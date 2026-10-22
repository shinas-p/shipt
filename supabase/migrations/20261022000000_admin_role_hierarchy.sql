-- ==============================================================================
-- Shipt Mart — Admin Role Hierarchy & Secure Permissions Migration
-- Version: 20261022000000
-- Target: Supabase / PostgreSQL 15+
--
-- Summary of Changes:
-- 1. Canonical delivery_blocks table for verified block assignments.
-- 2. Audit log table public.admin_audit_logs for tracking all administrative role
--    and assignment changes.
-- 3. Extend public.admin_roles to support 4-role hierarchy:
--    'super_admin', 'owner', 'store_manager', 'block_manager', and nullable assigned_block.
-- 4. Role helper & permission functions:
--    is_super_admin(), is_owner(), is_store_manager(), is_block_manager(),
--    get_admin_role(), get_assigned_block(), is_admin(), can_manage_costs(),
--    can_manage_all_orders(), can_manage_catalog().
-- 5. Strict RLS policy updates:
--    - admin_roles: Super Admin full access; users can view their own role & block.
--    - product_costs: Strictly super_admin & owner (via can_manage_costs()).
--    - orders: super_admin, owner, store_manager can view all; block_manager strictly
--      restricted to orders.block = public.get_assigned_block().
--    - order_items & order_status_history: enforced matching parent order block isolation.
--    - payments: Block Manager denied access; Store Manager store-level; Owner/Super Admin full.
-- 6. Super Admin RPCs:
--    - admin_list_roles (with assigned_block)
--    - admin_assign_role (with assigned_block and last Super Admin safeguard)
--    - admin_revoke_role (with last Super Admin safeguard)
--    - admin_get_audit_logs
-- ==============================================================================

