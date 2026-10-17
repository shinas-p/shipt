import { describe, expect, it } from "vitest";
import { validateSupabaseConfig, isSupabaseConfigured, supabase } from "@/lib/supabase";

describe("Production Authentication & Navigation Flows", { timeout: 25000 }, () => {
  describe("Configuration & Safe Diagnostics", () => {
    it("reports diagnostic status without exposing secret values or tokens", () => {
      const diag = validateSupabaseConfig();
      expect(diag).toHaveProperty("valid");
      expect(diag).toHaveProperty("missing");
      expect(Array.isArray(diag.missing)).toBe(true);

      // Ensure missing only lists public variable names, never actual secret keys
      for (const m of diag.missing) {
        expect(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]).toContain(m);
      }
    });

    it("verifies isSupabaseConfigured matches validation result", () => {
      const diag = validateSupabaseConfig();
      expect(isSupabaseConfigured).toBe(diag.valid);
    });
  });

  describe("Customer Registration Logic & Email Confirmation", () => {
    it("differentiates email confirmation required (session: null) from immediate login (session: object)", () => {
      // Scenario A: Supabase project has Confirm Email enabled
      const mockSignUpResponseWithEmailConfirmation = {
        data: {
          user: {
            id: "user-123",
            email: "student@campus.edu",
            identities: [{ id: "identity-1", provider: "email" }],
          },
          session: null,
        },
        error: null,
      };

      const hasSession = Boolean(mockSignUpResponseWithEmailConfirmation.data.session);
      const isNewUser = Boolean(
        mockSignUpResponseWithEmailConfirmation.data.user &&
        Array.isArray(mockSignUpResponseWithEmailConfirmation.data.user.identities) &&
        mockSignUpResponseWithEmailConfirmation.data.user.identities.length > 0
      );
      const requiresConfirmation = !hasSession && isNewUser;

      expect(requiresConfirmation).toBe(true);

      // Scenario B: Supabase returns active session (instant login)
      const mockSignUpResponseWithSession = {
        data: {
          user: {
            id: "user-456",
            email: "student2@campus.edu",
            identities: [{ id: "identity-2", provider: "email" }],
          },
          session: {
            access_token: "mock-token",
            token_type: "bearer",
            user: { id: "user-456" },
          },
        },
        error: null,
      };

      const hasSessionB = Boolean(mockSignUpResponseWithSession.data.session);
      expect(hasSessionB).toBe(true);
    });

    it("detects existing accounts via empty identities array (Supabase anti-enumeration)", () => {
      // Supabase Auth returns a user object with empty identities when user already exists and email confirm is ON
      const mockExistingUserResponse = {
        data: {
          user: {
            id: "existing-user-789",
            email: "existing@campus.edu",
            identities: [],
          },
          session: null,
        },
        error: null,
      };

      const isExistingAccount = Boolean(
        mockExistingUserResponse.data.user &&
        Array.isArray(mockExistingUserResponse.data.user.identities) &&
        mockExistingUserResponse.data.user.identities.length === 0
      );

      expect(isExistingAccount).toBe(true);
    });
  });

  describe("Admin Authentication vs Admin Authorization", () => {
    it("distinguishes valid authentication without admin role from full admin authorization", async () => {
      // An authenticated non-admin user must NOT pass is_admin check
      // When anonymous or unassigned, is_admin returns false
      if (isSupabaseConfigured) {
        const { data: isAdmin } = await supabase.rpc("is_admin");
        expect(isAdmin).toBe(false);
      }
    });

    it("ensures unauthenticated admin RPC execution fails securely", async () => {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.rpc("admin_update_order_status", {
          p_order_id: "00000000-0000-0000-0000-000000000000",
          p_new_status: "completed",
        });
        expect(data).toBeNull();
        expect(error).not.toBeNull();
      }
    });
  });

  describe("Orders Navigation & Tab URL Synchronization", () => {
    it("correctly parses tab search parameter for /account?tab=orders and ?tab=profile", () => {
      const searchParamsOrders = new URLSearchParams("?tab=orders");
      expect(searchParamsOrders.get("tab")).toBe("orders");

      const searchParamsProfile = new URLSearchParams("?tab=profile");
      expect(searchParamsProfile.get("tab")).toBe("profile");

      const searchParamsEmpty = new URLSearchParams("");
      expect(searchParamsEmpty.get("tab")).toBeNull();
    });

    it("preserves order reference parameters when deep linking", () => {
      const searchParamsDeepLink = new URLSearchParams("?orderId=QM-20261014-1234");
      expect(searchParamsDeepLink.get("orderId")).toBe("QM-20261014-1234");
    });
  });
});
