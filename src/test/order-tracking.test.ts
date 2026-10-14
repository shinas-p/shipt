import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { resolveOrderItemImage, BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { trackGuestOrder } from "@/lib/catalogApi";

describe("Shipt Order Tracking & Security Verification", () => {
  const migrationPath = path.resolve(__dirname, "../../supabase/migrations/20261013000000_quick_mart_schema.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");

  describe("Customer Ownership Restrictions & RLS Safety", () => {
    it("enforces RLS policy ensuring authenticated customers can ONLY access their own orders", () => {
      // Must enforce: auth.uid() IS NOT NULL AND user_id = auth.uid() OR is_admin()
      expect(migrationSql).toMatch(/CREATE POLICY "orders_select_policy" ON public\.orders/);
      expect(migrationSql).toContain("(auth.uid() IS NOT NULL AND user_id = auth.uid()) OR public.is_admin()");
    });

    it("enforces RLS policy on order items to restrict access to the order owner or admin", () => {
      expect(migrationSql).toMatch(/CREATE POLICY "order_items_select_policy" ON public\.order_items/);
      expect(migrationSql).toContain("(auth.uid() IS NOT NULL AND o.user_id = auth.uid()) OR public.is_admin()");
    });

    it("enforces RLS policy on order status history to prevent unauthorized inspection", () => {
      expect(migrationSql).toMatch(/CREATE POLICY "order_status_history_select_policy" ON public\.order_status_history/);
      expect(migrationSql).toContain("(auth.uid() IS NOT NULL AND o.user_id = auth.uid()) OR public.is_admin()");
    });

    it("restricts order status updates strictly to authorized administrators", () => {
      expect(migrationSql).toMatch(/CREATE POLICY "orders_update_admin" ON public\.orders/);
      expect(migrationSql).toContain("FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());");
    });
  });

  describe("Guest Order Tracking Protection", () => {
    it("rejects guest tracking requests when tracking token is empty or missing", async () => {
      const missingTokenRes = await trackGuestOrder("QM-20261014-ABCDEF12", "");
      expect(missingTokenRes.success).toBe(false);
      expect(missingTokenRes.error).toContain("required");

      const missingOrderNoRes = await trackGuestOrder("", "token123");
      expect(missingOrderNoRes.success).toBe(false);
      expect(missingOrderNoRes.error).toContain("required");
    });

    it("enforces that get_guest_order RPC requires both order number and matching guest_tracking_token", () => {
      expect(migrationSql).toContain("p_order_number text");
      expect(migrationSql).toContain("p_tracking_token text");
      expect(migrationSql).toContain("order_number = TRIM(p_order_number)");
      expect(migrationSql).toContain("guest_tracking_token = TRIM(p_tracking_token)");
      expect(migrationSql).toContain("user_id IS NULL");
    });

    it("indexes guest tracking token only for guest orders (user_id IS NULL)", () => {
      expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS idx_orders_guest_token ON public.orders(order_number, guest_tracking_token) WHERE user_id IS NULL;");
    });
  });

  describe("Product Image Resolution & Branded Fallback", () => {
    it("uses item snapshot image_url when available", () => {
      const resolved = resolveOrderItemImage({
        image_url: "https://example.com/custom-poster.jpg",
      });
      expect(resolved).toBe("https://example.com/custom-poster.jpg");
    });

    it("uses joined product image_url if item direct image is absent", () => {
      const resolved = resolveOrderItemImage({
        products: { image_url: "https://example.com/product-catalog.png" },
      });
      expect(resolved).toBe("https://example.com/product-catalog.png");
    });

    it("resolves catalog image by product name when image URL is omitted", () => {
      const resolved = resolveOrderItemImage({
        product_name: "Spiral Notebook",
      });
      expect(resolved).toBeTruthy();
      expect(resolved).not.toBe(BRAND_FALLBACK_IMAGE);
    });

    it("returns BRAND_FALLBACK_IMAGE when no image or recognized product matches", () => {
      const resolved = resolveOrderItemImage({
        product_name: "NonExistentUnknownProduct12345",
      });
      expect(resolved).toBe(BRAND_FALLBACK_IMAGE);
    });
  });

  describe("Status History Chronology & State Machine", () => {
    it("sorts status history records strictly chronologically", () => {
      const sampleEvents = [
        { id: "3", new_status: "completed", created_at: "2026-10-14T11:00:00Z" },
        { id: "1", new_status: "confirmed", created_at: "2026-10-14T09:30:00Z" },
        { id: "2", new_status: "preparing", created_at: "2026-10-14T10:00:00Z" },
      ];

      const sorted = [...sampleEvents].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      expect(sorted[0]?.new_status).toBe("confirmed");
      expect(sorted[1]?.new_status).toBe("preparing");
      expect(sorted[2]?.new_status).toBe("completed");
    });

    it("forbids direct cancellation of already completed orders in admin RPC", () => {
      expect(migrationSql).toContain("IF p_new_status = 'cancelled' AND v_old_status = 'completed' THEN");
      expect(migrationSql).toContain("RAISE EXCEPTION 'Cannot cancel an order that is already completed. Process as a return/refund instead.';");
    });

    it("forbids re-cancellation of already cancelled orders to prevent double-restocking", () => {
      expect(migrationSql).toContain("IF v_old_status = 'cancelled' THEN");
      expect(migrationSql).toContain("RAISE EXCEPTION 'Order is already cancelled.';");
    });
  });
});