-- 1. Canonical Delivery Blocks Table
CREATE TABLE IF NOT EXISTS public.delivery_blocks (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed standard delivery blocks safely and idempotently
INSERT INTO public.delivery_blocks (id, name, description)
VALUES
  ('Block A', 'Block A', 'Residential Area Block A'),
  ('Block B', 'Block B', 'Residential Area Block B'),
  ('Block C', 'Block C', 'Residential Area Block C'),
  ('Block D', 'Block D', 'Residential Area Block D'),
  ('North Wing', 'North Wing', 'North Wing Delivery Zone'),
  ('South Wing', 'South Wing', 'South Wing Delivery Zone'),
  ('Main Campus', 'Main Campus', 'Main Hub Delivery Zone')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.delivery_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_blocks_select_all" ON public.delivery_blocks;
CREATE POLICY "delivery_blocks_select_all" ON public.delivery_blocks
  FOR SELECT TO authenticated, anon
  USING (true);

-- 2. Admin Audit Logs Table
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text NOT NULL DEFAULT '',
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_email text NOT NULL DEFAULT '',
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor ON public.admin_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target ON public.admin_audit_logs(target_user_id);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_audit_logs FROM PUBLIC, anon;
GRANT SELECT ON public.admin_audit_logs TO authenticated;

-- 3. Extend public.admin_roles Table
-- Add assigned_block column referencing delivery_blocks
ALTER TABLE public.admin_roles
  ADD COLUMN IF NOT EXISTS assigned_block text REFERENCES public.delivery_blocks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_admin_roles_assigned_block ON public.admin_roles(assigned_block);

-- Safely update CHECK constraint to allow all 4 roles:
-- 'super_admin', 'owner', 'store_manager', 'block_manager'
DO $$
BEGIN
  ALTER TABLE public.admin_roles DROP CONSTRAINT IF EXISTS admin_roles_role_check;
  ALTER TABLE public.admin_roles ADD CONSTRAINT admin_roles_role_check
    CHECK (role IN ('super_admin', 'owner', 'store_manager', 'block_manager'));
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 4. Role Helper and Authorization Functions
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_store_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role = 'store_manager'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_block_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role = 'block_manager'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role IN ('super_admin', 'owner', 'store_manager', 'block_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_costs()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role IN ('super_admin', 'owner')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_all_orders()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role IN ('super_admin', 'owner', 'store_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_catalog()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role IN ('super_admin', 'owner', 'store_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.get_admin_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.admin_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE
    WHEN role = 'super_admin' THEN 1
    WHEN role = 'owner' THEN 2
    WHEN role = 'store_manager' THEN 3
    WHEN role = 'block_manager' THEN 4
    ELSE 5
  END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_assigned_block()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT assigned_block FROM public.admin_roles
  WHERE user_id = auth.uid() AND role = 'block_manager'
  LIMIT 1;
$$;

-- Grant execution to authenticated & anon
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_store_manager() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_block_manager() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_costs() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_all_orders() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_catalog() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_role() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_assigned_block() TO authenticated, anon;

-- 5. Protect public.admin_roles Table
DROP POLICY IF EXISTS "admin_roles_select_super_admin" ON public.admin_roles;
DROP POLICY IF EXISTS "admin_roles_modify_super_admin" ON public.admin_roles;
DROP POLICY IF EXISTS "admin_roles_select_policy" ON public.admin_roles;

-- Super Admin can view all roles; individual staff can view their own role & block
CREATE POLICY "admin_roles_select_policy" ON public.admin_roles
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR user_id = auth.uid());

-- Only Super Admin can insert, update, or delete admin roles
CREATE POLICY "admin_roles_modify_super_admin" ON public.admin_roles
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Protect audit logs
DROP POLICY IF EXISTS "admin_audit_logs_select_super_admin" ON public.admin_audit_logs;
CREATE POLICY "admin_audit_logs_select_super_admin" ON public.admin_audit_logs
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- 6. Supplier Costs Protection (Super Admin & Owner Only)
CREATE TABLE IF NOT EXISTS public.product_costs (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_cost numeric(10, 2) NOT NULL DEFAULT 0.00 CHECK (supplier_cost >= 0),
  other_costs numeric(10, 2) NOT NULL DEFAULT 0.00 CHECK (other_costs >= 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_costs_product_id ON public.product_costs(product_id);
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_costs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;

DROP POLICY IF EXISTS "product_costs_admin_all" ON public.product_costs;
CREATE POLICY "product_costs_admin_all" ON public.product_costs
  FOR ALL TO authenticated
  USING (public.can_manage_costs())
  WITH CHECK (public.can_manage_costs());

-- Update RPCs for supplier costs to check can_manage_costs()
CREATE OR REPLACE FUNCTION public.admin_upsert_product_cost(
  p_product_id uuid,
  p_supplier_cost numeric,
  p_other_costs numeric DEFAULT 0.00,
  p_notes text DEFAULT ''
)
RETURNS public.product_costs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result public.product_costs;
BEGIN
  -- Strict server-side authorization check: Super Admin or Owner only
  IF NOT public.can_manage_costs() THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators and Owners can manage supplier costs.';
  END IF;

  IF p_supplier_cost IS NULL OR p_supplier_cost < 0 THEN
    RAISE EXCEPTION 'Invalid supplier cost: Amount must be non-negative.';
  END IF;

  IF p_other_costs IS NULL OR p_other_costs < 0 THEN
    RAISE EXCEPTION 'Invalid other costs: Amount must be non-negative.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Product with ID % does not exist.', p_product_id;
  END IF;

  INSERT INTO public.product_costs (
    product_id,
    supplier_cost,
    other_costs,
    notes,
    updated_at
  )
  VALUES (
    p_product_id,
    ROUND(p_supplier_cost, 2),
    ROUND(p_other_costs, 2),
    COALESCE(TRIM(p_notes), ''),
    now()
  )
  ON CONFLICT (product_id) DO UPDATE
  SET
    supplier_cost = EXCLUDED.supplier_cost,
    other_costs = EXCLUDED.other_costs,
    notes = EXCLUDED.notes,
    updated_at = now()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_product_profitability()
RETURNS TABLE (
  product_id uuid,
  product_name text,
  size text,
  category_id text,
  price numeric,
  stock integer,
  is_active boolean,
  supplier_cost numeric,
  other_costs numeric,
  total_cost numeric,
  estimated_profit numeric,
  profit_margin_pct numeric,
  markup_pct numeric,
  inventory_cost_value numeric,
  inventory_profit_potential numeric,
  notes text,
  cost_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Strict server-side authorization check: Super Admin or Owner only
  IF NOT public.can_manage_costs() THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators and Owners can view profitability metrics.';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.size,
    p.category_id,
    p.price,
    p.stock,
    p.is_active,
    COALESCE(pc.supplier_cost, 0.00) AS supplier_cost,
    COALESCE(pc.other_costs, 0.00) AS other_costs,
    (COALESCE(pc.supplier_cost, 0.00) + COALESCE(pc.other_costs, 0.00)) AS total_cost,
    (p.price - (COALESCE(pc.supplier_cost, 0.00) + COALESCE(pc.other_costs, 0.00))) AS estimated_profit,
    CASE
      WHEN p.price > 0 THEN
        ROUND(((p.price - (COALESCE(pc.supplier_cost, 0.00) + COALESCE(pc.other_costs, 0.00))) / p.price) * 100.0, 2)
      ELSE 0.00
    END AS profit_margin_pct,
    CASE
      WHEN COALESCE(pc.supplier_cost, 0.00) > 0 THEN
        ROUND(((p.price - (COALESCE(pc.supplier_cost, 0.00) + COALESCE(pc.other_costs, 0.00))) / pc.supplier_cost) * 100.0, 2)
      ELSE 0.00
    END AS markup_pct,
    ((COALESCE(pc.supplier_cost, 0.00) + COALESCE(pc.other_costs, 0.00)) * p.stock) AS inventory_cost_value,
    ((p.price - (COALESCE(pc.supplier_cost, 0.00) + COALESCE(pc.other_costs, 0.00))) * p.stock) AS inventory_profit_potential,
    COALESCE(pc.notes, '') AS notes,
    pc.updated_at AS cost_updated_at
  FROM public.products p
  LEFT JOIN public.product_costs pc ON pc.product_id = p.id
  ORDER BY p.name ASC;
END;
$$;

-- 7. Orders RLS and Block Isolation
DROP POLICY IF EXISTS "orders_select_policy" ON public.orders;
CREATE POLICY "orders_select_policy" ON public.orders
  FOR SELECT TO authenticated
  USING (
    -- Customer viewing own order
    (auth.uid() IS NOT NULL AND user_id = auth.uid()) OR
    -- Super Admin, Owner, Store Manager can view all orders
    public.can_manage_all_orders() OR
    -- Block Manager can strictly view orders matching assigned_block
    (public.is_block_manager() AND block IS NOT NULL AND block = public.get_assigned_block())
  );

DROP POLICY IF EXISTS "orders_update_admin" ON public.orders;
CREATE POLICY "orders_update_admin" ON public.orders
  FOR UPDATE TO authenticated
  USING (
    public.can_manage_all_orders() OR
    (public.is_block_manager() AND block IS NOT NULL AND block = public.get_assigned_block())
  )
  WITH CHECK (
    public.can_manage_all_orders() OR
    (public.is_block_manager() AND block IS NOT NULL AND block = public.get_assigned_block())
  );

-- Index on orders.block for performant block filtering
CREATE INDEX IF NOT EXISTS idx_orders_block ON public.orders(block);

-- 8. Order Items RLS and Block Isolation
DROP POLICY IF EXISTS "order_items_select_policy" ON public.order_items;
CREATE POLICY "order_items_select_policy" ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          (auth.uid() IS NOT NULL AND o.user_id = auth.uid()) OR
          public.can_manage_all_orders() OR
          (public.is_block_manager() AND o.block IS NOT NULL AND o.block = public.get_assigned_block())
        )
    )
  );

-- 9. Order Status History RLS and Block Isolation
DROP POLICY IF EXISTS "order_status_history_select_policy" ON public.order_status_history;
CREATE POLICY "order_status_history_select_policy" ON public.order_status_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_status_history.order_id
        AND (
          (auth.uid() IS NOT NULL AND o.user_id = auth.uid()) OR
          public.can_manage_all_orders() OR
          (public.is_block_manager() AND o.block IS NOT NULL AND o.block = public.get_assigned_block())
        )
    )
  );

