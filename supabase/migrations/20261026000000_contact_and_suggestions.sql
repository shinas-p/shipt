-- ==============================================================================
-- Shipt Mart — Store Contact Information & Product Suggestions Migration
-- Version: 20261026000000
-- Target: Supabase / PostgreSQL 15+
--
-- Summary of Changes:
-- 1. Extend public.store_settings with configurable contact coordinates:
--    - contact_phone text NOT NULL DEFAULT '+91 9605174298'
--    - contact_email text NOT NULL DEFAULT 'dhemartforyou@gmail.com'
--    - contact_whatsapp text NOT NULL DEFAULT '+91 9605174298'
--
-- 2. Create public.product_suggestions table for customer product requests:
--    - Columns: id, user_id, customer_name, customer_email, customer_phone,
--      product_name, category, brand, expected_price, quantity, reason,
--      photo_url, status ('pending', 'reviewed', 'approved', 'rejected'),
--      admin_notes, created_at, updated_at, reviewed_by.
--
-- 3. Row-Level Security (RLS) on public.product_suggestions:
--    - Customers can INSERT their own suggestions (authenticated or guest with email).
--    - Customers can SELECT only their own suggestions (user_id = auth.uid()).
--    - Admins (super_admin, owner) can SELECT all suggestions.
--    - Admins (super_admin, owner) can UPDATE status, admin_notes, and reviewed_by.
--    - Customers CANNOT update statuses or notes.
--
-- 4. Storage Bucket for uploaded suggestion photos:
--    - 'product-suggestions' public bucket with 5 MB file size limit
--    - Allowed mime types: image/jpeg, image/png, image/webp
--    - Storage RLS: Authenticated users can insert; anyone can view with URL.
-- ==============================================================================

-- 1. Extend store_settings table with contact info
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS contact_phone text NOT NULL DEFAULT '+91 9605174298',
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT 'dhemartforyou@gmail.com',
  ADD COLUMN IF NOT EXISTS contact_whatsapp text NOT NULL DEFAULT '+91 9605174298';

-- 2. Create product_suggestions table
CREATE TABLE IF NOT EXISTS public.product_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text,
  product_name text NOT NULL,
  category text,
  brand text,
  expected_price numeric CHECK (expected_price IS NULL OR expected_price >= 0),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  reason text,
  photo_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'approved', 'rejected')),
  admin_notes text,
  approval_email_sent_at timestamptz,
  approval_email_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Index for fast user_id and status lookups
CREATE INDEX IF NOT EXISTS idx_product_suggestions_user_id ON public.product_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_product_suggestions_status ON public.product_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_product_suggestions_created_at ON public.product_suggestions(created_at DESC);

-- Enable RLS
ALTER TABLE public.product_suggestions ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies

-- Policy A: Insert permission
-- Authenticated customers can insert with their own user_id; unauthenticated can insert with null user_id
DROP POLICY IF EXISTS "product_suggestions_insert_policy" ON public.product_suggestions;
CREATE POLICY "product_suggestions_insert_policy" ON public.product_suggestions
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid()) OR
    (auth.uid() IS NULL AND user_id IS NULL)
  );

-- Policy B: Customers can read only their own suggestions
DROP POLICY IF EXISTS "product_suggestions_select_own" ON public.product_suggestions;
CREATE POLICY "product_suggestions_select_own" ON public.product_suggestions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
  );

-- Policy C: Authorized Admins (Super Admin & Owner) can read all suggestions
DROP POLICY IF EXISTS "product_suggestions_admin_select_all" ON public.product_suggestions;
CREATE POLICY "product_suggestions_admin_select_all" ON public.product_suggestions
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
  );

-- Policy D: Only Authorized Admins can update status, notes, and reviewed_by
DROP POLICY IF EXISTS "product_suggestions_admin_update" ON public.product_suggestions;
CREATE POLICY "product_suggestions_admin_update" ON public.product_suggestions
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
  )
  WITH CHECK (
    public.is_admin()
  );

-- 4. Storage Bucket Setup
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-suggestions',
  'product-suggestions',
  true,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage Policies for 'product-suggestions'
DROP POLICY IF EXISTS "product_suggestions_storage_select" ON storage.objects;
CREATE POLICY "product_suggestions_storage_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-suggestions');

DROP POLICY IF EXISTS "product_suggestions_storage_insert" ON storage.objects;
CREATE POLICY "product_suggestions_storage_insert" ON storage.objects
  FOR INSERT TO authenticated, anon
  WITH CHECK (bucket_id = 'product-suggestions');
