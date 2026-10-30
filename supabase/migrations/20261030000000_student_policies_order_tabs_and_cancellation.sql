-- ==============================================================================
-- Shipt Mart — Student Payment Policies, Order Status Tabs & Secure Cancellation
-- Migration Version: 20261030000000
-- ==============================================================================

-- 1. Extend public.store_settings with configurable payment controls
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS cash_payment_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS online_payment_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS guest_cash_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_cash_no_shows_threshold integer NOT NULL DEFAULT 2;

-- 2. Extend public.profiles with student payment policy & trust fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS student_id text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_policy text NOT NULL DEFAULT 'default'
    CHECK (payment_policy IN ('default', 'online_only', 'cash_and_online', 'cash_only')),
  ADD COLUMN IF NOT EXISTS verified_no_show_count integer NOT NULL DEFAULT 0
    CHECK (verified_no_show_count >= 0),
  ADD COLUMN IF NOT EXISTS cash_restricted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cash_restriction_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cash_restricted_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_payment_policy ON public.profiles(payment_policy);
CREATE INDEX IF NOT EXISTS idx_profiles_student_id ON public.profiles(student_id);

-- 3. Student Payment Policy Audit Logs
CREATE TABLE IF NOT EXISTS public.student_payment_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_policy text NOT NULL,
  new_policy text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_payment_audit_logs_student ON public.student_payment_audit_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_student_payment_audit_logs_created_at ON public.student_payment_audit_logs(created_at DESC);

ALTER TABLE public.student_payment_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_payment_audit_logs_admin_select" ON public.student_payment_audit_logs;
CREATE POLICY "student_payment_audit_logs_admin_select" ON public.student_payment_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "student_payment_audit_logs_admin_insert" ON public.student_payment_audit_logs;
CREATE POLICY "student_payment_audit_logs_admin_insert" ON public.student_payment_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- 4. Student Verified Uncollected / No-Show Records
CREATE TABLE IF NOT EXISTS public.student_no_show_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'disputed', 'revoked')),
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz DEFAULT NULL,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_no_show_records_student ON public.student_no_show_records(student_id);
CREATE INDEX IF NOT EXISTS idx_student_no_show_records_order ON public.student_no_show_records(order_id);

