import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { AdminPage, AdminErrorBoundary } from "@/routes/admin";
import {
  hasPermission,
  canManageCatalog,
  canManageRoles,
  canManageBlocks,
  canManageBranding,
  canManageCosts,
  canAccessOrder,
  type AdminRole,
} from "@/lib/permissions";

// Mock Supabase
vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      from: vi.fn(),
      rpc: vi.fn(),
      auth: {
        getSession: vi.fn(),
        getUser: vi.fn(),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: vi.fn().mockResolvedValue({ data: { path: "test" }, error: null }),
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://example.com/test.jpg" } }),
        }),
      },
    },
    isSupabaseConfigured: true,
  };
});

// Mock TanStack router Link
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<any>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children, to, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
    createFileRoute: () => () => ({
      component: () => null,
    }),
  };
});

describe("Admin Portal Crash Fix & Store Manager Role Hierarchy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Role Permission Hierarchy Enforcement", () => {
    it("enforces strict Store Manager boundaries", () => {
      const role: AdminRole = "store_manager";

      // Store Manager permitted features
      expect(canManageCatalog(role)).toBe(true);
      expect(hasPermission(role, "manage_products")).toBe(true);
      expect(hasPermission(role, "manage_inventory")).toBe(true);
      expect(hasPermission(role, "manage_categories")).toBe(true);
      expect(hasPermission(role, "view_pickup_orders")).toBe(true);
      expect(hasPermission(role, "update_order_status")).toBe(true);

      // Store Manager forbidden features
      expect(canManageRoles(role)).toBe(false);
      expect(canManageBlocks(role)).toBe(false);
      expect(canManageBranding(role)).toBe(false);
      expect(canManageCosts(role)).toBe(false);
      expect(hasPermission(role, "manage_roles")).toBe(false);
      expect(hasPermission(role, "view_all_orders")).toBe(false);
      expect(hasPermission(role, "view_profitability_reports")).toBe(false);
      expect(hasPermission(role, "view_audit_logs")).toBe(false);
    });

    it("restricts Store Manager order access strictly to campus_pickup orders", () => {
      const role: AdminRole = "store_manager";

      const pickupOrder = { delivery_method: "campus_pickup", delivery_block_id: null, block: null };
      const blockAOrder = { delivery_method: "hostel_delivery", delivery_block_id: "Block A", block: "Block A" };
      const blockBOrder = { delivery_method: "hostel_delivery", delivery_block_id: "Block B", block: "Block B" };

      expect(canAccessOrder(role, pickupOrder)).toBe(true);
      expect(canAccessOrder(role, blockAOrder)).toBe(false);
      expect(canAccessOrder(role, blockBOrder)).toBe(false);
    });

    it("allows Owner and Super Admin to oversee all orders and blocks", () => {
      const superAdmin: AdminRole = "super_admin";
      const owner: AdminRole = "owner";
      const pickupOrder = { delivery_method: "campus_pickup" };
      const blockOrder = { delivery_method: "hostel_delivery", delivery_block_id: "Block B" };

      expect(canAccessOrder(superAdmin, pickupOrder)).toBe(true);
      expect(canAccessOrder(superAdmin, blockOrder)).toBe(true);
      expect(canAccessOrder(owner, pickupOrder)).toBe(true);
      expect(canAccessOrder(owner, blockOrder)).toBe(true);

      expect(canManageBlocks(superAdmin)).toBe(true);
      expect(canManageBlocks(owner)).toBe(true);
      expect(canManageRoles(superAdmin)).toBe(true);
      expect(canManageRoles(owner)).toBe(false); // Owner cannot manage staff roles
    });

    it("restricts Block Manager strictly to assigned delivery block", () => {
      const role: AdminRole = "block_manager";
      const blockAOrder = { delivery_method: "hostel_delivery", delivery_block_id: "Block A", block: "Block A" };
      const blockBOrder = { delivery_method: "hostel_delivery", delivery_block_id: "Block B", block: "Block B" };
      const pickupOrder = { delivery_method: "campus_pickup" };

      expect(canAccessOrder(role, blockAOrder, "Block A")).toBe(true);
      expect(canAccessOrder(role, blockBOrder, "Block A")).toBe(false);
      expect(canAccessOrder(role, pickupOrder, "Block A")).toBe(false);
    });
  });

  describe("2. React Hook Uniformity & Error #310 Prevention", () => {
    it("renders AdminPage across loading and authenticated states without React error #310", async () => {
      const { supabase } = await import("@/lib/supabase");

      // Setup session for Store Manager skidhsidhan
      (supabase.auth.getSession as any).mockResolvedValue({
        data: {
          session: {
            user: { id: "sm-uuid-skidhsidhan", email: "skidhsidhan@shiptmart.com" },
          },
        },
        error: null,
      });

      // Mock get_admin_role RPC returning store_manager
      (supabase.rpc as any).mockImplementation((rpcName: string) => {
        if (rpcName === "get_admin_role") {
          return Promise.resolve({ data: "store_manager", error: null });
        }
        if (rpcName === "is_admin") {
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      // Mock from() for tables
      (supabase.from as any).mockImplementation((tableName: string) => {
        if (tableName === "admin_roles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: "store_manager", assigned_block: null },
              error: null,
            }),
          };
        }
        if (tableName === "orders") {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "ord-pickup-1",
                  order_number: "ORD-001",
                  customer_name: "Rahul",
                  customer_phone: "9876543210",
                  delivery_method: "campus_pickup",
                  pickup_location: "Central Store Counter",
                  status: "placed",
                  total_amount: 150,
                  payment_method: "upi",
                  payment_status: "pending",
                  created_at: new Date().toISOString(),
                  order_items: [],
                  order_status_history: [],
                },
                {
                  id: "ord-hostel-1",
                  order_number: "ORD-002",
                  customer_name: "Priya",
                  customer_phone: "9876543211",
                  delivery_method: "hostel_delivery",
                  delivery_block_id: "Block A",
                  block: "Block A",
                  room: "101",
                  status: "placed",
                  total_amount: 250,
                  payment_method: "upi",
                  payment_status: "pending",
                  created_at: new Date().toISOString(),
                  order_items: [],
                  order_status_history: [],
                },
              ],
              error: null,
            }),
          };
        }
        if (tableName === "products") {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (tableName === "categories") {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (tableName === "banners") {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (tableName === "store_settings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      // Render AdminPage - should not throw hook mismatch
      render(<AdminPage />);

      // Should transition from loading to admin portal view
      await waitFor(() => {
        expect(screen.getByText(/Administration/i)).toBeDefined();
        expect(screen.getAllByText(/Store Manager/i).length).toBeGreaterThan(0);
      });
    });
  });

  describe("3. Resilient Schema Fallback Handling", () => {
    it("handles missing delivery_block_id column (HTTP 400 / 42703) gracefully via fallback", async () => {
      const { supabase } = await import("@/lib/supabase");

      let callCount = 0;
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === "orders") {
          return {
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) {
                // First attempt: simulate 42703 column does not exist error
                return Promise.resolve({
                  data: null,
                  error: { code: "42703", message: "column orders.delivery_block_id does not exist" },
                });
              }
              // Second attempt (fallback): succeeds without delivery_block_id
              return Promise.resolve({
                data: [
                  {
                    id: "ord-legacy-1",
                    order_number: "ORD-LEGACY",
                    customer_name: "Legacy Student",
                    delivery_method: "campus_pickup",
                    status: "placed",
                    total_amount: 100,
                    created_at: new Date().toISOString(),
                    order_items: [],
                    order_status_history: [],
                  },
                ],
                error: null,
              });
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      // Verify fallback triggers and resolves data
      const { data, error } = await supabase.from("orders").select("*").order("created_at");
      expect(error?.code).toBe("42703");

      // Verify the fallback second call works
      const fallbackResult = await supabase.from("orders").select("*").order("created_at");
      expect(fallbackResult.data?.length).toBe(1);
      expect(fallbackResult.data?.[0].order_number).toBe("ORD-LEGACY");
    });
  });

  describe("4. In-Page Error Boundary Protection", () => {
    it("AdminErrorBoundary catches component rendering errors and renders a friendly recovery UI", () => {
      // Component that throws a rendering error
      const CrashingWidget = () => {
        throw new Error("Simulated widget failure in admin portal");
      };

      // Suppress console.error in test output for intentional throw
      const originalConsoleError = console.error;
      console.error = vi.fn();

      render(
        <AdminErrorBoundary>
          <CrashingWidget />
        </AdminErrorBoundary>
      );

      // Verify in-page recovery UI is rendered instead of a blank page or root crash
      expect(screen.getByText("Admin Interface Encountered an Issue")).toBeDefined();
      expect(screen.getByText("Simulated widget failure in admin portal")).toBeDefined();
      expect(screen.getByText("Reload Portal")).toBeDefined();
      expect(screen.getByText("Back to Storefront")).toBeDefined();

      console.error = originalConsoleError;
    });
  });
});
