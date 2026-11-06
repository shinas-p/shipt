-- ==============================================================================
-- Shipz Mart — Direct UPI, Cash on Delivery (COD) & Anti-Fake-Order Protection
-- Migration Version: 20261106000000
-- ==============================================================================
-- 1. Store Payment & Direct UPI Settings:
--    - Configurable UPI ID (default: '9605174298@upi') and Payee Name ('Shipt Mart')
--    - Configurable QR Code URL, COD limits, and first-order review toggle
-- 2. Anti-Abuse & Customer Moderation:
--    - Strict authentication guard (disables guest checkout)
--    - Blocklist fields and cancellation tracking on public.profiles
--    - Audit logging in public.customer_restriction_audit_logs
-- 3. Direct UPI Payment Proof:
--    - Screenshot tracking & verification fields on public.payments
--    - Unique partial index preventing duplicate UPI transaction references
--    - Private storage bucket 'payment-screenshots' with folder-scoped customer RLS
-- 4. Order Lifecycle & Status Hardening:
--    - Adds 'awaiting_payment', 'awaiting_approval' to orders.status
--    - Adds 'verification_pending' to orders.payment_status
--    - Adds first-order approval tracking on public.orders
-- 5. RPC Hardening:
--    - create_order_with_inventory (anti-fake-order controls, duplicate throttling)
--    - submit_order_payment_proof (customer proof submission)
--    - admin_verify_payment (manual ledger verification & order confirmation)
--    - admin_approve_first_time_cod (first-order approval)
--    - admin_set_customer_block_status (moderation & audit logging)
--    - customer_cancel_order (cancellation counter tracking)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTEND STORE SETTINGS WITH DIRECT UPI & COD CONTROLS
-- ------------------------------------------------------------------------------
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS upi_id text NOT NULL DEFAULT '9605174298@upi',
  ADD COLUMN IF NOT EXISTS upi_payee_name text NOT NULL DEFAULT 'Shipt Mart',
  ADD COLUMN IF NOT EXISTS upi_qr_code_url text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS max_active_cod_orders integer NOT NULL DEFAULT 1 CHECK (max_active_cod_orders >= 1),
  ADD COLUMN IF NOT EXISTS max_cod_order_amount numeric(10, 2) NOT NULL DEFAULT 500.00 CHECK (max_cod_order_amount > 0),
  ADD COLUMN IF NOT EXISTS require_first_order_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS duplicate_order_window_seconds integer NOT NULL DEFAULT 120 CHECK (duplicate_order_window_seconds >= 0);

-- ------------------------------------------------------------------------------
-- 2. EXTEND PAYMENTS WITH SCREENSHOT & VERIFICATION FIELDS
-- ------------------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS screenshot_path text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS screenshot_uploaded_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS verification_notes text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text DEFAULT NULL;

-- Prevent reuse of the same non-empty UPI reference number across distinct orders
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_upi_ref
  ON public.payments (lower(trim(upi_reference_number)))
  WHERE upi_reference_number IS NOT NULL AND trim(upi_reference_number) != '';

-- ------------------------------------------------------------------------------
-- 3. EXTEND PROFILES WITH BLOCKLIST & CANCELLATION TRACKING
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cancellation_count integer NOT NULL DEFAULT 0 CHECK (cancellation_count >= 0),
  ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS blocked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_is_blocked ON public.profiles(is_blocked) WHERE is_blocked = true;

-- ------------------------------------------------------------------------------
-- 4. CUSTOMER RESTRICTION AUDIT LOGS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_restriction_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('blocked', 'unblocked', 'cash_restricted', 'cash_restored', 'policy_override')),
  reason text NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_restriction_audit_cust ON public.customer_restriction_audit_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_restriction_audit_date ON public.customer_restriction_audit_logs(created_at DESC);

ALTER TABLE public.customer_restriction_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_restriction_audit_admin_read" ON public.customer_restriction_audit_logs;
CREATE POLICY "customer_restriction_audit_admin_read" ON public.customer_restriction_audit_logs
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "customer_restriction_audit_admin_insert" ON public.customer_restriction_audit_logs;
CREATE POLICY "customer_restriction_audit_admin_insert" ON public.customer_restriction_audit_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- 5. ORDER CONSTRAINTS & FIRST-ORDER TRACKING
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  -- Extended order statuses: includes awaiting_payment, awaiting_approval
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
  ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
    CHECK (status IN (
      'awaiting_payment',
      'pending_payment',
      'awaiting_approval',
      'placed',
      'confirmed',
      'preparing',
      'ready_for_pickup',
      'out_for_delivery',
      'completed',
      'cancelled'
    ));

  -- Extended payment statuses: includes verification_pending
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
  ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
    CHECK (payment_status IN (
      'pending',
      'verification_pending',
      'processing',
      'paid',
      'completed',
      'failed',
      'expired',
      'refund_pending',
      'refunded'
    ));