ALTER TABLE public.student_no_show_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_no_show_records_admin_select" ON public.student_no_show_records;
CREATE POLICY "student_no_show_records_admin_select" ON public.student_no_show_records
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "student_no_show_records_admin_all" ON public.student_no_show_records;
CREATE POLICY "student_no_show_records_admin_all" ON public.student_no_show_records
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 5. Admin RPC: Update Student Payment Policy with Mandatory Audit Logging
CREATE OR REPLACE FUNCTION public.admin_update_student_payment_policy(
  p_student_id uuid,
  p_policy text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_old_policy text;
  v_student_name text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only authorized administrators can update student payment policies.';
  END IF;

  IF p_policy NOT IN ('default', 'online_only', 'cash_and_online', 'cash_only') THEN
    RAISE EXCEPTION 'Invalid policy: "%". Supported policies are default, online_only, cash_and_online, cash_only.', p_policy;
  END IF;

  SELECT payment_policy, full_name
  INTO v_old_policy, v_student_name
  FROM public.profiles
  WHERE id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student profile not found for id %', p_student_id;
  END IF;

  IF v_old_policy = p_policy THEN
    RETURN jsonb_build_object(
      'success', true,
      'student_id', p_student_id,
      'payment_policy', p_policy,
      'message', 'Policy already matches target.'
    );
  END IF;

  -- Update profile record
  UPDATE public.profiles
  SET
    payment_policy = p_policy,
    updated_at = now()
  WHERE id = p_student_id;

  -- Record in audit log
  INSERT INTO public.student_payment_audit_logs (
    student_id,
    changed_by,
    previous_policy,
    new_policy,
    reason
  ) VALUES (
    p_student_id,
    v_caller_id,
    v_old_policy,
    p_policy,
    COALESCE(p_reason, 'Policy adjusted by administrator')
  );

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'previous_policy', v_old_policy,
    'new_policy', p_policy
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_student_payment_policy(uuid, text, text) TO authenticated;

-- 6. Admin RPC: Record Verified No-Show / Uncollected Order
CREATE OR REPLACE FUNCTION public.admin_record_student_no_show(
  p_student_id uuid,
  p_order_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_threshold integer;
  v_new_count integer;
  v_should_restrict boolean := false;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only administrators can record uncollected cash orders.';
  END IF;

  SELECT COALESCE(max_cash_no_shows_threshold, 2)
  INTO v_threshold
  FROM public.store_settings
  WHERE id = 'default';

  INSERT INTO public.student_no_show_records (
    student_id, order_id, recorded_by, notes, status
  ) VALUES (
    p_student_id, p_order_id, v_caller_id, p_notes, 'verified'
  );

  -- Recalculate verified active no-shows
  SELECT COUNT(*)::integer
  INTO v_new_count
  FROM public.student_no_show_records
  WHERE student_id = p_student_id AND status = 'verified';

  IF v_new_count >= v_threshold THEN
    v_should_restrict := true;
  END IF;

  UPDATE public.profiles
  SET
    verified_no_show_count = v_new_count,
    cash_restricted = CASE WHEN v_should_restrict THEN true ELSE cash_restricted END,
    cash_restriction_reason = CASE
      WHEN v_should_restrict AND cash_restriction_reason IS NULL
      THEN 'Repeated uncollected cash orders (' || v_new_count || ' verified no-shows)'
      ELSE cash_restriction_reason
    END,
    cash_restricted_at = CASE WHEN v_should_restrict AND cash_restricted_at IS NULL THEN now() ELSE cash_restricted_at END,
    updated_at = now()
  WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'verified_no_show_count', v_new_count,
    'cash_restricted', v_should_restrict
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_record_student_no_show(uuid, uuid, text) TO authenticated;

-- 7. Admin RPC: Restore Cash Privileges / Resolve Disputes
CREATE OR REPLACE FUNCTION public.admin_restore_cash_privileges(
  p_student_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only administrators can restore cash privileges.';
  END IF;

  UPDATE public.profiles
  SET
    cash_restricted = false,
    cash_restriction_reason = NULL,
    cash_restricted_at = NULL,
    updated_at = now()
  WHERE id = p_student_id;

  INSERT INTO public.student_payment_audit_logs (
    student_id, changed_by, previous_policy, new_policy, reason
  )
  SELECT id, v_caller_id, payment_policy, payment_policy,
         'Cash privileges manually restored by administrator: ' || COALESCE(p_reason, 'No reason specified')
  FROM public.profiles
  WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'cash_restricted', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_restore_cash_privileges(uuid, text) TO authenticated;

-- 8. Admin RPC: Dispute / Revoke an Inaccurate No-Show Record
CREATE OR REPLACE FUNCTION public.admin_dispute_no_show_record(
  p_record_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_student_id uuid;
  v_threshold integer;
  v_new_count integer;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only administrators can dispute or revoke no-show records.';
  END IF;

  SELECT student_id INTO v_student_id
  FROM public.student_no_show_records
  WHERE id = p_record_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No-show record not found.';
  END IF;

  UPDATE public.student_no_show_records
  SET
    status = 'revoked',
    revoked_by = v_caller_id,
    revoked_at = now(),
    revoke_reason = p_reason,
    updated_at = now()
  WHERE id = p_record_id;

  SELECT COALESCE(max_cash_no_shows_threshold, 2)
  INTO v_threshold
  FROM public.store_settings
  WHERE id = 'default';

  SELECT COUNT(*)::integer
  INTO v_new_count
  FROM public.student_no_show_records
  WHERE student_id = v_student_id AND status = 'verified';

  UPDATE public.profiles
  SET
    verified_no_show_count = v_new_count,
    cash_restricted = CASE WHEN v_new_count < v_threshold THEN false ELSE cash_restricted END,
    cash_restriction_reason = CASE WHEN v_new_count < v_threshold THEN NULL ELSE cash_restriction_reason END,
    updated_at = now()
  WHERE id = v_student_id;

  RETURN jsonb_build_object(
    'success', true,
    'record_id', p_record_id,
    'student_id', v_student_id,
    'active_verified_count', v_new_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dispute_no_show_record(uuid, text) TO authenticated;

-- 9. Admin RPC: Update Store Payment Settings
CREATE OR REPLACE FUNCTION public.admin_update_store_payment_settings(
  p_cash_enabled boolean,
  p_online_enabled boolean,
  p_guest_cash_allowed boolean,
  p_threshold integer
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
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = 'default';

  RETURN jsonb_build_object(
    'success', true,
    'cash_payment_enabled', p_cash_enabled,
    'online_payment_enabled', p_online_enabled,
    'guest_cash_allowed', p_guest_cash_allowed,
    'max_cash_no_shows_threshold', p_threshold
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_store_payment_settings(boolean, boolean, boolean, integer) TO authenticated;

-- 10. Trusted Payment Verification RPC
CREATE OR REPLACE FUNCTION public.verify_payment_transaction(
  p_order_id uuid,
  p_reference text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_curr_status text;
  v_payment_method text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only authorized administrators or secure webhooks can verify payment.';
  END IF;

  SELECT payment_status, payment_method INTO v_curr_status, v_payment_method
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  IF v_curr_status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Payment already verified as completed.');
  END IF;

  -- Update payments table
  UPDATE public.payments
  SET
    status = 'completed',
    upi_reference_number = p_reference,
    verified_by = v_caller_id,
    verified_at = now(),
    notes = COALESCE(p_notes, 'Verified by administrator')
  WHERE order_id = p_order_id;

  -- Update order payment_status
  UPDATE public.orders
  SET
    payment_status = 'completed',
    updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'payment_status', 'completed',
    'verified_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_payment_transaction(uuid, text, text) TO authenticated;

-- 11. Secure Customer Order Cancellation RPC with Concurrency Protection
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

  -- Atomic row lock on order by either order_id or order_number to prevent concurrent race conditions
  IF p_order_id IS NOT NULL THEN
    SELECT
      id,
      user_id,
      guest_tracking_token,
      order_number,
      status,
      payment_status,
      payment_method
    INTO
      v_resolved_order_id,
      v_order_user_id,
      v_order_guest_token,
      v_order_number,
      v_status,
      v_payment_status,
      v_payment_method
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;
  ELSIF p_order_number IS NOT NULL THEN
    SELECT
      id,
      user_id,
      guest_tracking_token,
      order_number,
      status,
      payment_status,
      payment_method
    INTO
      v_resolved_order_id,
      v_order_user_id,
      v_order_guest_token,
      v_order_number,
      v_status,
      v_payment_status,
      v_payment_method
    FROM public.orders
    WHERE order_number = p_order_number
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Order reference (id or order_number) is required.';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  -- 1. Authorization check: verified account ownership or guest token
  IF v_caller_id IS NOT NULL THEN
    IF v_order_user_id IS NULL OR v_order_user_id != v_caller_id THEN
      RAISE EXCEPTION 'Access Denied: You do not have permission to cancel this order.';
    END IF;
  ELSE
    -- Guest cancellation requires matching the private 64-character tracking token
    IF p_guest_token IS NULL OR BTRIM(p_guest_token) = '' OR
       v_order_guest_token IS NULL OR v_order_guest_token != BTRIM(p_guest_token) THEN
      RAISE EXCEPTION 'Access Denied: Valid guest tracking token is required to cancel this order.';
    END IF;
  END IF;

  -- 2. State validation & cutoff enforcement
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Order is already cancelled.';
  END IF;

  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'Completed orders cannot be cancelled. Please contact campus store support.';
  END IF;

  IF v_status IN ('out_for_delivery', 'ready_for_pickup') THEN
    RAISE EXCEPTION 'Order is already in transit or ready for pickup and can no longer be cancelled by the customer.';
  END IF;

  IF v_status NOT IN ('placed', 'confirmed', 'preparing') THEN
    RAISE EXCEPTION 'Order cannot be cancelled at its current status: "%".', v_status;
  END IF;

  -- 3. Atomic stock restoration with deterministic UUID ordering
  FOR v_item IN
    SELECT product_id, SUM(quantity)::integer AS quantity
    FROM public.order_items
    WHERE order_id = v_resolved_order_id AND product_id IS NOT NULL
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
      v_item.product_id, v_resolved_order_id, 'order_cancellation_restock', v_item.quantity,
      v_curr_stock, v_curr_stock + v_item.quantity,
      'Customer cancellation: ' || COALESCE(p_reason, 'Self-service cancel'), v_caller_id
    );
  END LOOP;

  -- 4. Payment handling: truthful refund flagging without fake instant completion
  -- If customer already paid online, flag for review rather than claiming refund has settled
  IF v_payment_method = 'upi' AND v_payment_status = 'completed' THEN
    UPDATE public.payments
    SET
      notes = COALESCE(notes, '') || ' | Pending refund review following customer order cancellation.',
      updated_at = now()
    WHERE order_id = v_resolved_order_id;
  END IF;

  -- 5. Transition order status
  UPDATE public.orders
  SET
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  WHERE id = v_resolved_order_id;

  -- 6. Audit trail
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    v_resolved_order_id, v_status, 'cancelled', v_caller_id,
    'Customer-initiated cancellation: ' || COALESCE(p_reason, 'No reason specified')
  );

  -- 7. Notification for Admins with dedup_key
  INSERT INTO public.admin_notifications (
    order_id, order_number, event_type, title, message, metadata, dedup_key
  ) VALUES (
    v_resolved_order_id,
    v_order_number,
    'order_cancelled',
    'Order #' || v_order_number || ' Cancelled by Customer',
    'Customer cancelled order ' || v_order_number || ' (' || COALESCE(p_reason, 'No reason provided') || '). Stock automatically restored.',
    jsonb_build_object(
      'order_id', v_resolved_order_id,
      'order_number', v_order_number,
      'previous_status', v_status,
      'reason', p_reason,
      'cancelled_by', COALESCE(v_caller_id::text, 'guest')
    ),
    'order_cancelled:' || v_resolved_order_id::text
  )
  ON CONFLICT (dedup_key) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_resolved_order_id,
    'order_number', v_order_number,
    'status', 'cancelled',
    'refund_status', CASE
      WHEN v_payment_method = 'upi' AND v_payment_status = 'completed' THEN 'refund_review_required'
      ELSE 'not_applicable'
    END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.customer_cancel_order(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_cancel_order(uuid, text, text, text) TO authenticated, anon;

-- 12. Update create_order_with_inventory with Server-Side Policy & Cash Restriction Enforcement
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

  IF v_payment_method NOT IN ('upi', 'cod') THEN
    RAISE EXCEPTION 'Invalid payment method: must be upi or cod';
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
  END IF;

  IF v_payment_method = 'upi' THEN
    IF v_online_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Online payment is currently disabled by store policy.';
    END IF;

    IF v_user_id IS NOT NULL AND v_student_policy = 'cash_only' THEN
      RAISE EXCEPTION 'Online payment is not permitted for your account policy (Cash Only). Please select cash payment.';
    END IF;
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
      v_db_stock, v_db_stock - v_qty, 'Customer order ' || v_order_number, v_user_id
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
    order_id, payment_method, amount, status
  ) VALUES (
    v_order_id, v_payment_method, v_total_amount, 'pending'
  );

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
    'payment_status', 'pending',
    'delivery_block_id', v_delivery_block_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_order_with_inventory(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_with_inventory(jsonb) TO authenticated, anon, service_role;

-- Reload schema
NOTIFY pgrst, 'reload schema';
