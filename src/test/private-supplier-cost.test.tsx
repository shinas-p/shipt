import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import {
  calculateProfitMetrics,
  validateCostInput,
  buildProductProfitabilityList,
  fetchProductCost,
  fetchAllProductCosts,
  saveProductCost,
} from "@/lib/profitability";
import { ProductFormModal } from "@/components/admin/products/ProductFormModal";
import { QuickEditModal } from "@/components/admin/products/QuickEditModal";
import { ProfitabilityTab } from "@/components/admin/products/ProfitabilityTab";
import { loadProducts } from "@/lib/catalogApi";
import { supabase } from "@/lib/supabase";
import type { DBProduct, DBCategory } from "@/components/admin/products/types";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

const mockCategories: DBCategory[] = [
  { id: "stationery", name: "Stationery", blurb: "Notebooks and pens", display_order: 1, is_active: true },
  { id: "snacks", name: "Snacks", blurb: "Munchies", display_order: 2, is_active: true },
];

const mockProduct: DBProduct = {
  id: "prod-101",
  name: "Premium Spiral Notebook",
  slug: "premium-spiral-notebook",
  size: "A5 · 160 pages",
  description: "High quality ruled notebook",
  price: 100,
  original_price: 120,
  category_id: "stationery",
  image_url: "https://example.com/notebook.jpg",
  stock: 50,
  bestseller: true,
  is_new: false,
  is_active: true,
  display_order: 1,
};

