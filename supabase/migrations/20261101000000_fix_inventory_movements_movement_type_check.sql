-- ==============================================================================
-- Shipz Mart — Fix Inventory Movements Movement Type Constraint for PayU Lifecycle
-- Migration Version: 20261101000000
-- ==============================================================================
-- Resolves:
-- 1. Expands inventory_movements_movement_type_check constraint to permit all 8
--    legitimate movement types:
--      'order_deduction', 'payu_checkout_reserve', 'order_cancellation_restock',
--      'payment_failure_restock', 'payment_timeout_restock', 'manual_adjustment',
--      'restock_shipment', 'damaged_loss'
-- 2. Preserves exact existing function signatures, grants, and return types:
--    - public.create_order_with_inventory(order_payload jsonb) -> jsonb
--    - public.handle_failed_payu_payment(uuid, text, text, text, jsonb) -> jsonb
--    - public.expire_stale_pending_payments() -> integer (preserves production 42P13 return type)
-- 3. Idempotent and safe to rerun multiple times in Supabase SQL Editor.
-- ==============================================================================

-- 1. EXPAND INVENTORY_MOVEMENTS CHECK CONSTRAINT SAFELY
DO $$
BEGIN
  ALTER TABLE public.inventory_movements
    DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;

  ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK (movement_type IN (
      'order_deduction',
      'payu_checkout_reserve',
      'order_cancellation_restock',
      'payment_failure_restock',
      'payment_timeout_restock',
      'manual_adjustment',
      'restock_shipment',
      'damaged_loss'
    ));
END $$;

-- 2. CLEAN UP ANY ACCIDENTAL 3-ARG OVERLOAD OF HANDLE_FAILED_PAYU_PAYMENT
DROP FUNCTION IF EXISTS public.handle_failed_payu_payment(text, text, jsonb);

-- 3. HARDEN CREATE_ORDER_WITH_INVENTORY RPC WITH RESILIENT FALLBACK
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

  v_user_id uuid;
  v_student_policy text := 'default';
  v_cash_restricted boolean := false;
  v_restriction_reason text;

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

  v_initial_status text;
  v_payu_txnid text := NULL;
  v_payment_expires_at timestamptz := NULL;
