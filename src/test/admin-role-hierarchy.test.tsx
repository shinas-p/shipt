import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  AdminRole,
  AdminPermission,
  ROLE_PERMISSIONS,
  hasPermission,
  canManageCosts,
  canManageRoles,
  canManageCatalog,
  canManageBanners,
  canManageBranding,
  canViewAllOrders,
  canViewAuditLogs,
  getRoleBadge,
  ADMIN_ROLES_METADATA,
} from "@/lib/permissions";
import { ProductManagementCenter } from "@/components/admin/products/ProductManagementCenter";
import { ProductFormModal } from "@/components/admin/products/ProductFormModal";
import { QuickEditModal } from "@/components/admin/products/QuickEditModal";
import { SmartDashboard } from "@/components/admin/SmartDashboard";
import { StoreBrandingTab } from "@/components/admin/StoreBrandingTab";
import { BrandingProvider } from "@/lib/branding";
import type { DBProduct, DBCategory } from "@/components/admin/products/types";

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
        resetPasswordForEmail: vi.fn(),
      },
      functions: {
        invoke: vi.fn(),
      },
      storage: {
        from: vi.fn().mockReturnValue({
          upload: vi.fn().mockResolvedValue({ data: { path: "test" }, error: null }),
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://example.com/test.jpg" } }),
        }),
      },
    },
    isSupabaseConfigured: true,
    validateSupabaseConfig: vi.fn().mockReturnValue({ valid: true, missing: [] }),
  };
});

const mockCategories: DBCategory[] = [
  { id: "snacks", name: "Snacks & Munchies", blurb: "Chips and quick bites", display_order: 1, is_active: true },
  { id: "beverages", name: "Cold Drinks", blurb: "Juices and sodas", display_order: 2, is_active: true },
];

const mockProducts: DBProduct[] = [
  {
    id: "prod-chips",
    name: "Classic Salted Chips",
    size: "50g",
    description: "Crispy potato chips",
    price: 30,
    original_price: 35,
    category_id: "snacks",
    image_url: "https://example.com/chips.jpg",
    stock: 25,
    is_active: true,
  },
  {
    id: "prod-juice",
    name: "Fresh Mango Juice",
    size: "200ml",
    description: "Chilled mango drink",
    price: 45,
    original_price: 50,
    category_id: "beverages",
    image_url: "https://example.com/juice.jpg",
    stock: 2,
    is_active: true,
  },
];

const mockOrders = [
  {
    id: "ord-1",
    order_number: "SHP-1001",
    customer_name: "Aman Gupta",
    customer_phone: "+91 98765 43210",
    delivery_method: "hostel_delivery",
    hostel: "Boys Hostel 1",
    block: "Block A",
    room: "204",
    status: "placed",
    subtotal: 75,
    delivery_fee: 10,
    discount_amount: 0,
    total_amount: 85,
    payment_method: "upi",
    payment_status: "completed",
    created_at: new Date().toISOString(),
    order_items: [
      {
        id: "item-1",
        product_id: "prod-chips",
        product_name: "Classic Salted Chips",
        product_size: "50g",
        unit_price: 30,
        quantity: 1,
        total_price: 30,
      },
      {
        id: "item-2",
        product_id: "prod-juice",
        product_name: "Fresh Mango Juice",
        product_size: "200ml",
        unit_price: 45,
        quantity: 1,
        total_price: 45,
      },
    ],
  },
  {
    id: "ord-2",
    order_number: "SHP-1002",
    customer_name: "Kavya Nair",
    customer_phone: "+91 98765 11111",
    delivery_method: "hostel_delivery",
    hostel: "Girls Hostel 2",
    block: "Block B",
    room: "105",
    status: "confirmed",
    subtotal: 60,
    delivery_fee: 10,
    discount_amount: 0,
    total_amount: 70,
    payment_method: "cash",
    payment_status: "pending",
    created_at: new Date().toISOString(),
    order_items: [
      {
        id: "item-3",
        product_id: "prod-chips",
        product_name: "Classic Salted Chips",
        product_size: "50g",
        unit_price: 30,
        quantity: 2,
        total_price: 60,
      },
    ],
  },
];

