-- ==============================================================================
-- Shipz Mart — Harden PayU Payment RPC Security, Fulfillment & Refund Integrity
-- Migration Version: 20261102000000
-- ==============================================================================
-- Resolves:
-- 1. Preflight Deduplication Validation:
--    - Inspects public.orders and public.payments for duplicate non-null, non-blank payu_txnid values.
--    - Inspects public.order_refunds for duplicate active payment_id or payu_txnid values.
--    - Runs BEFORE any schema modifications; cleanly aborts transaction if historical duplicates exist.
-- 2. Schema Security:
--    - Enforces REVOKE CREATE ON SCHEMA public FROM PUBLIC to prevent schema object spoofing.
-- 3. Legacy Overload Cleanup:
--    - Drops legacy 3-argument overload: public.handle_failed_payu_payment(text, text, jsonb)
-- 4. Idempotent Constraint Hardening:
--    - Guarantees public.inventory_movements permits all 8 required movement types:
--      'order_deduction', 'payu_checkout_reserve', 'order_cancellation_restock',
--      'payment_failure_restock', 'payment_timeout_restock', 'manual_adjustment',
--      'restock_shipment', 'damaged_loss'
--    - Guarantees public.customer_notifications permits 'payment_refund_review' alongside
--      all 14 original canonical event types ('order_placed', 'payment_initiated',
--      'payment_success', 'payment_failed', 'order_confirmed', 'order_preparing',
--      'order_ready', 'order_out_for_delivery', 'order_completed', 'order_cancelled',
--      'refund_requested', 'refund_processing', 'refund_completed', 'refund_rejected').
-- 5. Schema & Deduplication Enhancements:
--    - Adds payu_txnid column to public.order_refunds.
--    - Adds aligned unique index uidx_orders_payu_txnid on public.orders(payu_txnid).
--    - Adds aligned unique index uidx_payments_payu_txnid on public.payments(payu_txnid).
--    - Adds transaction-scoped unique index uidx_order_refunds_payment_id on public.order_refunds(payment_id).
--    - Adds transaction-scoped unique index uidx_order_refunds_payu_txnid on public.order_refunds(payu_txnid).
-- 6. Hardens public.verify_payu_payment_transaction(uuid, text, text, numeric, text, text, jsonb, text) -> jsonb:
--    - SET search_path = public, pg_temp with fully qualified table references.
--    - Strict order matching: WHERE id = p_order_id AND payu_txnid = v_txnid.
--    - Row-locks and validates specific payment record (prevents multi-attempt corruption).
--    - Validates non-empty mihpayid and allowed verified_via sources.
--    - Enforces exact amount match with durable tamper logging (returns structured rejection).
--    - Deduplicated refund review on cancelled orders tied to payment_id and payu_txnid.
--    - Uses canonical 'refund_requested' event type for customer refund notice.
--    - Forbids client-side execution (blocks anon & authenticated).
-- 7. Hardens public.handle_failed_payu_payment(uuid, text, text, text, jsonb) -> jsonb:
--    - SET search_path = public, pg_temp with fully qualified table references.
--    - Strict order matching: WHERE id = p_order_id AND payu_txnid = v_txnid.
--    - Locks and updates specific payment row.
--    - Correct inventory_movements schema (product_id, order_id, movement_type, quantity_change, previous_stock, new_stock, reason, performed_by).
--    - Forbids client-side execution (blocks anon & authenticated).
-- 8. Hardens public.customer_cancel_order(uuid, text, text, text) -> jsonb:
--    - Restricts self-service cancellation to 'placed' and 'confirmed' states only.
--    - Blocks cancellation for pending_payment (prevents race with gateway), preparing, packed, out_for_delivery, ready_for_pickup, completed.
--    - Handles paid PayU/online orders: marks payment 'refund_pending' and creates deduplicated order_refunds review record.
-- 9. Permissions & Transaction Commit:
--    - Revokes execute from PUBLIC, anon, and authenticated on internal payment RPCs.
--    - Grants execute strictly to service_role.
--    - Reloads PostgREST schema cache and commits transaction.
-- ==============================================================================

BEGIN;

-- Ensure refund transaction ID column exists before preflight validation
ALTER TABLE public.order_refunds
  ADD COLUMN IF NOT EXISTS payu_txnid text;

-- 1. PREFLIGHT VALIDATION: DETECT HISTORICAL DUPLICATE TRANSACTION IDS
-- Executes before ANY schema modifications. Halts migration cleanly if duplicates exist.
DO $$
DECLARE
  v_order_dups integer;
  v_sample_order_txns text;
  v_payment_dups integer;
  v_sample_payment_txns text;
  v_refund_payment_dups integer;
  v_refund_txn_dups integer;
