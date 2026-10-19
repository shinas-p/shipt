-- ==============================================================================
-- Shipt — Store Branding & App Identity Settings Migration
-- Version: 20261019000000
-- Target: Supabase / PostgreSQL 15+
-- ==============================================================================

-- 1. Create store_settings table
CREATE TABLE IF NOT EXISTS public.store_settings (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  store_name text NOT NULL DEFAULT 'Shipt',
  tagline text NOT NULL DEFAULT 'Your Campus. Your Marketplace.',
  logo_url text,
  favicon_url text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

-- 2. Public Read Policy (Anyone can read store branding to render the storefront)
DROP POLICY IF EXISTS "store_settings_public_read" ON public.store_settings;
CREATE POLICY "store_settings_public_read" ON public.store_settings
  FOR SELECT TO public
  USING (true);

-- 3. Super Admin Modify Policy (Only Super Admins can insert/update/delete settings)
DROP POLICY IF EXISTS "store_settings_super_admin_modify" ON public.store_settings;
CREATE POLICY "store_settings_super_admin_modify" ON public.store_settings
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 4. Seed default settings row if not present
INSERT INTO public.store_settings (id, store_name, tagline, logo_url, favicon_url)
VALUES ('default', 'Shipt', 'Your Campus. Your Marketplace.', NULL, NULL)
ON CONFLICT (id) DO NOTHING;
