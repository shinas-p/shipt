-- ==============================================================================
-- Shipz Mart — PayU Payment Gateway Integration & Multi-Channel Notifications
-- Migration Version: 20261031000000
-- ==============================================================================

-- 1. EXTEND ORDERS TABLE CONSTRAINTS & COLUMNS FOR PAYU & STATUS LIFECYCLE
-- Drop existing check constraints to safely permit 'pending_payment' order status, 'payu' payment method, and granular payment statuses
DO $$
BEGIN
  -- Drop check on orders.status
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
  ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
    CHECK (status IN (
      'pending_payment',
      'placed',
      'confirmed',
      'preparing',
      'ready_for_pickup',
      'out_for_delivery',
      'completed',
      'cancelled'
    ));

  -- Drop check on orders.payment_method
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
  ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check
    CHECK (payment_method IN ('upi', 'cod', 'payu'));

  -- Drop check on orders.payment_status
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
  ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check
    CHECK (payment_status IN (
      'pending',
      'processing',
      'paid',
      'completed',
      'failed',
      'expired',
      'refund_pending',
      'refunded'
    ));
END $$;

-- Add PayU specific tracking columns to public.orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payu_txnid text UNIQUE,
  ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_payu_txnid ON public.orders(payu_txnid) WHERE payu_txnid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at ON public.orders(payment_expires_at) WHERE status = 'pending_payment';

-- 2. EXTEND PAYMENTS TABLE CONSTRAINTS & COLUMNS
DO $$
BEGIN
  -- Drop check on payments.payment_method
  ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
  ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
    CHECK (payment_method IN ('upi', 'cod', 'payu'));

  -- Drop check on payments.status
  ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
  ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
    CHECK (status IN (
      'pending',
      'processing',
      'paid',
      'completed',
      'failed',
      'expired',
      'refund_pending',
      'refunded'
    ));
END $$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payu_txnid text UNIQUE,
  ADD COLUMN IF NOT EXISTS payu_mihpayid text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payu_mode text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payu_status text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payu_hash text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payu_response jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS verified_via text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_payu_txnid ON public.payments(payu_txnid) WHERE payu_txnid IS NOT NULL;

-- 3. PAYU TRANSACTION AUDIT LOG TABLE
CREATE TABLE IF NOT EXISTS public.payu_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  txnid text NOT NULL,
  action text NOT NULL, -- 'initiate', 'callback', 'webhook', 'verify_api', 'refund'
  request_payload jsonb DEFAULT '{}'::jsonb,
  response_payload jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  ip_address text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payu_transactions_txnid ON public.payu_transactions(txnid);
CREATE INDEX IF NOT EXISTS idx_payu_transactions_order_id ON public.payu_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payu_transactions_created_at ON public.payu_transactions(created_at DESC);

ALTER TABLE public.payu_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payu_transactions_admin_select" ON public.payu_transactions;
CREATE POLICY "payu_transactions_admin_select" ON public.payu_transactions
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "payu_transactions_admin_insert" ON public.payu_transactions;
CREATE POLICY "payu_transactions_admin_insert" ON public.payu_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- 4. CUSTOMER IN-APP NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.customer_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  order_number text,
  event_type text NOT NULL CHECK (event_type IN (
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
    'refund_requested',
    'refund_processing',
    'refund_completed',
    'refund_rejected'
  )),
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz DEFAULT NULL,
  dedup_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_notifications_user ON public.customer_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_notifications_unread ON public.customer_notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_customer_notifications_order ON public.customer_notifications(order_id) WHERE order_id IS NOT NULL;

ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;

-- Customers can select only their own notifications
DROP POLICY IF EXISTS "customer_notifications_select_own" ON public.customer_notifications;
CREATE POLICY "customer_notifications_select_own" ON public.customer_notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Customers can update read status on their own notifications
DROP POLICY IF EXISTS "customer_notifications_update_own" ON public.customer_notifications;
CREATE POLICY "customer_notifications_update_own" ON public.customer_notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Set replica identity to full so realtime payloads contain complete updated row
ALTER TABLE public.customer_notifications REPLICA IDENTITY FULL;

-- Add customer_notifications to supabase_realtime publication
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'customer_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_notifications;
  END IF;
END $$;

-- 5. ORDER REFUNDS TABLE
CREATE TABLE IF NOT EXISTS public.order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.payments(id) ON DELETE CASCADE,
  amount numeric(10, 2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  reason text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  gateway_refund_id text DEFAULT NULL,
  admin_notes text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_refunds_order ON public.order_refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_order_refunds_status ON public.order_refunds(status);

ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_refunds_admin_all" ON public.order_refunds;
CREATE POLICY "order_refunds_admin_all" ON public.order_refunds
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "order_refunds_customer_select" ON public.order_refunds;
CREATE POLICY "order_refunds_customer_select" ON public.order_refunds
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_refunds.order_id AND o.user_id = auth.uid()
    )
  );