BEGIN
  -- A. Check for duplicate payu_txnid in public.orders (non-null, non-blank)
  SELECT COUNT(DISTINCT payu_txnid) INTO v_order_dups
  FROM (
    SELECT payu_txnid
    FROM public.orders
    WHERE payu_txnid IS NOT NULL AND BTRIM(payu_txnid) != ''
    GROUP BY payu_txnid
    HAVING COUNT(*) > 1
  ) o_dup;

  IF v_order_dups > 0 THEN
    SELECT string_agg(payu_txnid || ' (' || cnt || ' orders)', ', ') INTO v_sample_order_txns
    FROM (
      SELECT payu_txnid, COUNT(*) AS cnt
      FROM public.orders
      WHERE payu_txnid IS NOT NULL AND BTRIM(payu_txnid) != ''
      GROUP BY payu_txnid
      HAVING COUNT(*) > 1
      LIMIT 5
    ) s;

    RAISE EXCEPTION 'Migration preflight check failed: public.orders contains % duplicate non-null payu_txnid value(s). Sample: %. Manual deduplication is required before creating unique index uidx_orders_payu_txnid.',
      v_order_dups, v_sample_order_txns;
  END IF;

  -- B. Check for duplicate payu_txnid in public.payments (non-null, non-blank)
  SELECT COUNT(DISTINCT payu_txnid) INTO v_payment_dups
  FROM (
    SELECT payu_txnid
    FROM public.payments
    WHERE payu_txnid IS NOT NULL AND BTRIM(payu_txnid) != ''
    GROUP BY payu_txnid
    HAVING COUNT(*) > 1
  ) p_dup;

  IF v_payment_dups > 0 THEN
    SELECT string_agg(payu_txnid || ' (' || cnt || ' payments)', ', ') INTO v_sample_payment_txns
    FROM (
      SELECT payu_txnid, COUNT(*) AS cnt
      FROM public.payments
      WHERE payu_txnid IS NOT NULL AND BTRIM(payu_txnid) != ''
      GROUP BY payu_txnid
      HAVING COUNT(*) > 1
      LIMIT 5
    ) s;

    RAISE EXCEPTION 'Migration preflight check failed: public.payments contains % duplicate non-null payu_txnid value(s). Sample: %. Manual deduplication is required before creating unique index uidx_payments_payu_txnid.',
      v_payment_dups, v_sample_payment_txns;
  END IF;

  -- C. Check for duplicate active payment_id in public.order_refunds
  SELECT COUNT(DISTINCT payment_id) INTO v_refund_payment_dups
  FROM (
    SELECT payment_id
    FROM public.order_refunds
    WHERE payment_id IS NOT NULL AND status IN ('pending', 'processing', 'completed')
    GROUP BY payment_id
    HAVING COUNT(*) > 1
  ) r_p_dup;

  IF v_refund_payment_dups > 0 THEN
    RAISE EXCEPTION 'Migration preflight check failed: public.order_refunds contains % active duplicate payment_id record(s). Manual review required before creating unique index uidx_order_refunds_payment_id.',
      v_refund_payment_dups;
  END IF;

  -- D. Check for duplicate active payu_txnid in public.order_refunds (non-null, non-blank)
  SELECT COUNT(DISTINCT payu_txnid) INTO v_refund_txn_dups
  FROM (
    SELECT payu_txnid
    FROM public.order_refunds
    WHERE payu_txnid IS NOT NULL AND BTRIM(payu_txnid) != '' AND status IN ('pending', 'processing', 'completed')
    GROUP BY payu_txnid
    HAVING COUNT(*) > 1
  ) r_t_dup;

  IF v_refund_txn_dups > 0 THEN
    RAISE EXCEPTION 'Migration preflight check failed: public.order_refunds contains % active duplicate payu_txnid record(s). Manual review required before creating unique index uidx_order_refunds_payu_txnid.',
      v_refund_txn_dups;
  END IF;
END $$;

-- 2. SCHEMA HARDENING (CVE-2018-1058 DEFENSE)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 3. CLEAN UP LEGACY UNUSED OVERLOADS
DROP FUNCTION IF EXISTS public.handle_failed_payu_payment(text, text, jsonb);

-- 4. IDEMPOTENT CONSTRAINT HARDENING
-- A. Ensure public.inventory_movements permits all 8 required movement types (including payment_failure_restock)
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

