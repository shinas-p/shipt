-- ==============================================================================
-- Shipt Mart — Block-Based Delivery & Order Management Migration
-- Version: 20261024000000
-- Target: Supabase / PostgreSQL 15+
--
-- Summary of Changes:
-- 1. Extend public.orders with delivery_block_id foreign key and audit tracking:
--    - delivery_block_id text REFERENCES public.delivery_blocks(id) ON DELETE SET NULL
--    - claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
--    - claimed_at timestamptz DEFAULT NULL
--    - processing_started_at timestamptz DEFAULT NULL
--    - completed_at timestamptz DEFAULT NULL
--    - cancelled_at timestamptz DEFAULT NULL
-- 2. Non-destructive update to chk_delivery_details constraint supporting delivery_block_id.
-- 3. Verified, non-destructive legacy order backfill:
--    - Unambiguous matches backfilled.
--    - Documented normalization for 'Main' -> 'Main Campus'.
--    - Unmapped/legacy orders ('SMS') safely preserved with delivery_block_id = NULL.
-- 4. Atomic Order Claiming RPC: public.admin_claim_order(p_order_id uuid)
--    - Row locking (FOR UPDATE) to eliminate concurrent claiming race conditions.
--    - Validates caller role & block authority from database.
-- 5. Hardened Status Lifecycle RPC: public.admin_update_order_status(...)
--    - Enforces valid state machine: placed -> confirmed -> preparing -> out_for_delivery/ready_for_pickup -> completed
--    - Block Manager restricted strictly to assigned block.
--    - Store Manager restricted strictly to Store Pickup orders (delivery_method = 'campus_pickup').
--    - Automatically records milestone timestamps and single-instance inventory restock on cancellation.
-- 6. Block Management RPC: public.admin_manage_delivery_block(...)
--    - Super Admin and Owner can create/edit blocks and assign existing Block Managers.
--    - Owner strictly prohibited from granting or revoking staff roles.
-- 7. Hardened Row Level Security (RLS) on public.orders & delivery_blocks:
--    - Super Admin & Owner: full view & management of all orders across all blocks.
--    - Store Manager: view & manage Store Pickup orders only.
--    - Block Manager: view & manage assigned block orders only.
--    - Customers: view their own orders only.
-- ==============================================================================

BEGIN;

-- 1. Extend public.orders Table with delivery_block_id and Claim/Milestone Audit Columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_block_id text REFERENCES public.delivery_blocks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_block_id ON public.orders(delivery_block_id);
CREATE INDEX IF NOT EXISTS idx_orders_claimed_by ON public.orders(claimed_by);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_method ON public.orders(delivery_method);

-- 2. Non-destructively Update Delivery Details Constraint
-- Ensures new orders require delivery_block_id while legacy records with hostel/room remain 100% valid.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS chk_delivery_details;
ALTER TABLE public.orders ADD CONSTRAINT chk_delivery_details
  CHECK (
    ((delivery_method = 'hostel_delivery') AND (delivery_block_id IS NOT NULL OR hostel IS NOT NULL) AND (room IS NOT NULL))
    OR (delivery_method = 'campus_pickup')
  );

-- 3. Verified Legacy Order Backfill (Safe, Non-Destructive)
-- Step 3a: Exact matches where orders.block matches an existing delivery_blocks.id
UPDATE public.orders
SET delivery_block_id = block
WHERE delivery_block_id IS NULL
  AND block IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.delivery_blocks db WHERE db.id = orders.block);

-- Step 3b: Verified normalization rule for abbreviated block: 'Main' -> 'Main Campus'
UPDATE public.orders
SET delivery_block_id = 'Main Campus'
WHERE delivery_block_id IS NULL
  AND trim(block) = 'Main';

-- Note: Orders with unmapped legacy blocks (e.g. 'SMS') remain delivery_block_id = NULL
-- with their original hostel, block, and room strings completely preserved.

