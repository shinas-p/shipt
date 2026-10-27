-- Quick Mart — Wholesale Batch Procurement & Per-Piece Profit Calculations
-- Migration: 20261027000000_wholesale_batch_costs.sql
-- Description: Adds wholesale batch tracking columns to public.product_costs
-- Backward Compatibility: Fully compatible with existing unit costs and legacy products.

-- 1. Add optional wholesale batch tracking columns to public.product_costs
ALTER TABLE public.product_costs
  ADD COLUMN IF NOT EXISTS cost_mode text NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS batch_cost numeric(10, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pack_count numeric(10, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pieces_per_pack numeric(10, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_pieces integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS batch_other_costs numeric(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS unit_other_costs numeric(10, 2) NOT NULL DEFAULT 0.00;

-- 2. Update admin_upsert_product_cost to support wholesale batch parameters
CREATE OR REPLACE FUNCTION public.admin_upsert_product_cost(
  p_product_id uuid,
  p_supplier_cost numeric,
  p_other_costs numeric DEFAULT 0.00,
  p_notes text DEFAULT '',
  p_cost_mode text DEFAULT 'unit',
  p_batch_cost numeric DEFAULT NULL,
  p_pack_count numeric DEFAULT NULL,
  p_pieces_per_pack numeric DEFAULT NULL,
  p_total_pieces integer DEFAULT NULL,
  p_batch_other_costs numeric DEFAULT 0.00,
  p_unit_other_costs numeric DEFAULT 0.00
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
    cost_mode,
    batch_cost,
    pack_count,
    pieces_per_pack,
    total_pieces,
    batch_other_costs,
    unit_other_costs,
    updated_at
  )
  VALUES (
    p_product_id,
    ROUND(p_supplier_cost, 2),
    ROUND(p_other_costs, 2),
    COALESCE(TRIM(p_notes), ''),
    COALESCE(p_cost_mode, 'unit'),
    p_batch_cost,
    p_pack_count,
    p_pieces_per_pack,
    p_total_pieces,
    COALESCE(p_batch_other_costs, 0.00),
    COALESCE(p_unit_other_costs, 0.00),
    now()
  )
  ON CONFLICT (product_id) DO UPDATE
  SET
    supplier_cost = EXCLUDED.supplier_cost,
    other_costs = EXCLUDED.other_costs,
    notes = EXCLUDED.notes,
    cost_mode = EXCLUDED.cost_mode,
    batch_cost = EXCLUDED.batch_cost,
    pack_count = EXCLUDED.pack_count,
    pieces_per_pack = EXCLUDED.pieces_per_pack,
    total_pieces = EXCLUDED.total_pieces,
    batch_other_costs = EXCLUDED.batch_other_costs,
    unit_other_costs = EXCLUDED.unit_other_costs,
    updated_at = now()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;
