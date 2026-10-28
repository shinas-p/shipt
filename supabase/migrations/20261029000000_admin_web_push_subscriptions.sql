-- ==============================================================================
-- Shipt Mart — Admin Web Push Subscriptions & Delivery Audit Logs
-- Version: 20261029000000
-- Target: Supabase / PostgreSQL 15+
--
-- Summary of Changes:
-- 1. Create public.admin_push_subscriptions table:
--    - Stores browser PushManager subscriptions (endpoint, p256dh, auth keys)
--      associated with authenticated administrators and their devices.
--    - Enables Web Push notifications to be delivered even when all website tabs are closed.
--    - Supports multiple devices per administrator.
--
-- 2. Create public.admin_push_logs table:
--    - Authoritative, idempotent delivery log recording event deduplication keys,
--      recipient counts, delivery outcomes, and pruning statistics.
--    - Prevents duplicate push deliveries for the same order event.
--
-- 3. Row-Level Security (RLS) on admin_push_subscriptions:
--    - Only authenticated administrators (public.is_admin()) can manage subscriptions.
--    - Admins can read, update, and delete their own device subscriptions.
--    - Super Admins and Owners can view and prune stale devices.
--    - Anonymous and customer users have zero access.
--
-- 4. Helper RPC functions:
--    - admin_upsert_push_subscription()
--    - admin_delete_push_subscription()
--    - admin_get_active_push_subscriptions()
--    - admin_prune_expired_push_subscription()
-- ==============================================================================

-- 1. Table: admin_push_subscriptions
CREATE TABLE IF NOT EXISTS public.admin_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  device_label text NOT NULL DEFAULT 'Browser',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz DEFAULT NULL
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_push_subs_user_id
  ON public.admin_push_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_push_subs_active
  ON public.admin_push_subscriptions(is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_push_subs_endpoint
  ON public.admin_push_subscriptions(endpoint);

-- 2. Table: admin_push_logs (Idempotent delivery audit)
CREATE TABLE IF NOT EXISTS public.admin_push_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  order_number text,
  total_recipients integer NOT NULL DEFAULT 0,
  successful_deliveries integer NOT NULL DEFAULT 0,
  failed_deliveries integer NOT NULL DEFAULT 0,
  pruned_subscriptions integer NOT NULL DEFAULT 0,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_logs_dedup
  ON public.admin_push_logs(dedup_key);

CREATE INDEX IF NOT EXISTS idx_push_logs_created_at
  ON public.admin_push_logs(created_at DESC);

-- 3. Row-Level Security (RLS)
ALTER TABLE public.admin_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_push_logs ENABLE ROW LEVEL SECURITY;

-- Admins can view their own subscriptions (Super Admin / Owner can view all)
DROP POLICY IF EXISTS "admin_push_subscriptions_select" ON public.admin_push_subscriptions;
CREATE POLICY "admin_push_subscriptions_select" ON public.admin_push_subscriptions
  FOR SELECT TO authenticated
  USING (
    public.is_admin() AND (
      auth.uid() = user_id OR
      EXISTS (
        SELECT 1 FROM public.admin_roles
        WHERE user_id = auth.uid() AND role IN ('super_admin', 'owner')
      )
    )
  );

-- Admins can register/insert subscriptions for their own account
DROP POLICY IF EXISTS "admin_push_subscriptions_insert" ON public.admin_push_subscriptions;
CREATE POLICY "admin_push_subscriptions_insert" ON public.admin_push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin() AND auth.uid() = user_id
  );

-- Admins can update their own subscriptions
DROP POLICY IF EXISTS "admin_push_subscriptions_update" ON public.admin_push_subscriptions;
CREATE POLICY "admin_push_subscriptions_update" ON public.admin_push_subscriptions
  FOR UPDATE TO authenticated
  USING (
    public.is_admin() AND (
      auth.uid() = user_id OR
      EXISTS (
        SELECT 1 FROM public.admin_roles
        WHERE user_id = auth.uid() AND role IN ('super_admin', 'owner')
      )
    )
  )
  WITH CHECK (
    public.is_admin()
  );

-- Admins can delete/unsubscribe their own subscriptions (Super Admin / Owner can remove any device)
DROP POLICY IF EXISTS "admin_push_subscriptions_delete" ON public.admin_push_subscriptions;
CREATE POLICY "admin_push_subscriptions_delete" ON public.admin_push_subscriptions
  FOR DELETE TO authenticated
  USING (
    public.is_admin() AND (
      auth.uid() = user_id OR
      EXISTS (
        SELECT 1 FROM public.admin_roles
        WHERE user_id = auth.uid() AND role IN ('super_admin', 'owner')
      )
    )
  );

-- Push logs readable by authorized admins
DROP POLICY IF EXISTS "admin_push_logs_select" ON public.admin_push_logs;
CREATE POLICY "admin_push_logs_select" ON public.admin_push_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- 4. Helper RPC: Upsert Push Subscription
CREATE OR REPLACE FUNCTION public.admin_upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text DEFAULT NULL,
  p_device_label text DEFAULT 'Browser'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_sub_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Admin authorization required to register push subscriptions';
  END IF;

  INSERT INTO public.admin_push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth,
    user_agent,
    device_label,
    is_active,
    updated_at
  ) VALUES (
    v_uid,
    p_endpoint,
    p_p256dh,
    p_auth,
    p_user_agent,
    COALESCE(p_device_label, 'Browser'),
    true,
    now()
  )
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = COALESCE(EXCLUDED.user_agent, admin_push_subscriptions.user_agent),
        device_label = COALESCE(EXCLUDED.device_label, admin_push_subscriptions.device_label),
        is_active = true,
        updated_at = now()
  RETURNING id INTO v_sub_id;

  RETURN jsonb_build_object('success', true, 'subscription_id', v_sub_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_push_subscription TO authenticated, service_role;

-- 5. Helper RPC: Delete / Deactivate Push Subscription
CREATE OR REPLACE FUNCTION public.admin_delete_push_subscription(
  p_endpoint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_is_super boolean;
  v_deleted integer;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Admin authorization required';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = v_uid AND role IN ('super_admin', 'owner')
  ) INTO v_is_super;

  IF v_is_super THEN
    DELETE FROM public.admin_push_subscriptions
    WHERE endpoint = p_endpoint;
  ELSE
    DELETE FROM public.admin_push_subscriptions
    WHERE endpoint = p_endpoint AND user_id = v_uid;
  END IF;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'deleted_count', v_deleted);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_push_subscription TO authenticated, service_role;

-- 6. Helper RPC: Prune Expired / 410 Subscription
CREATE OR REPLACE FUNCTION public.admin_prune_expired_push_subscription(
  p_endpoint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Callable by authenticated admins or service_role edge function
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied';
  END IF;

  DELETE FROM public.admin_push_subscriptions
  WHERE endpoint = p_endpoint;

  RETURN jsonb_build_object('success', true, 'pruned_endpoint', p_endpoint);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_prune_expired_push_subscription TO authenticated, service_role;