-- Step 3c: Non-invasive trigger on orders to auto-populate delivery_block_id from block
-- Leaves live checkout function (create_order_with_inventory) 100% untouched.
CREATE OR REPLACE FUNCTION public.set_order_delivery_block()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.delivery_block_id IS NULL AND NEW.block IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.delivery_blocks db WHERE db.id = NEW.block) THEN
      NEW.delivery_block_id := NEW.block;
    ELSIF trim(NEW.block) = 'Main' THEN
      NEW.delivery_block_id := 'Main Campus';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_set_delivery_block ON public.orders;
CREATE TRIGGER trg_orders_set_delivery_block
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_order_delivery_block();

-- 4. Atomic Order Claiming RPC
DROP FUNCTION IF EXISTS public.admin_claim_order(uuid);
CREATE OR REPLACE FUNCTION public.admin_claim_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_assigned_block text;
  v_order_status text;
  v_order_block text;
  v_delivery_block_id text;
  v_delivery_method text;
  v_existing_claimant uuid;
  v_actor_email text;
  v_order_number text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: caller session is unverified.';
  END IF;

  -- 1. Resolve caller role and block from trusted public.admin_roles table (never client headers)
  SELECT role, assigned_block INTO v_caller_role, v_assigned_block
  FROM public.admin_roles
  WHERE user_id = v_caller_id
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Access Denied: Caller does not possess administrative staff credentials.';
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'owner', 'store_manager', 'block_manager') THEN
    RAISE EXCEPTION 'Access Denied: Caller does not possess fulfillment manager credentials.';
  END IF;

  -- 2. Atomic row lock on the target order to prevent concurrent race conditions
  SELECT status, claimed_by, block, delivery_block_id, delivery_method, order_number
  INTO v_order_status, v_existing_claimant, v_order_block, v_delivery_block_id, v_delivery_method, v_order_number
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order with ID % not found.', p_order_id;
  END IF;

  -- 3. Check terminal states
  IF v_order_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot claim an order that is already %.', v_order_status;
  END IF;

  -- 4. Check concurrency: if already claimed by someone else, return conflict error
  IF v_existing_claimant IS NOT NULL AND v_existing_claimant != v_caller_id THEN
    RAISE EXCEPTION 'Concurrency Conflict: This order has already been claimed by another staff member.';
  END IF;

  -- 5. Role-based operational scope check:
  -- Block Manager: strictly restricted to their assigned delivery block
  IF v_caller_role = 'block_manager' THEN
    IF v_delivery_method = 'campus_pickup' THEN
      RAISE EXCEPTION 'Access Denied: Block Managers cannot process Store Pickup orders.';
    END IF;
    IF COALESCE(v_delivery_block_id, v_order_block) IS NULL OR
       (COALESCE(v_delivery_block_id, v_order_block) != v_assigned_block) THEN
      RAISE EXCEPTION 'Access Denied: You are only authorized to claim orders for delivery block "%".', v_assigned_block;
    END IF;
  END IF;

  -- Store Manager: strictly restricted to Store Pickup orders
  IF v_caller_role = 'store_manager' THEN
    IF v_delivery_method != 'campus_pickup' THEN
      RAISE EXCEPTION 'Access Denied: Store Managers can only claim Store Pickup orders. Block delivery orders are handled by Block Managers and Owners.';
    END IF;
  END IF;

  -- 6. Perform atomic claim update
  UPDATE public.orders
  SET
    claimed_by = v_caller_id,
    claimed_at = COALESCE(claimed_at, now()),
    status = CASE WHEN status = 'placed' THEN 'confirmed' ELSE status END,
    processing_started_at = CASE WHEN status = 'placed' THEN now() ELSE processing_started_at END,
    updated_at = now()
  WHERE id = p_order_id;

  -- 7. Get actor email for audit history
  SELECT email INTO v_actor_email FROM auth.users WHERE id = v_caller_id;

  -- 8. Record in order status history
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    p_order_id,
    v_order_status,
    CASE WHEN v_order_status = 'placed' THEN 'confirmed' ELSE v_order_status END,
    v_caller_id,
    'Order claimed by ' || COALESCE(v_actor_email, 'staff') || ' (' || v_caller_role || ')'
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order_number,
    'claimed_by', v_caller_id,
    'claimed_at', now(),
    'status', CASE WHEN v_order_status = 'placed' THEN 'confirmed' ELSE v_order_status END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_claim_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_claim_order(uuid) TO authenticated;