-- B. Ensure public.customer_notifications permits payment_refund_review alongside all 14 canonical existing types
DO $$
BEGIN
  ALTER TABLE public.customer_notifications
    DROP CONSTRAINT IF EXISTS customer_notifications_event_type_check;

  ALTER TABLE public.customer_notifications
    ADD CONSTRAINT customer_notifications_event_type_check
    CHECK (event_type IN (
      'order_placed',
      'payment_initiated',
      'payment_success',
      'payment_failed',
      'order_confirmed',
      'order_preparing',
      'order_ready',
      'order_out_for_delivery',
      'order_completed',
      'order_cancelled',
      'payment_refund_review',
      'refund_requested',
      'refund_processing',
      'refund_completed',
      'refund_rejected'
    ));
END $$;

-- 5. TRANSACTION-LEVEL UNIQUE INDEXES
-- Predicates match preflight checks exactly: WHERE payu_txnid IS NOT NULL AND BTRIM(payu_txnid) != ''
CREATE UNIQUE INDEX IF NOT EXISTS uidx_orders_payu_txnid
ON public.orders(payu_txnid)
WHERE payu_txnid IS NOT NULL AND BTRIM(payu_txnid) != '';

CREATE UNIQUE INDEX IF NOT EXISTS uidx_payments_payu_txnid
ON public.payments(payu_txnid)
WHERE payu_txnid IS NOT NULL AND BTRIM(payu_txnid) != '';

-- Remove overbroad order_id unique index if previously defined
DROP INDEX IF EXISTS public.uidx_order_refunds_active_order;

-- Transaction-scoped unique refund indexes
CREATE UNIQUE INDEX IF NOT EXISTS uidx_order_refunds_payment_id
ON public.order_refunds(payment_id)
WHERE payment_id IS NOT NULL AND status IN ('pending', 'processing', 'completed');

CREATE UNIQUE INDEX IF NOT EXISTS uidx_order_refunds_payu_txnid
ON public.order_refunds(payu_txnid)
WHERE payu_txnid IS NOT NULL AND BTRIM(payu_txnid) != '' AND status IN ('pending', 'processing', 'completed');

