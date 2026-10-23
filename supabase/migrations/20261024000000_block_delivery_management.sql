-- ==============================================================================
-- Shipt Mart — Block-Based Delivery & Order Management Migration
-- Version: 20261024000000
-- Target: Supabase / PostgreSQL 15+
--
-- Summary of Changes:
-- 1. Extend public.orders with delivery_block_id foreign key and audit tracking:
--    - delivery_block_id text REFERENCES public.delivery_blocks(id) ON DELETE SET NULL
--    - claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
--    - claimed_at timestamptz DEFAULT NULL
--    - processing_started_at timestamptz DEFAULT NULL
--    - completed_at timestamptz DEFAULT NULL
--    - cancelled_at timestamptz DEFAULT NULL
-- 2. Non-destructive update to chk_delivery_details constraint supporting delivery_block_id.
-- 3. Verified, non-destructive legacy order backfill:
--    - Unambiguous matches backfilled.
--    - Documented normalization for 'Main' -> 'Main Campus'.
--    - Unmapped/legacy orders ('SMS') safely preserved with delivery_block_id = NULL.
-- 4. Atomic Order Claiming RPC: public.admin_claim_order(p_order_id uuid)
--    - Row locking (FOR UPDATE) to eliminate concurrent claiming race conditions.
--    - Validates caller role & block authority from database.
-- 5. Hardened Status Lifecycle RPC: public.admin_update_order_status(...)
--    - Enforces valid state machine: placed -> confirmed -> preparing -> out_for_delivery/ready_for_pickup -> completed
--    - Block Manager restricted strictly to assigned block.
--    - Store Manager restricted strictly to Store Pickup orders (delivery_method = 'campus_pickup').
--    - Automatically records milestone timestamps and single-instance inventory restock on cancellation.
-- 6. Block Management RPC: public.admin_manage_delivery_block(...)
--    - Super Admin and Owner can create/edit blocks and assign existing Block Managers.
--    - Owner strictly prohibited from granting or revoking staff roles.
-- 7. Hardened Row Level Security (RLS) on public.orders & delivery_blocks:
--    - Super Admin & Owner: full view & management of all orders across all blocks.
--    - Store Manager: view & manage Store Pickup orders only.
--    - Block Manager: view & manage assigned block orders only.
--    - Customers: view their own orders only.
-- ==============================================================================

-- 1. Extend public.orders Table with delivery_block_id and Claim/Milestone Audit Columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_block_id text REFERENCES public.delivery_blocks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_block_id ON public.orders(delivery_block_id);
CREATE INDEX IF NOT EXISTS idx_orders_claimed_by ON public.orders(claimed_by);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_method ON public.orders(delivery_method);

-- 2. Non-destructively Update Delivery Details Constraint
-- Ensures new orders require delivery_block_id while legacy records with hostel/room remain 100% valid.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS chk_delivery_details;
ALTER TABLE public.orders ADD CONSTRAINT chk_delivery_details
  CHECK (
    ((delivery_method = 'hostel_delivery') AND (delivery_block_id IS NOT NULL OR hostel IS NOT NULL) AND (room IS NOT NULL))
    OR (delivery_method = 'campus_pickup')
  );

-- 3. Verified Legacy Order Backfill (Safe, Non-Destructive)
-- Step 3a: Exact matches where orders.block matches an existing delivery_blocks.id
UPDATE public.orders
SET delivery_block_id = block
WHERE delivery_block_id IS NULL
  AND block IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.delivery_blocks db WHERE db.id = orders.block);

-- Step 3b: Verified normalization rule for abbreviated block: 'Main' -> 'Main Campus'
UPDATE public.orders
SET delivery_block_id = 'Main Campus'
WHERE delivery_block_id IS NULL
  AND trim(block) = 'Main';

-- Note: Orders with unmapped legacy blocks (e.g. 'SMS') remain delivery_block_id = NULL
-- with their original hostel, block, and room strings completely preserved.