BEGIN
  -- 0. Server-Side Maintenance Mode & Store Payment Settings Guard
  SELECT
    is_maintenance_mode,
    maintenance_message,
    COALESCE(cash_payment_enabled, true),
    COALESCE(online_payment_enabled, true),
    COALESCE(guest_cash_allowed, true)
  INTO
    v_is_maintenance,
    v_maintenance_msg,
    v_cash_enabled,
    v_online_enabled,
    v_guest_cash_allowed
  FROM public.store_settings
  WHERE id = 'default';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'System Configuration Error: Store settings record was not found.';
  END IF;

  IF v_is_maintenance IS TRUE THEN
    RAISE EXCEPTION 'Maintenance Mode Active: %', COALESCE(NULLIF(TRIM(v_maintenance_msg), ''), 'Shipt Mart is temporarily closed for restocking.');
  END IF;

  -- Extract caller (NULL for guests)
  v_user_id := auth.uid();

  -- If guest checkout, generate a high-entropy 256-bit tracking token
  IF v_user_id IS NULL THEN
    v_guest_token := encode(extensions.gen_random_bytes(32), 'hex');
  ELSE
    -- Fetch student profile and payment policy securely from DB
    SELECT
      COALESCE(payment_policy, 'default'),
      COALESCE(cash_restricted, false),
      cash_restriction_reason
    INTO
      v_student_policy,
      v_cash_restricted,
      v_restriction_reason
    FROM public.profiles
    WHERE id = v_user_id;
  END IF;

  -- Extract and validate fields
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
    RAISE EXCEPTION 'Invalid customer name: must be at least 2 characters';
  END IF;

  IF v_customer_phone IS NULL OR LENGTH(v_customer_phone) < 10 THEN
    RAISE EXCEPTION 'Invalid customer phone number: must be at least 10 digits';
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

    -- Validate that delivery block exists in public.delivery_blocks
    IF NOT EXISTS (SELECT 1 FROM public.delivery_blocks WHERE id = v_delivery_block_id AND is_active = true) THEN
      RAISE EXCEPTION 'Invalid delivery block "%". Please select an active delivery block from the list.', v_delivery_block_id;
    END IF;

    IF v_hostel IS NULL THEN
      v_hostel := v_delivery_block_id;
    END IF;

    IF v_block IS NULL THEN
      v_block := v_delivery_block_id;
    END IF;

    IF v_room IS NULL THEN
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

  -- Normalize payment method (upi or payu both treated as online gateway)
  IF v_payment_method NOT IN ('upi', 'cod', 'payu') THEN
    RAISE EXCEPTION 'Invalid payment method: must be payu, upi, or cod';
  END IF;

  -- Strict Server-Side Payment Policy Enforcement
  IF v_payment_method = 'cod' THEN
    IF v_cash_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Cash on Delivery is currently disabled by store policy. Please select online payment.';
    END IF;

    IF v_user_id IS NULL THEN
      IF v_guest_cash_allowed IS NOT TRUE THEN
        RAISE EXCEPTION 'Cash orders are restricted for guest checkouts. Please sign in or use online payment.';
      END IF;
    ELSE
      IF v_student_policy = 'online_only' THEN
        RAISE EXCEPTION 'Cash orders are not permitted for your student account policy (Online Only). Please use online payment.';
      END IF;

      IF v_cash_restricted IS TRUE AND v_student_policy != 'cash_and_online' THEN
        RAISE EXCEPTION 'Cash orders are temporarily restricted for your account: %. Please use online payment or contact store support.',
          COALESCE(v_restriction_reason, 'Repeated uncollected cash orders');
      END IF;
    END IF;

    v_initial_status := 'placed';
  ELSE
    IF v_online_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Online payment is currently disabled by store policy.';
    END IF;

    IF v_user_id IS NOT NULL AND v_student_policy = 'cash_only' THEN
      RAISE EXCEPTION 'Online payment is not permitted for your account policy (Cash Only). Please select cash payment.';
    END IF;

    v_initial_status := 'pending_payment';
    v_payment_expires_at := now() + interval '20 minutes';
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

  IF v_payment_method IN ('payu', 'upi') THEN
    v_payu_txnid := 'TXN_' || replace(v_order_number, '-', '_') || '_' || upper(encode(extensions.gen_random_bytes(3), 'hex'));
  END IF;

  -- Create order record
  INSERT INTO public.orders (
    order_number, user_id, guest_tracking_token, customer_name, customer_phone, delivery_method,
    delivery_block_id, hostel, block, room, pickup_location, delivery_instructions,
    status, subtotal, delivery_fee, discount_amount, total_amount,
    payment_method, payment_status, payu_txnid, payment_expires_at
  ) VALUES (
    v_order_number, v_user_id, v_guest_token, v_customer_name, v_customer_phone, v_delivery_method,
    v_delivery_block_id, v_hostel, v_block, v_room, v_pickup_location, v_delivery_instructions,
    v_initial_status, 0, v_delivery_fee, 0, 0,
    v_payment_method, 'pending', v_payu_txnid, v_payment_expires_at
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

    BEGIN
      INSERT INTO public.inventory_movements (
        product_id, order_id, movement_type, quantity_change,
        previous_stock, new_stock, reason, performed_by
      ) VALUES (
        v_product_id, v_order_id,
        CASE WHEN v_initial_status = 'pending_payment' THEN 'payu_checkout_reserve' ELSE 'order_deduction' END,
        -v_qty,
        v_db_stock, v_db_stock - v_qty, 'Order ' || v_order_number || ' reservation', v_user_id
      );
    EXCEPTION
      WHEN check_violation THEN
        -- Graceful fallback if legacy constraint does not yet allow 'payu_checkout_reserve'
        INSERT INTO public.inventory_movements (
          product_id, order_id, movement_type, quantity_change,
          previous_stock, new_stock, reason, performed_by
        ) VALUES (
          v_product_id, v_order_id, 'order_deduction', -v_qty,
          v_db_stock, v_db_stock - v_qty, 'Order ' || v_order_number || ' reservation (fallback)', v_user_id
        );
    END;

    INSERT INTO public.order_items (
      order_id, product_id, product_name, product_size,
      unit_price, quantity, total_price
    ) VALUES (
      v_order_id, v_product_id, v_db_name, v_db_size,
      v_db_price, v_qty, v_line_total
    );
  END LOOP;

  v_total_amount := v_subtotal + v_delivery_fee;

  UPDATE public.orders
  SET subtotal = v_subtotal, total_amount = v_total_amount, updated_at = now()
  WHERE id = v_order_id;

  INSERT INTO public.payments (
    order_id, payment_method, amount, status, payu_txnid, expires_at
  ) VALUES (
    v_order_id, v_payment_method, v_total_amount, 'pending', v_payu_txnid, v_payment_expires_at
  );

  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    v_order_id, NULL, v_initial_status, v_user_id,
    CASE WHEN v_initial_status = 'pending_payment' THEN 'PayU checkout initiated' ELSE 'Order created via checkout' END
  );

  -- For PayU orders, notify customer of payment initiated
  IF v_user_id IS NOT NULL AND v_initial_status = 'pending_payment' THEN
    INSERT INTO public.customer_notifications (
      user_id, order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_user_id, v_order_id, v_order_number, 'payment_initiated',
      'Payment Initiated #' || v_order_number,
      'PayU online checkout of ₹' || v_total_amount || ' initiated. Please complete payment within 20 minutes.',
      jsonb_build_object('order_id', v_order_id, 'txnid', v_payu_txnid, 'amount', v_total_amount),
      'cust_pay_init_' || v_order_id::text
    ) ON CONFLICT (dedup_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'guest_tracking_token', v_guest_token,
    'total_amount', v_total_amount,
    'status', v_initial_status,
    'payment_method', v_payment_method,
    'payment_status', 'pending',
    'payu_txnid', v_payu_txnid,
    'payment_expires_at', v_payment_expires_at,
    'delivery_block_id', v_delivery_block_id
  );