DROP POLICY IF EXISTS "order_status_history_admin_all" ON public.order_status_history;
CREATE POLICY "order_status_history_admin_all" ON public.order_status_history
  FOR ALL TO authenticated
  USING (
    public.can_manage_all_orders() OR
    (public.is_block_manager() AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_status_history.order_id
        AND o.block IS NOT NULL AND o.block = public.get_assigned_block()
    ))
  )
  WITH CHECK (
    public.can_manage_all_orders() OR
    (public.is_block_manager() AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_status_history.order_id
        AND o.block IS NOT NULL AND o.block = public.get_assigned_block()
    ))
  );

-- 10. Payments RLS (Sensitive Financial Data)
-- Block Manager denied access; Store Manager store-level; Owner & Super Admin full.
DROP POLICY IF EXISTS "payments_select_policy" ON public.payments;
CREATE POLICY "payments_select_policy" ON public.payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = payments.order_id
        AND (
          (auth.uid() IS NOT NULL AND o.user_id = auth.uid()) OR
          public.is_super_admin() OR
          public.is_owner() OR
          (public.is_store_manager() AND EXISTS (SELECT 1 FROM public.orders ord WHERE ord.id = payments.order_id))
        )
    )
  );

DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;
CREATE POLICY "payments_admin_all" ON public.payments
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_owner())
  WITH CHECK (public.is_super_admin() OR public.is_owner());