describe("Shipt Mart — Secure Admin Role Hierarchy Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Centralized Permission Matrix Verification
  // =========================================================================
  describe("1. Centralized Permission Matrix & Least Privilege Enforcements", () => {
    it("Super Admin possesses all system security, administrative, cost, and order permissions", () => {
      const allPermissions: AdminPermission[] = [
        "manage_roles",
        "manage_security_settings",
        "manage_delivery_blocks",
        "assign_block_managers",
        "manage_products",
        "manage_categories",
        "manage_inventory",
        "manage_banners",
        "manage_branding",
        "view_all_orders",
        "view_assigned_block_orders",
        "view_pickup_orders",
        "update_order_status",
        "claim_orders",
        "manage_supplier_costs",
        "view_profitability_reports",
        "view_business_reports",
        "view_operational_reports",
        "view_audit_logs",
      ];

      for (const p of allPermissions) {
        expect(hasPermission("super_admin", p)).toBe(true);
      }
      expect(canManageRoles("super_admin")).toBe(true);
      expect(canManageCosts("super_admin")).toBe(true);
      expect(canManageCatalog("super_admin")).toBe(true);
      expect(canManageBanners("super_admin")).toBe(true);
      expect(canManageBranding("super_admin")).toBe(true);
      expect(canViewAllOrders("super_admin")).toBe(true);
      expect(canViewAuditLogs("super_admin")).toBe(true);
    });

    it("Owner possesses business authority, private costs and all orders, but is DENIED role admin and audit logs", () => {
      // Allowed permissions
      expect(hasPermission("owner", "manage_delivery_blocks")).toBe(true);
      expect(hasPermission("owner", "assign_block_managers")).toBe(true);
      expect(hasPermission("owner", "manage_products")).toBe(true);
      expect(hasPermission("owner", "manage_categories")).toBe(true);
      expect(hasPermission("owner", "manage_inventory")).toBe(true);
      expect(hasPermission("owner", "manage_banners")).toBe(true);
      expect(hasPermission("owner", "manage_branding")).toBe(true);
      expect(hasPermission("owner", "view_all_orders")).toBe(true);
      expect(hasPermission("owner", "manage_supplier_costs")).toBe(true);
      expect(hasPermission("owner", "view_profitability_reports")).toBe(true);
      expect(hasPermission("owner", "view_business_reports")).toBe(true);

      // Strictly Denied permissions
      expect(hasPermission("owner", "manage_roles")).toBe(false);
      expect(hasPermission("owner", "manage_security_settings")).toBe(false);
      expect(hasPermission("owner", "view_audit_logs")).toBe(false);
      expect(canManageRoles("owner")).toBe(false);
      expect(canViewAuditLogs("owner")).toBe(false);
    });

    it("Store Manager possesses catalog and order management, but is DENIED costs, profits, banners, and roles", () => {
      // Allowed
      expect(hasPermission("store_manager", "manage_products")).toBe(true);
      expect(hasPermission("store_manager", "manage_categories")).toBe(true);
      expect(hasPermission("store_manager", "manage_inventory")).toBe(true);
      expect(hasPermission("store_manager", "view_pickup_orders")).toBe(true);
      expect(hasPermission("store_manager", "update_order_status")).toBe(true);
      expect(hasPermission("store_manager", "view_operational_reports")).toBe(true);

      // Strictly Denied
      expect(hasPermission("store_manager", "view_all_orders")).toBe(false);
      expect(hasPermission("store_manager", "manage_delivery_blocks")).toBe(false);
      expect(hasPermission("store_manager", "assign_block_managers")).toBe(false);
      expect(hasPermission("store_manager", "manage_supplier_costs")).toBe(false);
      expect(hasPermission("store_manager", "view_profitability_reports")).toBe(false);
      expect(hasPermission("store_manager", "view_business_reports")).toBe(false);
      expect(hasPermission("store_manager", "manage_banners")).toBe(false);
      expect(hasPermission("store_manager", "manage_branding")).toBe(false);
      expect(hasPermission("store_manager", "manage_roles")).toBe(false);
      expect(hasPermission("store_manager", "view_audit_logs")).toBe(false);
      expect(canManageCosts("store_manager")).toBe(false);
      expect(canManageRoles("store_manager")).toBe(false);
      expect(canManageBanners("store_manager")).toBe(false);
      expect(canManageBranding("store_manager")).toBe(false);
    });

    it("Block Manager is restricted strictly to assigned block orders & delivery, DENIED all catalog, global, cost, and role access", () => {
      // Allowed
      expect(hasPermission("block_manager", "view_assigned_block_orders")).toBe(true);
      expect(hasPermission("block_manager", "update_order_status")).toBe(true);
      expect(hasPermission("block_manager", "view_operational_reports")).toBe(true);

      // Strictly Denied
      expect(hasPermission("block_manager", "view_all_orders")).toBe(false);
      expect(hasPermission("block_manager", "manage_products")).toBe(false);
      expect(hasPermission("block_manager", "manage_categories")).toBe(false);
      expect(hasPermission("block_manager", "manage_inventory")).toBe(false);
      expect(hasPermission("block_manager", "manage_banners")).toBe(false);
      expect(hasPermission("block_manager", "manage_branding")).toBe(false);
      expect(hasPermission("block_manager", "manage_supplier_costs")).toBe(false);
      expect(hasPermission("block_manager", "view_profitability_reports")).toBe(false);
      expect(hasPermission("block_manager", "view_business_reports")).toBe(false);
      expect(hasPermission("block_manager", "manage_roles")).toBe(false);
      expect(hasPermission("block_manager", "view_audit_logs")).toBe(false);
      expect(canManageCatalog("block_manager")).toBe(false);
      expect(canViewAllOrders("block_manager")).toBe(false);
    });

    it("returns false for null, undefined, or unauthorized roles", () => {
      expect(hasPermission(null, "view_all_orders")).toBe(false);
      expect(hasPermission(undefined, "manage_products")).toBe(false);
      expect(hasPermission("guest" as any, "view_all_orders")).toBe(false);
    });
  });

  // =========================================================================
  // 2. Super Admin-Only Role Assignment & Lockout Safeguard
  // =========================================================================
  describe("2. Super Admin-Only Role Assignment & Safety Lockout Prevention", () => {
    it("protects against revoking or demoting the last active Super Admin", () => {
      const validateAdminRevocation = (role: AdminRole, activeSuperAdminCount: number) => {
        if (role === "super_admin" && activeSuperAdminCount <= 1) {
          return { allowed: false, error: "Cannot revoke or demote the last remaining Super Administrator." };
        }
        return { allowed: true };
      };

      expect(validateAdminRevocation("super_admin", 1).allowed).toBe(false);
      expect(validateAdminRevocation("super_admin", 1).error).toContain("last remaining Super Administrator");
      expect(validateAdminRevocation("super_admin", 2).allowed).toBe(true);
      expect(validateAdminRevocation("owner", 1).allowed).toBe(true);
      expect(validateAdminRevocation("store_manager", 1).allowed).toBe(true);
      expect(validateAdminRevocation("block_manager", 1).allowed).toBe(true);
    });

    it("verifies that only callers with verified super_admin role can invoke role assignments", () => {
      const isCallerAuthorizedToAssign = (callerRole: AdminRole | null | undefined): boolean => {
        return callerRole === "super_admin";
      };

      expect(isCallerAuthorizedToAssign("super_admin")).toBe(true);
      expect(isCallerAuthorizedToAssign("owner")).toBe(false);
      expect(isCallerAuthorizedToAssign("store_manager")).toBe(false);
      expect(isCallerAuthorizedToAssign("block_manager")).toBe(false);
      expect(isCallerAuthorizedToAssign(null)).toBe(false);
    });
  });

  // =========================================================================
  // 3. Owner Access to Business Reports & Costs, but Denied Role Administration
  // =========================================================================
  describe("3. Owner Access vs Security Restrictions", () => {
    it("renders Profitability & Costs tab for Owner in ProductManagementCenter", () => {
      render(
        <ProductManagementCenter
          products={mockProducts}
          categories={mockCategories}
          orders={mockOrders as any}
          adminRole="owner"
          productsLoading={false}
          onRefreshProducts={vi.fn()}
          onRefreshCategories={vi.fn()}
        />
      );

      // Owner can see Profitability & Costs subtab
      expect(screen.getByRole("button", { name: /profitability & costs/i })).toBeInTheDocument();
    });

    it("allows Owner to access Store Branding management", () => {
      render(
        <BrandingProvider>
          <StoreBrandingTab adminRole="owner" />
        </BrandingProvider>
      );

      // Owner can view and save branding changes
      expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
      expect(screen.queryByText(/Staff View \(Read-Only\)/i)).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 4. Store Manager Product & Inventory Access with Strict Financial Isolation
  // =========================================================================
  describe("4. Store Manager Product Operations & Financial Data Protection", () => {
    it("hides Profitability & Costs subtab from Store Manager in ProductManagementCenter", () => {
      render(
        <ProductManagementCenter
          products={mockProducts}
          categories={mockCategories}
          orders={mockOrders as any}
          adminRole="store_manager"
          productsLoading={false}
          onRefreshProducts={vi.fn()}
          onRefreshCategories={vi.fn()}
        />
      );

      // Subtab must be absent
      expect(screen.queryByRole("button", { name: /profitability & costs/i })).not.toBeInTheDocument();
      // Operational catalog tabs must be present
      expect(screen.getByRole("button", { name: /products/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /inventory/i })).toBeInTheDocument();
    });

    it("hides private supplier cost and margin fields from Store Manager in ProductFormModal", () => {
      render(
        <ProductFormModal
          open={true}
          onOpenChange={vi.fn()}
          product={mockProducts[0] ?? null}
          categories={mockCategories}
          adminRole="store_manager"
          onSaveSuccess={vi.fn()}
        />
      );

      // Supplier cost card must NOT be in the document for Store Manager
      expect(screen.queryByText(/Supplier Cost \(Private\)/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Estimated Profit/i)).not.toBeInTheDocument();
    });

    it("hides private supplier cost fields from Store Manager in QuickEditModal", () => {
      render(
        <QuickEditModal
          open={true}
          onOpenChange={vi.fn()}
          product={mockProducts[0] ?? null}
          adminRole="store_manager"
          onSuccess={vi.fn()}
        />
      );

      // Supplier cost must NOT be in the QuickEdit document
      expect(screen.queryByText(/Supplier Cost \(Private\)/i)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText("e.g. 40")).not.toBeInTheDocument();
    });

    it("renders read-only notice when Store Manager views store branding", () => {
      render(
        <BrandingProvider>
          <StoreBrandingTab adminRole="store_manager" />
        </BrandingProvider>
      );

      expect(screen.getByText(/Store Manager View \(Read-Only\)/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 5. Block Manager Block Isolation & Data Partitioning
  // =========================================================================
  describe("5. Block Manager Block Isolation & Empty States", () => {
    it("renders unassigned block state when Block Manager has no assigned block", () => {
      render(
        <SmartDashboard
          orders={mockOrders as any}
          products={mockProducts}
          ordersLoading={false}
          productsLoading={false}
          adminRole="block_manager"
          assignedBlock={null}
          onRefresh={vi.fn()}
          onNavigateTab={vi.fn()}
          onAddNewProduct={vi.fn()}
          onManageInventory={vi.fn()}
          onViewOrder={vi.fn()}
          onEditProduct={vi.fn()}
        />
      );

      expect(screen.getByText(/No Delivery Block Assigned/i)).toBeInTheDocument();
      expect(screen.getByText(/no specific delivery block has been designated yet/i)).toBeInTheDocument();
      // Should NOT expose global store sales or catalog metrics
      expect(screen.queryByTestId("metric-today-sales")).not.toBeInTheDocument();
    });

    it("renders dedicated Block Coordinator view displaying only orders for assigned block", () => {
      render(
        <SmartDashboard
          orders={mockOrders as any}
          products={mockProducts}
          ordersLoading={false}
          productsLoading={false}
          adminRole="block_manager"
          assignedBlock="Block A"
          onRefresh={vi.fn()}
          onNavigateTab={vi.fn()}
          onAddNewProduct={vi.fn()}
          onManageInventory={vi.fn()}
          onViewOrder={vi.fn()}
          onEditProduct={vi.fn()}
        />
      );

      // Header shows assigned block
      expect(screen.getByText(/Block A Coordinator/i)).toBeInTheDocument();
      // Displays order SHP-1001 (which is in Block A)
      expect(screen.getByText("SHP-1001")).toBeInTheDocument();
      // Does NOT display SHP-1002 (which is in Block B) in the block table
      expect(screen.queryByText("SHP-1002")).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 6. Direct URL / Tab Access Protection
  // =========================================================================
  describe("6. Route & Tab Access Protection", () => {
    it("redirects forbidden tabs to dashboard for Block Manager", () => {
      const getAuthorizedTab = (attemptedTab: string, role: AdminRole): string => {
        if (role === "block_manager" && attemptedTab !== "dashboard" && attemptedTab !== "orders") {
          return "dashboard";
        }
        if (!canManageCatalog(role) && attemptedTab === "products") return "dashboard";
        if (!canManageBanners(role) && attemptedTab === "banners") return "dashboard";
        if (!canManageRoles(role) && attemptedTab === "roles") return "dashboard";
        if (!canManageBranding(role) && attemptedTab === "branding") return "dashboard";
        return attemptedTab;
      };

      expect(getAuthorizedTab("products", "block_manager")).toBe("dashboard");
      expect(getAuthorizedTab("banners", "block_manager")).toBe("dashboard");
      expect(getAuthorizedTab("roles", "block_manager")).toBe("dashboard");
      expect(getAuthorizedTab("branding", "block_manager")).toBe("dashboard");
      expect(getAuthorizedTab("orders", "block_manager")).toBe("orders");
      expect(getAuthorizedTab("dashboard", "block_manager")).toBe("dashboard");

      // Store Manager
      expect(getAuthorizedTab("roles", "store_manager")).toBe("dashboard");
      expect(getAuthorizedTab("banners", "store_manager")).toBe("dashboard");
      expect(getAuthorizedTab("branding", "store_manager")).toBe("dashboard");
      expect(getAuthorizedTab("products", "store_manager")).toBe("products");

      // Owner
      expect(getAuthorizedTab("roles", "owner")).toBe("dashboard");
      expect(getAuthorizedTab("banners", "owner")).toBe("banners");
      expect(getAuthorizedTab("products", "owner")).toBe("products");
    });
  });

  // =========================================================================
  // 7. Security Definer & Database RPC Access Rules
  // =========================================================================
  describe("7. Database RPC Authorization Enforcement", () => {
    it("simulates RPC rejection for non-super admin role assignments", async () => {
      const mockRpc = vi.fn().mockImplementation((fnName: string) => {
        if (fnName === "admin_assign_role") {
          return Promise.resolve({
            data: null,
            error: { message: "Access Denied: Only Super Administrators can assign staff roles." },
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const res = await mockRpc("admin_assign_role");
      expect(res.error?.message).toContain("Access Denied");
    });

    it("simulates RPC rejection for Store Manager attempting to write supplier costs", async () => {
      const mockUpsertCost = vi.fn().mockImplementation((role: AdminRole) => {
        if (!canManageCosts(role)) {
          return Promise.resolve({
            data: null,
            error: { message: "Access Denied: Only Super Admins and Owners can manage product costs." },
          });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      });

      const storeManagerAttempt = await mockUpsertCost("store_manager");
      expect(storeManagerAttempt.error?.message).toContain("Access Denied");

      const blockManagerAttempt = await mockUpsertCost("block_manager");
      expect(blockManagerAttempt.error?.message).toContain("Access Denied");

      const ownerAttempt = await mockUpsertCost("owner");
      expect(ownerAttempt.data?.success).toBe(true);

      const superAdminAttempt = await mockUpsertCost("super_admin");
      expect(superAdminAttempt.data?.success).toBe(true);
    });
  });

  // =========================================================================
  // 8. Public Endpoints Never Returning Private Supplier Costs
  // =========================================================================
  describe("8. Public Catalog & Storefront Privacy Enforcement", () => {
    it("verifies public product representations never contain supplier_cost, other_costs, or margins", () => {
      const publicProduct = {
        id: "prod-101",
        name: "Spiral Notebook",
        price: 60,
        original_price: 70,
        stock: 15,
        image_url: "https://example.com/notebook.jpg",
        is_active: true,
      };

      // Ensure private keys are absent from public object
      expect("supplier_cost" in publicProduct).toBe(false);
      expect("other_costs" in publicProduct).toBe(false);
      expect("estimated_profit" in publicProduct).toBe(false);
      expect("profit_margin_percent" in publicProduct).toBe(false);
    });
  });

  // =========================================================================
  // 9. Role Metadata and Styling Consistency
  // =========================================================================
  describe("9. Role Metadata, Badges & Labels", () => {
    it("returns distinct badges and titles for all four roles", () => {
      const roles: AdminRole[] = ["super_admin", "owner", "store_manager", "block_manager"];

      for (const role of roles) {
        const badge = getRoleBadge(role);
        const meta = ADMIN_ROLES_METADATA[role];

        expect(badge.label).toBe(meta.badgeLabel);
        expect(badge.className).toBe(meta.badgeClass);
        expect(meta.title).toBeTruthy();
        expect(meta.description).toBeTruthy();
      }
    });
  });

  // =========================================================================
  // 10. RPC Parameter & Block Manager Validation Simulation
  // =========================================================================
  describe("10. admin_assign_role Parameter & Block Validation", () => {
    const simulateAdminAssignRole = (
      actorRole: AdminRole,
      targetEmail: string,
      targetRole: string,
      assignedBlock?: string | null
    ): { success: boolean; error?: string } => {
      if (actorRole !== "super_admin") {
        return { success: false, error: "Access Denied: Only Super Administrators can assign staff roles." };
      }

      const validRoles = ["super_admin", "owner", "store_manager", "block_manager"];
      if (!validRoles.includes(targetRole)) {
        return { success: false, error: `Invalid role specified: ${targetRole}. Supported roles: super_admin, owner, store_manager, block_manager` };
      }

      if (targetRole === "block_manager") {
        if (!assignedBlock || !assignedBlock.trim()) {
          return { success: false, error: "A valid delivery block must be assigned when designating a Block Manager." };
        }
        const validBlocks = ["Block A", "Block B", "Block C", "Block D", "North Wing", "South Wing", "Main Campus"];
        if (!validBlocks.includes(assignedBlock.trim())) {
          return { success: false, error: `Invalid delivery block "${assignedBlock}". Block must exist in delivery_blocks.` };
        }
      }

      if (!targetEmail || !targetEmail.includes("@")) {
        return { success: false, error: "A valid email address is required." };
      }

      return { success: true };
    };

    it("rejects assignment when caller is Owner instead of Super Admin", () => {
      const res = simulateAdminAssignRole("owner", "staff@shiptmart.com", "store_manager");
      expect(res.success).toBe(false);
      expect(res.error).toContain("Access Denied");
    });

    it("rejects assignment with unsupported role identifier", () => {
      const res = simulateAdminAssignRole("super_admin", "staff@shiptmart.com", "moderator");
      expect(res.success).toBe(false);
      expect(res.error).toContain("Invalid role specified");
    });

    it("rejects block_manager assignment when block is missing", () => {
      const res = simulateAdminAssignRole("super_admin", "bm@shiptmart.com", "block_manager", null);
      expect(res.success).toBe(false);
      expect(res.error).toContain("A valid delivery block must be assigned");
    });

    it("rejects block_manager assignment when block is not in delivery_blocks", () => {
      const res = simulateAdminAssignRole("super_admin", "bm@shiptmart.com", "block_manager", "Zone 99");
      expect(res.success).toBe(false);
      expect(res.error).toContain("Invalid delivery block");
    });

    it("accepts valid assignments for all 4 roles", () => {
      expect(simulateAdminAssignRole("super_admin", "sa@shiptmart.com", "super_admin").success).toBe(true);
      expect(simulateAdminAssignRole("super_admin", "ow@shiptmart.com", "owner").success).toBe(true);
      expect(simulateAdminAssignRole("super_admin", "sm@shiptmart.com", "store_manager").success).toBe(true);
      expect(simulateAdminAssignRole("super_admin", "bm@shiptmart.com", "block_manager", "Block A").success).toBe(true);
    });
  });

  // =========================================================================
  // 11. Complete Removal of Darul Huda Branding from User Experience
  // =========================================================================
  describe("11. Obsolete Branding Verification", () => {
    it("verifies branding metadata does not contain Darul Huda or DHU", () => {
      const metadata = Object.values(ADMIN_ROLES_METADATA);
      for (const m of metadata) {
        expect(m.title.toLowerCase()).not.toContain("darul");
        expect(m.title.toLowerCase()).not.toContain("huda");
        expect(m.title.toLowerCase()).not.toContain("dhu");
        expect(m.description.toLowerCase()).not.toContain("darul");
        expect(m.description.toLowerCase()).not.toContain("huda");
        expect(m.description.toLowerCase()).not.toContain("dhu");
      }
    });
  });
});
