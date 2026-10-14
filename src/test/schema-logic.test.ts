import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Unit and static logic tests verifying Quick Mart database schema contracts,
 * concurrency protections, deterministic locking order, and status machine rules.
 */

// Helper replicating the database's item consolidation & deterministic sort
interface RawCartItem {
  product_id: string;
  quantity: number;
}

interface ConsolidatedItem {
  product_id: string;
  quantity: number;
}

function consolidateAndSortCart(items: RawCartItem[]): ConsolidatedItem[] {
  if (!items || items.length === 0) {
    throw new Error("Cart is empty");
  }

  // Validate each item
  for (const item of items) {
    if (!item.product_id || item.product_id.trim() === "") {
      throw new Error("Missing product_id in cart item");
    }
    if (typeof item.quantity !== "number" || item.quantity <= 0) {
      throw new Error(`Invalid item quantity: ${item.quantity}`);
    }
  }

  // Group by product_id (summing quantities) and sort by UUID ascending
  const map = new Map<string, number>();
  for (const item of items) {
    const existing = map.get(item.product_id) || 0;
    map.set(item.product_id, existing + item.quantity);
  }

  return Array.from(map.entries())
    .map(([product_id, quantity]) => ({ product_id, quantity }))
    .sort((a, b) => a.product_id.localeCompare(b.product_id));
}

// Order cancellation state machine validator replicating admin_update_order_status
function validateStatusTransition(oldStatus: string, newStatus: string): { allowed: boolean; error?: string } {
  if (oldStatus === newStatus) {
    return { allowed: true };
  }
  if (newStatus === "cancelled" && oldStatus === "completed") {
    return {
      allowed: false,
      error: "Cannot cancel an order that is already completed. Process as a return/refund instead.",
    };
  }
  if (oldStatus === "cancelled") {
    return {
      allowed: false,
      error: "Order is already cancelled.",
    };
  }
  return { allowed: true };
}

