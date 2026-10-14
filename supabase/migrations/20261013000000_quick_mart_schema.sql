-- ==============================================================================
-- Quick Mart — Complete Database Schema & Security Migration
-- Version: 20261013000000
-- Target: Supabase / PostgreSQL 15+
--
-- AUDITED & CORRECTED VERSION (Pre-execution review).
-- DO NOT APPLY WITHOUT DEVELOPER REVIEW AND EXPLICIT APPROVAL.
--
-- Changes in this version:
-- 1. is_admin() is parameterless and strictly evaluates auth.uid().
-- 2. Added guest_tracking_token (32-byte cryptographically secure hex).
-- 3. Added get_guest_order() secure tracking RPC with high-entropy token check.
-- 4. Increased order_number entropy (QM-YYYYMMDD + 8 hex chars) with collision retry loop.
-- 5. Safe cancellation restocking with atomic SELECT ... FOR UPDATE row locking on orders and products.
-- 6. Prevent cancellation of already 'completed' orders.
-- 7. Deterministic UUID lock ordering and cart consolidation in create_order_with_inventory to eliminate deadlocks.
-- 8. Restricted posters bucket MIME types to JPEG, PNG, and WebP (excluding SVG to eliminate XSS risks).
-- 9. Fully idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS, DROP TRIGGER IF EXISTS.
-- 10. Explicit REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC on privileged RPCs and triggers.
-- 11. Secure bootstrap procedure restricted to service_role / SQL Editor.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS & UTILITIES
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- Function: Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Restrict trigger utility execution
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. CORE TABLES (IDEMPOTENT CREATION)
-- ------------------------------------------------------------------------------

-- 2.1 Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
  id text PRIMARY KEY, -- Text slug matching existing CategoryId (e.g., 'snacks', 'stationery')
  name text NOT NULL,
  blurb text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_categories_updated_at ON public.categories;
CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2.2 Products Table
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  name text NOT NULL,
  size text NOT NULL, -- e.g., '120 g', 'Pack of 3', 'A5 · 160 pages'
  description text NOT NULL DEFAULT '',
  price numeric(10, 2) NOT NULL CHECK (price >= 0),
  original_price numeric(10, 2) CHECK (original_price IS NULL OR original_price >= price),
  category_id text NOT NULL REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  image_url text NOT NULL,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  bestseller boolean NOT NULL DEFAULT false,
  is_new boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_bestseller ON public.products(bestseller) WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2.3 User Profiles Table (Linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  default_hostel text,
  default_block text,
  default_room text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Function: Automatically create profile on user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auth_user_created ON auth.users;
CREATE TRIGGER trg_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2.4 Dedicated Admin Roles Table (Secure RBAC, non-customer-editable)
CREATE TABLE IF NOT EXISTS public.admin_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('super_admin', 'store_manager', 'inventory_staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_admin_roles_user ON public.admin_roles(user_id);

-- ------------------------------------------------------------------------------
-- 2.5 AUTHORIZATION FUNCTIONS & SAFE BOOTSTRAP
-- ------------------------------------------------------------------------------

-- Helper Function: Check whether caller is an authorized admin (PARAMETERLESS)
-- STRICTLY evaluates auth.uid() to prevent user enumeration / Oracle disclosure.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid()
  );
$$;

-- Grant execution to authenticated & anon so RLS policies can evaluate caller role
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- Procedure: Safe First-Super-Admin Bootstrap
-- Restricted to service_role / PostgreSQL direct access.
-- Cannot be invoked by public or anonymous clients over the API.
CREATE OR REPLACE FUNCTION public.bootstrap_initial_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow bootstrapping when NO super_admin exists
  IF EXISTS (SELECT 1 FROM public.admin_roles WHERE role = 'super_admin') THEN
    RAISE EXCEPTION 'Bootstrapping is disabled: Super administrator already exists.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Target user does not exist in auth.users.';
  END IF;

  INSERT INTO public.admin_roles (user_id, role, created_at)
  VALUES (p_user_id, 'super_admin', now())
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN true;
END;
$$;

-- STRICT: Revoke public execution to prevent any API caller from attempting bootstrap
REVOKE EXECUTE ON FUNCTION public.bootstrap_initial_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_initial_admin(uuid) TO service_role;

-- 2.6 Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE, -- e.g. QM-20261013-8A2F9B4D
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- Nullable for guest purchases
  guest_tracking_token text UNIQUE, -- 64-character high-entropy hex token for guest verification
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  delivery_method text NOT NULL CHECK (delivery_method IN ('hostel_delivery', 'campus_pickup')),
  hostel text,
  block text,
  room text,
  pickup_location text,
  delivery_instructions text,
  status text NOT NULL DEFAULT 'placed' CHECK (
    status IN ('placed', 'confirmed', 'preparing', 'out_for_delivery', 'ready_for_pickup', 'completed', 'cancelled')
  ),
  subtotal numeric(10, 2) NOT NULL CHECK (subtotal >= 0),
  delivery_fee numeric(10, 2) NOT NULL DEFAULT 0.00 CHECK (delivery_fee >= 0),
  discount_amount numeric(10, 2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
  total_amount numeric(10, 2) NOT NULL CHECK (total_amount >= 0),
  payment_method text NOT NULL CHECK (payment_method IN ('upi', 'cod')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (
    payment_status IN ('pending', 'processing', 'completed', 'failed', 'refunded')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_delivery_details CHECK (
    (delivery_method = 'hostel_delivery' AND hostel IS NOT NULL AND room IS NOT NULL) OR
    (delivery_method = 'campus_pickup')
  )
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_guest_token ON public.orders(order_number, guest_tracking_token) WHERE user_id IS NULL;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2.7 Order Items Table (Snapshot of product data at purchase time)
CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  product_size text NOT NULL,
  unit_price numeric(10, 2) NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  total_price numeric(10, 2) NOT NULL CHECK (total_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON public.order_items(product_id);

-- 2.8 Payments Table
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_method text NOT NULL CHECK (payment_method IN ('upi', 'cod')),
  amount numeric(10, 2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'completed', 'failed', 'refunded')
  ),
  upi_transaction_id text,
  upi_reference_number text,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);

DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2.9 Order Status History Table (Audit Trail)
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  previous_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_history_order ON public.order_status_history(order_id);

-- 2.10 Inventory Movements Table (Stock Ledger)
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (
    movement_type IN ('order_deduction', 'order_cancellation_restock', 'manual_adjustment', 'restock_shipment', 'damaged_loss')
  ),
  quantity_change integer NOT NULL, -- Negative for sales, positive for restocks
  previous_stock integer NOT NULL CHECK (previous_stock >= 0),
  new_stock integer NOT NULL CHECK (new_stock >= 0),
  reason text,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON public.inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order ON public.inventory_movements(order_id);

-- 2.11 Banners Table (Promotional Posters & Carousels)
CREATE TABLE IF NOT EXISTS public.banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  description text,
  image_url text NOT NULL, -- Path or URL in 'posters' bucket
  button_text text,
  button_url text,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  start_at timestamptz,
  end_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banners_active ON public.banners(is_active, display_order);

DROP TRIGGER IF EXISTS trg_banners_updated_at ON public.banners;
CREATE TRIGGER trg_banners_updated_at
  BEFORE UPDATE ON public.banners
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ------------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) POLICIES (IDEMPOTENT CREATION)
-- ------------------------------------------------------------------------------

-- Enable RLS on all public tables
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

-- 3.1 Categories RLS
DROP POLICY IF EXISTS "categories_select_policy" ON public.categories;
CREATE POLICY "categories_select_policy" ON public.categories
  FOR SELECT USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "categories_admin_all" ON public.categories;
CREATE POLICY "categories_admin_all" ON public.categories
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3.2 Products RLS
DROP POLICY IF EXISTS "products_select_policy" ON public.products;
CREATE POLICY "products_select_policy" ON public.products
  FOR SELECT USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "products_admin_all" ON public.products;
CREATE POLICY "products_admin_all" ON public.products
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3.3 Profiles RLS
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy" ON public.profiles
  FOR UPDATE USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

-- 3.4 Admin Roles RLS
DROP POLICY IF EXISTS "admin_roles_select_policy" ON public.admin_roles;
CREATE POLICY "admin_roles_select_policy" ON public.admin_roles
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "admin_roles_admin_all" ON public.admin_roles;
CREATE POLICY "admin_roles_admin_all" ON public.admin_roles
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3.5 Orders RLS
-- Authenticated customers can view only their own orders; admins can view all
DROP POLICY IF EXISTS "orders_select_policy" ON public.orders;
CREATE POLICY "orders_select_policy" ON public.orders
  FOR SELECT USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid()) OR public.is_admin()
  );

