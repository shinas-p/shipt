-- ==============================================================================
-- Shipt Mart — Super Admin–Controlled Maintenance Mode Migration
-- Version: 20261025000000
-- Target: Supabase / PostgreSQL 15+
--
-- Summary of Changes:
-- 1. Extend public.store_settings table with persistent maintenance mode columns:
--    - is_maintenance_mode (boolean)
--    - maintenance_message (text)
--    - maintenance_reopen_at (timestamptz)
--    - maintenance_updated_at (timestamptz)
--    - maintenance_updated_by (uuid -> auth.users)
-- 2. Verify Row-Level Security: public read, strictly Super Admin modify.
-- 3. Super Admin RPC public.admin_set_maintenance_mode() for trusted atomic updates
--    with audit trail logging in public.admin_audit_logs.
-- 4. Super Admin RPC public.admin_get_maintenance_audit_logs() for audit inspection.
-- 5. Safe guard in public.create_order_with_inventory() to block checkout & direct
--    API submissions whenever maintenance mode is active.
-- ==============================================================================

-- 1. Extend public.store_settings
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS is_maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_message text NOT NULL 
    DEFAULT 'We are currently restocking our inventory and updating our catalogue. We will be back shortly!',
  ADD COLUMN IF NOT EXISTS maintenance_reopen_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS maintenance_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS maintenance_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Ensure RLS is active on store_settings
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_settings_public_read" ON public.store_settings;
CREATE POLICY "store_settings_public_read" ON public.store_settings
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "store_settings_super_admin_modify" ON public.store_settings;
CREATE POLICY "store_settings_super_admin_modify" ON public.store_settings
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 3. Super Admin RPC: Set Maintenance Mode
CREATE OR REPLACE FUNCTION public.admin_set_maintenance_mode(
  p_enabled boolean,
  p_message text DEFAULT NULL,
  p_reopen_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_email text;
  v_clean_message text;
BEGIN
  -- Strict Super Admin authorization
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators can configure Maintenance Mode.';
  END IF;

  SELECT lower(email) INTO v_actor_email FROM auth.users WHERE id = auth.uid();
  v_clean_message := COALESCE(NULLIF(TRIM(p_message), ''), 'We are currently restocking our inventory. We will be back shortly!');

  -- Upsert authoritative store settings row
  INSERT INTO public.store_settings (
    id,
    is_maintenance_mode,
    maintenance_message,
    maintenance_reopen_at,
    maintenance_updated_at,
    maintenance_updated_by
  ) VALUES (
    'default',
    p_enabled,
    v_clean_message,
    p_reopen_at,
    now(),
    auth.uid()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    is_maintenance_mode = EXCLUDED.is_maintenance_mode,
    maintenance_message = EXCLUDED.maintenance_message,
    maintenance_reopen_at = EXCLUDED.maintenance_reopen_at,
    maintenance_updated_at = now(),
    maintenance_updated_by = auth.uid();

  -- Record in admin audit log
  INSERT INTO public.admin_audit_logs (
    actor_id,
    actor_email,
    target_user_id,
    target_email,
    action,
    details,
    created_at
  ) VALUES (
    auth.uid(),
    COALESCE(v_actor_email, 'system'),
    NULL,
    'storefront',
    CASE WHEN p_enabled THEN 'maintenance_mode_enabled' ELSE 'maintenance_mode_disabled' END,
    jsonb_build_object(
      'is_maintenance_mode', p_enabled,
      'maintenance_message', v_clean_message,
      'maintenance_reopen_at', p_reopen_at
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'is_maintenance_mode', p_enabled,
    'maintenance_message', v_clean_message,
    'maintenance_reopen_at', p_reopen_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_maintenance_mode(boolean, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_maintenance_mode(boolean, text, timestamptz) TO authenticated;

-- 4. Super Admin RPC: Get Maintenance Audit Logs
CREATE OR REPLACE FUNCTION public.admin_get_maintenance_audit_logs(p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  actor_email text,
  action text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Strict Super Admin authorization
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators can view maintenance audit logs.';
  END IF;

  RETURN QUERY
  SELECT l.id, l.actor_email, l.action, l.details, l.created_at
  FROM public.admin_audit_logs l
  WHERE l.action IN ('maintenance_mode_enabled', 'maintenance_mode_disabled')
  ORDER BY l.created_at DESC
  LIMIT LEAST(p_limit, 50);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_maintenance_audit_logs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_maintenance_audit_logs(integer) TO authenticated;

-- 5. Safe Maintenance Guard in create_order_with_inventory
CREATE OR REPLACE FUNCTION public.create_order_with_inventory(order_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_is_maintenance boolean;
  v_maintenance_msg text;

  v_user_id uuid;
  v_guest_token text := NULL;
  v_customer_name text;
  v_customer_phone text;
  v_delivery_method text;
  v_hostel text;
  v_block text;
  v_room text;
  v_pickup_location text;
  v_delivery_instructions text;
  v_payment_method text;
  v_items jsonb;
  v_raw_item jsonb;
  v_cart_item record;

  v_order_id uuid;
  v_order_number text;
  v_attempts integer := 0;
  v_subtotal numeric(10, 2) := 0;
  v_delivery_fee numeric(10, 2) := 0;
  v_total_amount numeric(10, 2) := 0;

  v_product_id uuid;
  v_qty integer;
  v_db_stock integer;
  v_db_price numeric(10, 2);
  v_db_name text;
  v_db_size text;
  v_line_total numeric(10, 2);
BEGIN
  -- 0. Server-Side Maintenance Mode & Store Settings Guard
  SELECT is_maintenance_mode, maintenance_message
  INTO v_is_maintenance, v_maintenance_msg
  FROM public.store_settings
  WHERE id = 'default';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'System Configuration Error: Store settings record (id = ''default'') was not found. Checkout halted for system safety.';
  END IF;

  IF v_is_maintenance IS TRUE THEN
    RAISE EXCEPTION 'Maintenance Mode Active: %', COALESCE(NULLIF(TRIM(v_maintenance_msg), ''), 'Shipt Mart is temporarily closed for restocking and catalogue maintenance. No new orders can be accepted at this time.');
  END IF;

  -- Extract caller (NULL for guests)
  v_user_id := auth.uid();

  -- If guest checkout, generate a high-entropy 256-bit cryptographically secure tracking token
  IF v_user_id IS NULL THEN
    v_guest_token := encode(extensions.gen_random_bytes(32), 'hex');
  END IF;

  -- Extract and validate fields
  v_customer_name := TRIM(order_payload->>'customer_name');
  v_customer_phone := TRIM(order_payload->>'customer_phone');
  v_delivery_method := TRIM(order_payload->>'delivery_method');
  v_hostel := order_payload->>'hostel';
  v_block := order_payload->>'block';
  v_room := order_payload->>'room';
  v_pickup_location := order_payload->>'pickup_location';
  v_delivery_instructions := order_payload->>'delivery_instructions';
  v_payment_method := TRIM(order_payload->>'payment_method');
  v_items := order_payload->'items';

  IF v_customer_name IS NULL OR LENGTH(v_customer_name) < 2 THEN
    RAISE EXCEPTION 'Invalid customer name: must be at least 2 characters';
  END IF;

  IF v_customer_phone IS NULL OR LENGTH(v_customer_phone) < 10 THEN
    RAISE EXCEPTION 'Invalid customer phone number: must be at least 10 digits';
  END IF;

  IF v_delivery_method NOT IN ('hostel_delivery', 'campus_pickup') THEN
    RAISE EXCEPTION 'Invalid delivery method: must be hostel_delivery or campus_pickup';
  END IF;

  IF v_delivery_method = 'hostel_delivery' AND (v_hostel IS NULL OR v_room IS NULL) THEN
    RAISE EXCEPTION 'Hostel and room number are required for hostel delivery';
  END IF;

  IF v_payment_method NOT IN ('upi', 'cod') THEN
    RAISE EXCEPTION 'Invalid payment method: must be upi or cod';
  END IF;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- High-Entropy Order Number with collision-safe retry loop
  LOOP
    v_order_number := 'QM-' || to_char(now(), 'YYYYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE order_number = v_order_number);
    v_attempts := v_attempts + 1;
    IF v_attempts > 5 THEN
      RAISE EXCEPTION 'Failed to generate a unique order number. Please try again.';
    END IF;
  END LOOP;

  -- Create order record
  INSERT INTO public.orders (
    order_number, user_id, guest_tracking_token, customer_name, customer_phone, delivery_method,
    hostel, block, room, pickup_location, delivery_instructions,
    status, subtotal, delivery_fee, discount_amount, total_amount,
    payment_method, payment_status
  ) VALUES (
    v_order_number, v_user_id, v_guest_token, v_customer_name, v_customer_phone, v_delivery_method,
    v_hostel, v_block, v_room, v_pickup_location, v_delivery_instructions,
    'placed', 0, v_delivery_fee, 0, 0,
    v_payment_method, 'pending'
  ) RETURNING id INTO v_order_id;

  -- Validate line items structure before locking
  FOR v_raw_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    IF (v_raw_item->>'product_id') IS NULL OR (v_raw_item->>'product_id') = '' THEN
      RAISE EXCEPTION 'Missing product_id in cart item';
    END IF;

    IF (v_raw_item->>'quantity') IS NULL OR (v_raw_item->>'quantity')::integer <= 0 THEN
      RAISE EXCEPTION 'Invalid item quantity: %', (v_raw_item->>'quantity');
    END IF;
  END LOOP;

  -- Process line items with deterministic UUID ordering (FOR UPDATE)
  -- Consolidates duplicate product IDs to guarantee exact stock verification and eliminate deadlocks
  FOR v_cart_item IN
    SELECT
      (item->>'product_id')::uuid AS product_id,
      SUM((item->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(v_items) AS item
    GROUP BY (item->>'product_id')::uuid
    ORDER BY (item->>'product_id')::uuid ASC
  LOOP
    v_product_id := v_cart_item.product_id;
    v_qty := v_cart_item.quantity;

    -- Row lock on product in deterministic order to prevent concurrent overselling & deadlock race conditions
    SELECT stock, price, name, size
    INTO v_db_stock, v_db_price, v_db_name, v_db_size
    FROM public.products
    WHERE id = v_product_id AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % is not available or does not exist', v_product_id;
    END IF;

    IF v_db_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for "%": only % available (requested %)', v_db_name, v_db_stock, v_qty;
    END IF;

    v_line_total := v_db_price * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    -- Decrement stock atomically
    UPDATE public.products
    SET stock = stock - v_qty, updated_at = now()
    WHERE id = v_product_id;

    -- Record stock movement ledger
    INSERT INTO public.inventory_movements (
      product_id, order_id, movement_type, quantity_change,
      previous_stock, new_stock, reason, performed_by
    ) VALUES (
      v_product_id, v_order_id, 'order_deduction', -v_qty,
      v_db_stock, v_db_stock - v_qty, 'Customer order ' || v_order_number, v_user_id
    );

    -- Insert snapshot line item
    INSERT INTO public.order_items (
      order_id, product_id, product_name, product_size,
      unit_price, quantity, total_price
    ) VALUES (
      v_order_id, v_product_id, v_db_name, v_db_size,
      v_db_price, v_qty, v_line_total
    );
  END LOOP;

  v_total_amount := v_subtotal + v_delivery_fee;

  -- Update order with verified totals
  UPDATE public.orders
  SET subtotal = v_subtotal, total_amount = v_total_amount, updated_at = now()
  WHERE id = v_order_id;

  -- Create initial payment record (locked at pending)
  INSERT INTO public.payments (
    order_id, payment_method, amount, status
  ) VALUES (
    v_order_id, v_payment_method, v_total_amount, 'pending'
  );

  -- Record initial order status history
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    v_order_id, NULL, 'placed', v_user_id, 'Order created via checkout'
  );

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'guest_tracking_token', v_guest_token,
    'total_amount', v_total_amount,
    'status', 'placed',
    'payment_method', v_payment_method,
    'payment_status', 'pending'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_order_with_inventory(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_with_inventory(jsonb) TO authenticated, anon, service_role;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