-- 11. Banners & Categories Policies
-- Super Admin & Owner manage banners
DROP POLICY IF EXISTS "banners_admin_all" ON public.banners;
CREATE POLICY "banners_admin_all" ON public.banners
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_owner())
  WITH CHECK (public.is_super_admin() OR public.is_owner());

-- Super Admin, Owner & Store Manager can manage categories & products
DROP POLICY IF EXISTS "categories_admin_all" ON public.categories;
CREATE POLICY "categories_admin_all" ON public.categories
  FOR ALL TO authenticated
  USING (public.can_manage_catalog())
  WITH CHECK (public.can_manage_catalog());

-- 12. RPC: Super Admin - List all staff roles with block assignments
DROP FUNCTION IF EXISTS public.admin_list_roles();
CREATE OR REPLACE FUNCTION public.admin_list_roles()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  role text,
  assigned_block text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators can view staff roles.';
  END IF;

  RETURN QUERY
  SELECT
    ar.user_id,
    u.email::text,
    COALESCE(p.full_name, '')::text,
    ar.role,
    ar.assigned_block,
    ar.created_at
  FROM public.admin_roles ar
  JOIN auth.users u ON u.id = ar.user_id
  LEFT JOIN public.profiles p ON p.id = ar.user_id
  ORDER BY
    CASE
      WHEN ar.role = 'super_admin' THEN 1
      WHEN ar.role = 'owner' THEN 2
      WHEN ar.role = 'store_manager' THEN 3
      WHEN ar.role = 'block_manager' THEN 4
      ELSE 5
    END,
    ar.created_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_roles() TO authenticated;

