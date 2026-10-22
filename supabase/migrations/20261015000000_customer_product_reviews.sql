-- ==============================================================================
-- Shipt — Customer Product Reviews & Ratings Migration
-- Version: 20261015000000
-- Target: Supabase / PostgreSQL 15+
--
-- Summary of Changes:
-- 1. Create public.product_reviews table with rating constraints (1-5) and review length limits.
-- 2. Enforce unique review per customer per product (prevent duplicates).
-- 3. Row Level Security (RLS):
--    - SELECT: Public (anyone can read product reviews without exposing private email/tokens).
--    - INSERT: Authenticated users can submit reviews with auth.uid() = user_id.
--    - UPDATE: Authors can only edit their own reviews (auth.uid() = user_id).
--    - DELETE: Authors can delete their own reviews; admins can moderate.
-- 4. RPC: check_is_verified_purchaser(p_product_id, p_user_id) to securely verify purchase before awarding badge.
-- ==============================================================================

-- 1. Create Product Reviews Table
CREATE TABLE IF NOT EXISTS public.product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text text NOT NULL CHECK (char_length(review_text) <= 1000),
  customer_name text NOT NULL DEFAULT 'Customer',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_customer_product_review UNIQUE (product_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON public.product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_user_id ON public.product_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_created_at ON public.product_reviews(created_at DESC);

-- Trigger for auto-updating updated_at timestamp
DROP TRIGGER IF EXISTS trg_product_reviews_updated_at ON public.product_reviews;
CREATE TRIGGER trg_product_reviews_updated_at
  BEFORE UPDATE ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;

-- 2.1 Public Read Policy (Anyone can read product reviews)
DROP POLICY IF EXISTS "product_reviews_select_public" ON public.product_reviews;
CREATE POLICY "product_reviews_select_public" ON public.product_reviews
  FOR SELECT
  USING (true);

-- 2.2 Authenticated Customer Insert Policy (Must be signed in, can only insert for self)
DROP POLICY IF EXISTS "product_reviews_insert_authenticated" ON public.product_reviews;
CREATE POLICY "product_reviews_insert_authenticated" ON public.product_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 2.3 Author Update Policy (Only review author can update their review)
DROP POLICY IF EXISTS "product_reviews_update_own" ON public.product_reviews;
CREATE POLICY "product_reviews_update_own" ON public.product_reviews
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2.4 Author or Admin Delete Policy (Author can delete, admin can moderate)
DROP POLICY IF EXISTS "product_reviews_delete_own_or_admin" ON public.product_reviews;
CREATE POLICY "product_reviews_delete_own_or_admin" ON public.product_reviews
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

-- 3. Secure Verification RPC: Check if user is a verified purchaser of this product
CREATE OR REPLACE FUNCTION public.check_is_verified_purchaser(p_product_id text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.user_id = p_user_id
      AND o.status IN ('confirmed', 'preparing', 'out_for_delivery', 'delivered', 'completed')
      AND (oi.product_id = p_product_id OR oi.product_name ILIKE '%' || p_product_id || '%')
  );
$$;

GRANT EXECUTE ON FUNCTION public.check_is_verified_purchaser(text, uuid) TO authenticated, anon;