-- 6. EXTEND ADMIN NOTIFICATIONS EVENT TYPES
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
      'order_status_changed'
    ));
END $$;

-- 7. DATABASE TRIGGER: NOTIFY CUSTOMER ON SUCCESSFUL ORDER STATUS TRANSITIONS (PART D)
CREATE OR REPLACE FUNCTION public.trg_notify_customer_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_title text;
  v_message text;
  v_event_type text;
  v_dedup text;
BEGIN
  -- Only trigger on actual status transitions
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Map the target order status to customer notification content
  CASE NEW.status
    WHEN 'confirmed' THEN
      v_event_type := 'order_confirmed';
      v_title := 'Order Confirmed #' || COALESCE(NEW.order_number, '');
      v_message := 'Your order has been accepted by our campus team and queued for fulfillment.';
    WHEN 'preparing' THEN
      v_event_type := 'order_preparing';
      v_title := 'Order in Preparation #' || COALESCE(NEW.order_number, '');
      v_message := 'Our store team is currently picking and packing your items.';
    WHEN 'ready_for_pickup' THEN
      v_event_type := 'order_ready';
      v_title := 'Order Ready for Pickup #' || COALESCE(NEW.order_number, '');
      v_message := 'Your package is ready for collection at ' || COALESCE(NEW.pickup_location, 'the central campus store') || '.';
    WHEN 'out_for_delivery' THEN
      v_event_type := 'order_out_for_delivery';
      v_title := 'Order Out for Delivery #' || COALESCE(NEW.order_number, '');
      v_message := 'Our campus delivery coordinator is on the way to ' || COALESCE(NEW.hostel || ' Room ' || NEW.room, 'your address') || '.';
    WHEN 'completed' THEN
      v_event_type := 'order_completed';
      v_title := 'Order Delivered #' || COALESCE(NEW.order_number, '');
      v_message := 'Your order has been successfully delivered and completed. Enjoy your essentials!';
    WHEN 'cancelled' THEN
      v_event_type := 'order_cancelled';
      v_title := 'Order Cancelled #' || COALESCE(NEW.order_number, '');
      v_message := 'Your order has been cancelled.';
    ELSE
      -- Other status transitions (placed, pending_payment) are handled explicitly by payment/order creation
      RETURN NEW;
  END CASE;

  -- 1. Insert customer notification if order has an authenticated customer
  IF NEW.user_id IS NOT NULL THEN
    v_dedup := 'cust_status_' || NEW.id::text || '_' || NEW.status;
    INSERT INTO public.customer_notifications (
      user_id,
      order_id,
      order_number,
      event_type,
      title,
      message,
      metadata,
      dedup_key,
      created_at
    ) VALUES (
      NEW.user_id,
      NEW.id,
      NEW.order_number,
      v_event_type,
      v_title,
      v_message,
      jsonb_build_object(
        'order_id', NEW.id,
        'order_number', NEW.order_number,
        'status', NEW.status,
        'previous_status', OLD.status,
        'total_amount', NEW.total_amount
      ),
      v_dedup,
      now()
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END IF;

  -- 2. Emit admin notification if relevant for staff attention
  IF NEW.status = 'completed' OR NEW.status = 'ready_for_pickup' THEN
    INSERT INTO public.admin_notifications (
      order_id,
      order_number,
      event_type,
      title,
      message,
      metadata,
      dedup_key,
      created_at
    ) VALUES (
      NEW.id,
      NEW.order_number,
      'order_status_changed',
      'Order #' || NEW.order_number || ' Status: ' || upper(replace(NEW.status, '_', ' ')),
      'Order #' || NEW.order_number || ' transitioned to ' || NEW.status || '.',
      jsonb_build_object('order_id', NEW.id, 'order_number', NEW.order_number, 'status', NEW.status),
      'admin_status_' || NEW.id::text || '_' || NEW.status,
      now()
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_customer_order_status_change failed for order %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_customer_status_notification ON public.orders;
CREATE TRIGGER trg_orders_customer_status_notification
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_customer_order_status_change();

-- 8. RPC: VERIFY PAYU PAYMENT SERVER-SIDE (PART A & G)
CREATE OR REPLACE FUNCTION public.verify_payu_payment_transaction(
  p_order_id uuid,
  p_txnid text,
  p_mihpayid text,
  p_amount numeric(10, 2),
  p_status text,
  p_mode text DEFAULT NULL,
  p_response_payload jsonb DEFAULT '{}'::jsonb,
  p_verified_via text DEFAULT 'webhook'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_order record;
  v_payment record;
  v_dedup_admin text;
  v_dedup_cust text;
BEGIN
  v_caller_id := auth.uid();

  -- Atomic row lock on order
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id OR payu_txnid = p_txnid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found for transaction "%"', p_txnid;
  END IF;

  -- Verify amount matches exactly to eliminate price tampering
  IF v_order.total_amount != p_amount THEN
    -- Audit suspicious attempt
    INSERT INTO public.payu_transactions (
      order_id, txnid, action, request_payload, response_payload, status, is_verified
    ) VALUES (
      v_order.id, p_txnid, 'tamper_detected', jsonb_build_object('expected_amount', v_order.total_amount, 'paid_amount', p_amount),
      p_response_payload, 'amount_mismatch', false
    );

    INSERT INTO public.admin_notifications (
      order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_order.id, v_order.order_number, 'payment_suspicious_callback',
      'Suspicious Payment Callback #' || v_order.order_number,
      'PayU reported ₹' || p_amount || ' but order total is ₹' || v_order.total_amount || '. Payment rejected.',
      jsonb_build_object('order_id', v_order.id, 'txnid', p_txnid, 'paid_amount', p_amount, 'expected_amount', v_order.total_amount),
      'tamper_' || p_txnid
    ) ON CONFLICT (dedup_key) DO NOTHING;

    RAISE EXCEPTION 'Amount mismatch: paid % does not match expected total %', p_amount, v_order.total_amount;
  END IF;

  -- If order was already cancelled before payment cleared
  IF v_order.status = 'cancelled' THEN
    -- Flag for administrative refund review immediately
    INSERT INTO public.order_refunds (
      order_id, amount, status, reason, admin_notes
    ) VALUES (
      v_order.id, p_amount, 'pending', 'Payment received after order was already cancelled',
      'PayU Txn ID: ' || p_txnid || ', MIHPayID: ' || p_mihpayid
    );

    UPDATE public.payments
    SET
      status = 'refund_pending',
      payu_txnid = p_txnid,
      payu_mihpayid = p_mihpayid,
      payu_status = p_status,
      payu_mode = p_mode,
      payu_response = p_response_payload,
      verified_via = p_verified_via,
      notes = 'Payment captured after customer cancelled order. Refund review created.',
      updated_at = now()
    WHERE order_id = v_order.id;

    INSERT INTO public.admin_notifications (
      order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_order.id, v_order.order_number, 'payment_attention',
      'Payment Received on Cancelled Order #' || v_order.order_number,
      '₹' || p_amount || ' captured via PayU for cancelled order #' || v_order.order_number || '. Refund review required.',
      jsonb_build_object('order_id', v_order.id, 'txnid', p_txnid, 'mihpayid', p_mihpayid),
      'pay_after_cancel_' || p_txnid
    ) ON CONFLICT (dedup_key) DO NOTHING;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_order.id,
      'status', 'cancelled',
      'payment_status', 'refund_pending',
      'message', 'Payment recorded on cancelled order; flagged for refund.'
    );
  END IF;

  -- Idempotency check: if already marked paid, return success without duplicate processing
  IF v_order.payment_status IN ('paid', 'completed') THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_order.id,
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'message', 'Payment was already verified.'
    );
  END IF;

  -- Update payment record
  UPDATE public.payments
  SET
    status = 'paid',
    payu_txnid = p_txnid,
    payu_mihpayid = p_mihpayid,
    payu_mode = p_mode,
    payu_status = p_status,
    payu_response = p_response_payload,
    verified_via = p_verified_via,
    verified_at = now(),
    updated_at = now()
  WHERE order_id = v_order.id;

  -- Transition order status from 'pending_payment' to 'placed' (ready for fulfillment queue)
  UPDATE public.orders
  SET
    status = 'placed',
    payment_status = 'paid',
    payu_txnid = p_txnid,
    updated_at = now()
  WHERE id = v_order.id;

  -- Audit log in order_status_history
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    v_order.id, v_order.status, 'placed', v_caller_id,
    'PayU payment verified successfully (' || p_verified_via || '): TxnID ' || p_txnid
  );

  -- Record in payu_transactions audit log
  INSERT INTO public.payu_transactions (
    order_id, txnid, action, request_payload, response_payload, status, is_verified
  ) VALUES (
    v_order.id, p_txnid, p_verified_via, jsonb_build_object('amount', p_amount, 'mode', p_mode),
    p_response_payload, 'success', true
  );

  -- Notify Admins: Successful Payment
  v_dedup_admin := 'pay_success_' || p_txnid;
  INSERT INTO public.admin_notifications (
    order_id, order_number, event_type, title, message, metadata, dedup_key
  ) VALUES (
    v_order.id, v_order.order_number, 'payment_success',
    'Payment Verified #' || v_order.order_number,
    'PayU payment of ₹' || p_amount || ' verified via ' || COALESCE(p_mode, 'Online') || '. Order queued for processing.',
    jsonb_build_object('order_id', v_order.id, 'txnid', p_txnid, 'mihpayid', p_mihpayid, 'amount', p_amount),
    v_dedup_admin
  ) ON CONFLICT (dedup_key) DO NOTHING;

  -- Notify Customer: Payment Successful
  IF v_order.user_id IS NOT NULL THEN
    v_dedup_cust := 'cust_pay_success_' || p_txnid;
    INSERT INTO public.customer_notifications (
      user_id, order_id, order_number, event_type, title, message, metadata, dedup_key
    ) VALUES (
      v_order.user_id, v_order.id, v_order.order_number, 'payment_success',
      'Payment Successful #' || v_order.order_number,
      'Your payment of ₹' || p_amount || ' was verified successfully. Our team will begin preparing your order.',
      jsonb_build_object('order_id', v_order.id, 'txnid', p_txnid, 'amount', p_amount),
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

GRANT EXECUTE ON FUNCTION public.verify_payu_payment_transaction(uuid, text, text, numeric, text, text, jsonb, text) TO authenticated, service_role, anon;

-- 9. RPC: HANDLE FAILED / CANCELLED PAYU PAYMENT (PART A & D)
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

      INSERT INTO public.inventory_movements (
        product_id, order_id, movement_type, quantity_change,
        previous_stock, new_stock, reason
      ) VALUES (
        v_item.product_id, v_order.id, 'payment_failure_restock', v_item.quantity,
        v_curr_stock, v_curr_stock + v_item.quantity,
        'Stock release on payment failure: ' || COALESCE(p_error_msg, 'Gateway payment failed')
      );
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
    'PayU payment failed for order #' || v_order.order_number || ': ' || COALESCE(p_error_msg, 'Payment cancelled/declined'),
    jsonb_build_object('order_id', v_order.id, 'txnid', p_txnid, 'error_msg', p_error_msg),
    'admin_pay_fail_' || p_txnid
  ) ON CONFLICT (dedup_key) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'status', 'cancelled',
    'payment_status', 'failed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_failed_payu_payment(uuid, text, text, text, jsonb) TO authenticated, service_role, anon;