-- 6. HARDEN VERIFY_PAYU_PAYMENT_TRANSACTION (8 ARGUMENTS)
CREATE OR REPLACE FUNCTION public.verify_payu_payment_transaction(
  p_order_id uuid,
  p_txnid text,
  p_mihpayid text,
  p_amount numeric,
  p_status text,
  p_mode text DEFAULT NULL,
  p_response_payload jsonb DEFAULT '{}'::jsonb,
  p_verified_via text DEFAULT 'webhook'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_caller_id uuid;
  v_order record;
  v_payment record;
  v_dedup_admin text;
  v_dedup_cust text;
  v_txnid text;
  v_mihpayid text;
  v_verified_via text;
BEGIN
  v_caller_role := auth.role();
  v_caller_id := auth.uid();

  -- Security Check 1: Disallow anonymous or client-authenticated execution
  IF v_caller_role IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Access denied: client execution of verify_payu_payment_transaction is forbidden';
  END IF;

  -- Security Check 2: Mandatory order ID and transaction ID
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Cannot verify payment: order ID is required';
  END IF;

  v_txnid := BTRIM(COALESCE(p_txnid, ''));
  IF v_txnid = '' THEN
    RAISE EXCEPTION 'Cannot verify payment: transaction ID is required';
  END IF;

  v_mihpayid := BTRIM(COALESCE(p_mihpayid, ''));
  IF v_mihpayid = '' THEN
    RAISE EXCEPTION 'Cannot verify payment: PayU payment ID (mihpayid) is required';
  END IF;

  -- Security Check 3: Verified_via whitelist
  v_verified_via := LOWER(BTRIM(COALESCE(p_verified_via, 'webhook')));
  IF v_verified_via NOT IN ('server_verify_api', 'server_callback', 'webhook', 'manual_reconciliation') THEN
    RAISE EXCEPTION 'Cannot verify payment: invalid verification source "%"', p_verified_via;
  END IF;

  -- Security Check 4: Enforce that status must be 'success'
  IF LOWER(BTRIM(COALESCE(p_status, ''))) != 'success' THEN
    RAISE EXCEPTION 'Cannot mark transaction verified: status is "%" (must be "success")', p_status;
  END IF;

  -- Security Check 5: Enforce positive amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Cannot mark transaction verified: invalid amount %', p_amount;
  END IF;

  -- Check for duplicate orders sharing the same txnid
  IF (SELECT count(*) FROM public.orders WHERE payu_txnid = v_txnid) > 1 THEN
    RAISE EXCEPTION 'Database integrity error: multiple orders found with transaction ID "%"', v_txnid;
  END IF;

  -- Strict Order Identity Matching: BOTH id AND payu_txnid must identify the exact same order
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND payu_txnid = v_txnid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or transaction ID mismatch: order % does not match txnid "%"', p_order_id, v_txnid;
  END IF;

  -- Lock and verify the exact payment record for this transaction
  -- Step A: Try exact match on order_id + payu_txnid
  SELECT * INTO v_payment
  FROM public.payments
  WHERE order_id = v_order.id AND payu_txnid = v_txnid
  FOR UPDATE;

  -- Step B: If no exact match, allow fallback ONLY when exactly one unassigned payment exists
  IF NOT FOUND THEN
    IF (SELECT count(*) FROM public.payments WHERE order_id = v_order.id AND payu_txnid IS NULL) = 1 THEN
      SELECT * INTO v_payment
      FROM public.payments
      WHERE order_id = v_order.id AND payu_txnid IS NULL
      FOR UPDATE;
    ELSIF (SELECT count(*) FROM public.payments WHERE order_id = v_order.id AND payu_txnid IS NULL) > 1 THEN
      RAISE EXCEPTION 'Ambiguous payment records: multiple unassigned payments exist for order %. Manual review required.', v_order.id;
    ELSE
      RAISE EXCEPTION 'Payment record not found for order % and transaction "%"', v_order.id, v_txnid;
    END IF;
  END IF;

  -- Verify amount matches exactly to eliminate price tampering
  IF ROUND(v_order.total_amount, 2) != ROUND(p_amount, 2) THEN
    -- Durable Audit: Persist tamper log and admin alert without raising an exception that rolls them back
    INSERT INTO public.payu_transactions (
      order_id, txnid, action, request_payload, response_payload, status, is_verified
    ) VALUES (
      v_order.id, v_txnid, 'tamper_detected',
      jsonb_build_object('expected_amount', v_order.total_amount, 'paid_amount', p_amount),
      p_response_payload, 'amount_mismatch', false
    );

    INSERT INTO public.admin_notifications (
      order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_order.id, v_order.order_number, 'payment_suspicious_callback',
      'Suspicious Payment Callback #' || v_order.order_number,
      'PayU reported ₹' || p_amount || ' but order total is ₹' || v_order.total_amount || '. Payment rejected.',
      jsonb_build_object('order_id', v_order.id, 'txnid', v_txnid, 'paid_amount', p_amount, 'expected_amount', v_order.total_amount),
      'tamper_' || v_txnid
    ) ON CONFLICT (dedup_key) DO NOTHING;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'AMOUNT_MISMATCH',
      'order_id', v_order.id,
      'message', 'Amount mismatch: paid ' || p_amount || ' does not match expected total ' || v_order.total_amount
    );
  END IF;

  -- If order was already cancelled before payment cleared (e.g. reservation expired or customer self-cancel)
  IF v_order.status = 'cancelled' THEN
    -- Deduplicated refund entry: only create if a refund for this specific payment attempt does not exist
    IF NOT EXISTS (
      SELECT 1 FROM public.order_refunds
      WHERE payment_id = v_payment.id AND status IN ('pending', 'processing', 'completed')
    ) THEN
      INSERT INTO public.order_refunds (
        order_id, payment_id, payu_txnid, amount, status, reason, admin_notes
      ) VALUES (
        v_order.id, v_payment.id, v_txnid, p_amount, 'pending',
        'Payment captured after order was cancelled: PayU Txn ' || v_txnid,
        'PayU Txn ID: ' || v_txnid || ', MIHPayID: ' || v_mihpayid
      );
    END IF;

    -- Update only the specific locked payment record
    UPDATE public.payments
    SET
      status = 'refund_pending',
      payu_txnid = v_txnid,
      payu_mihpayid = v_mihpayid,
      payu_status = p_status,
      payu_mode = p_mode,
      payu_response = p_response_payload,
      verified_via = v_verified_via,
      notes = 'Payment captured after order was cancelled. Refund review created.',
      updated_at = now()
    WHERE id = v_payment.id;

    INSERT INTO public.admin_notifications (
      order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_order.id, v_order.order_number, 'payment_attention',
      'Payment Received on Cancelled Order #' || v_order.order_number,
      '₹' || p_amount || ' captured via PayU for cancelled order #' || v_order.order_number || '. Refund review required.',
      jsonb_build_object('order_id', v_order.id, 'txnid', v_txnid, 'mihpayid', v_mihpayid),
      'pay_after_cancel_' || v_txnid
    ) ON CONFLICT (dedup_key) DO NOTHING;

    -- Notify Customer: Payment Received on Cancelled Order (Truthful refund review notice)
    IF v_order.user_id IS NOT NULL THEN
      v_dedup_cust := 'cust_late_pay_' || v_txnid;
      INSERT INTO public.customer_notifications (
        user_id, order_id, order_number, event_type, title, message, metadata, dedup_key
      ) VALUES (
        v_order.user_id, v_order.id, v_order.order_number, 'refund_requested',
        'Payment Received for Cancelled Order #' || v_order.order_number,
        'We received your payment of ₹' || p_amount || ', but order #' || v_order.order_number || ' was already cancelled or expired. Your payment has been flagged for refund review.',
        jsonb_build_object('order_id', v_order.id, 'txnid', v_txnid, 'amount', p_amount, 'payment_status', 'refund_pending'),
        v_dedup_cust
      ) ON CONFLICT (dedup_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'status', 'cancelled',
      'payment_status', 'refund_pending',
      'is_late_payment', true,
      'message', 'Payment recorded on cancelled order; flagged for refund review.'
    );
  END IF;

  -- Idempotency check: if order is already marked paid, return success without duplicate processing
  IF v_order.payment_status IN ('paid', 'completed') THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_order.id,
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'message', 'Payment was already verified.'
    );
  END IF;

  -- State guard: Only allow payment confirmation when order is in 'pending_payment' state.
  -- Orders in fulfillment states (preparing, packed, out_for_delivery, completed etc.) must NOT
  -- be moved back to 'placed'. This prevents a stale/replayed callback from corrupting a
  -- fulfilled order.
  IF v_order.status != 'pending_payment' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_STATE',
      'order_id', v_order.id,
      'message', 'Cannot confirm payment: order is in status "' || v_order.status || '", expected "pending_payment"'
    );
  END IF;

  -- Update only the specific locked payment record
  UPDATE public.payments
  SET
    status = 'paid',
    payu_txnid = v_txnid,
    payu_mihpayid = v_mihpayid,
    payu_mode = p_mode,
    payu_status = p_status,
    payu_response = p_response_payload,
    verified_via = v_verified_via,
    verified_at = now(),
    updated_at = now()
  WHERE id = v_payment.id;

  -- Transition order status from 'pending_payment' to 'placed' (ready for fulfillment queue)
  UPDATE public.orders
  SET
    status = 'placed',
    payment_status = 'paid',
    payu_txnid = v_txnid,
    updated_at = now()
  WHERE id = v_order.id;

  -- Audit log in order_status_history
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    v_order.id, v_order.status, 'placed', v_caller_id,
    'PayU payment verified successfully (' || v_verified_via || '): TxnID ' || v_txnid || ', MIHPayID ' || v_mihpayid
  );

  -- Record in payu_transactions audit log
  INSERT INTO public.payu_transactions (
    order_id, txnid, action, request_payload, response_payload, status, is_verified
  ) VALUES (
    v_order.id, v_txnid, v_verified_via,
    jsonb_build_object('amount', p_amount, 'mode', p_mode, 'mihpayid', v_mihpayid),
    p_response_payload, 'success', true
  );

  -- Notify Admins: Successful Payment
  v_dedup_admin := 'pay_success_' || v_txnid;
  INSERT INTO public.admin_notifications (
    order_id, order_number, event_type, title, message, metadata, dedup_key
  ) VALUES (
    v_order.id, v_order.order_number, 'payment_success',
    'Payment Verified #' || v_order.order_number,
    'PayU payment of ₹' || p_amount || ' verified via ' || COALESCE(p_mode, 'Online') || '. Order queued for processing.',
    jsonb_build_object('order_id', v_order.id, 'txnid', v_txnid, 'mihpayid', v_mihpayid, 'amount', p_amount),
    v_dedup_admin
  ) ON CONFLICT (dedup_key) DO NOTHING;

  -- Notify Customer: Payment Successful
  IF v_order.user_id IS NOT NULL THEN
    v_dedup_cust := 'cust_pay_success_' || v_txnid;
    INSERT INTO public.customer_notifications (
      user_id, order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_order.user_id, v_order.id, v_order.order_number, 'payment_success',
      'Payment Successful #' || v_order.order_number,
      'Your payment of ₹' || p_amount || ' was verified successfully. Our team will begin preparing your order.',
      jsonb_build_object('order_id', v_order.id, 'txnid', v_txnid, 'amount', p_amount),
      v_dedup_cust
    ) ON CONFLICT (dedup_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', 'placed',
    'payment_status', 'paid'
  );
