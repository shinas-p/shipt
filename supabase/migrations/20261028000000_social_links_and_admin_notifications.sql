-- ==============================================================================
-- Shipt Mart — Social Media Links & Real-Time Admin Notifications Migration
-- Version: 20261028000000
-- Target: Supabase / PostgreSQL 15+
--
-- Summary of Changes:
-- 1. Extend public.store_settings with configurable social media links:
--    - social_whatsapp text DEFAULT NULL (WhatsApp Channel URL)
--    - social_instagram text DEFAULT NULL (Instagram Page URL)
--    - social_facebook text DEFAULT NULL (Facebook Page URL)
--
-- 2. Create public.admin_notifications table for durable, real-time admin alerts:
--    - Columns: id, order_id, order_number, event_type, title, message,
--      metadata, is_read, read_at, read_by, dedup_key, created_at.
--    - Indexes on (created_at DESC), (is_read, created_at DESC), (dedup_key).
--
-- 3. Row-Level Security (RLS) on public.admin_notifications:
--    - Restricted to authorized administrators (super_admin, owner, store_manager, block_manager).
--    - Admins can SELECT all notifications.
--    - Admins can UPDATE (mark as read).
--    - Inserts permitted via trusted database trigger or authenticated admin operations.
--
-- 4. Idempotent Database Trigger on public.orders (AFTER INSERT):
--    - Triggers trg_notify_new_order() to record an authoritative admin notification.
--    - Uses ON CONFLICT (dedup_key) DO NOTHING to prevent duplicate events.
--    - Only fires for successfully committed and persisted orders.
--
-- 5. Enable Supabase Realtime publication on public.admin_notifications.
-- ==============================================================================

-- 1. Extend store_settings table with configurable social media coordinates
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS social_whatsapp text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS social_instagram text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS social_facebook text DEFAULT NULL;

-- 2. Create admin_notifications table
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  order_number text,
  event_type text NOT NULL CHECK (event_type IN ('new_order', 'order_cancelled', 'payment_attention', 'new_suggestion', 'low_stock', 'system_alert')),
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz DEFAULT NULL,
  read_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dedup_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at
  ON public.admin_notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread
  ON public.admin_notifications (is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_order_id
  ON public.admin_notifications (order_id)
  WHERE order_id IS NOT NULL;

-- 3. Row Level Security (RLS) on admin_notifications
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Admins can view notifications
DROP POLICY IF EXISTS "admin_notifications_select" ON public.admin_notifications;
CREATE POLICY "admin_notifications_select" ON public.admin_notifications
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
  );

-- Admins can update read status
DROP POLICY IF EXISTS "admin_notifications_update" ON public.admin_notifications;
CREATE POLICY "admin_notifications_update" ON public.admin_notifications
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Allow trusted inserts from authenticated staff and service_role
DROP POLICY IF EXISTS "admin_notifications_insert" ON public.admin_notifications;
CREATE POLICY "admin_notifications_insert" ON public.admin_notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- 4. Idempotent Database Trigger for New Orders
CREATE OR REPLACE FUNCTION public.trg_notify_new_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_title text;
  v_message text;
  v_dedup text;
  v_method_label text;
BEGIN
  -- Format human-readable delivery method
  IF NEW.delivery_method = 'hostel_delivery' THEN
    v_method_label := 'Hostel Delivery' || COALESCE(' (' || NEW.delivery_block_id || ')', '');
  ELSIF NEW.delivery_method = 'campus_pickup' THEN
    v_method_label := 'Campus Pickup';
  ELSE
    v_method_label := 'Delivery';
  END IF;

  v_title := 'New Order #' || COALESCE(NEW.order_number, 'Unknown');
  v_message := 'Order received for ₹' || COALESCE(NEW.total_amount, 0)::text || ' via ' || v_method_label || '.';
  v_dedup := 'order_created:' || NEW.id::text;

  -- Insert notification idempotently
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
    'new_order',
    v_title,
    v_message,
    jsonb_build_object(
      'total_amount', NEW.total_amount,
      'delivery_method', NEW.delivery_method,
      'delivery_block_id', NEW.delivery_block_id,
      'payment_method', NEW.payment_method,
      'payment_status', NEW.payment_status
    ),
    v_dedup,
    now()
  )
  ON CONFLICT (dedup_key) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Ensure notification error never rolls back or aborts order creation
    RAISE WARNING 'trg_notify_new_order exception for order %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_new_order_notification ON public.orders;
CREATE TRIGGER trg_orders_new_order_notification
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_new_order();

-- 5. Helper RPC: Admin Upsert Notification (for idempotent event creation from edge functions / client fallback)
CREATE OR REPLACE FUNCTION public.admin_create_notification(
  p_event_type text,
  p_title text,
  p_message text,
  p_order_id uuid DEFAULT NULL,
  p_order_number text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_dedup_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_inserted_id uuid;
  v_dedup text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Admin authorization required to create notifications';
  END IF;

  v_dedup := COALESCE(p_dedup_key, 'event_' || p_event_type || '_' || gen_random_uuid()::text);

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
    p_order_id,
    p_order_number,
    p_event_type,
    p_title,
    p_message,
    COALESCE(p_metadata, '{}'::jsonb),
    v_dedup,
    now()
  )
  ON CONFLICT (dedup_key) DO UPDATE
    SET updated_at = now() -- No-op to capture id if already exists
  RETURNING id INTO v_inserted_id;

  RETURN jsonb_build_object('success', true, 'id', v_inserted_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_notification TO authenticated, service_role;

-- 6. Helper RPC: Admin Mark All Read
CREATE OR REPLACE FUNCTION public.admin_mark_all_notifications_read()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Admin authorization required';
  END IF;

  UPDATE public.admin_notifications
  SET is_read = true,
      read_at = now(),
      read_by = auth.uid()
  WHERE is_read = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'marked_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mark_all_notifications_read TO authenticated, service_role;

-- 7. Add admin_notifications to supabase_realtime publication
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    -- Table already in publication
    NULL;
END;
$$;