END $$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_first_order boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_notes text DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_payment_status_pending_verif
  ON public.orders(payment_status) WHERE payment_status = 'verification_pending';

CREATE INDEX IF NOT EXISTS idx_orders_status_awaiting_approval
  ON public.orders(status) WHERE status = 'awaiting_approval';

-- ------------------------------------------------------------------------------
-- 6. PRIVATE STORAGE BUCKET: payment-screenshots
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-screenshots',
  'payment-screenshots',
  false, -- STRICTLY PRIVATE: no public exposure
  5242880, -- 5 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Storage RLS: Customer uploads restricted strictly to their own user folder: {user_id}/*
DROP POLICY IF EXISTS "payment_screenshots_customer_upload" ON storage.objects;
CREATE POLICY "payment_screenshots_customer_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage RLS: Customer can only view their own screenshots; Admins can view any screenshot
DROP POLICY IF EXISTS "payment_screenshots_select" ON storage.objects;
CREATE POLICY "payment_screenshots_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-screenshots'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

-- ------------------------------------------------------------------------------
-- 7. NOTIFICATIONS CONSTRAINTS EXTENSION
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE public.admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_event_type_check;
  ALTER TABLE public.admin_notifications ADD CONSTRAINT admin_notifications_event_type_check
    CHECK (event_type IN (
      'new_order',
      'order_cancelled',
      'payment_attention',
      'new_suggestion',
      'low_stock',
      'system_alert',
      'payment_initiated',
      'payment_success',
      'payment_failed',
      'payment_pending_timeout',
      'payment_suspicious_callback',
      'refund_requested',
      'refund_status_changed',
      'order_status_changed',
      'payment_proof_submitted',
      'cod_approval_needed'
    ));
END $$;

-- ------------------------------------------------------------------------------
-- 8. TRANSACTIONAL RPC: create_order_with_inventory
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_with_inventory(order_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_is_maintenance boolean;
  v_maintenance_msg text;
  v_cash_enabled boolean;
  v_online_enabled boolean;
  v_guest_cash_allowed boolean;
  v_max_active_cod integer;
  v_max_cod_amount numeric(10, 2);
  v_require_first_approval boolean;
  v_dup_window_secs integer;

  v_user_id uuid;
  v_student_policy text := 'default';
  v_cash_restricted boolean := false;
  v_restriction_reason text;
  v_is_blocked boolean := false;
  v_blocked_reason text;

  v_customer_name text;
  v_customer_phone text;
  v_delivery_method text;
  v_delivery_block_id text;
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

  v_initial_status text;
  v_is_first_order boolean := false;
  v_active_cod_count integer := 0;
  v_completed_orders_count integer := 0;
  v_payment_expires_at timestamptz := NULL;
BEGIN
  -- 0. Server-Side Maintenance Mode & Settings Guard
  SELECT
    is_maintenance_mode,
    maintenance_message,
    COALESCE(cash_payment_enabled, true),
    COALESCE(online_payment_enabled, true),
    COALESCE(guest_cash_allowed, true),
    COALESCE(max_active_cod_orders, 1),
    COALESCE(max_cod_order_amount, 500.00),
    COALESCE(require_first_order_approval, true),
    COALESCE(duplicate_order_window_seconds, 120)
  INTO
    v_is_maintenance,
    v_maintenance_msg,
    v_cash_enabled,
    v_online_enabled,
    v_guest_cash_allowed,
    v_max_active_cod,
    v_max_cod_amount,
    v_require_first_approval,
    v_dup_window_secs
  FROM public.store_settings
  WHERE id = 'default';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'System Configuration Error: Store settings record was not found.';
  END IF;

  IF v_is_maintenance IS TRUE THEN
    RAISE EXCEPTION 'Maintenance Mode Active: %', COALESCE(NULLIF(TRIM(v_maintenance_msg), ''), 'Shipt Mart is temporarily closed for restocking.');
  END IF;

  -- 1. Anti-Abuse: Require Authenticated Account (Disable Guest Checkout)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign-in required: Guest checkout is disabled. Please log in to your account to place an order.';
  END IF;

  -- 2. Anti-Abuse: Customer Blocklist & Policy Verification
  SELECT
    COALESCE(payment_policy, 'default'),
    COALESCE(cash_restricted, false),
    cash_restriction_reason,
    COALESCE(is_blocked, false),
    blocked_reason
  INTO
    v_student_policy,
    v_cash_restricted,
    v_restriction_reason,
    v_is_blocked,
    v_blocked_reason
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_is_blocked IS TRUE THEN
    RAISE EXCEPTION 'Your account has been restricted from placing orders: %. Please contact store administration.',
      COALESCE(v_blocked_reason, 'Account restricted');
  END IF;

  -- 3. Extract and Validate Customer & Delivery Information
  v_customer_name := TRIM(order_payload->>'customer_name');
  v_customer_phone := TRIM(order_payload->>'customer_phone');
  v_delivery_method := TRIM(order_payload->>'delivery_method');
  v_delivery_block_id := NULLIF(TRIM(order_payload->>'delivery_block_id'), '');
  v_hostel := NULLIF(TRIM(order_payload->>'hostel'), '');
  v_block := NULLIF(TRIM(order_payload->>'block'), '');
  v_room := NULLIF(TRIM(order_payload->>'room'), '');
  v_pickup_location := NULLIF(TRIM(order_payload->>'pickup_location'), '');
  v_delivery_instructions := NULLIF(TRIM(order_payload->>'delivery_instructions'), '');
  v_payment_method := TRIM(order_payload->>'payment_method');
  v_items := order_payload->'items';

  IF v_customer_name IS NULL OR LENGTH(v_customer_name) < 2 THEN
    RAISE EXCEPTION 'Customer name is required (minimum 2 characters)';
  END IF;

  IF v_customer_phone IS NULL OR LENGTH(v_customer_phone) < 10 THEN
    RAISE EXCEPTION 'Customer mobile number is required (minimum 10 digits)';
  END IF;

  IF v_delivery_method NOT IN ('hostel_delivery', 'campus_pickup') THEN
    RAISE EXCEPTION 'Invalid delivery method: must be hostel_delivery or campus_pickup';
  END IF;

  IF v_delivery_method = 'hostel_delivery' THEN
    IF v_delivery_block_id IS NULL AND v_block IS NOT NULL THEN
      v_delivery_block_id := v_block;
    END IF;

    IF v_delivery_block_id IS NULL THEN
      RAISE EXCEPTION 'Please select your delivery block for hostel delivery.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.delivery_blocks WHERE id = v_delivery_block_id AND is_active = true) THEN
      RAISE EXCEPTION 'Invalid delivery block "%". Please select an active delivery block from the list.', v_delivery_block_id;
    END IF;

    IF v_hostel IS NULL THEN
      v_hostel := v_delivery_block_id;
    END IF;

    IF v_block IS NULL THEN
      v_block := v_delivery_block_id;
    END IF;

    IF v_room IS NULL OR LENGTH(v_room) < 1 THEN
      RAISE EXCEPTION 'Room number is required for hostel delivery.';
    END IF;
  ELSIF v_delivery_method = 'campus_pickup' THEN
    v_delivery_block_id := NULL;
    v_block := NULL;
    v_hostel := NULL;
    v_room := NULL;
    IF v_pickup_location IS NULL THEN
      v_pickup_location := 'Main Store Counter';
    END IF;
  END IF;

  -- 4. Anti-Abuse: Rapid Duplicate Order Throttling
  IF v_dup_window_secs > 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.orders
      WHERE user_id = v_user_id
        AND created_at > now() - (v_dup_window_secs || ' seconds')::interval
        AND status NOT IN ('cancelled', 'failed')
    ) THEN
      RAISE EXCEPTION 'Please wait a moment before placing another order. A recent order was placed just now.';
    END IF;
  END IF;

  -- 5. Payment Method & Policy Enforcement
  IF v_payment_method NOT IN ('upi', 'cod') THEN
    RAISE EXCEPTION 'Invalid payment method: must be upi or cod';
  END IF;

  IF v_payment_method = 'cod' THEN
    IF v_cash_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Cash on Delivery is currently disabled by store policy. Please select Direct UPI payment.';
    END IF;

    IF v_student_policy = 'online_only' THEN
      RAISE EXCEPTION 'Cash orders are not permitted for your student account policy (Online Only). Please use Direct UPI.';
    END IF;

    IF v_cash_restricted IS TRUE AND v_student_policy != 'cash_and_online' THEN
      RAISE EXCEPTION 'Cash orders are temporarily restricted for your account: %. Please use Direct UPI or contact store support.',
        COALESCE(v_restriction_reason, 'Repeated uncollected cash orders');
    END IF;

    -- Active unpaid COD orders cap
    SELECT COUNT(*) INTO v_active_cod_count
    FROM public.orders
    WHERE user_id = v_user_id
      AND payment_method = 'cod'
      AND status NOT IN ('completed', 'cancelled')
      AND payment_status != 'paid';

    IF v_active_cod_count >= v_max_active_cod THEN
      RAISE EXCEPTION 'Active COD order limit reached (% max active unpaid orders). Please complete your existing orders first or pay via Direct UPI.', v_max_active_cod;
    END IF;

    -- First-time customer review check: requires at least one successfully completed and settled purchase
    SELECT COUNT(*) INTO v_completed_orders_count
    FROM public.orders
    WHERE user_id = v_user_id
      AND status = 'completed'
      AND payment_status IN ('paid', 'completed');

    IF v_completed_orders_count = 0 AND v_require_first_approval IS TRUE THEN
      v_is_first_order := true;
      v_initial_status := 'awaiting_approval';
    ELSE
      v_is_first_order := false;
      v_initial_status := 'placed';
    END IF;

  ELSE -- UPI / Online
    IF v_online_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Direct UPI payment is currently disabled by store policy.';
    END IF;

    IF v_student_policy = 'cash_only' THEN
      RAISE EXCEPTION 'Online payment is not permitted for your account policy (Cash Only). Please select Cash on Delivery.';
    END IF;

    v_initial_status := 'awaiting_payment';
    v_payment_expires_at := now() + interval '30 minutes';
  END IF;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- 6. Generate High-Entropy Order Number
  LOOP
    v_order_number := 'QM-' || to_char(now(), 'YYYYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE order_number = v_order_number);
    v_attempts := v_attempts + 1;
    IF v_attempts > 5 THEN
      RAISE EXCEPTION 'Failed to generate a unique order number. Please try again.';
    END IF;
  END LOOP;

  -- 7. Insert Order Record
  INSERT INTO public.orders (
    order_number, user_id, guest_tracking_token, customer_name, customer_phone, delivery_method,
    delivery_block_id, hostel, block, room, pickup_location, delivery_instructions,
    status, subtotal, delivery_fee, discount_amount, total_amount,
    payment_method, payment_status, is_first_order, payment_expires_at
  ) VALUES (
    v_order_number, v_user_id, NULL, v_customer_name, v_customer_phone, v_delivery_method,
    v_delivery_block_id, v_hostel, v_block, v_room, v_pickup_location, v_delivery_instructions,
    v_initial_status, 0, v_delivery_fee, 0, 0,
    v_payment_method, 'pending', v_is_first_order, v_payment_expires_at
  ) RETURNING id INTO v_order_id;

  -- 8. Validate & Process Line Items with Atomic Lock
  FOR v_raw_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    IF (v_raw_item->>'product_id') IS NULL OR (v_raw_item->>'product_id') = '' THEN
      RAISE EXCEPTION 'Missing product_id in cart item';
    END IF;

    IF (v_raw_item->>'quantity') IS NULL OR (v_raw_item->>'quantity')::integer <= 0 THEN
      RAISE EXCEPTION 'Invalid item quantity: %', (v_raw_item->>'quantity');
    END IF;
  END LOOP;

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

    UPDATE public.products
    SET stock = stock - v_qty, updated_at = now()
    WHERE id = v_product_id;

    INSERT INTO public.inventory_movements (
      product_id, order_id, movement_type, quantity_change,
      previous_stock, new_stock, reason, performed_by
    ) VALUES (
      v_product_id, v_order_id, 'order_deduction', -v_qty,
      v_db_stock, v_db_stock - v_qty, 'Order ' || v_order_number || ' reservation', v_user_id
    );

    INSERT INTO public.order_items (
      order_id, product_id, product_name, product_size,
      unit_price, quantity, total_price
    ) VALUES (
      v_order_id, v_product_id, v_db_name, v_db_size,
      v_db_price, v_qty, v_line_total
    );
  END LOOP;

  v_total_amount := v_subtotal + v_delivery_fee;

  -- 9. Check Maximum COD Amount Limit
  IF v_payment_method = 'cod' AND v_total_amount > v_max_cod_amount THEN
    RAISE EXCEPTION 'Cash on Delivery is limited to orders up to ₹%. Your order total is ₹%. Please select Direct UPI payment.',
      v_max_cod_amount, v_total_amount;
  END IF;

  UPDATE public.orders
  SET subtotal = v_subtotal, total_amount = v_total_amount, updated_at = now()
  WHERE id = v_order_id;

  -- 10. Record Initial Payment Entry
  INSERT INTO public.payments (
    order_id, payment_method, amount, status
  ) VALUES (
    v_order_id, v_payment_method, v_total_amount, 'pending'
  );

  -- 11. Record Order Status History
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    v_order_id, NULL, v_initial_status, v_user_id,
    CASE
      WHEN v_initial_status = 'awaiting_approval' THEN 'First-time COD order placed — awaiting staff approval'
      WHEN v_initial_status = 'awaiting_payment' THEN 'Direct UPI order placed — awaiting payment proof submission'
      ELSE 'Order placed via checkout'
    END
  );

  -- 12. Notify Admin for First-Time COD Orders
  IF v_initial_status = 'awaiting_approval' THEN
    INSERT INTO public.admin_notifications (
      order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_order_id, v_order_number, 'cod_approval_needed',
      'First-Time COD Order: #' || v_order_number,
      'First-time customer ' || v_customer_name || ' placed a COD order for ₹' || v_total_amount || '. Approval required.',
      jsonb_build_object('order_id', v_order_id, 'amount', v_total_amount, 'customer_name', v_customer_name),
      'admin_cod_appr_' || v_order_id::text
    ) ON CONFLICT (dedup_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'guest_tracking_token', NULL,
    'total_amount', v_total_amount,
    'status', v_initial_status,
    'payment_method', v_payment_method,
    'payment_status', 'pending',
    'is_first_order', v_is_first_order,
    'delivery_block_id', v_delivery_block_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_order_with_inventory(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_with_inventory(jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. CUSTOMER RPC: submit_order_payment_proof
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_order_payment_proof(
  p_order_id uuid,
  p_screenshot_path text,
  p_upi_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller uuid;
  v_order record;
  v_clean_ref text;
  v_clean_path text;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit payment proof.';
  END IF;

  v_clean_path := NULLIF(TRIM(p_screenshot_path), '');
  IF v_clean_path IS NULL THEN
    RAISE EXCEPTION 'Screenshot path is required.';
  END IF;

  v_clean_ref := NULLIF(TRIM(p_upi_ref), '');

  SELECT id, user_id, order_number, total_amount, status, payment_status, payment_method
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  IF v_order.user_id != v_caller AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: You do not own this order.';
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot submit payment proof for a cancelled order.';
  END IF;

  -- Validate duplicate UPI reference if provided
  IF v_clean_ref IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.payments
      WHERE lower(trim(upi_reference_number)) = lower(v_clean_ref)
        AND order_id != p_order_id
        AND status IN ('pending', 'processing', 'paid', 'completed')
    ) THEN
      RAISE EXCEPTION 'This UPI reference number has already been submitted for another order. Please check and provide the correct reference.';
    END IF;
  END IF;

  UPDATE public.payments
  SET
    screenshot_path = v_clean_path,
    screenshot_uploaded_at = now(),
    upi_reference_number = COALESCE(v_clean_ref, upi_reference_number),
    status = 'pending',
    updated_at = now()
  WHERE order_id = p_order_id;

  UPDATE public.orders
  SET
    payment_status = 'verification_pending',
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    p_order_id, v_order.status, v_order.status, v_caller,
    'Payment proof submitted for manual verification' || CASE WHEN v_clean_ref IS NOT NULL THEN ' (Ref: ' || v_clean_ref || ')' ELSE '' END
  );

  INSERT INTO public.admin_notifications (
    order_id, order_number, event_type, title, message, metadata, dedup_key
  ) VALUES (
    p_order_id, v_order.order_number, 'payment_attention',
    'Payment Proof Submitted: #' || v_order.order_number,
    'Customer submitted UPI payment proof for ₹' || v_order.total_amount || '. Verification required.',
    jsonb_build_object('order_id', p_order_id, 'order_number', v_order.order_number, 'amount', v_order.total_amount, 'upi_ref', v_clean_ref, 'screenshot_path', v_clean_path),
    'admin_pay_proof_' || p_order_id::text
  ) ON CONFLICT (dedup_key) DO UPDATE SET
    created_at = now(),
    is_read = false,
    message = EXCLUDED.message,
    metadata = EXCLUDED.metadata;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'payment_status', 'verification_pending',
    'screenshot_path', v_clean_path,
    'upi_ref', v_clean_ref
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_order_payment_proof(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_order_payment_proof(uuid, text, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 10. ADMIN RPC: admin_verify_payment
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_verify_payment(
  p_payment_id uuid,
  p_status text,
  p_upi_ref text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_order_id uuid;
  v_order_status text;
  v_order_num text;
  v_user_id uuid;
  v_total numeric(10, 2);
  v_clean_ref text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Administrator permission required';
  END IF;

  v_clean_ref := NULLIF(TRIM(p_upi_ref), '');

  IF p_status IN ('paid', 'completed') AND v_clean_ref IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.payments
      WHERE lower(trim(upi_reference_number)) = lower(v_clean_ref)
        AND id != p_payment_id
        AND status IN ('paid', 'completed')
    ) THEN
      RAISE EXCEPTION 'Duplicate UPI reference: "%" is already linked to another verified payment.', v_clean_ref;
    END IF;
  END IF;

  UPDATE public.payments
  SET
    status = p_status,
    upi_reference_number = COALESCE(v_clean_ref, upi_reference_number),
    verified_by = auth.uid(),
    verified_at = now(),
    verification_notes = COALESCE(p_notes, verification_notes),
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_payment_id
  RETURNING order_id INTO v_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found';
  END IF;

  SELECT status, order_number, user_id, total_amount
  INTO v_order_status, v_order_num, v_user_id, v_total
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF p_status IN ('paid', 'completed') THEN
    UPDATE public.orders
    SET
      payment_status = 'paid',
      status = CASE
        WHEN status IN ('awaiting_payment', 'pending_payment', 'placed') THEN 'confirmed'
        ELSE status
      END,
      updated_at = now()
    WHERE id = v_order_id;

    INSERT INTO public.order_status_history (
      order_id, previous_status, new_status, changed_by, notes
    ) VALUES (
      v_order_id, v_order_status,
      CASE WHEN v_order_status IN ('awaiting_payment', 'pending_payment', 'placed') THEN 'confirmed' ELSE v_order_status END,
      auth.uid(),
      'Payment verified by staff' || CASE WHEN p_notes IS NOT NULL THEN ': ' || p_notes ELSE '' END
    );

    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.customer_notifications (
        user_id, order_id, order_number, event_type, title, message, metadata, dedup_key
      ) VALUES (
        v_user_id, v_order_id, v_order_num, 'order_confirmed',
        'Payment Verified #' || v_order_num,
        'Your payment of ₹' || v_total || ' has been verified. Order is confirmed and being prepared!',
        jsonb_build_object('order_id', v_order_id, 'payment_id', p_payment_id),
        'cust_pay_verified_' || v_order_id::text
      ) ON CONFLICT (dedup_key) DO NOTHING;
    END IF;

  ELSIF p_status = 'failed' THEN
    UPDATE public.orders
    SET
      payment_status = 'failed',
      updated_at = now()
    WHERE id = v_order_id;

    INSERT INTO public.order_status_history (
      order_id, previous_status, new_status, changed_by, notes
    ) VALUES (
      v_order_id, v_order_status, v_order_status, auth.uid(),
      'Payment proof rejected by staff: ' || COALESCE(p_notes, 'Invalid or unrecognized transaction')
    );

    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.customer_notifications (
        user_id, order_id, order_number, event_type, title, message, metadata, dedup_key
      ) VALUES (
        v_user_id, v_order_id, v_order_num, 'payment_failed',
        'Payment Verification Failed #' || v_order_num,
        'Payment proof could not be verified: ' || COALESCE(p_notes, 'Please submit a valid payment screenshot or transaction reference.'),
        jsonb_build_object('order_id', v_order_id, 'payment_id', p_payment_id, 'reason', p_notes),
        'cust_pay_failed_' || v_order_id::text || '_' || extract(epoch from now())::text
      ) ON CONFLICT (dedup_key) DO NOTHING;
    END IF;
  ELSE
    UPDATE public.orders
    SET payment_status = p_status, updated_at = now()
    WHERE id = v_order_id;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_verify_payment(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_payment(uuid, text, text, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 11. ADMIN RPC: admin_approve_first_time_cod
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_approve_first_time_cod(
  p_order_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_order record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Administrator permission required';
  END IF;

  SELECT id, status, order_number, user_id, total_amount
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status != 'awaiting_approval' THEN
    RAISE EXCEPTION 'Order is not awaiting approval (current status: %)', v_order.status;
  END IF;

  UPDATE public.orders
  SET
    status = 'confirmed',
    approval_notes = COALESCE(p_notes, 'First-time COD approved by staff'),
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    p_order_id, 'awaiting_approval', 'confirmed', auth.uid(),
    'First-time COD order approved by admin: ' || COALESCE(p_notes, 'Approved for processing')
  );

  IF v_order.user_id IS NOT NULL THEN
    INSERT INTO public.customer_notifications (
      user_id, order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_order.user_id, p_order_id, v_order.order_number, 'order_confirmed',
      'COD Order Approved #' || v_order.order_number,
      'Your Cash on Delivery order of ₹' || v_order.total_amount || ' has been approved and is now being prepared.',
      jsonb_build_object('order_id', p_order_id),
      'cust_cod_approved_' || p_order_id::text
    ) ON CONFLICT (dedup_key) DO NOTHING;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_approve_first_time_cod(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_first_time_cod(uuid, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 12. ADMIN RPC: admin_set_customer_block_status
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_customer_block_status(
  p_customer_id uuid,
  p_is_blocked boolean,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_clean_reason text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Administrator permission required';
  END IF;

  v_admin_id := auth.uid();
  v_clean_reason := NULLIF(TRIM(p_reason), '');
  IF p_is_blocked AND v_clean_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required when blocking a customer.';
  END IF;

  UPDATE public.profiles
  SET
    is_blocked = p_is_blocked,
    blocked_reason = CASE WHEN p_is_blocked THEN v_clean_reason ELSE NULL END,
    blocked_at = CASE WHEN p_is_blocked THEN now() ELSE NULL END,
    blocked_by = CASE WHEN p_is_blocked THEN v_admin_id ELSE NULL END,
    updated_at = now()
  WHERE id = p_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile not found';
  END IF;

  INSERT INTO public.customer_restriction_audit_logs (
    customer_id, action, reason, changed_by, metadata
  ) VALUES (
    p_customer_id,
    CASE WHEN p_is_blocked THEN 'blocked' ELSE 'unblocked' END,
    COALESCE(v_clean_reason, 'Block lifted by administrator'),
    v_admin_id,
    jsonb_build_object('blocked', p_is_blocked)
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_customer_block_status(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_customer_block_status(uuid, boolean, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 13. ADMIN RPC: admin_update_store_payment_settings (Overload with UPI & COD controls)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_update_store_payment_settings(boolean, boolean, boolean, integer);

CREATE OR REPLACE FUNCTION public.admin_update_store_payment_settings(
  p_cash_enabled boolean,
  p_online_enabled boolean,
  p_guest_cash_allowed boolean,
  p_threshold integer,
  p_upi_id text DEFAULT NULL,
  p_upi_payee_name text DEFAULT NULL,
  p_upi_qr_code_url text DEFAULT NULL,
  p_max_active_cod integer DEFAULT NULL,
  p_max_cod_amount numeric DEFAULT NULL,
  p_require_first_approval boolean DEFAULT NULL,
  p_dup_window_secs integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NOT (public.is_super_admin() OR public.is_owner()) THEN
    RAISE EXCEPTION 'Access Denied: Only Super Admin or Owner can update store-wide payment settings.';
  END IF;

  IF p_threshold < 1 THEN
    RAISE EXCEPTION 'Threshold must be at least 1.';
  END IF;

  UPDATE public.store_settings
  SET
    cash_payment_enabled = p_cash_enabled,
    online_payment_enabled = p_online_enabled,
    guest_cash_allowed = p_guest_cash_allowed,
    max_cash_no_shows_threshold = p_threshold,
    upi_id = COALESCE(NULLIF(TRIM(p_upi_id), ''), upi_id),
    upi_payee_name = COALESCE(NULLIF(TRIM(p_upi_payee_name), ''), upi_payee_name),
    upi_qr_code_url = CASE WHEN p_upi_qr_code_url IS NOT NULL THEN NULLIF(TRIM(p_upi_qr_code_url), '') ELSE upi_qr_code_url END,
    max_active_cod_orders = COALESCE(p_max_active_cod, max_active_cod_orders),
    max_cod_order_amount = COALESCE(p_max_cod_amount, max_cod_order_amount),
    require_first_order_approval = COALESCE(p_require_first_approval, require_first_order_approval),
    duplicate_order_window_seconds = COALESCE(p_dup_window_secs, duplicate_order_window_seconds),
    updated_at = now()
  WHERE id = 'default';

  RETURN jsonb_build_object(
    'success', true,
    'cash_payment_enabled', p_cash_enabled,
    'online_payment_enabled', p_online_enabled,
    'guest_cash_allowed', p_guest_cash_allowed,
    'max_cash_no_shows_threshold', p_threshold,
    'upi_id', p_upi_id,
    'upi_payee_name', p_upi_payee_name,
    'upi_qr_code_url', p_upi_qr_code_url,
    'max_active_cod_orders', p_max_active_cod,
    'max_cod_order_amount', p_max_cod_amount,
    'require_first_order_approval', p_require_first_approval,
    'duplicate_order_window_seconds', p_dup_window_secs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_store_payment_settings(boolean, boolean, boolean, integer, text, text, text, integer, numeric, boolean, integer) TO authenticated;

-- ------------------------------------------------------------------------------
-- 14. CUSTOMER RPC: customer_cancel_order (CANCELLATION COUNTER HOOK)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_cancel_order(
  p_order_id uuid DEFAULT NULL,
  p_guest_token text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_order_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_resolved_order_id uuid;
  v_order_user_id uuid;
  v_order_guest_token text;
  v_order_number text;
  v_status text;
  v_payment_status text;
  v_payment_method text;
  v_item record;
  v_curr_stock integer;
BEGIN
  v_caller_id := auth.uid();

  IF p_order_id IS NOT NULL THEN
    SELECT
      id, user_id, guest_tracking_token, order_number, status, payment_status, payment_method
    INTO
      v_resolved_order_id, v_order_user_id, v_order_guest_token, v_order_number,
      v_status, v_payment_status, v_payment_method
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;
  ELSIF p_order_number IS NOT NULL THEN
    SELECT
      id, user_id, guest_tracking_token, order_number, status, payment_status, payment_method
    INTO
      v_resolved_order_id, v_order_user_id, v_order_guest_token, v_order_number,
      v_status, v_payment_status, v_payment_method
    FROM public.orders
    WHERE order_number = p_order_number
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Invalid parameters: either p_order_id or p_order_number must be supplied.';
  END IF;

  IF v_resolved_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  IF v_order_user_id IS NOT NULL THEN
    IF v_caller_id IS NULL OR v_caller_id != v_order_user_id THEN
      RAISE EXCEPTION 'Unauthorized: you can only cancel your own account orders.';
    END IF;
  ELSE
    IF p_guest_token IS NULL OR p_guest_token != v_order_guest_token THEN
      RAISE EXCEPTION 'Unauthorized: invalid guest token for this order.';
    END IF;
  END IF;

  IF v_status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Order is already % and cannot be cancelled.', v_status;
  END IF;

  IF v_status IN ('out_for_delivery', 'ready_for_pickup') THEN
    RAISE EXCEPTION 'Order is already % and is past the cancellation cutoff.', v_status;
  END IF;

  -- Atomic stock restoration
  FOR v_item IN
    SELECT product_id, quantity
    FROM public.order_items
    WHERE order_id = v_resolved_order_id
    ORDER BY product_id ASC
  LOOP
    SELECT stock INTO v_curr_stock
    FROM public.products
    WHERE id = v_item.product_id
    FOR UPDATE;

    UPDATE public.products
    SET stock = v_curr_stock + v_item.quantity, updated_at = now()
    WHERE id = v_item.product_id;

    INSERT INTO public.inventory_movements (
      product_id, order_id, movement_type, quantity_change,
      previous_stock, new_stock, reason, performed_by
    ) VALUES (
      v_item.product_id, v_resolved_order_id, 'order_cancellation_restock', v_item.quantity,
      v_curr_stock, v_curr_stock + v_item.quantity,
      'Customer cancellation: ' || COALESCE(p_reason, 'Self-service cancel'), v_caller_id
    );
  END LOOP;

  IF v_payment_method IN ('upi', 'payu') AND v_payment_status IN ('completed', 'paid') THEN
    UPDATE public.payments
    SET
      notes = COALESCE(notes, '') || ' | Pending refund review following customer order cancellation.',
      updated_at = now()
    WHERE order_id = v_resolved_order_id;
  END IF;

  UPDATE public.orders
  SET
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  WHERE id = v_resolved_order_id;

  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    v_resolved_order_id, v_status, 'cancelled', v_caller_id,
    'Customer-initiated cancellation: ' || COALESCE(p_reason, 'No reason specified')
  );

  -- Track cancellation count on profile
  IF v_order_user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET
      cancellation_count = COALESCE(cancellation_count, 0) + 1,
      updated_at = now()
    WHERE id = v_order_user_id;
  END IF;

  INSERT INTO public.admin_notifications (
    order_id, order_number, event_type, title, message, metadata, dedup_key
  ) VALUES (
    v_resolved_order_id, v_order_number, 'order_cancelled',
    'Order #' || v_order_number || ' Cancelled',
    'Customer cancelled order #' || v_order_number || '. Reason: ' || COALESCE(p_reason, 'No reason specified') || '. Inventory restored.',
    jsonb_build_object(
      'order_id', v_resolved_order_id,
      'reason', p_reason,
      'user_id', v_order_user_id
    ),
    'admin_notif_cancel_' || v_resolved_order_id::text
  ) ON CONFLICT (dedup_key) DO UPDATE SET
    created_at = now(),
    is_read = false,
    message = EXCLUDED.message;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_resolved_order_id,
    'order_number', v_order_number,
    'status', 'cancelled'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_cancel_order(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_cancel_order(uuid, text, text, text) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