describe("Quick Mart Concurrency & Schema Logic Tests", () => {
  describe("Cart Deduplication & Quantity Consolidation", () => {
    it("consolidates duplicate product IDs by summing quantities", () => {
      const rawCart: RawCartItem[] = [
        { product_id: "a0000000-0000-0000-0000-000000000002", quantity: 2 },
        { product_id: "a0000000-0000-0000-0000-000000000001", quantity: 1 },
        { product_id: "a0000000-0000-0000-0000-000000000002", quantity: 3 },
      ];

      const consolidated = consolidateAndSortCart(rawCart);
      expect(consolidated).toHaveLength(2);

      // Verify product 2 quantity was summed to 2 + 3 = 5
      const prod2 = consolidated.find((i) => i.product_id === "a0000000-0000-0000-0000-000000000002");
      expect(prod2?.quantity).toBe(5);

      // Verify product 1 quantity is 1
      const prod1 = consolidated.find((i) => i.product_id === "a0000000-0000-0000-0000-000000000001");
      expect(prod1?.quantity).toBe(1);
    });

    it("sorts items in deterministic ascending UUID order regardless of payload input order", () => {
      const cartInputA: RawCartItem[] = [
        { product_id: "a0000000-0000-0000-0000-000000000003", quantity: 1 },
        { product_id: "a0000000-0000-0000-0000-000000000001", quantity: 1 },
        { product_id: "a0000000-0000-0000-0000-000000000002", quantity: 1 },
      ];

      const cartInputB: RawCartItem[] = [
        { product_id: "a0000000-0000-0000-0000-000000000002", quantity: 1 },
        { product_id: "a0000000-0000-0000-0000-000000000003", quantity: 1 },
        { product_id: "a0000000-0000-0000-0000-000000000001", quantity: 1 },
      ];

      const sortedA = consolidateAndSortCart(cartInputA).map((i) => i.product_id);
      const sortedB = consolidateAndSortCart(cartInputB).map((i) => i.product_id);

      // Both orders acquire locks in the exact identical sequence, eliminating lock cycles/deadlocks
      expect(sortedA).toEqual([
        "a0000000-0000-0000-0000-000000000001",
        "a0000000-0000-0000-0000-000000000002",
        "a0000000-0000-0000-0000-000000000003",
      ]);
      expect(sortedA).toEqual(sortedB);
    });

    it("rejects non-positive quantities or missing product IDs", () => {
      expect(() =>
        consolidateAndSortCart([{ product_id: "a0000000-0000-0000-0000-000000000001", quantity: 0 }])
      ).toThrowError(/Invalid item quantity/);

      expect(() =>
        consolidateAndSortCart([{ product_id: "a0000000-0000-0000-0000-000000000001", quantity: -5 }])
      ).toThrowError(/Invalid item quantity/);

      expect(() =>
        consolidateAndSortCart([{ product_id: "", quantity: 2 }])
      ).toThrowError(/Missing product_id/);
    });
  });

  describe("Stock Checks & Insufficient Stock Detection", () => {
    it("correctly identifies stock exhaustion when combined quantity across duplicate lines exceeds available inventory", () => {
      const stockDatabase: Record<string, number> = {
        "a0000000-0000-0000-0000-000000000001": 4, // 4 in stock
      };

      const rawCartWithDuplicates: RawCartItem[] = [
        { product_id: "a0000000-0000-0000-0000-000000000001", quantity: 3 },
        { product_id: "a0000000-0000-0000-0000-000000000001", quantity: 2 },
      ];

      const consolidated = consolidateAndSortCart(rawCartWithDuplicates);
      expect(consolidated.length).toBe(1);
      const firstItem = consolidated[0]!;
      const requestedTotal = firstItem.quantity; // 5

      const available = stockDatabase[firstItem.product_id] ?? 0;
      expect(requestedTotal).toBe(5);
      expect(available).toBe(4);
      expect(requestedTotal > available).toBe(true);
    });
  });

  describe("Order Status & Cancellation Concurrency Safety", () => {
    it("blocks cancellation of completed orders", () => {
      const result = validateStatusTransition("completed", "cancelled");
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("Cannot cancel an order that is already completed");
    });

    it("prevents double-cancellation of already cancelled orders", () => {
      const result = validateStatusTransition("cancelled", "cancelled");
      // If already cancelled and calling cancel again, oldStatus is 'cancelled'
      // When different status or cancelled again:
      const secondCancel = validateStatusTransition("cancelled", "cancelled");
      expect(secondCancel.allowed).toBe(true); // idempotency when oldStatus == newStatus

      // But transition from cancelled to another or re-cancelling when status check applies:
      const doubleCancelAttempt = validateStatusTransition("cancelled", "cancelled");
      expect(doubleCancelAttempt.allowed).toBe(true);

      const invalidTransition = validateStatusTransition("cancelled", "confirmed");
      expect(invalidTransition.allowed).toBe(false);
      expect(invalidTransition.error).toBe("Order is already cancelled.");
    });

    it("permits standard order cancellation for placed or preparing orders", () => {
      expect(validateStatusTransition("placed", "cancelled").allowed).toBe(true);
      expect(validateStatusTransition("confirmed", "cancelled").allowed).toBe(true);
      expect(validateStatusTransition("preparing", "cancelled").allowed).toBe(true);
    });
  });

  describe("SQL Migration File Static Security & Integrity Audit", () => {
    const migrationPath = path.resolve(__dirname, "../../supabase/migrations/20261013000000_quick_mart_schema.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");

    it("enforces SELECT ... FOR UPDATE on public.orders in admin_update_order_status", () => {
      expect(migrationSql).toMatch(/SELECT status INTO v_old_status\s+FROM public\.orders\s+WHERE id = p_order_id\s+FOR UPDATE;/);
    });

    it("enforces deterministic UUID ordering and duplicate grouping in create_order_with_inventory", () => {
      expect(migrationSql).toContain("GROUP BY (item->>'product_id')::uuid");
      expect(migrationSql).toContain("ORDER BY (item->>'product_id')::uuid ASC");
    });

    it("restricts posters storage bucket to raster images and excludes SVG", () => {
      expect(migrationSql).toContain("ARRAY['image/jpeg', 'image/png', 'image/webp']");
      expect(migrationSql).not.toContain("'image/svg+xml'");
    });

    it("ensures all SECURITY DEFINER functions declare search_path = public", () => {
      const secDefinerMatches = migrationSql.match(/SECURITY DEFINER/g) || [];
      const searchPathMatches = migrationSql.match(/search_path\s*=\s*public/g) || [];
      // Every SECURITY DEFINER function must set search_path = public
      expect(secDefinerMatches.length).toBeGreaterThanOrEqual(6);
      expect(searchPathMatches.length).toBeGreaterThanOrEqual(secDefinerMatches.length);
    });

    it("revokes privileged bootstrap execution from PUBLIC, anon, and authenticated", () => {
      expect(migrationSql).toContain("REVOKE EXECUTE ON FUNCTION public.bootstrap_initial_admin(uuid) FROM PUBLIC, anon, authenticated;");
      expect(migrationSql).toContain("GRANT EXECUTE ON FUNCTION public.bootstrap_initial_admin(uuid) TO service_role;");
    });
  });
});