-- 5. Hardened Order Status Transition RPC with State Machine & Scope Verification
CREATE OR REPLACE FUNCTION public.admin_update_order_status(
  p_order_id uuid,
  p_new_status text,
  p_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_assigned_block text;
  v_old_status text;
  v_delivery_method text;
  v_delivery_block_id text;
  v_order_block text;
  v_claimed_by uuid;
  v_item record;
  v_curr_stock integer;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: caller session is unverified.';
  END IF;

  -- Resolve caller role and assigned block from database
  SELECT role, assigned_block INTO v_caller_role, v_assigned_block
  FROM public.admin_roles
  WHERE user_id = v_caller_id
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Access Denied: Administrator permission required.';
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'owner', 'store_manager', 'block_manager') THEN
    RAISE EXCEPTION 'Access Denied: Caller does not possess fulfillment management credentials.';
  END IF;

  -- Atomic row-level lock on order to serialize status transitions
  SELECT status, delivery_method, delivery_block_id, block, claimed_by
  INTO v_old_status, v_delivery_method, v_delivery_block_id, v_order_block, v_claimed_by
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order with ID % not found.', p_order_id;
  END IF;

  -- Role boundary check on order scope
  IF v_caller_role = 'block_manager' THEN
    IF v_delivery_method = 'campus_pickup' THEN
      RAISE EXCEPTION 'Access Denied: Block Managers cannot update Store Pickup orders.';
    END IF;
    IF COALESCE(v_delivery_block_id, v_order_block) IS NULL OR
       (COALESCE(v_delivery_block_id, v_order_block) != v_assigned_block) THEN
      RAISE EXCEPTION 'Access Denied: You are not authorized to update orders for another delivery block.';
    END IF;
  END IF;

  IF v_caller_role = 'store_manager' THEN
    IF v_delivery_method != 'campus_pickup' THEN
      RAISE EXCEPTION 'Access Denied: Store Managers can only update Store Pickup orders.';
    END IF;
  END IF;

  -- No-op if target status is already set
  IF v_old_status = p_new_status THEN
    RETURN true;
  END IF;

  -- Terminal status checks: cancelled and completed are permanent
  IF v_old_status = 'cancelled' THEN
    RAISE EXCEPTION 'Order is already cancelled. Cancelled orders cannot be modified or re-restocked.';
  END IF;

  IF v_old_status = 'completed' THEN
    RAISE EXCEPTION 'Order is already completed. Completed orders cannot be changed or cancelled.';
  END IF;

  -- Validate target status is one of the supported domain statuses
  IF p_new_status NOT IN ('placed', 'confirmed', 'preparing', 'out_for_delivery', 'ready_for_pickup', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid target status: "%".', p_new_status;
  END IF;

  -- Prevent pickup-only status for delivery orders and vice-versa
  IF p_new_status = 'ready_for_pickup' AND v_delivery_method != 'campus_pickup' THEN
    RAISE EXCEPTION 'Invalid status: "ready_for_pickup" applies only to Store Pickup orders.';
  END IF;

  IF p_new_status = 'out_for_delivery' AND v_delivery_method = 'campus_pickup' THEN
    RAISE EXCEPTION 'Invalid status: "out_for_delivery" applies only to Doorstep Delivery orders.';
  END IF;

  -- Lifecycle Progression Rules:
  -- Super Admin & Owner: full administrative authority to adjust status across active workflow states
  -- Block Manager & Store Manager: enforce forward progression (prevents regressing from transit back to placed)
  IF v_caller_role NOT IN ('super_admin', 'owner') THEN
    IF v_old_status IN ('out_for_delivery', 'ready_for_pickup') AND p_new_status NOT IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid transition: Orders in transit or ready for pickup can only be completed or cancelled.';
    END IF;

    IF v_old_status = 'preparing' AND p_new_status NOT IN ('out_for_delivery', 'ready_for_pickup', 'completed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid transition: Preparing orders can only move to out_for_delivery, ready_for_pickup, completed, or cancelled.';
    END IF;
  END IF;

  -- Single-instance atomic inventory restocking on cancellation
  -- Locks product rows in deterministic UUID ascending order to eliminate deadlocks
  IF p_new_status = 'cancelled' THEN
    FOR v_item IN
      SELECT product_id, SUM(quantity)::integer AS quantity
      FROM public.order_items
      WHERE order_id = p_order_id AND product_id IS NOT NULL
      GROUP BY product_id
      ORDER BY product_id ASC
    LOOP
      SELECT stock INTO v_curr_stock
      FROM public.products
      WHERE id = v_item.product_id
      FOR UPDATE;

      UPDATE public.products
      SET stock = v_curr_stock + v_item.quantity, updated_at = now()
      WHERE id = v_item.product_id;

      INSERT INTO public.inventory_movements (
        product_id, order_id, movement_type, quantity_change,
        previous_stock, new_stock, reason, performed_by
      ) VALUES (
        v_item.product_id, p_order_id, 'order_cancellation_restock', v_item.quantity,
        v_curr_stock, v_curr_stock + v_item.quantity,
        'Restock on order cancellation (' || v_old_status || ' -> cancelled)', v_caller_id
      );
    END LOOP;
  END IF;

  -- Update order with milestone timestamps
  UPDATE public.orders
  SET
    status = p_new_status,
    claimed_by = COALESCE(claimed_by, v_caller_id),
    claimed_at = COALESCE(claimed_at, now()),
    processing_started_at = CASE
      WHEN p_new_status IN ('confirmed', 'preparing') AND processing_started_at IS NULL THEN now()
      ELSE processing_started_at
    END,
    completed_at = CASE WHEN p_new_status = 'completed' THEN now() ELSE completed_at END,
    cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN now() ELSE cancelled_at END,
    updated_at = now()
  WHERE id = p_order_id;

  -- Record audit trail in order_status_history
  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, notes
  ) VALUES (
    p_order_id, v_old_status, p_new_status, v_caller_id, p_notes
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_order_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_order_status(uuid, text, text) TO authenticated;

-- 6. Delivery Block Management RPC (Super Admin & Owner)
-- Allows creating/updating blocks, toggling active status, and assigning existing Block Managers.
-- Explicitly prevents Owner from modifying staff roles or creating users.
DROP FUNCTION IF EXISTS public.admin_manage_delivery_block(text, text, text, text, boolean, uuid);
CREATE OR REPLACE FUNCTION public.admin_manage_delivery_block(
  p_action text,
  p_id text,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_manager_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_target_role text;
  v_clean_id text;
  v_clean_name text;
  v_current_active boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- Verify caller is Super Admin or Owner
  SELECT role INTO v_caller_role
  FROM public.admin_roles
  WHERE user_id = v_caller_id
  LIMIT 1;

  IF v_caller_role NOT IN ('super_admin', 'owner') THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators and Store Owners can manage delivery blocks.';
  END IF;

  v_clean_id := TRIM(COALESCE(p_id, ''));
  v_clean_name := COALESCE(NULLIF(TRIM(p_name), ''), v_clean_id);

  IF v_clean_id = '' THEN
    RAISE EXCEPTION 'A valid delivery block ID is required.';
  END IF;

  -- Action 1: Create new delivery block
  IF p_action = 'create' THEN
    IF EXISTS (SELECT 1 FROM public.delivery_blocks WHERE id = v_clean_id) THEN
      RAISE EXCEPTION 'A delivery block with ID "%" already exists.', v_clean_id;
    END IF;

    INSERT INTO public.delivery_blocks (id, name, description, is_active)
    VALUES (v_clean_id, v_clean_name, COALESCE(p_description, ''), COALESCE(p_is_active, true));

    -- If a Block Manager was chosen, assign them
    IF p_manager_user_id IS NOT NULL THEN
      SELECT role INTO v_target_role FROM public.admin_roles WHERE user_id = p_manager_user_id;
      IF v_target_role != 'block_manager' THEN
        RAISE EXCEPTION 'Invalid assignment: Only staff with role "block_manager" can be assigned to a delivery block.';
      END IF;
      UPDATE public.admin_roles SET assigned_block = NULL WHERE assigned_block = v_clean_id AND user_id != p_manager_user_id;
      UPDATE public.admin_roles SET assigned_block = v_clean_id WHERE user_id = p_manager_user_id;
    END IF;

    -- Audit log
    INSERT INTO public.admin_audit_logs (actor_id, action, details)
    VALUES (v_caller_id, 'create_delivery_block', jsonb_build_object('block_id', v_clean_id, 'name', v_clean_name));

    RETURN jsonb_build_object('success', true, 'action', 'create', 'block_id', v_clean_id);
  END IF;

  -- Action 2: Update existing block details
  IF p_action = 'update' THEN
    SELECT is_active INTO v_current_active FROM public.delivery_blocks WHERE id = v_clean_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Delivery block "%" does not exist.', v_clean_id;
    END IF;

    -- Guard: Prevent deactivating a block when active orders exist for it
    IF p_is_active IS FALSE AND v_current_active IS TRUE THEN
      IF EXISTS (
        SELECT 1 FROM public.orders
        WHERE (delivery_block_id = v_clean_id OR (delivery_block_id IS NULL AND block = v_clean_id))
          AND status IN ('placed', 'confirmed', 'preparing', 'out_for_delivery')
      ) THEN
        RAISE EXCEPTION 'Cannot deactivate delivery block "%": there are active orders currently being fulfilled for this block. Please complete or reassign active orders first.', v_clean_id;
      END IF;
    END IF;

    UPDATE public.delivery_blocks
    SET
      name = COALESCE(NULLIF(TRIM(p_name), ''), name),
      description = COALESCE(p_description, description),
      is_active = COALESCE(p_is_active, is_active)
    WHERE id = v_clean_id;

    -- Update or change assigned Block Manager if specified
    IF p_manager_user_id IS NOT NULL THEN
      SELECT role INTO v_target_role FROM public.admin_roles WHERE user_id = p_manager_user_id;
      IF v_target_role != 'block_manager' THEN
        RAISE EXCEPTION 'Invalid assignment: Only staff with role "block_manager" can be assigned to a delivery block.';
      END IF;
      UPDATE public.admin_roles SET assigned_block = NULL WHERE assigned_block = v_clean_id AND user_id != p_manager_user_id;
      UPDATE public.admin_roles SET assigned_block = v_clean_id WHERE user_id = p_manager_user_id;
    END IF;

    -- Audit log
    INSERT INTO public.admin_audit_logs (actor_id, action, details)
    VALUES (v_caller_id, 'update_delivery_block', jsonb_build_object('block_id', v_clean_id, 'name', v_clean_name));

    RETURN jsonb_build_object('success', true, 'action', 'update', 'block_id', v_clean_id);
  END IF;

  -- Action 3: Toggle active status
  IF p_action = 'toggle_active' THEN
    SELECT is_active INTO v_current_active FROM public.delivery_blocks WHERE id = v_clean_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Delivery block "%" does not exist.', v_clean_id;
    END IF;

    -- Guard: Prevent deactivating a block when active orders exist for it
    IF v_current_active IS TRUE THEN
      IF EXISTS (
        SELECT 1 FROM public.orders
        WHERE (delivery_block_id = v_clean_id OR (delivery_block_id IS NULL AND block = v_clean_id))
          AND status IN ('placed', 'confirmed', 'preparing', 'out_for_delivery')
      ) THEN
        RAISE EXCEPTION 'Cannot deactivate delivery block "%": there are active orders currently being fulfilled for this block. Please complete or reassign active orders first.', v_clean_id;
      END IF;
    END IF;

    UPDATE public.delivery_blocks
    SET is_active = NOT is_active
    WHERE id = v_clean_id;

    -- Audit log
    INSERT INTO public.admin_audit_logs (actor_id, action, details)
    VALUES (v_caller_id, 'toggle_active_delivery_block', jsonb_build_object('block_id', v_clean_id, 'new_status', NOT v_current_active));

    RETURN jsonb_build_object('success', true, 'action', 'toggle_active', 'block_id', v_clean_id, 'is_active', NOT v_current_active);
  END IF;

  -- Action 4: Assign or unassign Block Manager
  IF p_action = 'assign_manager' THEN
    IF NOT EXISTS (SELECT 1 FROM public.delivery_blocks WHERE id = v_clean_id) THEN
      RAISE EXCEPTION 'Delivery block "%" does not exist.', v_clean_id;
    END IF;

    IF p_manager_user_id IS NULL THEN
      -- Unassign all managers currently on this block
      UPDATE public.admin_roles SET assigned_block = NULL WHERE assigned_block = v_clean_id;
    ELSE
      SELECT role INTO v_target_role FROM public.admin_roles WHERE user_id = p_manager_user_id;
      IF v_target_role != 'block_manager' THEN
        RAISE EXCEPTION 'Invalid assignment: Only staff with role "block_manager" can be assigned to a delivery block.';
      END IF;
      -- Assign this manager to the block and clear previous assignment on this block
      UPDATE public.admin_roles SET assigned_block = NULL WHERE assigned_block = v_clean_id AND user_id != p_manager_user_id;
      UPDATE public.admin_roles SET assigned_block = v_clean_id WHERE user_id = p_manager_user_id;
    END IF;

    -- Audit log
    INSERT INTO public.admin_audit_logs (actor_id, action, details)
    VALUES (v_caller_id, 'assign_block_manager', jsonb_build_object('block_id', v_clean_id, 'manager_id', p_manager_user_id));

    RETURN jsonb_build_object('success', true, 'action', 'assign_manager', 'block_id', v_clean_id, 'manager_id', p_manager_user_id);
  END IF;

  RAISE EXCEPTION 'Invalid action: %. Supported actions: create, update, toggle_active, assign_manager.', p_action;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_manage_delivery_block(text, text, text, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_delivery_block(text, text, text, text, boolean, uuid) TO authenticated;

-- 7. Block Statistics RPC for Owner & Super Admin Dashboard
DROP FUNCTION IF EXISTS public.admin_get_delivery_blocks_with_stats();
CREATE OR REPLACE FUNCTION public.admin_get_delivery_blocks_with_stats()
RETURNS TABLE (
  id text,
  name text,
  description text,
  is_active boolean,
  created_at timestamptz,
  assigned_manager_id uuid,
  assigned_manager_email text,
  assigned_manager_name text,
  total_orders bigint,
  active_orders bigint,
  latest_claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT (public.is_super_admin() OR public.is_owner()) THEN
    RAISE EXCEPTION 'Access Denied: Only Super Administrators and Store Owners can view block management statistics.';
  END IF;

  RETURN QUERY
  SELECT
    db.id,
    db.name,
    db.description,
    db.is_active,
    db.created_at,
    ar.user_id AS assigned_manager_id,
    u.email::text AS assigned_manager_email,
    COALESCE(p.full_name, '')::text AS assigned_manager_name,
    COUNT(DISTINCT o.id)::bigint AS total_orders,
    COUNT(DISTINCT CASE WHEN o.status IN ('placed', 'confirmed', 'preparing', 'out_for_delivery') THEN o.id END)::bigint AS active_orders,
    MAX(o.claimed_at) AS latest_claimed_at
  FROM public.delivery_blocks db
  LEFT JOIN public.admin_roles ar ON ar.assigned_block = db.id AND ar.role = 'block_manager'
  LEFT JOIN auth.users u ON u.id = ar.user_id
  LEFT JOIN public.profiles p ON p.id = ar.user_id
  LEFT JOIN public.orders o ON (o.delivery_block_id = db.id OR (o.delivery_block_id IS NULL AND o.block = db.id))
  GROUP BY db.id, db.name, db.description, db.is_active, db.created_at, ar.user_id, u.email, p.full_name
  ORDER BY db.name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_delivery_blocks_with_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_delivery_blocks_with_stats() TO authenticated;

-- Standalone Helper Functions for Robust RLS Evaluation
CREATE OR REPLACE FUNCTION public.is_block_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role = 'block_manager'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_block_manager() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_assigned_block()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT assigned_block FROM public.admin_roles
  WHERE user_id = auth.uid() AND role = 'block_manager'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_assigned_block() TO authenticated, anon;

-- Ensure helper function strictly aligns with least-privilege model: only Super Admin and Owner
CREATE OR REPLACE FUNCTION public.can_manage_all_orders()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = auth.uid() AND role IN ('super_admin', 'owner')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_manage_all_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_all_orders() TO authenticated;

-- 8. Hardened Row Level Security (RLS) on public.orders & Child Tables
DROP POLICY IF EXISTS "orders_select_policy" ON public.orders;
CREATE POLICY "orders_select_policy" ON public.orders
  FOR SELECT TO authenticated
  USING (
    -- 1. Customer viewing their own order
    (auth.uid() IS NOT NULL AND user_id = auth.uid()) OR
    -- 2. Super Admin & Owner: full access to all orders across all blocks
    (public.is_super_admin() OR public.is_owner()) OR
    -- 3. Store Manager: strictly restricted to Store Pickup orders
    (public.is_store_manager() AND delivery_method = 'campus_pickup') OR
    -- 4. Block Manager: strictly restricted to their assigned delivery block
    (public.is_block_manager() AND (
      (delivery_block_id IS NOT NULL AND delivery_block_id = public.get_assigned_block()) OR
      (delivery_block_id IS NULL AND block IS NOT NULL AND block = public.get_assigned_block())
    ))
  );

DROP POLICY IF EXISTS "orders_update_admin" ON public.orders;
CREATE POLICY "orders_update_admin" ON public.orders
  FOR UPDATE TO authenticated
  USING (
    -- Super Admin & Owner can update all orders
    (public.is_super_admin() OR public.is_owner()) OR
    -- Store Manager can update Store Pickup orders only
    (public.is_store_manager() AND delivery_method = 'campus_pickup') OR
    -- Block Manager can update assigned block orders only
    (public.is_block_manager() AND (
      (delivery_block_id IS NOT NULL AND delivery_block_id = public.get_assigned_block()) OR
      (delivery_block_id IS NULL AND block IS NOT NULL AND block = public.get_assigned_block())
    ))
  )
  WITH CHECK (
    (public.is_super_admin() OR public.is_owner()) OR
    (public.is_store_manager() AND delivery_method = 'campus_pickup') OR
    (public.is_block_manager() AND (
      (delivery_block_id IS NOT NULL AND delivery_block_id = public.get_assigned_block()) OR
      (delivery_block_id IS NULL AND block IS NOT NULL AND block = public.get_assigned_block())
    ))
  );

-- Synchronize child table RLS: order_items matching parent order permissions
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
          (public.is_store_manager() AND o.delivery_method = 'campus_pickup') OR
          (public.is_block_manager() AND (
            (o.delivery_block_id IS NOT NULL AND o.delivery_block_id = public.get_assigned_block()) OR
            (o.delivery_block_id IS NULL AND o.block IS NOT NULL AND o.block = public.get_assigned_block())
          ))
        )
    )
  );

-- Synchronize child table RLS: order_status_history matching parent order permissions
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
          (public.is_store_manager() AND o.delivery_method = 'campus_pickup') OR
          (public.is_block_manager() AND (
            (o.delivery_block_id IS NOT NULL AND o.delivery_block_id = public.get_assigned_block()) OR
            (o.delivery_block_id IS NULL AND o.block IS NOT NULL AND o.block = public.get_assigned_block())
          ))
        )
    )
  );

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