-- 13. RPC: Super Admin - Assign role and block with Last Super Admin Safeguard
DROP FUNCTION IF EXISTS public.admin_assign_role(text, text);
DROP FUNCTION IF EXISTS public.admin_assign_role(text, text, text);
CREATE OR REPLACE FUNCTION public.admin_assign_role(
  p_email text,
  p_role text,
  p_assigned_block text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target_id uuid;
  v_clean_email text;
  v_actor_email text;
  v_current_role text;
  v_super_count integer;
BEGIN
  -- Strict Super Admin check
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators can assign staff roles.';
  END IF;

  -- Role boundary check
  IF p_role NOT IN ('super_admin', 'owner', 'store_manager', 'block_manager') THEN
    RAISE EXCEPTION 'Invalid role specified: %. Supported roles: super_admin, owner, store_manager, block_manager', p_role;
  END IF;

  -- Block Manager assignment validation
  IF p_role = 'block_manager' AND (p_assigned_block IS NULL OR TRIM(p_assigned_block) = '') THEN
    RAISE EXCEPTION 'A valid delivery block must be assigned when designating a Block Manager.';
  END IF;

  IF p_role = 'block_manager' AND p_assigned_block IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.delivery_blocks WHERE id = TRIM(p_assigned_block)) THEN
      RAISE EXCEPTION 'Invalid delivery block "%". Block must exist in delivery_blocks.', p_assigned_block;
    END IF;
  END IF;

  -- Normalize and validate target email
  v_clean_email := lower(trim(COALESCE(p_email, '')));
  IF v_clean_email = '' OR position('@' in v_clean_email) = 0 THEN
    RAISE EXCEPTION 'A valid email address is required.';
  END IF;

  -- Safe user lookup in auth.users
  SELECT id INTO v_target_id
  FROM auth.users
  WHERE lower(email) = v_clean_email
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'No user found with email "%". The user must register an account first.', v_clean_email;
  END IF;

  -- Safeguard: If target user is currently a Super Admin and is being changed to another role,
  -- verify that at least one other Super Admin exists.
  SELECT role INTO v_current_role
  FROM public.admin_roles
  WHERE user_id = v_target_id AND role = 'super_admin';

  IF v_current_role = 'super_admin' AND p_role != 'super_admin' THEN
    SELECT COUNT(*) INTO v_super_count
    FROM public.admin_roles
    WHERE role = 'super_admin';

    IF v_super_count <= 1 THEN
      RAISE EXCEPTION 'Action blocked: Cannot demote or change the role of the last remaining Super Administrator.';
    END IF;
  END IF;

  -- Get actor email for audit log
  SELECT lower(email) INTO v_actor_email
  FROM auth.users
  WHERE id = auth.uid();

  -- Clear any previous role for this user to guarantee single active role
  DELETE FROM public.admin_roles WHERE user_id = v_target_id;

  -- Insert new role assignment
  INSERT INTO public.admin_roles (user_id, role, assigned_block, created_by, created_at)
  VALUES (
    v_target_id,
    p_role,
    CASE WHEN p_role = 'block_manager' THEN TRIM(p_assigned_block) ELSE NULL END,
    auth.uid(),
    now()
  );

  -- Audit log entry
  INSERT INTO public.admin_audit_logs (
    actor_id,
    actor_email,
    target_user_id,
    target_email,
    action,
    details,
    created_at
  )
  VALUES (
    auth.uid(),
    COALESCE(v_actor_email, 'system'),
    v_target_id,
    v_clean_email,
    'role_assigned',
    jsonb_build_object(
      'previous_role', v_current_role,
      'new_role', p_role,
      'assigned_block', CASE WHEN p_role = 'block_manager' THEN TRIM(p_assigned_block) ELSE NULL END
    ),
    now()
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_assign_role(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_role(text, text, text) TO authenticated;

-- 14. RPC: Super Admin - Revoke role with Last Super Admin Safeguard
DROP FUNCTION IF EXISTS public.admin_revoke_role(uuid, text);
CREATE OR REPLACE FUNCTION public.admin_revoke_role(p_user_id uuid, p_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_super_count integer;
  v_actor_email text;
  v_target_email text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators can revoke staff roles.';
  END IF;

  -- Guard: Prevent revoking the last remaining super_admin
  IF p_role = 'super_admin' THEN
    SELECT COUNT(*) INTO v_super_count
    FROM public.admin_roles
    WHERE role = 'super_admin';

    IF v_super_count <= 1 THEN
      RAISE EXCEPTION 'Action blocked: Cannot revoke or delete the last Super Administrator.';
    END IF;
  END IF;

  -- Look up target and actor emails for audit
  SELECT lower(email) INTO v_actor_email FROM auth.users WHERE id = auth.uid();
  SELECT lower(email) INTO v_target_email FROM auth.users WHERE id = p_user_id;

  DELETE FROM public.admin_roles
  WHERE user_id = p_user_id AND role = p_role;

  -- Audit log entry
  INSERT INTO public.admin_audit_logs (
    actor_id,
    actor_email,
    target_user_id,
    target_email,
    action,
    details,
    created_at
  )
  VALUES (
    auth.uid(),
    COALESCE(v_actor_email, 'system'),
    p_user_id,
    COALESCE(v_target_email, p_user_id::text),
    'role_revoked',
    jsonb_build_object('revoked_role', p_role),
    now()
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid, text) TO authenticated;

-- 15. RPC: Super Admin - Get Audit Logs
CREATE OR REPLACE FUNCTION public.admin_get_audit_logs(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  actor_email text,
  target_email text,
  action text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators can view audit logs.';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.actor_email,
    l.target_email,
    l.action,
    l.details,
    l.created_at
  FROM public.admin_audit_logs l
  ORDER BY l.created_at DESC
  LIMIT LEAST(p_limit, 200);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_audit_logs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_audit_logs(integer) TO authenticated;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
