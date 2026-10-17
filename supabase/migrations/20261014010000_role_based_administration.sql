-- ==============================================================================
-- Shipt — Role-Based Administration (Super Admin vs Store Manager) Migration
-- Version: 20261014010000
-- Target: Supabase / PostgreSQL 15+
--
-- Summary of Changes:
-- 1. Helper functions: is_super_admin(), is_store_manager(), get_admin_role().
-- 2. Strict RBAC on admin_roles: Only super_admin can view or modify roles.
-- 3. Strict RBAC on banners & categories: Only super_admin can create/edit/delete.
-- 4. Shared management on products & orders: Both super_admin and store_manager can manage catalogue and order fulfillment.
-- 5. Safe role management RPCs for Super Admin: admin_list_roles, admin_assign_role, admin_revoke_role.
-- ==============================================================================

-- 1. Role Helper Functions
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

CREATE OR REPLACE FUNCTION public.is_store_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role IN ('super_admin', 'store_manager')
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
  ORDER BY CASE WHEN role = 'super_admin' THEN 1 WHEN role = 'store_manager' THEN 2 ELSE 3 END
  LIMIT 1;
$$;

-- Grant execution to authenticated & anon for client and policy evaluations
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_store_manager() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_role() TO authenticated, anon;

-- Update is_admin() to explicitly check for active super_admin or store_manager
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role IN ('super_admin', 'store_manager')
  );
$$;

-- 2. Protect public.admin_roles table with strict Super Admin policy
DROP POLICY IF EXISTS "admin_roles_select_policy" ON public.admin_roles;
DROP POLICY IF EXISTS "admin_roles_admin_all" ON public.admin_roles;

CREATE POLICY "admin_roles_select_super_admin" ON public.admin_roles
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "admin_roles_modify_super_admin" ON public.admin_roles
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 3. Restrict Banners to Super Admin
DROP POLICY IF EXISTS "banners_admin_all" ON public.banners;
CREATE POLICY "banners_admin_all" ON public.banners
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 4. Restrict Categories to Super Admin
DROP POLICY IF EXISTS "categories_admin_all" ON public.categories;
CREATE POLICY "categories_admin_all" ON public.categories
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 5. Products & Orders remain accessible to both Super Admin and Store Manager
-- (products_admin_all and orders_update_admin evaluate public.is_admin())

-- 6. RPC: Super Admin - List all staff roles
CREATE OR REPLACE FUNCTION public.admin_list_roles()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  role text,
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
    ar.created_at
  FROM public.admin_roles ar
  JOIN auth.users u ON u.id = ar.user_id
  LEFT JOIN public.profiles p ON p.id = ar.user_id
  ORDER BY
    CASE WHEN ar.role = 'super_admin' THEN 1 ELSE 2 END,
    ar.created_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_roles() TO authenticated;

-- 7. RPC: Super Admin - Assign role by email
CREATE OR REPLACE FUNCTION public.admin_assign_role(p_email text, p_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target_id uuid;
  v_clean_email text;
BEGIN
  -- Security check: strictly Super Admin only
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators can assign staff roles.';
  END IF;

  -- Role boundary check
  IF p_role NOT IN ('super_admin', 'store_manager') THEN
    RAISE EXCEPTION 'Invalid role specified: %. Supported roles: super_admin, store_manager', p_role;
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

  -- Insert or update role assignment
  INSERT INTO public.admin_roles (user_id, role, created_by, created_at)
  VALUES (v_target_id, p_role, auth.uid(), now())
  ON CONFLICT (user_id, role) DO UPDATE
    SET created_by = auth.uid(), created_at = now();

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_assign_role(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_role(text, text) TO authenticated;

-- 8. RPC: Super Admin - Revoke role
CREATE OR REPLACE FUNCTION public.admin_revoke_role(p_user_id uuid, p_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_super_count integer;
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

  DELETE FROM public.admin_roles
  WHERE user_id = p_user_id AND role = p_role;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid, text) TO authenticated;

-- Refresh PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';