-- 10. RPC: EXPIRE STALE PENDING PAYMENTS (PART A.4)
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

      INSERT INTO public.inventory_movements (
        product_id, order_id, movement_type, quantity_change,
        previous_stock, new_stock, reason
      ) VALUES (
        v_item.product_id, v_expired_order.id, 'payment_timeout_restock', v_item.quantity,
        v_curr_stock, v_curr_stock + v_item.quantity,
        'Stock released: PayU payment expired without completion'
      );
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

GRANT EXECUTE ON FUNCTION public.expire_stale_pending_payments() TO authenticated, service_role;

-- 11. RPC: ADMIN MANAGE REFUND
CREATE OR REPLACE FUNCTION public.admin_manage_refund(
  p_order_id uuid,
  p_action text, -- 'approve', 'process', 'complete', 'reject'
  p_amount numeric(10, 2) DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_gateway_refund_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_order record;
  v_refund record;
  v_new_status text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only administrators can manage refunds.';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  CASE p_action
    WHEN 'approve' THEN v_new_status := 'processing';
    WHEN 'complete' THEN v_new_status := 'completed';
    WHEN 'reject' THEN v_new_status := 'rejected';
    ELSE RAISE EXCEPTION 'Invalid refund action: "%"', p_action;
  END CASE;

  -- Upsert order_refunds record
  SELECT * INTO v_refund
  FROM public.order_refunds
  WHERE order_id = p_order_id
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.order_refunds
    SET
      status = v_new_status,
      processed_by = v_caller_id,
      admin_notes = COALESCE(p_notes, admin_notes),
      gateway_refund_id = COALESCE(p_gateway_refund_id, gateway_refund_id),
      updated_at = now()
    WHERE id = v_refund.id;
  ELSE
    INSERT INTO public.order_refunds (
      order_id, amount, status, reason, requested_by, processed_by, admin_notes, gateway_refund_id
    ) VALUES (
      p_order_id, COALESCE(p_amount, v_order.total_amount), v_new_status, 'Admin initiated refund action',
      v_caller_id, v_caller_id, p_notes, p_gateway_refund_id
    );
  END IF;

  -- Update payment status accordingly
  IF v_new_status = 'completed' THEN
    UPDATE public.payments
    SET status = 'refunded', notes = COALESCE(notes, '') || ' | Refund completed by admin', updated_at = now()
    WHERE order_id = p_order_id;

    UPDATE public.orders
    SET payment_status = 'refunded', updated_at = now()
    WHERE id = p_order_id;

    -- Notify customer
    IF v_order.user_id IS NOT NULL THEN
      INSERT INTO public.customer_notifications (
        user_id, order_id, order_number, event_type, title, message, metadata, dedup_key
      ) VALUES (
        v_order.user_id, v_order.id, v_order.order_number, 'refund_completed',
        'Refund Completed #' || v_order.order_number,
        'Your refund of ₹' || COALESCE(p_amount, v_order.total_amount) || ' has been processed. ' || COALESCE(p_notes, ''),
        jsonb_build_object('order_id', v_order.id, 'refund_status', 'completed', 'amount', COALESCE(p_amount, v_order.total_amount)),
        'cust_refund_comp_' || p_order_id::text
      ) ON CONFLICT (dedup_key) DO NOTHING;
    END IF;
  ELSIF v_new_status = 'rejected' THEN
    -- Notify customer of rejection
    IF v_order.user_id IS NOT NULL THEN
      INSERT INTO public.customer_notifications (
        user_id, order_id, order_number, event_type, title, message, metadata, dedup_key
      ) VALUES (
        v_order.user_id, v_order.id, v_order.order_number, 'refund_rejected',
        'Refund Request Declined #' || v_order.order_number,
        'Refund request for order #' || v_order.order_number || ' was reviewed and declined: ' || COALESCE(p_notes, 'Not eligible'),
        jsonb_build_object('order_id', v_order.id, 'refund_status', 'rejected'),
        'cust_refund_rej_' || p_order_id::text
      ) ON CONFLICT (dedup_key) DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'refund_status', v_new_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_manage_refund(uuid, text, numeric, text, text) TO authenticated;

-- 12. UPDATE CREATE_ORDER_WITH_INVENTORY FOR PAYU CHECKOUT (PART A)
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
  v_delivery_block_id := order_payload->>'delivery_block_id';
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

  -- Normalize payment method (upi or payu both treated as online gateway)
  IF v_payment_method NOT IN ('upi', 'cod', 'payu') THEN
    RAISE EXCEPTION 'Invalid payment method: must be payu, upi, or cod';
  END IF;

  -- ==============================================================================
  -- Strict Server-Side Payment Policy & Fake Cash-Order Enforcement
  -- ==============================================================================
  IF v_payment_method = 'cod' THEN
    -- Global cash disablement strictly overrides individual permissions
    IF v_cash_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Cash on Delivery is currently disabled by store policy. Please select online payment.';
    END IF;

    -- Unauthenticated / Guest Policy
    IF v_user_id IS NULL THEN
      IF v_guest_cash_allowed IS NOT TRUE THEN
        RAISE EXCEPTION 'Cash orders are restricted for guest checkouts. Please sign in or use online payment.';
      END IF;
    ELSE
      -- Authenticated Student Policy Checks
      IF v_student_policy = 'online_only' THEN
        RAISE EXCEPTION 'Cash orders are not permitted for your student account policy (Online Only). Please use online payment.';
      END IF;

      -- Check verified uncollected cash order restriction
      IF v_cash_restricted IS TRUE AND v_student_policy != 'cash_and_online' THEN
        RAISE EXCEPTION 'Cash orders are temporarily restricted for your account: %. Please use online payment or contact store support.',
          COALESCE(v_restriction_reason, 'Repeated uncollected cash orders');
      END IF;
    END IF;

    v_initial_status := 'placed';
  ELSE
    -- Online Payment (PayU / UPI)
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

    INSERT INTO public.inventory_movements (
      product_id, order_id, movement_type, quantity_change,
      previous_stock, new_stock, reason, performed_by
    ) VALUES (
      v_product_id, v_order_id,
      CASE WHEN v_initial_status = 'pending_payment' THEN 'payu_checkout_reserve' ELSE 'order_deduction' END,
      -v_qty,
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

GRANT EXECUTE ON FUNCTION public.create_order_with_inventory(jsonb) TO authenticated, anon, service_role;

-- Reload schema
NOTIFY pgrst, 'reload schema';