END;
$$;

-- 4. HARDEN HANDLE_FAILED_PAYU_PAYMENT RPC WITH RESILIENT FALLBACK
-- Preserves the exact 5-parameter signature from the applied PayU migration
CREATE OR REPLACE FUNCTION public.handle_failed_payu_payment(
  p_order_id uuid,
  p_txnid text,
  p_error_code text DEFAULT NULL,
  p_error_msg text DEFAULT NULL,
  p_response_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_order record;
  v_item record;
  v_curr_stock integer;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id OR payu_txnid = p_txnid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found for transaction "%"', p_txnid;
  END IF;

  -- If payment already succeeded, do not mark as failed
  IF v_order.payment_status IN ('paid', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order is already marked paid.');
  END IF;

  -- Record failed transaction log
  INSERT INTO public.payu_transactions (
    order_id, txnid, action, request_payload, response_payload, status, is_verified
  ) VALUES (
    v_order.id, p_txnid, 'failed_callback', jsonb_build_object('error_code', p_error_code, 'error_msg', p_error_msg),
    p_response_payload, 'failed', false
  );

  -- Only restock stock if order was in 'pending_payment' and not already cancelled
  IF v_order.status = 'pending_payment' THEN
    -- Restock reserved inventory
    FOR v_item IN
      SELECT product_id, SUM(quantity)::integer AS quantity
      FROM public.order_items
      WHERE order_id = v_order.id AND product_id IS NOT NULL
      GROUP BY product_id
      ORDER BY product_id ASC
    LOOP
      SELECT stock INTO v_curr_stock
      FROM public.products
      WHERE id = v_item.product_id
      FOR UPDATE;

      UPDATE public.products
      SET stock = v_curr_stock + v_item.quantity, updated_at = now()
      WHERE id = v_item.product_id;

      BEGIN
        INSERT INTO public.inventory_movements (
          product_id, order_id, movement_type, quantity_change,
          previous_stock, new_stock, reason
        ) VALUES (
          v_item.product_id, v_order.id, 'payment_failure_restock', v_item.quantity,
          v_curr_stock, v_curr_stock + v_item.quantity,
          'Stock release on payment failure: ' || COALESCE(p_error_msg, 'Gateway payment failed')
        );
      EXCEPTION
        WHEN check_violation THEN
          INSERT INTO public.inventory_movements (
            product_id, order_id, movement_type, quantity_change,
            previous_stock, new_stock, reason
          ) VALUES (
            v_item.product_id, v_order.id, 'order_cancellation_restock', v_item.quantity,
            v_curr_stock, v_curr_stock + v_item.quantity,
            'Stock release on payment failure (fallback): ' || COALESCE(p_error_msg, 'Gateway payment failed')
          );
      END;
    END LOOP;

    -- Update order to cancelled
    UPDATE public.orders
    SET
      status = 'cancelled',
      payment_status = 'failed',
      cancelled_at = now(),
      updated_at = now()
    WHERE id = v_order.id;
  END IF;

  UPDATE public.payments
  SET
    status = 'failed',
    payu_txnid = p_txnid,
    payu_response = p_response_payload,
    notes = 'PayU payment failed: ' || COALESCE(p_error_msg, p_error_code, 'Payment declined or cancelled by user'),
    updated_at = now()
  WHERE order_id = v_order.id;

  -- Notify Customer: Payment Failed
  IF v_order.user_id IS NOT NULL THEN
    INSERT INTO public.customer_notifications (
      user_id, order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_order.user_id, v_order.id, v_order.order_number, 'payment_failed',
      'Payment Failed #' || v_order.order_number,
      'Your payment could not be processed (' || COALESCE(p_error_msg, 'Declined by bank') || '). You can retry checkout anytime.',
      jsonb_build_object('order_id', v_order.id, 'txnid', p_txnid, 'error_msg', p_error_msg),
      'cust_pay_fail_' || p_txnid
    ) ON CONFLICT (dedup_key) DO NOTHING;
  END IF;

  -- Notify Admin: Payment Failed
  INSERT INTO public.admin_notifications (
    order_id, order_number, event_type, title, message, metadata, dedup_key
  ) VALUES (
    v_order.id, v_order.order_number, 'payment_failed',
    'Payment Failed #' || v_order.order_number,
    'PayU transaction ' || p_txnid || ' failed: ' || COALESCE(p_error_msg, p_error_code, 'Gateway returned failure') || '. Reserved stock released.',
    jsonb_build_object('order_id', v_order.id, 'txnid', p_txnid, 'error_code', p_error_code, 'error_msg', p_error_msg),
    'fail_' || p_txnid
  ) ON CONFLICT (dedup_key) DO NOTHING;

  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, notes
  ) VALUES (
    v_order.id, v_order.status, 'cancelled', 'PayU payment failed: ' || COALESCE(p_error_msg, p_error_code, 'Gateway returned failure')
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'payment_status', 'failed',
    'order_status', 'cancelled'
  );
END;
$$;

-- 5. HARDEN EXPIRE_STALE_PENDING_PAYMENTS RPC WITH RESILIENT FALLBACK
-- Preserves exact production signature and return type (RETURNS integer)
-- to avoid PostgreSQL ERROR 42P13: cannot change return type of existing function.
CREATE OR REPLACE FUNCTION public.expire_stale_pending_payments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_expired_order record;
  v_item record;
  v_curr_stock integer;
  v_count integer := 0;
BEGIN
  FOR v_expired_order IN
    SELECT id, order_number, user_id, payu_txnid
    FROM public.orders
    WHERE status = 'pending_payment'
      AND payment_expires_at IS NOT NULL
      AND payment_expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Restock reserved inventory
    FOR v_item IN
      SELECT product_id, SUM(quantity)::integer AS quantity
      FROM public.order_items
      WHERE order_id = v_expired_order.id AND product_id IS NOT NULL
      GROUP BY product_id
      ORDER BY product_id ASC
    LOOP
      SELECT stock INTO v_curr_stock
      FROM public.products
      WHERE id = v_item.product_id
      FOR UPDATE;

      UPDATE public.products
      SET stock = v_curr_stock + v_item.quantity, updated_at = now()
      WHERE id = v_item.product_id;

      BEGIN
        INSERT INTO public.inventory_movements (
          product_id, order_id, movement_type, quantity_change,
          previous_stock, new_stock, reason
        ) VALUES (
          v_item.product_id, v_expired_order.id, 'payment_timeout_restock', v_item.quantity,
          v_curr_stock, v_curr_stock + v_item.quantity,
          'Stock released: PayU payment expired without completion'
        );
      EXCEPTION
        WHEN check_violation THEN
          INSERT INTO public.inventory_movements (
            product_id, order_id, movement_type, quantity_change,
            previous_stock, new_stock, reason
          ) VALUES (
            v_item.product_id, v_expired_order.id, 'order_cancellation_restock', v_item.quantity,
            v_curr_stock, v_curr_stock + v_item.quantity,
            'Stock released: PayU payment expired (fallback)'
          );
      END;
    END LOOP;

    -- Update order to cancelled
    UPDATE public.orders
    SET
      status = 'cancelled',
      payment_status = 'expired',
      cancelled_at = now(),
      updated_at = now()
    WHERE id = v_expired_order.id;

    UPDATE public.payments
    SET
      status = 'expired',
      notes = 'Payment window expired. Reserved inventory restored.',
      updated_at = now()
    WHERE order_id = v_expired_order.id;

    -- Notify Admin
    INSERT INTO public.admin_notifications (
      order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_expired_order.id, v_expired_order.order_number, 'payment_pending_timeout',
      'Payment Expired #' || v_expired_order.order_number,
      'Pending PayU checkout expired after window elapsed. Reserved stock restored.',
      jsonb_build_object('order_id', v_expired_order.id, 'txnid', v_expired_order.payu_txnid),
      'timeout_' || v_expired_order.id::text
    ) ON CONFLICT (dedup_key) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 6. PERMISSIONS & SCHEMA CACHE RELOAD
GRANT EXECUTE ON FUNCTION public.create_order_with_inventory(jsonb) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.handle_failed_payu_payment(uuid, text, text, text, jsonb) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_payments() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