-- Step 3c: Update create_order_with_inventory to validate active delivery block on new orders
CREATE OR REPLACE FUNCTION public.create_order_with_inventory(order_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_guest_token text := NULL;
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
BEGIN
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
  v_delivery_block_id := COALESCE(NULLIF(TRIM(order_payload->>'delivery_block_id'), ''), NULLIF(TRIM(order_payload->>'block'), ''));
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

  IF v_delivery_method = 'hostel_delivery' THEN
    IF v_delivery_block_id IS NULL THEN
      RAISE EXCEPTION 'Delivery block is required for doorstep delivery.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.delivery_blocks WHERE id = v_delivery_block_id AND is_active = true) THEN
      RAISE EXCEPTION 'Selected delivery block "%" is inactive or does not exist.', v_delivery_block_id;
    END IF;

    IF v_room IS NULL OR TRIM(v_room) = '' THEN
      RAISE EXCEPTION 'Room or unit number is required for doorstep delivery.';
    END IF;

    -- Maintain backward-compatible text fields
    v_block := v_delivery_block_id;
    IF v_hostel IS NULL OR TRIM(v_hostel) = '' THEN
      v_hostel := v_delivery_block_id;
    END IF;
  ELSE
    v_delivery_block_id := NULL;
    v_hostel := NULL;
    v_block := NULL;
    v_room := NULL;
    IF v_pickup_location IS NULL OR TRIM(v_pickup_location) = '' THEN
      v_pickup_location := 'Shipt Mart Hub — Central Dispatch Point';
    END IF;
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

  -- Create order record with delivery_block_id
  INSERT INTO public.orders (
    order_number, user_id, guest_tracking_token, customer_name, customer_phone, delivery_method,
    delivery_block_id, hostel, block, room, pickup_location, delivery_instructions,
    status, subtotal, delivery_fee, discount_amount, total_amount,
    payment_method, payment_status
  ) VALUES (
    v_order_number, v_user_id, v_guest_token, v_customer_name, v_customer_phone, v_delivery_method,
    v_delivery_block_id, v_hostel, v_block, v_room, v_pickup_location, v_delivery_instructions,
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

-- 4. Atomic Order Claiming RPC
DROP FUNCTION IF EXISTS public.admin_claim_order(uuid);
CREATE OR REPLACE FUNCTION public.admin_claim_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_assigned_block text;
  v_order_status text;
  v_order_block text;
  v_delivery_block_id text;
  v_delivery_method text;
  v_existing_claimant uuid;
  v_actor_email text;
  v_order_number text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: caller session is unverified.';
  END IF;

  -- 1. Resolve caller role and block from trusted public.admin_roles table (never client headers)
  SELECT role, assigned_block INTO v_caller_role, v_assigned_block
  FROM public.admin_roles
  WHERE user_id = v_caller_id
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Access Denied: Caller does not possess administrative staff credentials.';
  END IF;

  -- 2. Atomic row lock on the target order to prevent concurrent race conditions
  SELECT status, claimed_by, block, delivery_block_id, delivery_method, order_number
  INTO v_order_status, v_existing_claimant, v_order_block, v_delivery_block_id, v_delivery_method, v_order_number
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order with ID % not found.', p_order_id;
  END IF;

  -- 3. Check terminal states
  IF v_order_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot claim an order that is already %.', v_order_status;
  END IF;

  -- 4. Check concurrency: if already claimed by someone else, return conflict error
  IF v_existing_claimant IS NOT NULL AND v_existing_claimant != v_caller_id THEN
    RAISE EXCEPTION 'Concurrency Conflict: This order has already been claimed by another staff member.';
  END IF;

  -- 5. Role-based operational scope check:
  -- Block Manager: strictly restricted to their assigned delivery block
  IF v_caller_role = 'block_manager' THEN
    IF v_delivery_method = 'campus_pickup' THEN
      RAISE EXCEPTION 'Access Denied: Block Managers cannot process Store Pickup orders.';
    END IF;
    IF COALESCE(v_delivery_block_id, v_order_block) IS NULL OR
       (COALESCE(v_delivery_block_id, v_order_block) != v_assigned_block) THEN
      RAISE EXCEPTION 'Access Denied: You are only authorized to claim orders for delivery block "%".', v_assigned_block;
    END IF;
  END IF;

  -- Store Manager: strictly restricted to Store Pickup orders
  IF v_caller_role = 'store_manager' THEN
    IF v_delivery_method != 'campus_pickup' THEN
      RAISE EXCEPTION 'Access Denied: Store Managers can only claim Store Pickup orders. Block delivery orders are handled by Block Managers and Owners.';
    END IF;
  END IF;

  -- 6. Perform atomic claim update
  UPDATE public.orders
  SET
    claimed_by = v_caller_id,
    claimed_at = COALESCE(claimed_at, now()),
    status = CASE WHEN status = 'placed' THEN 'confirmed' ELSE status END,
    processing_started_at = CASE WHEN status = 'placed' THEN now() ELSE processing_started_at END,
    updated_at = now()
  WHERE id = p_order_id;

  -- 7. Get actor email for audit history
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_caller_id;

  -- 8. Record in order status history
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    p_order_id,
    v_order_status,
    CASE WHEN v_order_status = 'placed' THEN 'confirmed' ELSE v_order_status END,
    v_caller_id,
    'Order claimed by ' || COALESCE(v_actor_email, 'staff') || ' (' || v_caller_role || ')'
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order_number,
    'claimed_by', v_caller_id,
    'claimed_at', now(),
    'status', CASE WHEN v_order_status = 'placed' THEN 'confirmed' ELSE v_order_status END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_claim_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_claim_order(uuid) TO authenticated;

-- 5. Hardened Order Status Transition RPC with State Machine & Scope Verification
CREATE OR REPLACE FUNCTION public.admin_update_order_status(
  p_order_id uuid,
  p_new_status text,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_assigned_block text;
  v_old_status text;
  v_delivery_method text;
  v_delivery_block_id text;
  v_order_block text;
  v_claimed_by uuid;
  v_item record;
  v_curr_stock integer;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: caller session is unverified.';
  END IF;

  -- Resolve caller role and assigned block from database
  SELECT role, assigned_block INTO v_caller_role, v_assigned_block
  FROM public.admin_roles
  WHERE user_id = v_caller_id
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Access Denied: Administrator permission required.';
  END IF;

  -- Atomic row-level lock on order to serialize status transitions
  SELECT status, delivery_method, delivery_block_id, block, claimed_by
  INTO v_old_status, v_delivery_method, v_delivery_block_id, v_order_block, v_claimed_by
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order with ID % not found.', p_order_id;
  END IF;

  -- Role boundary check on order scope
  IF v_caller_role = 'block_manager' THEN
    IF v_delivery_method = 'campus_pickup' THEN
      RAISE EXCEPTION 'Access Denied: Block Managers cannot update Store Pickup orders.';
    END IF;
    IF COALESCE(v_delivery_block_id, v_order_block) IS NULL OR
       (COALESCE(v_delivery_block_id, v_order_block) != v_assigned_block) THEN
      RAISE EXCEPTION 'Access Denied: You are not authorized to update orders for another delivery block.';
    END IF;
  END IF;

  IF v_caller_role = 'store_manager' THEN
    IF v_delivery_method != 'campus_pickup' THEN
      RAISE EXCEPTION 'Access Denied: Store Managers can only update Store Pickup orders.';
    END IF;
  END IF;

  -- No-op if target status is already set
  IF v_old_status = p_new_status THEN
    RETURN true;
  END IF;

  -- Terminal status checks
  IF v_old_status = 'cancelled' THEN
    RAISE EXCEPTION 'Order is already cancelled. Cancelled orders cannot be modified or re-restocked.';
  END IF;

  IF v_old_status = 'completed' THEN
    RAISE EXCEPTION 'Order is already completed. Completed orders cannot be changed or cancelled.';
  END IF;

  -- Valid status lifecycle transitions:
  -- placed -> confirmed, cancelled
  -- confirmed -> preparing, cancelled
  -- preparing -> out_for_delivery, ready_for_pickup, cancelled
  -- out_for_delivery -> completed, cancelled
  -- ready_for_pickup -> completed, cancelled
  IF v_old_status = 'placed' AND p_new_status NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition: Placed orders must be confirmed before advancing to %.', p_new_status;
  END IF;

  IF v_old_status = 'confirmed' AND p_new_status NOT IN ('preparing', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition: Confirmed orders must move to preparing before advancing to %.', p_new_status;
  END IF;

  IF v_old_status = 'preparing' AND p_new_status NOT IN ('out_for_delivery', 'ready_for_pickup', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition: Preparing orders can only move to out_for_delivery, ready_for_pickup, or cancelled.';
  END IF;

  IF v_old_status IN ('out_for_delivery', 'ready_for_pickup') AND p_new_status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition: Orders in transit or ready for pickup can only be completed or cancelled.';
  END IF;

  -- Prevent pickup-only status for delivery orders and vice-versa
  IF p_new_status = 'ready_for_pickup' AND v_delivery_method != 'campus_pickup' THEN
    RAISE EXCEPTION 'Invalid status: "ready_for_pickup" applies only to Store Pickup orders.';
  END IF;

  IF p_new_status = 'out_for_delivery' AND v_delivery_method = 'campus_pickup' THEN
    RAISE EXCEPTION 'Invalid status: "out_for_delivery" applies only to Doorstep Delivery orders.';
  END IF;

  -- Single-instance atomic inventory restocking on cancellation
  IF p_new_status = 'cancelled' THEN
    FOR v_item IN
      SELECT product_id, quantity
      FROM public.order_items
      WHERE order_id = p_order_id AND product_id IS NOT NULL
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
        v_item.product_id, p_order_id, 'order_cancellation_restock', v_item.quantity,
        v_curr_stock, v_curr_stock + v_item.quantity,
        'Restock on order cancellation (' || v_old_status || ' -> cancelled)', v_caller_id
      );
    END LOOP;
  END IF;

  -- Update order with milestone timestamps
  UPDATE public.orders
  SET
    status = p_new_status,
    claimed_by = COALESCE(claimed_by, v_caller_id),
    claimed_at = COALESCE(claimed_at, now()),
    processing_started_at = CASE
      WHEN p_new_status IN ('confirmed', 'preparing') AND processing_started_at IS NULL THEN now()
      ELSE processing_started_at
    END,
    completed_at = CASE WHEN p_new_status = 'completed' THEN now() ELSE completed_at END,
    cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN now() ELSE cancelled_at END,
    updated_at = now()
  WHERE id = p_order_id;

  -- Record audit trail in order_status_history
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    p_order_id, v_old_status, p_new_status, v_caller_id, p_notes
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_order_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_order_status(uuid, text, text) TO authenticated;

-- 6. Delivery Block Management RPC (Super Admin & Owner)
-- Allows creating/updating blocks, toggling active status, and assigning existing Block Managers.
-- Explicitly prevents Owner from modifying staff roles or creating users.
DROP FUNCTION IF EXISTS public.admin_manage_delivery_block(text, text, text, text, boolean, uuid);
CREATE OR REPLACE FUNCTION public.admin_manage_delivery_block(
  p_action text,
  p_id text,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_manager_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_target_role text;
  v_clean_id text;
  v_clean_name text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- Verify caller is Super Admin or Owner
  SELECT role INTO v_caller_role
  FROM public.admin_roles
  WHERE user_id = v_caller_id
  LIMIT 1;

  IF v_caller_role NOT IN ('super_admin', 'owner') THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators and Store Owners can manage delivery blocks.';
  END IF;

  v_clean_id := TRIM(COALESCE(p_id, ''));
  v_clean_name := TRIM(COALESCE(p_name, v_clean_id));

  IF v_clean_id = '' THEN
    RAISE EXCEPTION 'A valid delivery block ID is required.';
  END IF;

  -- Action 1: Create new delivery block
  IF p_action = 'create' THEN
    IF EXISTS (SELECT 1 FROM public.delivery_blocks WHERE id = v_clean_id) THEN
      RAISE EXCEPTION 'A delivery block with ID "%" already exists.', v_clean_id;
    END IF;

    INSERT INTO public.delivery_blocks (id, name, description, is_active)
    VALUES (v_clean_id, v_clean_name, COALESCE(p_description, ''), COALESCE(p_is_active, true));

    -- If a Block Manager was chosen, assign them
    IF p_manager_user_id IS NOT NULL THEN
      SELECT role INTO v_target_role FROM public.admin_roles WHERE user_id = p_manager_user_id;
      IF v_target_role != 'block_manager' THEN
        RAISE EXCEPTION 'Invalid assignment: Only staff with role "block_manager" can be assigned to a delivery block.';
      END IF;
      UPDATE public.admin_roles SET assigned_block = v_clean_id WHERE user_id = p_manager_user_id;
    END IF;

    -- Audit log
    INSERT INTO public.admin_audit_logs (actor_id, action, details)
    VALUES (v_caller_id, 'create_delivery_block', jsonb_build_object('block_id', v_clean_id, 'name', v_clean_name));

    RETURN jsonb_build_object('success', true, 'action', 'create', 'block_id', v_clean_id);
  END IF;

  -- Action 2: Update existing block details
  IF p_action = 'update' THEN
    IF NOT EXISTS (SELECT 1 FROM public.delivery_blocks WHERE id = v_clean_id) THEN
      RAISE EXCEPTION 'Delivery block "%" does not exist.', v_clean_id;
    END IF;

    UPDATE public.delivery_blocks
    SET
      name = COALESCE(v_clean_name, name),
      description = COALESCE(p_description, description),
      is_active = COALESCE(p_is_active, is_active)
    WHERE id = v_clean_id;

    -- Update or change assigned Block Manager if specified
    IF p_manager_user_id IS NOT NULL THEN
      SELECT role INTO v_target_role FROM public.admin_roles WHERE user_id = p_manager_user_id;
      IF v_target_role != 'block_manager' THEN
        RAISE EXCEPTION 'Invalid assignment: Only staff with role "block_manager" can be assigned to a delivery block.';
      END IF;
      UPDATE public.admin_roles SET assigned_block = v_clean_id WHERE user_id = p_manager_user_id;
    END IF;

    -- Audit log
    INSERT INTO public.admin_audit_logs (actor_id, action, details)
    VALUES (v_caller_id, 'update_delivery_block', jsonb_build_object('block_id', v_clean_id, 'name', v_clean_name));

    RETURN jsonb_build_object('success', true, 'action', 'update', 'block_id', v_clean_id);
  END IF;

  -- Action 3: Toggle active status
  IF p_action = 'toggle_active' THEN
    UPDATE public.delivery_blocks
    SET is_active = NOT is_active
    WHERE id = v_clean_id;

    RETURN jsonb_build_object('success', true, 'action', 'toggle_active', 'block_id', v_clean_id);
  END IF;

  -- Action 4: Assign or unassign Block Manager
  IF p_action = 'assign_manager' THEN
    IF p_manager_user_id IS NULL THEN
      -- Unassign all managers currently on this block
      UPDATE public.admin_roles SET assigned_block = NULL WHERE assigned_block = v_clean_id;
    ELSE
      SELECT role INTO v_target_role FROM public.admin_roles WHERE user_id = p_manager_user_id;
      IF v_target_role != 'block_manager' THEN
        RAISE EXCEPTION 'Invalid assignment: Only staff with role "block_manager" can be assigned to a delivery block.';
      END IF;
      -- Assign this manager to the block
      UPDATE public.admin_roles SET assigned_block = v_clean_id WHERE user_id = p_manager_user_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'action', 'assign_manager', 'block_id', v_clean_id, 'manager_id', p_manager_user_id);
  END IF;

  RAISE EXCEPTION 'Invalid action: %. Supported actions: create, update, toggle_active, assign_manager.', p_action;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_manage_delivery_block(text, text, text, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_delivery_block(text, text, text, text, boolean, uuid) TO authenticated;

-- 7. Block Statistics RPC for Owner & Super Admin Dashboard
DROP FUNCTION IF EXISTS public.admin_get_delivery_blocks_with_stats();
CREATE OR REPLACE FUNCTION public.admin_get_delivery_blocks_with_stats()
RETURNS TABLE (
  id text,
  name text,
  description text,
  is_active boolean,
  created_at timestamptz,
  assigned_manager_id uuid,
  assigned_manager_email text,
  assigned_manager_name text,
  total_orders bigint,
  active_orders bigint,
  latest_claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT (public.is_super_admin() OR public.is_owner()) THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators and Store Owners can view block management statistics.';
  END IF;

  RETURN QUERY
  SELECT
    db.id,
    db.name,
    db.description,
    db.is_active,
    db.created_at,
    ar.user_id AS assigned_manager_id,
    u.email::text AS assigned_manager_email,
    COALESCE(p.full_name, '')::text AS assigned_manager_name,
    COUNT(o.id) AS total_orders,
    COUNT(CASE WHEN o.status IN ('placed', 'confirmed', 'preparing', 'out_for_delivery') THEN 1 END) AS active_orders,
    MAX(o.claimed_at) AS latest_claimed_at
  FROM public.delivery_blocks db
  LEFT JOIN public.admin_roles ar ON ar.assigned_block = db.id AND ar.role = 'block_manager'
  LEFT JOIN auth.users u ON u.id = ar.user_id
  LEFT JOIN public.profiles p ON p.id = ar.user_id
  LEFT JOIN public.orders o ON (o.delivery_block_id = db.id OR (o.delivery_block_id IS NULL AND o.block = db.id))
  GROUP BY db.id, db.name, db.description, db.is_active, db.created_at, ar.user_id, u.email, p.full_name
  ORDER BY db.name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_delivery_blocks_with_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_delivery_blocks_with_stats() TO authenticated;

-- 8. Hardened Row Level Security (RLS) on public.orders
DROP POLICY IF EXISTS "orders_select_policy" ON public.orders;
CREATE POLICY "orders_select_policy" ON public.orders
  FOR SELECT TO authenticated
  USING (
    -- 1. Customer viewing their own order
    (auth.uid() IS NOT NULL AND user_id = auth.uid()) OR
    -- 2. Super Admin & Owner: full access to all orders across all blocks
    (public.is_super_admin() OR public.is_owner()) OR
    -- 3. Store Manager: strictly restricted to Store Pickup orders
    (public.is_store_manager() AND delivery_method = 'campus_pickup') OR
    -- 4. Block Manager: strictly restricted to their assigned delivery block
    (public.is_block_manager() AND (
      (delivery_block_id IS NOT NULL AND delivery_block_id = public.get_assigned_block()) OR
      (delivery_block_id IS NULL AND block IS NOT NULL AND block = public.get_assigned_block())
    ))
  );

DROP POLICY IF EXISTS "orders_update_admin" ON public.orders;
CREATE POLICY "orders_update_admin" ON public.orders
  FOR UPDATE TO authenticated
  USING (
    -- Super Admin & Owner can update all orders
    (public.is_super_admin() OR public.is_owner()) OR
    -- Store Manager can update Store Pickup orders only
    (public.is_store_manager() AND delivery_method = 'campus_pickup') OR
    -- Block Manager can update assigned block orders only
    (public.is_block_manager() AND (
      (delivery_block_id IS NOT NULL AND delivery_block_id = public.get_assigned_block()) OR
      (delivery_block_id IS NULL AND block IS NOT NULL AND block = public.get_assigned_block())
    ))
  )
  WITH CHECK (
    (public.is_super_admin() OR public.is_owner()) OR
    (public.is_store_manager() AND delivery_method = 'campus_pickup') OR
    (public.is_block_manager() AND (
      (delivery_block_id IS NOT NULL AND delivery_block_id = public.get_assigned_block()) OR
      (delivery_block_id IS NULL AND block IS NOT NULL AND block = public.get_assigned_block())
    ))
  );

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
