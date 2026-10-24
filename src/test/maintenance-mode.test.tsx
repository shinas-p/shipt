import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import {
  canManageMaintenance,
  hasPermission,
  ROLE_PERMISSIONS,
  type AdminRole,
} from "@/lib/permissions";
import { MaintenanceView } from "@/components/store/MaintenanceView";
import { MaintenanceModeTab } from "@/components/admin/MaintenanceModeTab";

// Mock TanStack Router
const mockNavigate = vi.fn();
let mockCurrentPath = "/";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockCurrentPath, search: "", hash: "" }),
  createFileRoute: () => (opts: any) => opts,
}));

// Mock Supabase
vi.mock("@/lib/supabase", () => {
  const channelMock = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            is_maintenance_mode: false,
            maintenance_message: "Test maintenance message",
            maintenance_reopen_at: null,
            maintenance_updated_at: new Date().toISOString(),
          },
          error: null,
        }),
      })),
      rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
      channel: vi.fn(() => channelMock),
      removeChannel: vi.fn(),
    },
    isSupabaseConfigured: true,
  };
});

// Mock Auth
vi.mock("@/lib/auth", () => ({
  useCustomerAuth: () => ({
    user: null,
    profile: null,
    loading: false,
    session: null,
  }),
  AuthProvider: ({ children }: any) => <div>{children}</div>,
}));

// Mock Branding
vi.mock("@/lib/branding", () => ({
  useBranding: () => ({
    branding: {
      store_name: "Shipt Mart",
      tagline: "Everyday Essentials Delivered Fast",
      logo_url: null,
      favicon_url: null,
    },
    isLoading: false,
  }),
}));

describe("Maintenance Mode Architecture & RBAC", () => {
  it("strictly grants maintenance management only to super_admin", () => {
    expect(canManageMaintenance("super_admin")).toBe(true);
    expect(canManageMaintenance("owner")).toBe(false);
    expect(canManageMaintenance("store_manager")).toBe(false);
    expect(canManageMaintenance("block_manager")).toBe(false);
    expect(canManageMaintenance(null)).toBe(false);
    expect(canManageMaintenance(undefined)).toBe(false);
  });

  it("verifies manage_maintenance permission in role sets", () => {
    expect(ROLE_PERMISSIONS.super_admin.has("manage_maintenance")).toBe(true);
    expect(ROLE_PERMISSIONS.owner.has("manage_maintenance" as any)).toBe(false);
    expect(ROLE_PERMISSIONS.store_manager.has("manage_maintenance" as any)).toBe(false);
    expect(ROLE_PERMISSIONS.block_manager.has("manage_maintenance" as any)).toBe(false);

    expect(hasPermission("super_admin", "manage_maintenance")).toBe(true);
    expect(hasPermission("owner", "manage_maintenance")).toBe(false);
  });
});

describe("Customer MaintenanceView Component", () => {
  it("renders the branded restocking hero headline and explanation", () => {
    render(
      <MaintenanceView
        previewMessage="Catalogue updates in progress. Fresh items coming soon!"
        previewReopenAt={null}
        isPreview={false}
      />
    );

    expect(screen.getByText("We're restocking!")).toBeInTheDocument();
    expect(screen.getByText("Shipt Mart")).toBeInTheDocument();
    expect(
      screen.getByText(/is temporarily closed while our warehouse and catalogue team/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText("Catalogue updates in progress. Fresh items coming soon!")
    ).toBeInTheDocument();
  });

  it("displays live expected reopening schedule when timestamp is provided", () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    render(
      <MaintenanceView
        previewMessage="Scheduled restocking"
        previewReopenAt={futureDate}
        isPreview={false}
      />
    );

    expect(screen.getByText("Expected Reopening:")).toBeInTheDocument();
    expect(screen.getByText(/remaining/i)).toBeInTheDocument();
  });

  it("renders order tracking and staff login action links", () => {
    render(
      <MaintenanceView
        previewMessage="Routine maintenance"
        previewReopenAt={null}
        isPreview={false}
      />
    );

    const trackBtn = screen.getByRole("button", { name: /track existing order/i });
    expect(trackBtn).toBeInTheDocument();

    const staffLink = screen.getByRole("link", { name: /staff sign-in/i });
    expect(staffLink).toBeInTheDocument();
    expect(staffLink).toHaveAttribute("href", "/admin");
  });
});

describe("Super Admin MaintenanceModeTab Component", () => {
  it("shows restricted access notice to non-super admin roles", () => {
    render(<MaintenanceModeTab adminRole="store_manager" />);

    expect(
      screen.getByText("Super Administrator Authority Required")
    ).toBeInTheDocument();
    expect(screen.getByText(/Current Role: store_manager/i)).toBeInTheDocument();
    expect(
      screen.queryByText("Public Announcement Message")
    ).not.toBeInTheDocument();
  });

  it("renders full control panel and preset buttons for super_admin", async () => {
    render(<MaintenanceModeTab adminRole="super_admin" />);

    expect(
      screen.getByText(/Storefront Announcement & Reopening Schedule/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Inventory Restock")).toBeInTheDocument();
    expect(screen.getByText("Catalogue & Price Calibration")).toBeInTheDocument();
    expect(screen.getByText("Scheduled Maintenance")).toBeInTheDocument();

    // Verify quick preset updates textarea
    const textarea = screen.getByLabelText(
      "Public Announcement Message"
    ) as HTMLTextAreaElement;
    fireEvent.click(screen.getByText("Inventory Restock"));
    expect(textarea.value).toContain("restocking our campus warehouse");

    // Verify time shortcut buttons exist
    expect(screen.getByRole("button", { name: "+1 Hour" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+2 Hours" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tomorrow 9 AM" })).toBeInTheDocument();
  });
});

describe("Storefront Route Interception Logic", () => {
  const isBypassedRoute = (pathname: string) =>
    pathname.startsWith("/admin") ||
    pathname.startsWith("/accept-invitation") ||
    pathname.startsWith("/auth.callback") ||
    pathname.startsWith("/account");

  it("intercepts customer routes when maintenance is active", () => {
    const customerRoutes = ["/", "/cart", "/checkout", "/wishlist", "/product/prod_123"];
    customerRoutes.forEach((route) => {
      expect(isBypassedRoute(route)).toBe(false);
    });
  });

  it("bypasses staff and auth routes so administration remains accessible", () => {
    const staffRoutes = ["/admin", "/admin/orders", "/accept-invitation", "/auth.callback", "/account"];
    staffRoutes.forEach((route) => {
      expect(isBypassedRoute(route)).toBe(true);
    });
  });
});

