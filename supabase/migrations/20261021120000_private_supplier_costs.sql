-- ==============================================================================
-- Shipt — Private Supplier Cost & Profit Management Migration
-- Version: 20261021120000
-- Target: Supabase / PostgreSQL 15+
--
-- Summary of Changes:
-- 1. Create public.product_costs table linked to public.products with ON DELETE CASCADE.
-- 2. Enforce strict Row Level Security (RLS): Only authenticated staff with active
--    admin_roles (Super Admin and Store Manager via public.is_admin()) can select or modify.
-- 3. Revoke all permissions from anon and public to prevent any customer or guest access.
-- 4. Provide security definer RPCs for atomic cost upserts and profitability reporting.
-- 5. Public catalogue queries against public.products remain clean and untouched without
--    any exposure of confidential supplier margins.
-- ==============================================================================

-- 1. Private Product Costs Table
CREATE TABLE IF NOT EXISTS public.product_costs (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_cost numeric(10, 2) NOT NULL DEFAULT 0.00 CHECK (supplier_cost >= 0),
  other_costs numeric(10, 2) NOT NULL DEFAULT 0.00 CHECK (other_costs >= 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index on product_id for fast joins
CREATE INDEX IF NOT EXISTS idx_product_costs_product_id ON public.product_costs(product_id);

-- Automatic updated_at trigger using existing handle_updated_at function
DROP TRIGGER IF EXISTS trg_product_costs_updated_at ON public.product_costs;
CREATE TRIGGER trg_product_costs_updated_at
  BEFORE UPDATE ON public.product_costs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Strict Row Level Security
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

-- Deny all access to anon and public roles
REVOKE ALL ON public.product_costs FROM PUBLIC, anon;

-- Grant access only to authenticated role (still subject to RLS policy below)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;

-- RLS Policy: Only authenticated users with an authorized admin role (super_admin or store_manager)
DROP POLICY IF EXISTS "product_costs_admin_all" ON public.product_costs;
CREATE POLICY "product_costs_admin_all" ON public.product_costs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. Security Definer RPC: Atomic Admin Cost Upsert
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
  -- Strict server-side authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only authorized administrators can manage supplier costs.';
  END IF;

  -- Validate non-negative numbers
  IF p_supplier_cost IS NULL OR p_supplier_cost < 0 THEN
    RAISE EXCEPTION 'Invalid supplier cost: Amount must be non-negative.';
  END IF;

  IF p_other_costs IS NULL OR p_other_costs < 0 THEN
    RAISE EXCEPTION 'Invalid other costs: Amount must be non-negative.';
  END IF;

  -- Ensure the product exists
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

REVOKE EXECUTE ON FUNCTION public.admin_upsert_product_cost(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_product_cost(uuid, numeric, numeric, text) TO authenticated;

-- 4. Security Definer RPC: Admin Profitability Metrics Calculation
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
  -- Strict server-side authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access Denied: Only authorized administrators can view profitability metrics.';
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

REVOKE EXECUTE ON FUNCTION public.admin_get_product_profitability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_product_profitability() TO authenticated;
