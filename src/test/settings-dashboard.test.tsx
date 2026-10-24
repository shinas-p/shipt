import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { SettingsDashboardTab } from "@/components/admin/SettingsDashboardTab";
import { ContactSettingsView } from "@/components/admin/ContactSettingsView";
import { ProductSuggestionsTab } from "@/components/admin/ProductSuggestionsTab";
import {
  canManageSuggestions,
  canManageContact,
  canAccessSettings,
  canManageMaintenance,
  type AdminRole,
} from "@/lib/permissions";

// Mock Supabase
const mockEq = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn(() => ({ eq: mockEq }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          contact_phone: "+91 9605174298",
          contact_email: "dhemartforyou@gmail.com",
          contact_whatsapp: "+91 9605174298",
        },
        error: null,
      }),
      update: mockUpdate,
    })),
  },
  isSupabaseConfigured: true,
}));

// Mock suggestions client
vi.mock("@/lib/suggestions", () => ({
  fetchAllSuggestions: vi.fn().mockResolvedValue([
    {
      id: "sug-1",
      customer_name: "Aman Gupta",
      customer_email: "aman@campus.edu",
      customer_phone: "9876543210",
      product_name: "Cold Coffee Can 250ml",
      category: "Snacks & Drinks",
      brand: "Nescafe",
      expected_price: 45,
      quantity: 2,
      reason: "Need energy drinks during late night study sessions",
      photo_url: "https://example.com/can.jpg",
      status: "pending",
      admin_notes: null,
      created_at: new Date().toISOString(),
    },
    {
      id: "sug-2",
      customer_name: "Sneha",
      customer_email: "sneha@campus.edu",
      customer_phone: null,
      product_name: "Spiral Notebook A4",
      category: "Stationery",
      brand: "Classmate",
      expected_price: 80,
      quantity: 1,
      reason: null,
      photo_url: null,
      status: "approved",
      admin_notes: "Vendor confirmed delivery next Monday",
      created_at: new Date().toISOString(),
    },
  ]),
  updateSuggestionStatus: vi.fn().mockResolvedValue({ success: true }),
}));

describe("Feature C — Central Settings Dashboard & Role-Based Permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Role-Based Permissions Matrix", () => {
    it("enforces strict least privilege across all 4 admin roles", () => {
      // Super Admin: Full authority
      expect(canAccessSettings("super_admin")).toBe(true);
      expect(canManageSuggestions("super_admin")).toBe(true);
      expect(canManageContact("super_admin")).toBe(true);
      expect(canManageMaintenance("super_admin")).toBe(true);

      // Owner: Operational authority, cannot manage contact info or maintenance
      expect(canAccessSettings("owner")).toBe(true);
      expect(canManageSuggestions("owner")).toBe(true);
      expect(canManageContact("owner")).toBe(false);
      expect(canManageMaintenance("owner")).toBe(false);

      // Store Manager: Strictly catalog and store pickup orders
      expect(canAccessSettings("store_manager")).toBe(false);
      expect(canManageSuggestions("store_manager")).toBe(false);
      expect(canManageContact("store_manager")).toBe(false);
      expect(canManageMaintenance("store_manager")).toBe(false);

      // Block Manager: Strictly block orders
      expect(canAccessSettings("block_manager")).toBe(false);
      expect(canManageSuggestions("block_manager")).toBe(false);
      expect(canManageContact("block_manager")).toBe(false);
      expect(canManageMaintenance("block_manager")).toBe(false);
    });
  });

  describe("2. SettingsDashboardTab Navigation Hub", () => {
    it("renders all 6 category cards with full controls for Super Admin", () => {
      const onNavigate = vi.fn();
      render(
        <SettingsDashboardTab
          adminRole="super_admin"
          onNavigateSubView={onNavigate}
        />
      );

      expect(screen.getByText("Central Settings Dashboard")).toBeDefined();
      expect(screen.getByText("Store Identity & Branding")).toBeDefined();
      expect(screen.getByText("Promotional Banners")).toBeDefined();
      expect(screen.getByText("Staff Roles & Security")).toBeDefined();
      expect(screen.getByText("Storefront Maintenance Mode")).toBeDefined();
      expect(screen.getByText("Product Suggestions Management")).toBeDefined();
      expect(screen.getByText("Store Contact Coordinates")).toBeDefined();

      // Trigger navigation to suggestions
      const sugBtn = screen.getByText("Review Product Suggestions");
      fireEvent.click(sugBtn);
      expect(onNavigate).toHaveBeenCalledWith("suggestions");

      // Trigger navigation to banners
      const bannerBtn = screen.getByText("Manage Banners");
      fireEvent.click(bannerBtn);
      expect(onNavigate).toHaveBeenCalledWith("banners");
    });

    it("restricts Maintenance Mode card for Owner without Super Admin privileges", () => {
      const onNavigate = vi.fn();
      render(
        <SettingsDashboardTab
          adminRole="owner"
          onNavigateSubView={onNavigate}
        />
      );

      // Store Identity and Product Suggestions are accessible to Owner
      expect(screen.getByText("Configure Store Branding")).toBeDefined();
      expect(screen.getByText("Review Product Suggestions")).toBeDefined();
      expect(screen.getByText("Manage Banners")).toBeDefined();

      // Maintenance Mode and Staff Roles are restricted for Owner
      expect(screen.getAllByText("Restricted to Super Admin").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("3. ContactSettingsView", () => {
    it("allows Super Admin to edit and save contact details and dynamically updates helper links", async () => {
      render(<ContactSettingsView adminRole="super_admin" />);

      const phoneInput = screen.getByLabelText(/Support Phone Number/i) as HTMLInputElement;
      expect(phoneInput.disabled).toBe(false);

      fireEvent.change(phoneInput, { target: { value: "+91 9605174298" } });

      // Dynamic phone link preview should match the input value
      expect(screen.getByText("tel:+919605174298")).toBeDefined();

      const saveBtn = screen.getByRole("button", { name: /Save Contact Settings/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText(/Contact coordinates successfully updated/i)).toBeDefined();
      });
    });

    it("displays read-only indicator for non-Super Admin roles", () => {
      render(<ContactSettingsView adminRole="owner" />);

      expect(screen.getByText(/Read-Only: Super Admin permission required/i)).toBeDefined();
      expect(screen.queryByRole("button", { name: /Save Contact Settings/i })).toBeNull();
    });
  });

  describe("4. ProductSuggestionsTab", () => {
    it("renders suggestions list and counters for authorized administrators", async () => {
      render(<ProductSuggestionsTab adminRole="super_admin" />);

      await waitFor(() => {
        expect(screen.getByText("Cold Coffee Can 250ml")).toBeDefined();
        expect(screen.getByText("Spiral Notebook A4")).toBeDefined();
      });

      expect(screen.getByText("Aman Gupta")).toBeDefined();
      expect(screen.getByText("Nescafe")).toBeDefined();
      expect(screen.getByText(/45/)).toBeDefined();
    });

    it("allows admin to filter suggestions by search query", async () => {
      render(<ProductSuggestionsTab adminRole="owner" />);

      await waitFor(() => {
        expect(screen.getByText("Cold Coffee Can 250ml")).toBeDefined();
      });

      const searchInput = screen.getByPlaceholderText(/Search suggestions/i);
      fireEvent.change(searchInput, { target: { value: "Classmate" } });

      expect(screen.queryByText("Cold Coffee Can 250ml")).toBeNull();
      expect(screen.getByText("Spiral Notebook A4")).toBeDefined();
    });
  });
});
