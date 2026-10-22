# Shipt Coins — Loyalty & Rewards Programme Implementation Plan

## Executive Overview
**Shipt Coins** is a planned customer loyalty programme designed specifically for Shipt Mart customers. It rewards registered customers for everyday purchases (snacks, stationery, essentials, electronics) and encourages repeat orders while preserving strict financial integrity and server-side validation.

> [!NOTE]
> Per project directives, **no coin balances, database tables, redemption logic, or coin-related UI are to be implemented in this release**. This plan outlines the exact architectural blueprint, database schema, transactional state machine, and security boundaries for a future, separately reviewed Supabase migration.

---

## 1. Core Business Rules & Financial Model

| Parameter | Configuration | Rule Specification |
| :--- | :--- | :--- |
| **Earning Rate** | `₹20 spent = 1 Coin` | Calculated on eligible **subtotal** (excluding delivery fees and post-discount portions). Rounded down (`FLOOR(subtotal / 20)`). |
| **Redemption Value** | `100 Coins = ₹10 Discount` | 1 Coin = ₹0.10. Redemptions permitted in blocks of 100 coins (e.g., 100 coins = ₹10 off, 200 coins = ₹20 off). |
| **Max Redemption** | Configurable (e.g., 50% of order) | Prevents negative or zero-subtotal orders to avoid delivery fraud. |
| **Eligible Customers** | Registered Accounts Only | Guest checkouts never earn or redeem account-based coins. |
| **Awarding Timing** | Order Completion Only | Coins are only earned after an order moves to `completed` / `delivered`. Not awarded at initial placement. |
| **Idempotent Rewards** | Exactly Once | Status changes, retries, and network replays must never duplicate coin accrual for the same order. |
| **Cancellations & Returns** | Full Reversal | If an order where coins were earned is cancelled/returned, earned coins are revoked. If coins were redeemed, they are restored to the customer's balance. |

---

## 2. Server-Authoritative Database Schema (Proposed Migration)

### 2.1 Double-Entry Ledger Pattern
To prevent balance tampering, race conditions, and phantom rewards, customer balances are **derived from an immutable ledger of transactions**, backed by a materialized cached balance with strict row-locking:

```sql
-- 1. Loyalty Accounts (summary cache)
CREATE TABLE public.loyalty_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_coins INTEGER NOT NULL DEFAULT 0 CHECK (balance_coins >= 0),
  lifetime_earned_coins INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_earned_coins >= 0),
  lifetime_redeemed_coins INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_redeemed_coins >= 0),
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 2. Loyalty Transaction Ledger (immutable audit trail)
CREATE TYPE public.loyalty_tx_type AS ENUM (
  'earn_order',       -- Awarded upon qualifying order completion
  'redeem_order',     -- Deducted at checkout for order discount
  'refund_restore',   -- Restored if order was cancelled before delivery
  'refund_revoke',    -- Revoked if completed order is later returned/refunded
  'admin_adjustment'  -- Manual credited/debited adjustment by super-admin
);

CREATE TABLE public.loyalty_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.loyalty_accounts(user_id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  tx_type public.loyalty_tx_type NOT NULL,
  amount_coins INTEGER NOT NULL, -- positive for credit, negative for debit
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reference_reason TEXT NOT NULL,
  idempotency_key TEXT UNIQUE, -- e.g. "earn:order:<order_id>" to prevent duplicate awards
  created_by UUID REFERENCES auth.users(id), -- NULL for system, user_id for admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_loyalty_ledger_user_created ON public.loyalty_ledger(user_id, created_at DESC);
CREATE INDEX idx_loyalty_ledger_order ON public.loyalty_ledger(order_id);
```

---

## 3. Concurrency, Atomicity & Fraud Controls

### 3.1 Pessimistic Row Locking (`FOR UPDATE`)
Every coin transaction locks the user's `loyalty_accounts` row:
```sql
SELECT balance_coins, is_frozen
INTO v_balance, v_is_frozen
FROM public.loyalty_accounts
WHERE user_id = p_user_id
FOR UPDATE;
```
This guarantees serial execution: two simultaneous checkouts or background order-status updates cannot spend or award coins against the same balance simultaneously.

### 3.2 Idempotent Order Awarding
When an order's status transitions to `completed`:
1. The function computes `v_coins_to_award := FLOOR(order.subtotal / 20)`.
2. The function inserts into `public.loyalty_ledger` with `idempotency_key = 'earn:order:' || p_order_id::text`.
3. If the row already exists (`ON CONFLICT (idempotency_key) DO NOTHING`), no duplicate coins are awarded.

### 3.3 Cancellation & Rollback Lifecycle
- **Cancelled before completion (Redeemed Coins Used):**
  If customer redeemed 200 coins (₹20 discount) and the order is cancelled, the `admin_update_order_status` or cancellation RPC credits back 200 coins with `tx_type = 'refund_restore'`.
- **Cancelled after completion (Earned Coins Already Awarded):**
  The awarded coins are deducted via `tx_type = 'refund_revoke'`. If this causes balance to drop below zero, the balance is floored at 0 and flagged for administrative review.

---

## 4. Administrative Adjustments & Auditing

Super-administrators must have the ability to credit or debit student balances (e.g. promotional campus giveaways, resolution of delivery disputes):

- Implemented strictly via a `SECURITY DEFINER` function: `admin_adjust_loyalty_balance(...)`.
- Requires caller to have `role = 'admin'` verified via `public.profiles` or JWT app metadata.
- Requires a non-empty `p_reason` string (minimum 10 characters) stored in `public.loyalty_ledger` along with the admin's `auth.uid()`.
- Users have **zero direct INSERT/UPDATE permissions** on `loyalty_accounts` and `loyalty_ledger`.

---

## 5. Security & Row-Level Security (RLS) Policies

```sql
-- Enable RLS
ALTER TABLE public.loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_ledger ENABLE ROW LEVEL SECURITY;

-- Customers can view only their own loyalty balance and history
CREATE POLICY loyalty_account_select_owner ON public.loyalty_accounts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY loyalty_ledger_select_owner ON public.loyalty_ledger
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all loyalty balances and ledgers
CREATE POLICY loyalty_account_select_admin ON public.loyalty_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY loyalty_ledger_select_admin ON public.loyalty_ledger
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Revoke direct mutations from all public roles
REVOKE INSERT, UPDATE, DELETE ON public.loyalty_accounts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.loyalty_ledger FROM anon, authenticated;
```

---

## 6. Frontend Integration Blueprint (Future Phase)

When approved for deployment:
1. **Cart & Checkout Drawer:** Add a slider/toggle `"Redeem Shipt Coins"` (visible only to logged-in customers with `balance >= 100`). Real-time deduction reflected in subtotal.
2. **Order Confirmation:** Display `"You will earn X Shipt Coins upon delivery!"`.
3. **Account Dashboard (`/account`):** Add a `"Shipt Coins"` badge and ledger tab displaying points earned, spent, and order references.
4. **Guest Conversion Incentive:** Enhance the guest-to-account modal: `"You missed out on earning 12 Shipt Coins on this order. Register now to earn on your next order!"`.