END;
$$;

-- 7. HARDEN HANDLE_FAILED_PAYU_PAYMENT (5 ARGUMENTS)
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_order record;
  v_payment record;
  v_item record;
  v_curr_stock integer;
  v_txnid text;
BEGIN
  v_caller_role := auth.role();

  -- Security Check 1: Disallow anonymous or client-authenticated execution
  IF v_caller_role IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Access denied: client execution of handle_failed_payu_payment is forbidden';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Cannot handle payment failure: order ID is required';
  END IF;

  v_txnid := BTRIM(COALESCE(p_txnid, ''));
  IF v_txnid = '' THEN
    RAISE EXCEPTION 'Cannot handle payment failure: transaction ID is required';
  END IF;

  -- Strict Order Identity Matching: BOTH id AND payu_txnid must identify the exact same order
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND payu_txnid = v_txnid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or transaction ID mismatch: order % does not match txnid "%"', p_order_id, v_txnid;
  END IF;

  -- If payment already succeeded, do not mark as failed (paid orders are immutable against failure callbacks)
  IF v_order.payment_status IN ('paid', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order is already marked paid.');
  END IF;

  -- Lock and verify the exact payment record for this transaction
  -- Step A: Try exact match on order_id + payu_txnid
  SELECT * INTO v_payment
  FROM public.payments
  WHERE order_id = v_order.id AND payu_txnid = v_txnid
  FOR UPDATE;

  -- Step B: If no exact match, allow fallback ONLY when exactly one unassigned payment exists
  IF NOT FOUND THEN
    IF (SELECT count(*) FROM public.payments WHERE order_id = v_order.id AND payu_txnid IS NULL) = 1 THEN
      SELECT * INTO v_payment
      FROM public.payments
      WHERE order_id = v_order.id AND payu_txnid IS NULL
      FOR UPDATE;
    ELSIF (SELECT count(*) FROM public.payments WHERE order_id = v_order.id AND payu_txnid IS NULL) > 1 THEN
      RAISE EXCEPTION 'Ambiguous payment records: multiple unassigned payments exist for order %. Manual review required.', v_order.id;
    ELSE
      RAISE EXCEPTION 'Payment record not found for order % and transaction "%"', v_order.id, v_txnid;
    END IF;
  END IF;

  -- Record failed transaction log
  INSERT INTO public.payu_transactions (
    order_id, txnid, action, request_payload, response_payload, status, is_verified
  ) VALUES (
    v_order.id, v_txnid, 'failed_callback',
    jsonb_build_object('error_code', p_error_code, 'error_msg', p_error_msg),
    p_response_payload, 'failed', false
  );

  -- Only restock stock if order was in 'pending_payment' and not already cancelled
  IF v_order.status = 'pending_payment' THEN
    -- Restock reserved inventory with accurate previous_stock, new_stock, reason, performed_by
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

      INSERT INTO public.inventory_movements (
        product_id, order_id, movement_type, quantity_change,
        previous_stock, new_stock, reason, performed_by
      ) VALUES (
        v_item.product_id, v_order.id, 'payment_failure_restock', v_item.quantity,
        v_curr_stock, v_curr_stock + v_item.quantity,
        'Restocked inventory following verified failed PayU payment: ' || COALESCE(p_error_msg, 'Declined'),
        NULL
      );
    END LOOP;

    -- Update order status to cancelled
    UPDATE public.orders
    SET
      status = 'cancelled',
      payment_status = 'failed',
      cancelled_at = now(),
      cancellation_reason = COALESCE(p_error_msg, 'Payment cancelled or declined'),
      updated_at = now()
    WHERE id = v_order.id;

    -- Update payment status to failed on the exact payment row
    UPDATE public.payments
    SET
      status = 'failed',
      payu_txnid = v_txnid,
      payu_status = 'failed',
      payu_response = p_response_payload,
      notes = COALESCE(p_error_msg, 'Payment cancelled or declined by gateway'),
      updated_at = now()
    WHERE id = v_payment.id;

    RETURN jsonb_build_object('success', true, 'status', 'cancelled', 'payment_status', 'failed');
  END IF;

  RETURN jsonb_build_object('success', false, 'status', v_order.status, 'message', 'Order was not in pending_payment status.');
END;
$$;

-- 8. HARDEN CUSTOMER_CANCEL_ORDER (FULFILLMENT CUTOFF & TRUTHFUL REFUND REVIEW)
CREATE OR REPLACE FUNCTION public.customer_cancel_order(
  p_order_id uuid DEFAULT NULL,
  p_guest_token text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_order_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_order record;
  v_payment record;
  v_item record;
  v_curr_stock integer;
  v_captured_count integer;
BEGIN
  v_caller_id := auth.uid();

  -- Row lock order by ID or order_number
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;
  ELSIF p_order_number IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE order_number = p_order_number
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Order reference (id or order_number) is required.';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  -- 1. Authorization: verified user ownership or valid guest token
  IF v_caller_id IS NOT NULL THEN
    IF v_order.user_id IS NULL OR v_order.user_id != v_caller_id THEN
      RAISE EXCEPTION 'Access Denied: You do not have permission to cancel this order.';
    END IF;
  ELSE
    IF p_guest_token IS NULL OR BTRIM(p_guest_token) = '' OR
       v_order.guest_tracking_token IS NULL OR v_order.guest_tracking_token != BTRIM(p_guest_token) THEN
      RAISE EXCEPTION 'Access Denied: Valid guest tracking token is required to cancel this order.';
    END IF;
  END IF;

  -- 2. State & Fulfilment Cutoff Enforcement
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Order is already cancelled.';
  END IF;

  IF v_order.status = 'pending_payment' THEN
    RAISE EXCEPTION 'Payment is currently in progress. If payment is not completed, your reservation will expire automatically.';
  END IF;

  -- Irreversible fulfilment states cannot be cancelled by customer
  IF v_order.status IN ('preparing', 'packed', 'out_for_delivery', 'ready_for_pickup', 'completed') THEN
    RAISE EXCEPTION 'Order cannot be cancelled at status "%". The store has already begun preparing or dispatched your items. Please contact store support.', v_order.status;
  END IF;

  -- Permitted cancellation states for customers are strictly: 'placed', 'confirmed'
  IF v_order.status NOT IN ('placed', 'confirmed') THEN
    RAISE EXCEPTION 'Order cannot be cancelled at its current status: "%".', v_order.status;
  END IF;

  -- 3. Payment Consistency & Validation (Must run BEFORE inventory or order modification)
  SELECT count(*) INTO v_captured_count
  FROM public.payments
  WHERE order_id = v_order.id AND status IN ('paid', 'completed');

  IF v_order.payment_status IN ('paid', 'completed') THEN
    -- If order claims to be paid/completed, require exactly one identifiable captured payment record
    IF v_captured_count = 0 THEN
      RAISE EXCEPTION 'Payment inconsistency: order % is marked %, but no captured payment record exists. Manual admin reconciliation required.', v_order.id, v_order.payment_status;
    END IF;

    IF v_captured_count > 1 THEN
      RAISE EXCEPTION 'Ambiguous captured payments: % captured payment records exist for order %. Manual admin reconciliation required.', v_captured_count, v_order.id;
    END IF;

    -- Lock the single identifiable captured payment record
    SELECT * INTO v_payment
    FROM public.payments
    WHERE order_id = v_order.id AND status IN ('paid', 'completed')
    FOR UPDATE;

    -- Verify payment ID, order ID, transaction ID, and amount consistency
    IF v_payment.id IS NULL OR v_payment.order_id != v_order.id THEN
      RAISE EXCEPTION 'Payment identity mismatch: payment record % does not match order %. Manual admin reconciliation required.', v_payment.id, v_order.id;
    END IF;

    -- If order has a PayU transaction ID, require the captured payment record to have the exact same non-empty transaction ID.
    -- A NULL or empty transaction ID on the payment record must NOT pass as a valid match.
    -- Non-PayU orders (where v_order.payu_txnid IS NULL, e.g. COD) are not broken.
    IF v_order.payu_txnid IS NOT NULL AND BTRIM(v_order.payu_txnid) != '' THEN
      IF v_payment.payu_txnid IS NULL OR BTRIM(v_payment.payu_txnid) = '' OR v_payment.payu_txnid != v_order.payu_txnid THEN
        RAISE EXCEPTION 'Payment transaction ID mismatch: order % has PayU txnid "%", but captured payment record % has txnid "%". Manual admin reconciliation required.',
          v_order.id, v_order.payu_txnid, v_payment.id, COALESCE(v_payment.payu_txnid, 'NULL');
      END IF;
    END IF;

    IF ROUND(v_payment.amount, 2) != ROUND(v_order.total_amount, 2) THEN
      RAISE EXCEPTION 'Payment amount mismatch: payment amount % does not match order total %. Manual admin reconciliation required.', v_payment.amount, v_order.total_amount;
    END IF;
  ELSE
    -- Order is NOT marked paid/completed (e.g. pending, failed, or cod)
    -- If a captured payment DOES exist, this is an inconsistent state requiring admin reconciliation!
    IF v_captured_count > 0 THEN
      RAISE EXCEPTION 'Payment inconsistency: order % has payment_status "%", but % captured payment record(s) exist. Manual admin reconciliation required.', v_order.id, v_order.payment_status, v_captured_count;
    END IF;
  END IF;

  -- 4. Stock Restoration with deterministic ordering (executed only after payment consistency verified)
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

    INSERT INTO public.inventory_movements (
      product_id, order_id, movement_type, quantity_change,
      previous_stock, new_stock, reason, performed_by
    ) VALUES (
      v_item.product_id, v_order.id, 'order_cancellation_restock', v_item.quantity,
      v_curr_stock, v_curr_stock + v_item.quantity,
      'Customer cancellation: ' || COALESCE(p_reason, 'Self-service cancel'), v_caller_id
    );
  END LOOP;

  -- 5. Payment Handling & Refund Queue
  -- If payment was captured online, flag the exact captured payment for truthful refund review
  IF v_order.payment_status IN ('paid', 'completed') AND v_payment.id IS NOT NULL THEN
    UPDATE public.payments
    SET
      status = 'refund_pending',
      notes = COALESCE(notes, '') || ' | Pending refund review following customer order cancellation.',
      updated_at = now()
    WHERE id = v_payment.id;

    -- Insert deduplicated order_refunds row for this exact payment
    IF NOT EXISTS (
      SELECT 1 FROM public.order_refunds
      WHERE payment_id = v_payment.id AND status IN ('pending', 'processing', 'completed')
    ) THEN
      INSERT INTO public.order_refunds (
        order_id, payment_id, payu_txnid, amount, status, reason, admin_notes
      ) VALUES (
        v_order.id, v_payment.id, v_payment.payu_txnid, v_payment.amount, 'pending',
        'Customer cancelled paid order: ' || COALESCE(p_reason, 'Self-service cancel'),
        'PayU Txn ID: ' || COALESCE(v_payment.payu_txnid, 'N/A')
      );
    END IF;

    INSERT INTO public.admin_notifications (
      order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_order.id, v_order.order_number, 'payment_attention',
      'Refund Review: Order Cancelled by Customer #' || v_order.order_number,
      'Customer cancelled paid order #' || v_order.order_number || '. Payment marked refund_pending.',
      jsonb_build_object('order_id', v_order.id, 'payment_id', v_payment.id, 'amount', v_payment.amount),
      'cust_cancel_refund_' || v_order.id
    ) ON CONFLICT (dedup_key) DO NOTHING;
  END IF;

  -- 6. Transition order status
  UPDATE public.orders
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancellation_reason = COALESCE(p_reason, 'Customer self-service cancellation'),
    updated_at = now()
  WHERE id = v_order.id;

  -- 7. Audit Trail
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    v_order.id, v_order.status, 'cancelled', v_caller_id,
    'Customer-initiated cancellation: ' || COALESCE(p_reason, 'No reason specified')
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'status', 'cancelled',
    'payment_status', CASE WHEN v_order.payment_status IN ('paid', 'completed') THEN 'refund_pending' ELSE v_order.payment_status END,
    'message', 'Order cancelled successfully.'
  );
END;
$$;

-- 9. PERMISSIONS: REVOKE CLIENT EXECUTE ON INTERNAL PAYMENT RPCS
REVOKE ALL ON FUNCTION public.verify_payu_payment_transaction(uuid, text, text, numeric, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_failed_payu_payment(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- GRANT EXECUTE STRICTLY TO SERVICE_ROLE
GRANT EXECUTE ON FUNCTION public.verify_payu_payment_transaction(uuid, text, text, numeric, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_failed_payu_payment(uuid, text, text, text, jsonb) TO service_role;

-- PERMISSIONS: CUSTOMER CANCEL ORDER
REVOKE EXECUTE ON FUNCTION public.customer_cancel_order(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_cancel_order(uuid, text, text, text) TO authenticated, anon, service_role;

-- 10. REFRESH SCHEMA CACHE & COMMIT TRANSACTION
NOTIFY pgrst, 'reload schema';

COMMIT;
