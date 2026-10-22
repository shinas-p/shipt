-- ==============================================================================
-- Shipt Mart — Seed Data
-- Version: 20261013000000
-- Target: Supabase / PostgreSQL
--
-- AUDITED & CORRECTED VERSION (Pre-execution review).
-- DO NOT APPLY WITHOUT DEVELOPER REVIEW AND EXPLICIT APPROVAL.
--
-- Features:
-- 1. Uses deterministic fixed UUIDs for products to allow repeatable staging, testing,
--    and compatibility across migrations.
-- 2. Matches exact TypeScript CategoryId, pricing in INR, stock, sizes, and flags.
-- 3. Idempotent INSERT ... ON CONFLICT (id) DO UPDATE.
-- ==============================================================================

-- 1. Seed Categories
INSERT INTO public.categories (id, name, blurb, display_order, is_active)
VALUES
  ('snacks', 'Snacks & Drinks', 'Late-night fuel', 1, true),
  ('stationery', 'Stationery', 'Notes & pens', 2, true),
  ('personal-care', 'Personal Care', 'Daily basics', 3, true),
  ('hostel', 'Hostel Essentials', 'Room & laundry', 4, true),
  ('electronics', 'Electronics & Accessories', 'Cables & more', 5, true),
  ('exam', 'Exam Essentials', 'Ace the paper', 6, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  blurb = EXCLUDED.blurb,
  display_order = EXCLUDED.display_order,
  is_active = EXCLUDED.is_active;

-- 2. Seed Products (With Deterministic UUIDs)
INSERT INTO public.products (
  id, slug, name, size, description, price, original_price, category_id,
  image_url, stock, bestseller, is_new, is_active, display_order
) VALUES
  (
    'a0000000-0000-0000-0000-000000000001',
    'notebook-a5',
    'Spiral Notebook',
    'A5 · 160 pages',
    'Kraft-cover ruled notebook with sturdy wire binding. Perfect for lecture notes.',
    60.00,
    75.00,
    'stationery',
    'https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-notebook.jpg',
    24,
    true,
    false,
    true,
    1
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    'pen-blue-3',
    'Blue Ballpoint Pens',
    'Pack of 3',
    'Smooth-writing blue ballpoint pens with a comfortable grip.',
    30.00,
    NULL,
    'exam',
    'https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-pen.jpg',
    40,
    true,
    false,
    true,
    2
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    'biscuits-cream',
    'Cream Biscuits',
    '120 g',
    'Classic vanilla cream sandwich biscuits for study breaks.',
    25.00,
    NULL,
    'snacks',
    'https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-biscuits.jpg',
    18,
    false,
    false,
    true,
    3
  ),
  (
    'a0000000-0000-0000-0000-000000000004',
    'chips-salted',
    'Salted Potato Chips',
    '52 g',
    'Crunchy, lightly salted potato chips.',
    20.00,
    NULL,
    'snacks',
    'https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-chips.jpg',
    30,
    true,
    false,
    true,
    4
  ),
  (
    'a0000000-0000-0000-0000-000000000005',
    'chocolate-dark',
    'Dark Chocolate Bar',
    '50 g',
    'Rich dark chocolate — a small treat after a long day.',
    80.00,
    95.00,
    'snacks',
    'https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-chocolate.jpg',
    0,
    false,
    false,
    true,
    5
  ),
  (
    'a0000000-0000-0000-0000-000000000006',
    'toothpaste-mint',
    'Mint Toothpaste',
    '100 g',
    'Fresh mint fluoride toothpaste for everyday use.',
    55.00,
    NULL,
    'personal-care',
    'https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-toothpaste.jpg',
    15,
    false,
    false,
    true,
    6
  ),
  (
    'a0000000-0000-0000-0000-000000000007',
    'soap-herbal',
    'Herbal Bathing Soap',
    '100 g',
    'Gentle herbal soap bar with a fresh scent.',
    40.00,
    NULL,
    'personal-care',
    'https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-soap.jpg',
    22,
    false,
    true,
    true,
    7
  ),
  (
    'a0000000-0000-0000-0000-000000000008',
    'cable-usbc',
    'USB-C Charging Cable',
    '1 m',
    'Durable USB-C to USB-C cable for phones and tablets.',
    199.00,
    249.00,
    'electronics',
    'https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-cable.jpg',
    6,
    false,
    true,
    true,
    8
  ),
  (
    'a0000000-0000-0000-0000-000000000009',
    'detergent-sachet',
    'Detergent Sachets',
    'Pack of 3',
    'Single-wash detergent powder sachets — easy for hostel laundry.',
    30.00,
    NULL,
    'hostel',
    'https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-detergent.jpg',
    3,
    false,
    true,
    true,
    9
  ),
  (
    'a0000000-0000-0000-0000-000000000010',
    'highlighter-4',
    'Highlighter Set',
    '4 colours',
    'Bright chisel-tip highlighters for revision season.',
    90.00,
    NULL,
    'exam',
    'https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-highlighter.jpg',
    12,
    false,
    true,
    true,
    10
  )
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  size = EXCLUDED.size,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  original_price = EXCLUDED.original_price,
  category_id = EXCLUDED.category_id,
  image_url = EXCLUDED.image_url,
  stock = EXCLUDED.stock,
  bestseller = EXCLUDED.bestseller,
  is_new = EXCLUDED.is_new,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order;