-- Only admins can update orders directly (status transitions, etc.)
DROP POLICY IF EXISTS "orders_update_admin" ON public.orders;
CREATE POLICY "orders_update_admin" ON public.orders
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3.6 Order Items RLS
DROP POLICY IF EXISTS "order_items_select_policy" ON public.order_items;
CREATE POLICY "order_items_select_policy" ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND ((auth.uid() IS NOT NULL AND o.user_id = auth.uid()) OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "order_items_admin_all" ON public.order_items;
CREATE POLICY "order_items_admin_all" ON public.order_items
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3.7 Payments RLS
DROP POLICY IF EXISTS "payments_select_policy" ON public.payments;
CREATE POLICY "payments_select_policy" ON public.payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = payments.order_id
        AND ((auth.uid() IS NOT NULL AND o.user_id = auth.uid()) OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;
CREATE POLICY "payments_admin_all" ON public.payments
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3.8 Order Status History RLS
DROP POLICY IF EXISTS "order_status_history_select_policy" ON public.order_status_history;
CREATE POLICY "order_status_history_select_policy" ON public.order_status_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_status_history.order_id
        AND ((auth.uid() IS NOT NULL AND o.user_id = auth.uid()) OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "order_status_history_admin_all" ON public.order_status_history;
CREATE POLICY "order_status_history_admin_all" ON public.order_status_history
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3.9 Inventory Movements RLS
DROP POLICY IF EXISTS "inventory_movements_admin_all" ON public.inventory_movements;
CREATE POLICY "inventory_movements_admin_all" ON public.inventory_movements
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3.10 Banners RLS
DROP POLICY IF EXISTS "banners_select_policy" ON public.banners;
CREATE POLICY "banners_select_policy" ON public.banners
  FOR SELECT USING (
    (
      is_active = true
      AND (start_at IS NULL OR start_at <= now())
      AND (end_at IS NULL OR end_at >= now())
    ) OR public.is_admin()
  );

DROP POLICY IF EXISTS "banners_admin_all" ON public.banners;
CREATE POLICY "banners_admin_all" ON public.banners
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- 4. PRIVILEGED DATABASE FUNCTIONS (ATOMIC, CONCURRENCY-SAFE, PERMISSION-CHECKED)
-- ------------------------------------------------------------------------------

-- 4.1 Atomic Order Creation & Concurrency-Safe Inventory Decrement
CREATE OR REPLACE FUNCTION public.create_order_with_inventory(order_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_guest_token text := NULL;
  v_customer_name text;
  v_customer_phone text;
  v_delivery_method text;
  v_hostel text;
  v_block text;
  v_room text;
  v_pickup_location text;
  v_delivery_instructions text;
  v_payment_method text;
  v_items jsonb;
  v_raw_item jsonb;
  v_cart_item record;

  v_order_id uuid;
  v_order_number text;
  v_attempts integer := 0;
  v_subtotal numeric(10, 2) := 0;
  v_delivery_fee numeric(10, 2) := 0;
  v_total_amount numeric(10, 2) := 0;

  v_product_id uuid;
  v_qty integer;
  v_db_stock integer;
  v_db_price numeric(10, 2);
  v_db_name text;
  v_db_size text;
  v_line_total numeric(10, 2);
BEGIN
  -- Extract caller (NULL for guests)
  v_user_id := auth.uid();

  -- If guest checkout, generate a high-entropy 256-bit cryptographically secure tracking token
  IF v_user_id IS NULL THEN
    v_guest_token := encode(extensions.gen_random_bytes(32), 'hex');
  END IF;

  -- Extract and validate fields
  v_customer_name := TRIM(order_payload->>'customer_name');
  v_customer_phone := TRIM(order_payload->>'customer_phone');
  v_delivery_method := TRIM(order_payload->>'delivery_method');
  v_hostel := order_payload->>'hostel';
  v_block := order_payload->>'block';
  v_room := order_payload->>'room';
  v_pickup_location := order_payload->>'pickup_location';
  v_delivery_instructions := order_payload->>'delivery_instructions';
  v_payment_method := TRIM(order_payload->>'payment_method');
  v_items := order_payload->'items';

  IF v_customer_name IS NULL OR LENGTH(v_customer_name) < 2 THEN
    RAISE EXCEPTION 'Invalid customer name: must be at least 2 characters';
  END IF;

  IF v_customer_phone IS NULL OR LENGTH(v_customer_phone) < 10 THEN
    RAISE EXCEPTION 'Invalid customer phone number: must be at least 10 digits';
  END IF;

  IF v_delivery_method NOT IN ('hostel_delivery', 'campus_pickup') THEN
    RAISE EXCEPTION 'Invalid delivery method: must be hostel_delivery or campus_pickup';
  END IF;

  IF v_delivery_method = 'hostel_delivery' AND (v_hostel IS NULL OR v_room IS NULL) THEN
    RAISE EXCEPTION 'Hostel and room number are required for hostel delivery';
  END IF;

  IF v_payment_method NOT IN ('upi', 'cod') THEN
    RAISE EXCEPTION 'Invalid payment method: must be upi or cod';
  END IF;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  -- High-Entropy Order Number with collision-safe retry loop
  LOOP
    v_order_number := 'QM-' || to_char(now(), 'YYYYMMDD') || '-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE order_number = v_order_number);
    v_attempts := v_attempts + 1;
    IF v_attempts > 5 THEN
      RAISE EXCEPTION 'Failed to generate a unique order number. Please try again.';
    END IF;
  END LOOP;

  -- Create order record
  INSERT INTO public.orders (
    order_number, user_id, guest_tracking_token, customer_name, customer_phone, delivery_method,
    hostel, block, room, pickup_location, delivery_instructions,
    status, subtotal, delivery_fee, discount_amount, total_amount,
    payment_method, payment_status
  ) VALUES (
    v_order_number, v_user_id, v_guest_token, v_customer_name, v_customer_phone, v_delivery_method,
    v_hostel, v_block, v_room, v_pickup_location, v_delivery_instructions,
    'placed', 0, v_delivery_fee, 0, 0,
    v_payment_method, 'pending'
  ) RETURNING id INTO v_order_id;

  -- Validate line items structure before locking
  FOR v_raw_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    IF (v_raw_item->>'product_id') IS NULL OR (v_raw_item->>'product_id') = '' THEN
      RAISE EXCEPTION 'Missing product_id in cart item';
    END IF;

    IF (v_raw_item->>'quantity') IS NULL OR (v_raw_item->>'quantity')::integer <= 0 THEN
      RAISE EXCEPTION 'Invalid item quantity: %', (v_raw_item->>'quantity');
    END IF;
  END LOOP;

  -- Process line items with deterministic UUID ordering (FOR UPDATE)
  -- Consolidates duplicate product IDs to guarantee exact stock verification and eliminate deadlocks
  FOR v_cart_item IN
    SELECT
      (item->>'product_id')::uuid AS product_id,
      SUM((item->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(v_items) AS item
    GROUP BY (item->>'product_id')::uuid
    ORDER BY (item->>'product_id')::uuid ASC
  LOOP
    v_product_id := v_cart_item.product_id;
    v_qty := v_cart_item.quantity;

    -- Row lock on product in deterministic order to prevent concurrent overselling & deadlock race conditions
    SELECT stock, price, name, size
    INTO v_db_stock, v_db_price, v_db_name, v_db_size
    FROM public.products
    WHERE id = v_product_id AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % is not available or does not exist', v_product_id;
    END IF;

    IF v_db_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for "%": only % available (requested %)', v_db_name, v_db_stock, v_qty;
    END IF;

    v_line_total := v_db_price * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    -- Decrement stock atomically
    UPDATE public.products
    SET stock = stock - v_qty, updated_at = now()
    WHERE id = v_product_id;

    -- Record stock movement ledger
    INSERT INTO public.inventory_movements (
      product_id, order_id, movement_type, quantity_change,
      previous_stock, new_stock, reason, performed_by
    ) VALUES (
      v_product_id, v_order_id, 'order_deduction', -v_qty,
      v_db_stock, v_db_stock - v_qty, 'Customer order ' || v_order_number, v_user_id
    );

    -- Insert snapshot line item
    INSERT INTO public.order_items (
      order_id, product_id, product_name, product_size,
      unit_price, quantity, total_price
    ) VALUES (
      v_order_id, v_product_id, v_db_name, v_db_size,
      v_db_price, v_qty, v_line_total
    );
  END LOOP;

  v_total_amount := v_subtotal + v_delivery_fee;

  -- Update order with verified totals
  UPDATE public.orders
  SET subtotal = v_subtotal, total_amount = v_total_amount, updated_at = now()
  WHERE id = v_order_id;

  -- Create initial payment record (locked at pending)
  INSERT INTO public.payments (
    order_id, payment_method, amount, status
  ) VALUES (
    v_order_id, v_payment_method, v_total_amount, 'pending'
  );

  -- Record initial order status history
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    v_order_id, NULL, 'placed', v_user_id, 'Order created via checkout'
  );

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'guest_tracking_token', v_guest_token,
    'total_amount', v_total_amount,
    'status', 'placed',
    'payment_method', v_payment_method,
    'payment_status', 'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_with_inventory(jsonb) TO authenticated, anon;

-- 4.2 Secure Guest Order Status Lookup (Requires 256-bit Tracking Token)
CREATE OR REPLACE FUNCTION public.get_guest_order(
  p_order_number text,
  p_tracking_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_items jsonb;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE order_number = TRIM(p_order_number)
    AND guest_tracking_token = TRIM(p_tracking_token)
    AND user_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found with provided verification token.';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name', product_name,
    'product_size', product_size,
    'unit_price', unit_price,
    'quantity', quantity,
    'total_price', total_price
  )) INTO v_items
  FROM public.order_items
  WHERE order_id = v_order.id;

  RETURN jsonb_build_object(
    'order_number', v_order.order_number,
    'status', v_order.status,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method,
    'hostel', v_order.hostel,
    'block', v_order.block,
    'room', v_order.room,
    'pickup_location', v_order.pickup_location,
    'subtotal', v_order.subtotal,
    'total_amount', v_order.total_amount,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'created_at', v_order.created_at,
    'items', COALESCE(v_items, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_order(text, text) TO authenticated, anon;

-- 4.3 Admin Order Status Transition & Concurrency-Safe Cancellation Restocking
CREATE OR REPLACE FUNCTION public.admin_update_order_status(
  p_order_id uuid,
  p_new_status text,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status text;
  v_item record;
  v_curr_stock integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Administrator permission required';
  END IF;

  -- Atomic row-level lock on order to serialize concurrent status transitions and prevent double-processing
  SELECT status INTO v_old_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN true;
  END IF;

  -- Guard: Prevent ordinary cancellation of completed orders
  IF p_new_status = 'cancelled' AND v_old_status = 'completed' THEN
    RAISE EXCEPTION 'Cannot cancel an order that is already completed. Process as a return/refund instead.';
  END IF;

  -- Guard: Prevent double-restocking of already cancelled orders
  IF v_old_status = 'cancelled' THEN
    RAISE EXCEPTION 'Order is already cancelled.';
  END IF;

  -- If order is being cancelled, atomically lock and restock items
  IF p_new_status = 'cancelled' THEN
    FOR v_item IN SELECT product_id, quantity FROM public.order_items WHERE order_id = p_order_id AND product_id IS NOT NULL
    LOOP
      -- Atomic row lock before reading stock
      SELECT stock INTO v_curr_stock
      FROM public.products
      WHERE id = v_item.product_id
      FOR UPDATE;

      -- Update stock
      UPDATE public.products
      SET stock = v_curr_stock + v_item.quantity, updated_at = now()
      WHERE id = v_item.product_id;

      -- Log exact atomic values in ledger
      INSERT INTO public.inventory_movements (
        product_id, order_id, movement_type, quantity_change,
        previous_stock, new_stock, reason, performed_by
      ) VALUES (
        v_item.product_id, p_order_id, 'order_cancellation_restock', v_item.quantity,
        v_curr_stock, v_curr_stock + v_item.quantity,
        'Restock on order cancellation (' || v_old_status || ' -> cancelled)', auth.uid()
      );
    END LOOP;
  END IF;

  UPDATE public.orders
  SET status = p_new_status, updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    p_order_id, v_old_status, p_new_status, auth.uid(), p_notes
  );

  RETURN true;
END;
$$;

-- Restrict privileged admin status updater
REVOKE EXECUTE ON FUNCTION public.admin_update_order_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_order_status(uuid, text, text) TO authenticated;

-- 4.4 Admin Payment Verification
CREATE OR REPLACE FUNCTION public.admin_verify_payment(
  p_payment_id uuid,
  p_status text,
  p_upi_ref text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Administrator permission required';
  END IF;

  UPDATE public.payments
  SET
    status = p_status,
    upi_reference_number = COALESCE(p_upi_ref, upi_reference_number),
    verified_by = auth.uid(),
    verified_at = now(),
    notes = COALESCE(p_notes, notes),
    updated_at = now()
  WHERE id = p_payment_id
  RETURNING order_id INTO v_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found';
  END IF;

  -- Sync payment status to order
  UPDATE public.orders
  SET payment_status = p_status, updated_at = now()
  WHERE id = v_order_id;

  RETURN true;
END;
$$;

-- Restrict privileged admin payment verifier
REVOKE EXECUTE ON FUNCTION public.admin_verify_payment(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_payment(uuid, text, text, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. STORAGE BUCKET & STORAGE RLS POLICIES (BANNERS & POSTERS)
-- ------------------------------------------------------------------------------
-- Create 'posters' public bucket for banners and promotional posters (restricted to raster images)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'posters',
  'posters',
  true,
  5242880, -- 5 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage Policy: Anyone can read posters
DROP POLICY IF EXISTS "posters_public_read" ON storage.objects;
CREATE POLICY "posters_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'posters');

-- Storage Policy: Only admins can upload posters
DROP POLICY IF EXISTS "posters_admin_insert" ON storage.objects;
CREATE POLICY "posters_admin_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'posters' AND public.is_admin()
  );

-- Storage Policy: Only admins can update/replace posters
DROP POLICY IF EXISTS "posters_admin_update" ON storage.objects;
CREATE POLICY "posters_admin_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'posters' AND public.is_admin()
  ) WITH CHECK (
    bucket_id = 'posters' AND public.is_admin()
  );

-- Storage Policy: Only admins can delete posters
DROP POLICY IF EXISTS "posters_admin_delete" ON storage.objects;
CREATE POLICY "posters_admin_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'posters' AND public.is_admin()
  );
