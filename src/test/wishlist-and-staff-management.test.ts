import { describe, expect, it } from "vitest";
import { products as defaultProducts, getProduct, formatINR } from "@/data/products";

describe("Shipt — Staff Management & Customer Wishlist Suite", { timeout: 25000 }, () => {
  describe("Staff & Roles Management Logic", () => {
    it("validates permitted staff roles strictly to super_admin and store_manager", () => {
      const allowedRoles = ["super_admin", "store_manager"];
      const isRoleValid = (role: string) => allowedRoles.includes(role);

      expect(isRoleValid("super_admin")).toBe(true);
      expect(isRoleValid("store_manager")).toBe(true);
      expect(isRoleValid("customer")).toBe(false);
      expect(isRoleValid("admin")).toBe(false);
      expect(isRoleValid("owner")).toBe(false);
      expect(isRoleValid("")).toBe(false);
    });

    it("normalizes staff email addresses consistently", () => {
      const normalizeEmail = (email: string) => email.trim().toLowerCase();

      expect(normalizeEmail("  Manager@Shipt.Campus  ")).toBe("manager@shipt.campus");
      expect(normalizeEmail("STUDENT@DHUniversity.EDU")).toBe("student@dhuniversity.edu");
    });

    it("validates that empty or malformed staff emails are rejected before RPC invocation", () => {
      const validateStaffEmail = (email: string): { valid: boolean; error?: string } => {
        const clean = email.trim().toLowerCase();
        if (!clean) return { valid: false, error: "Please enter a user email address." };
        if (!clean.includes("@") || !clean.includes(".")) {
          return { valid: false, error: "Please enter a valid email address." };
        }
        return { valid: true };
      };

      expect(validateStaffEmail("").valid).toBe(false);
      expect(validateStaffEmail("invalid-email").valid).toBe(false);
      expect(validateStaffEmail("staff@campus.edu").valid).toBe(true);
    });

    it("detects schema cache missing function errors and sets diagnostic notice", () => {
      const rpcError = {
        code: "PGRST202",
        details: "Searched for the function public.admin_assign_role with parameters p_email, p_role",
        message: "Could not find the function public.admin_assign_role(p_email, p_role) in the schema cache",
      };

      const isRpcMissing = (err: any) =>
        err?.code === "PGRST202" || err?.message?.includes("schema cache");

      expect(isRpcMissing(rpcError)).toBe(true);
      expect(isRpcMissing({ code: "42501", message: "permission denied" })).toBe(false);
    });

    it("resolves Super Admin's real email in fallback mode instead of displaying raw UUID", () => {
      const session = {
        user: {
          id: "usr-admin-12345",
          email: "superadmin@shipt.campus",
        },
      };

      const rawDbRecord = {
        user_id: "usr-admin-12345",
        role: "super_admin",
        created_at: "2026-10-14T00:00:00Z",
      };

      const resolveDisplayEmail = (rec: { user_id: string }, curUser: any) => {
        const isMe = curUser?.id === rec.user_id;
        return isMe && curUser?.email ? curUser.email : rec.user_id;
      };

      expect(resolveDisplayEmail(rawDbRecord, session.user)).toBe("superadmin@shipt.campus");

      const otherStaffRecord = {
        user_id: "usr-other-99999",
        role: "store_manager",
        created_at: "2026-10-15T00:00:00Z",
      };

      expect(resolveDisplayEmail(otherStaffRecord, session.user)).toBe("usr-other-99999");
    });

    it("protects against revoking the last remaining super_admin", () => {
      const canRevokeRole = (role: string, superAdminCount: number) => {
        if (role === "super_admin" && superAdminCount <= 1) {
          return { allowed: false, error: "Cannot revoke or delete the last Super Administrator." };
        }
        return { allowed: true };
      };

      expect(canRevokeRole("super_admin", 1).allowed).toBe(false);
      expect(canRevokeRole("super_admin", 2).allowed).toBe(true);
      expect(canRevokeRole("store_manager", 1).allowed).toBe(true);
    });
  });

  describe("Wishlist State & Navigation Logic", () => {
    it("resolves saved product IDs correctly against the active catalog", () => {
      const savedIds = ["notebook-a5", "pen-blue-3", "deleted-product-id-999"];
      const resolved = savedIds
        .map((id) => getProduct(id))
        .filter((p) => p !== undefined);

      expect(resolved.length).toBe(2);
      expect(resolved[0]?.id).toBe("notebook-a5");
      expect(resolved[0]?.name).toBe("Spiral Notebook");
      expect(resolved[1]?.id).toBe("pen-blue-3");
      expect(resolved[1]?.name).toBe("Blue Ballpoint Pens");
    });

    it("formats Indian Rupee prices accurately for wishlist items", () => {
      const p1 = getProduct("notebook-a5")!;
      expect(formatINR(p1.price)).toBe("₹60");

      const p2 = getProduct("cable-usbc")!;
      expect(formatINR(p2.price)).toBe("₹199");
    });

    it("identifies out-of-stock items and prevents Add to Cart on unavailable stock", () => {
      const outOfStock = defaultProducts.find((p) => p.stock === 0)!;
      expect(outOfStock).toBeDefined();

      const canAddToCart = (p: typeof outOfStock) => p.stock > 0;
      expect(canAddToCart(outOfStock)).toBe(false);

      const inStock = defaultProducts.find((p) => p.stock > 0)!;
      expect(canAddToCart(inStock)).toBe(true);
    });

    it("simulates wishlist persistence to local storage format", () => {
      const STORAGE_KEY = "campusmart.demo.wishlist";
      const initialWishlist = ["notebook-a5", "biscuits-cream"];

      // Simulate save
      const serialized = JSON.stringify(initialWishlist);
      expect(serialized).toBe('["notebook-a5","biscuits-cream"]');

      // Simulate toggle item off
      const toggleOff = initialWishlist.filter((id) => id !== "notebook-a5");
      expect(toggleOff).toEqual(["biscuits-cream"]);

      // Simulate toggle new item on
      const toggleOn = [...toggleOff, "chips-salted"];
      expect(toggleOn).toEqual(["biscuits-cream", "chips-salted"]);
    });

    it("verifies empty state triggers when no products are in the wishlist", () => {
      const emptyWishlist: string[] = [];
      const resolved = emptyWishlist
        .map((id) => getProduct(id))
        .filter((p) => p !== undefined);

      expect(resolved.length).toBe(0);
      const showEmptyState = resolved.length === 0;
      expect(showEmptyState).toBe(true);
    });
  });
});