describe("Private Supplier Cost & Profit Management Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Financial & Mathematical Calculation Requirements
  // =========================================================================
  describe("1. Profit, Margin, and Markup Calculations", () => {
    it("accurately calculates profit, margin, and markup for standard profitable items", () => {
      // Selling price = ₹100, Supplier cost = ₹60, Other costs = ₹10
      // Total cost = ₹70
      // Estimated profit = 100 - 60 - 10 = ₹30
      // Profit margin = (30 / 100) * 100 = 30.0%
      // Markup = (30 / 60) * 100 = 50.0%
      const res = calculateProfitMetrics(100, 60, 10);
      expect(res.sellingPrice).toBe(100);
      expect(res.supplierCost).toBe(60);
      expect(res.otherCosts).toBe(10);
      expect(res.totalCost).toBe(70);
      expect(res.estimatedProfit).toBe(30);
      expect(res.profitMarginPct).toBe(30);
      expect(res.markupPct).toBe(50);
      expect(res.isLoss).toBe(false);
      expect(res.isBreakeven).toBe(false);
    });

    it("handles zero selling price safely without division-by-zero errors", () => {
      // Selling price = 0, Supplier cost = 25
      // Estimated profit = -25 (loss)
      // Profit margin must safely be 0% rather than NaN or Infinity
      const res = calculateProfitMetrics(0, 25, 5);
      expect(res.sellingPrice).toBe(0);
      expect(res.totalCost).toBe(30);
      expect(res.estimatedProfit).toBe(-30);
      expect(res.profitMarginPct).toBe(0);
      expect(res.isLoss).toBe(true);
      expect(Number.isFinite(res.profitMarginPct)).toBe(true);
    });

    it("handles zero supplier cost safely without division-by-zero errors", () => {
      // Selling price = 50, Supplier cost = 0, Other costs = 5
      // Markup must safely be 0% rather than NaN or Infinity
      const res = calculateProfitMetrics(50, 0, 5);
      expect(res.supplierCost).toBe(0);
      expect(res.totalCost).toBe(5);
      expect(res.estimatedProfit).toBe(45);
      expect(res.profitMarginPct).toBe(90);
      expect(res.markupPct).toBe(0);
      expect(Number.isFinite(res.markupPct)).toBe(true);
    });

    it("detects loss-making items when selling price is below total procurement costs", () => {
      // Selling price = ₹40, Supplier cost = ₹50, Other costs = ₹5
      // Total cost = ₹55
      // Estimated profit = -₹15 (Loss)
      // Profit margin = (-15 / 40) * 100 = -37.5%
      // Markup = (-15 / 50) * 100 = -30.0%
      const res = calculateProfitMetrics(40, 50, 5);
      expect(res.estimatedProfit).toBe(-15);
      expect(res.profitMarginPct).toBe(-37.5);
      expect(res.markupPct).toBe(-30);
      expect(res.isLoss).toBe(true);
    });

    it("identifies breakeven pricing accurately", () => {
      const res = calculateProfitMetrics(50, 45, 5);
      expect(res.estimatedProfit).toBe(0);
      expect(res.profitMarginPct).toBe(0);
      expect(res.markupPct).toBe(0);
      expect(res.isBreakeven).toBe(true);
      expect(res.isLoss).toBe(false);
    });

    it("validates input as non-negative amounts", () => {
      expect(validateCostInput("45.50")).toEqual({ valid: true, value: 45.5, error: undefined });
      expect(validateCostInput("-10").valid).toBe(false);
      expect(validateCostInput("invalid-text").valid).toBe(false);
      expect(validateCostInput(0)).toEqual({ valid: true, value: 0, error: undefined });
    });
  });

  // =========================================================================
  // 2. Security & RLS Authorization Enforcement
  // =========================================================================
  describe("2. Security, RLS Authorization, & Role Isolation", () => {
    it("allows authorized administrators to retrieve private product costs", async () => {
      const selectSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              product_id: "prod-101",
              supplier_cost: "55.00",
              other_costs: "5.00",
              notes: "Verified wholesaler invoice",
              created_at: "2026-10-21T10:00:00Z",
              updated_at: "2026-10-21T10:00:00Z",
            },
            error: null,
          }),
        }),
      });

      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "product_costs") {
          return { select: selectSpy } as any;
        }
        return {} as any;
      });

      const cost = await fetchProductCost("prod-101");
      expect(cost).not.toBeNull();
      expect(cost?.supplier_cost).toBe(55);
      expect(cost?.other_costs).toBe(5);
      expect(cost?.notes).toBe("Verified wholesaler invoice");
    });

    it("denies access to product_costs when RLS returns permission denied or empty for non-admins", async () => {
      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "product_costs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "new row violates row-level security policy for table product_costs" },
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const cost = await fetchProductCost("prod-101");
      // Returns null safely without throwing or leaking schema
      expect(cost).toBeNull();
    });

    it("invokes the admin_upsert_product_cost RPC with non-negative parameters", async () => {
      const rpcSpy = vi.spyOn(supabase, "rpc").mockResolvedValueOnce({
        data: {
          product_id: "prod-101",
          supplier_cost: 60,
          other_costs: 5,
          notes: "Vendor contract #12",
          updated_at: new Date().toISOString(),
        },
        error: null,
      } as any);

      const res = await saveProductCost("prod-101", 60, 5, "Vendor contract #12");
      expect(res.success).toBe(true);
      expect(rpcSpy).toHaveBeenCalledWith("admin_upsert_product_cost", {
        p_product_id: "prod-101",
        p_supplier_cost: 60,
        p_other_costs: 5,
        p_notes: "Vendor contract #12",
      });
    });

    it("handles unauthorized RPC rejection when caller is not an admin", async () => {
      vi.spyOn(supabase, "rpc").mockResolvedValueOnce({
        data: null,
        error: { message: "Access Denied: Only authorized administrators can manage supplier costs." },
      } as any);

      // And table fallback also rejects via RLS
      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "product_costs") {
          return {
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "Access Denied: RLS violation" },
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const res = await saveProductCost("prod-101", 50, 0);
      expect(res.success).toBe(false);
      expect(res.error).toContain("Access Denied");
    });
  });

  // =========================================================================
  // 3. Public Customer-Facing Isolation (Never Leaks Supplier Costs)
  // =========================================================================
  describe("3. Customer-Facing Isolation & Public Schema Verification", () => {
    it("ensures public loadProducts() never exposes supplier_cost or profit fields", async () => {
      // Simulate raw Supabase products query returned from public.products
      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "products") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "prod-public-1",
                      name: "Campus Salted Chips",
                      slug: "campus-salted-chips",
                      size: "50 g",
                      description: "Snack item",
                      price: 20,
                      original_price: null,
                      category_id: "snacks",
                      image_url: "/chips.jpg",
                      stock: 15,
                      bestseller: false,
                      is_new: true,
                      is_active: true,
                      display_order: 1,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const publicProducts = await loadProducts();
      expect(publicProducts).toHaveLength(1);
      const firstItem = publicProducts[0] as any;

      // Customer fields present
      expect(firstItem.id).toBe("prod-public-1");
      expect(firstItem.name).toBe("Campus Salted Chips");
      expect(firstItem.price).toBe(20);

      // Private supplier fields MUST be strictly undefined
      expect(firstItem.supplier_cost).toBeUndefined();
      expect(firstItem.supplierCost).toBeUndefined();
      expect(firstItem.other_costs).toBeUndefined();
      expect(firstItem.otherCosts).toBeUndefined();
      expect(firstItem.estimated_profit).toBeUndefined();
      expect(firstItem.profitMargin).toBeUndefined();
      expect(firstItem.markup).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. ProductFormModal Admin UI & Dynamic Calculations
  // =========================================================================
  describe("4. ProductFormModal Admin Cost Editor", () => {
    it("renders 'Supplier Cost (Private)' input in the Pricing & Stock tab and calculates live metrics", async () => {
      // Mock existing cost fetch
      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "product_costs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    product_id: mockProduct.id,
                    supplier_cost: 60,
                    other_costs: 5,
                    notes: "Direct distributor rate",
                  },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      render(
        <ProductFormModal
          open={true}
          onOpenChange={vi.fn()}
          product={mockProduct}
          categories={mockCategories}
          onSaveSuccess={vi.fn()}
        />
      );

      // Switch to Pricing & Stock tab
      const pricingTabBtn = screen.getByRole("button", { name: /pricing & stock/i });
      fireEvent.click(pricingTabBtn);

      // Verify the private supplier cost input is present with exact required label
      await waitFor(() => {
        expect(screen.getByText(/supplier cost \(private\)/i)).toBeInTheDocument();
      });

      // Verify confidential admin-only badge
      expect(screen.getByText(/private · admin only/i)).toBeInTheDocument();

      // Check loaded values
      const supplierInput = screen.getByPlaceholderText("e.g. 40") as HTMLInputElement;
      expect(supplierInput).toBeInTheDocument();
      await waitFor(() => {
        expect(supplierInput.value).toBe("60");
      });

      // Verify live calculated profit and margin:
      // Selling price: 100, Supplier: 60, Other: 5 => Total Cost: 65, Profit: 35, Margin: 35.0%
      expect(screen.getByText(/35.0%/i)).toBeInTheDocument();

      // Change selling price to 120 and verify live recalculation:
      // Total Cost: 65, Profit: 55, Margin: (55 / 120) * 100 = 45.8%
      const priceInput = screen.getByPlaceholderText("60");
      fireEvent.change(priceInput, { target: { value: "120" } });

      await waitFor(() => {
        expect(screen.getByText(/45.8%/i)).toBeInTheDocument();
      });
    });

    it("displays loss alert when selling price is lower than unit cost", async () => {
      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "product_costs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    product_id: mockProduct.id,
                    supplier_cost: 90,
                    other_costs: 20,
                  },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      render(
        <ProductFormModal
          open={true}
          onOpenChange={vi.fn()}
          product={mockProduct} // price = 100
          categories={mockCategories}
          onSaveSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /pricing & stock/i }));

      // Total Cost = 110 > Price = 100
      await waitFor(() => {
        expect(screen.getByText(/warning: selling price is lower than unit cost/i)).toBeInTheDocument();
        expect(screen.getByText(/estimated loss/i)).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 5. QuickEditModal Inline Cost Updating
  // =========================================================================
  describe("5. QuickEditModal Fast Cost Adjustments", () => {
    it("renders private supplier cost in Quick Edit and saves cost changes", async () => {
      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "product_costs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { product_id: mockProduct.id, supplier_cost: 70, other_costs: 0 },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === "products") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          } as any;
        }
        return {} as any;
      });

      const rpcSpy = vi.spyOn(supabase, "rpc").mockResolvedValue({
        data: { product_id: mockProduct.id, supplier_cost: 75, other_costs: 0 },
        error: null,
      } as any);

      render(
        <QuickEditModal
          open={true}
          product={mockProduct}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn().mockResolvedValue(undefined)}
        />
      );

      expect(screen.getByText(/supplier cost \(private\)/i)).toBeInTheDocument();

      const costInput = screen.getByPlaceholderText("e.g. 40") as HTMLInputElement;
      await waitFor(() => {
        expect(costInput.value).toBe("70");
      });

      // Update cost to 75
      fireEvent.change(costInput, { target: { value: "75" } });
      expect(costInput.value).toBe("75");

      // Save
      const saveBtn = screen.getByRole("button", { name: /save/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(rpcSpy).toHaveBeenCalledWith(
          "admin_upsert_product_cost",
          expect.objectContaining({
            p_supplier_cost: 75,
          })
        );
      });
    });
  });

  // =========================================================================
  // 6. ProfitabilityTab Comprehensive Admin Report
  // =========================================================================
  describe("6. ProfitabilityTab Admin Report & Metrics", () => {
    it("renders portfolio KPI summary cards and table with colored margin badges", async () => {
      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "product_costs") {
          return {
            select: vi.fn().mockResolvedValue({
              data: [
                {
                  product_id: mockProduct.id,
                  supplier_cost: 60,
                  other_costs: 0,
                  notes: "Wholesale batch A",
                },
              ],
              error: null,
            }),
          } as any;
        }
        return {} as any;
      });

      render(
        <ProfitabilityTab
          products={[mockProduct]}
          categories={mockCategories}
          onOpenEdit={vi.fn()}
          onRefreshProducts={vi.fn().mockResolvedValue(undefined)}
        />
      );

      // Verify top confidential banner
      expect(screen.getByText(/private supplier cost & margin management/i)).toBeInTheDocument();
      expect(screen.getByText(/staff confidential/i)).toBeInTheDocument();

      // Verify KPI titles
      expect(screen.getByText(/total inventory cost value/i)).toBeInTheDocument();
      expect(screen.getByText(/gross profit potential/i)).toBeInTheDocument();
      expect(screen.getByText(/average margin/i)).toBeInTheDocument();

      // Verify table product row and margin badge
      await waitFor(() => {
        expect(screen.getByText("Premium Spiral Notebook")).toBeInTheDocument();
        const marginBadges = screen.getAllByText("40.0%");
        expect(marginBadges.length).toBeGreaterThanOrEqual(2);
      });
    });
  });
});
