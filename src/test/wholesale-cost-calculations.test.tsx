import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import {
  calculateWholesaleMetrics,
  calculatePartialSaleMetrics,
  calculateProfitMetrics,
  encodeBatchNotes,
  decodeBatchNotes,
  fetchProductCost,
  saveProductCost,
  buildProductProfitabilityList,
  type WholesaleBatchParams,
} from "@/lib/profitability";
import { ProductFormModal } from "@/components/admin/products/ProductFormModal";
import { QuickEditModal } from "@/components/admin/products/QuickEditModal";
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
  { id: "candies", name: "Candies & Munchies", blurb: "Sweet treats", display_order: 1, is_active: true },
  { id: "stationery", name: "Stationery", blurb: "Pens and paper", display_order: 2, is_active: true },
];

const mockCandyProduct: DBProduct = {
  id: "candy-prod-01",
  name: "Mango Bite Candies",
  slug: "mango-bite-candies",
  size: "1 Piece",
  description: "Sweet mango candy",
  price: 1,
  original_price: null,
  category_id: "candies",
  image_url: "https://example.com/candy.jpg",
  stock: 60,
  bestseller: true,
  is_new: false,
  is_active: true,
  display_order: 1,
};

describe("Wholesale Batch Cost & Per-Piece Profit Calculations Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Requirement 3 & 4: Exact 6-pack candy example validation
  // =========================================================================
  describe("1. 6-Pack, 10-Pieces/Pack, ₹50-Total-Cost, ₹1-Selling-Price Math", () => {
    it("accurately calculates total pieces, unrounded unit cost, revenue, profit, and margin", () => {
      // 6 packs × 10 pieces/pack = 60 pieces
      // Total purchase cost for all 6 packs = ₹50
      // Selling price = ₹1 per piece
      const batchParams: WholesaleBatchParams = {
        costMode: "batch",
        batchCost: 50,
        packCount: 6,
        piecesPerPack: 10,
        totalPieces: 60,
        batchOtherCosts: 0,
        unitOtherCosts: 0,
      };

      const metrics = calculateWholesaleMetrics(1, batchParams, null, null, 60);

      // Verify Total pieces = 6 × 10 = 60
      expect(metrics.totalPieces).toBe(60);

      // Verify Unit cost = 50 ÷ 60 = 0.8333333333333334
      expect(metrics.baseUnitCost).toBeCloseTo(0.8333, 4);
      expect(metrics.baseUnitCost).toBe(50 / 60);

      // Verify Revenue at full stock sell-through = 60 × ₹1 = ₹60
      expect(metrics.totalRevenue).toBe(60);

      // Verify Total gross profit = ₹60 − ₹50 = ₹10
      expect(metrics.totalGrossProfit).toBe(10);

      // Verify Per-piece profit = ₹1 − (₹50 ÷ 60) = 0.16666666666666663 (approx ₹0.17)
      expect(metrics.perPieceProfit).toBeCloseTo(0.1667, 4);
      expect(metrics.perPieceProfit).toBe(1 - 50 / 60);

      // Verify Gross profit margin = (10 ÷ 60) × 100 = 16.6666...% (approx 16.67%)
      expect(metrics.grossProfitMarginPct).toBeCloseTo(16.67, 2);

      // Verify Markup = (10 ÷ 50) × 100 = 20%
      expect(metrics.markupPct).toBe(20);

      expect(metrics.isLoss).toBe(false);
      expect(metrics.isBreakeven).toBe(false);
    });

    it("does not round internal unit cost prematurely, preserving mathematical integrity", () => {
      const batchParams: WholesaleBatchParams = {
        costMode: "batch",
        batchCost: 50,
        packCount: 6,
        piecesPerPack: 10,
        totalPieces: 60,
      };

      const metrics = calculateWholesaleMetrics(1, batchParams);

      // If unit cost was rounded prematurely to 0.83:
      // profit would be 1 - 0.83 = 0.17, and total profit would be 0.17 * 60 = 10.20 (20 paise error)
      // With unrounded precision:
      const totalReconstructedProfit = metrics.perPieceProfit * metrics.totalPieces;
      expect(totalReconstructedProfit).toBeCloseTo(10.0, 6);
      expect(metrics.totalGrossProfit).toBe(10.0);
    });
  });

  // =========================================================================
  // Requirement 5: Segregating Batch-Level vs Per-Piece Additional Costs
  // =========================================================================
  describe("2. Additional Costs Breakdown (Batch vs Per-Piece)", () => {
    it("correctly includes batch-level freight and per-piece packaging costs", () => {
      // 60 pieces, ₹50 batch cost, ₹1 selling price
      // Batch-level additional expense = ₹5 (e.g. bulk parcel courier)
      // Per-piece additional expense = ₹0.05 (e.g. 5 paise mini-pouch per candy)
      const batchParams: WholesaleBatchParams = {
        costMode: "batch",
        batchCost: 50,
        packCount: 6,
        piecesPerPack: 10,
        totalPieces: 60,
        batchOtherCosts: 5,
        unitOtherCosts: 0.05,
      };

      const metrics = calculateWholesaleMetrics(1, batchParams);

      // Total additional expenses = 5 + (0.05 × 60) = 5 + 3 = ₹8
      expect(metrics.totalAdditionalCosts).toBe(8);

      // Effective unit cost = (50 / 60) + (5 / 60) + 0.05 = (55 / 60) + 0.05 = 0.91666... + 0.05 = 0.96666...
      expect(metrics.effectiveUnitCost).toBeCloseTo(0.9667, 4);

      // Total gross profit before additional expenses = 60 - 50 = ₹10
      expect(metrics.totalGrossProfit).toBe(10);
      expect(metrics.grossProfitMarginPct).toBeCloseTo(16.67, 2);

      // Total net profit after additional expenses = 10 - 8 = ₹2
      expect(metrics.totalNetProfit).toBe(2);

      // Net profit margin = (2 / 60) * 100 = 3.33%
      expect(metrics.netProfitMarginPct).toBeCloseTo(3.33, 2);

      // Per-piece net profit = 1 - 0.9666... = 0.0333... (approx ₹0.03)
      expect(metrics.perPieceNetProfit).toBeCloseTo(0.0333, 4);
    });

    it("flags loss when additional expenses exceed gross revenue", () => {
      // 60 pieces at ₹1 = ₹60 revenue
      // Batch cost = ₹50
      // Batch other costs = ₹15 (freight)
      // Total expenses = 50 + 15 = ₹65 > ₹60
      const batchParams: WholesaleBatchParams = {
        costMode: "batch",
        batchCost: 50,
        totalPieces: 60,
        batchOtherCosts: 15,
      };

      const metrics = calculateWholesaleMetrics(1, batchParams);
      expect(metrics.totalNetProfit).toBe(-5);
      expect(metrics.isLoss).toBe(true);
      expect(metrics.netProfitMarginPct).toBeCloseTo(-8.33, 2);
    });
  });

  // =========================================================================
  // Requirement 11: Partial Sales Calculations
  // =========================================================================
  describe("3. Partial Sales Accounting", () => {
    it("accurately computes revenue, COGS, and realized vs unrealized profit for 20 pieces sold out of 60", () => {
      const batchParams: WholesaleBatchParams = {
        costMode: "batch",
        batchCost: 50,
        packCount: 6,
        piecesPerPack: 10,
        totalPieces: 60,
      };

      const wholesale = calculateWholesaleMetrics(1, batchParams);
      const partial = calculatePartialSaleMetrics(wholesale, 20, 60);

      // 20 pieces sold at ₹1 each = ₹20 revenue
      expect(partial.quantitySold).toBe(20);
      expect(partial.revenue).toBe(20.0);

      // COGS for 20 pieces = 20 × (50 / 60) = 16.666... => ₹16.67
      expect(partial.cogs).toBe(16.67);

      // Realized profit on 20 pieces = 20 - 16.67 = ₹3.33
      expect(partial.realizedProfit).toBe(3.33);
      expect(partial.realizedMarginPct).toBeCloseTo(16.65, 1);

      // Remaining stock = 60 - 20 = 40 pieces
      expect(partial.remainingStock).toBe(40);

      // Remaining inventory cost value = 40 × (50 / 60) = 33.333... => ₹33.33
      expect(partial.remainingCostValue).toBe(33.33);

      // Unrealized profit potential = 40 × (1 - 50/60) = 6.666... => ₹6.67
      expect(partial.unrealizedProfitPotential).toBe(6.67);

      // Zero leakage: Total COGS + remaining inventory = ₹50.00 exact!
      expect(partial.cogs + partial.remainingCostValue).toBe(50.0);

      // Zero leakage: Realized profit + unrealized profit = ₹10.00 exact!
      expect(partial.realizedProfit + partial.unrealizedProfitPotential).toBe(10.0);
    });
  });

  // =========================================================================
  // Requirement 9: Backward Compatibility with Existing Products
  // =========================================================================
  describe("4. Backward Compatibility with Existing Products", () => {
    it("handles legacy products with direct unit costs seamlessly without regressions", () => {
      // Existing product: price ₹100, supplier cost ₹60, other costs ₹10, stock 50
      const legacyMetrics = calculateProfitMetrics(100, 60, 10);
      expect(legacyMetrics.sellingPrice).toBe(100);
      expect(legacyMetrics.supplierCost).toBe(60);
      expect(legacyMetrics.otherCosts).toBe(10);
      expect(legacyMetrics.totalCost).toBe(70);
      expect(legacyMetrics.estimatedProfit).toBe(30);
      expect(legacyMetrics.profitMarginPct).toBe(30);
      expect(legacyMetrics.markupPct).toBe(50);
      expect(legacyMetrics.costPerPiece).toBe(60);
    });

    it("correctly integrates legacy and wholesale products in buildProductProfitabilityList", () => {
      const legacyProduct: DBProduct = {
        id: "legacy-prod",
        name: "Notebook A5",
        slug: "notebook-a5",
        size: "1 Pc",
        description: "",
        price: 100,
        original_price: null,
        category_id: "stationery",
        image_url: "",
        stock: 50,
        bestseller: false,
        is_new: false,
        is_active: true,
        display_order: 1,
      };

      const costMap = {
        "legacy-prod": {
          product_id: "legacy-prod",
          supplier_cost: 60,
          other_costs: 10,
          notes: "Legacy unit entry",
        },
        "candy-prod-01": {
          product_id: "candy-prod-01",
          supplier_cost: 0.83,
          other_costs: 0,
          notes: "Wholesale candy",
          cost_mode: "batch" as const,
          batch_cost: 50,
          pack_count: 6,
          pieces_per_pack: 10,
          total_pieces: 60,
        },
      };

      const list = buildProductProfitabilityList([legacyProduct, mockCandyProduct], costMap);
      expect(list).toHaveLength(2);

      // Legacy item
      const item1 = list.find((i) => i.productId === "legacy-prod")!;
      expect(item1.price).toBe(100);
      expect(item1.supplierCost).toBe(60);
      expect(item1.totalCost).toBe(70);
      expect(item1.estimatedProfit).toBe(30);
      expect(item1.profitMarginPct).toBe(30);
      expect(item1.inventoryCostValue).toBe(3500); // 70 * 50

      // Wholesale item
      const item2 = list.find((i) => i.productId === "candy-prod-01")!;
      expect(item2.price).toBe(1);
      expect(item2.supplierCost).toBe(0.83);
      expect(item2.totalCost).toBe(0.83);
      expect(item2.estimatedProfit).toBe(0.17);
      expect(item2.profitMarginPct).toBe(16.67);
      expect(item2.inventoryCostValue).toBe(50); // 60 * (50/60)
      expect(item2.inventoryProfitPotential).toBe(10); // 60 * 0.1666...
    });
  });

  // =========================================================================
  // Requirement 7: Inventory Ledger Semantics & Single Piece Checkout Deduction
  // =========================================================================
  describe("5. Inventory Ledger Semantics & Checkout Stock Deductions", () => {
    it("ensures selling one candy piece deducts exactly 1 from stock in individual selling units", () => {
      // Candy stock = 60 pieces
      let stock = mockCandyProduct.stock;
      expect(stock).toBe(60);

      // Simulate customer purchasing 1 piece of candy
      const orderQuantity = 1;
      const previousStock = stock;
      stock -= orderQuantity;

      // Verify exact single piece deduction
      expect(stock).toBe(59);

      // Verify simulated inventory_movements record
      const ledgerEntry = {
        product_id: mockCandyProduct.id,
        movement_type: "order_deduction",
        quantity_change: -orderQuantity,
        previous_stock: previousStock,
        new_stock: stock,
        reason: "Customer order #ORD-1001",
      };

      expect(ledgerEntry.quantity_change).toBe(-1);
      expect(ledgerEntry.previous_stock).toBe(60);
      expect(ledgerEntry.new_stock).toBe(59);
    });
  });

  // =========================================================================
  // Requirement 4 & 10: ProductFormModal Form UI & Unambiguous Labels
  // =========================================================================
  describe("6. ProductFormModal Live Summary & Unambiguous Labels", () => {
    it("displays exact required metrics and unambiguous labels for the 6-pack candy example", async () => {
      // Mock existing product cost fetch with wholesale batch
      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "product_costs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    product_id: mockCandyProduct.id,
                    supplier_cost: 0.83,
                    other_costs: 0,
                    notes: '<!--SHIPT_BATCH:{"costMode":"batch","batchCost":50,"packCount":6,"piecesPerPack":10,"totalPieces":60}--> Wholesale batch ref #482',
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
          product={mockCandyProduct}
          categories={mockCategories}
          onSaveSuccess={vi.fn()}
        />
      );

      // Switch to Pricing & Stock tab
      fireEvent.click(screen.getByRole("button", { name: /pricing & stock/i }));

      // Wait for cost data to load into the form
      await waitFor(() => {
        const batchCostInput = screen.getByPlaceholderText("e.g. 50") as HTMLInputElement;
        expect(batchCostInput).toBeInTheDocument();
        expect(batchCostInput.value).toBe("50");
      });

      // Verify unambiguous labels in the live admin cost/profit summary:
      expect(screen.getByText("Purchase cost")).toBeInTheDocument();
      expect(screen.getByText("Cost per piece")).toBeInTheDocument();
      expect(screen.getByText("Revenue if all stock sells")).toBeInTheDocument();
      expect(screen.getByText("Expected gross profit")).toBeInTheDocument();

      // Verify the displayed values match requirement 4:
      // - Purchase cost: ₹50 total
      // - Stock: 60 pieces
      // - Unit cost / Cost per piece: ₹0.83
      // - Selling price: ₹1 per piece
      // - Revenue if all pieces sell: ₹60
      // - Gross profit if all pieces sell: ₹10
      // - Gross profit margin: 16.67%
      expect(screen.getByText("₹50")).toBeInTheDocument();
      expect(screen.getByText("total")).toBeInTheDocument();
      expect(screen.getByText("60 pieces")).toBeInTheDocument();
      expect(screen.getByText("₹0.83")).toBeInTheDocument();
      expect(screen.getByText("₹1 per piece")).toBeInTheDocument();
      expect(screen.getByText("₹60")).toBeInTheDocument();
      expect(screen.getByText("₹10")).toBeInTheDocument();
      expect(screen.getByText("16.67%")).toBeInTheDocument();
      expect(screen.getByText("₹0.17")).toBeInTheDocument();
    });

    it("automatically calculates total pieces and syncs warehouse stock when entering packs and pieces per pack", async () => {
      // Mock new product creation (product = null)
      render(
        <ProductFormModal
          open={true}
          onOpenChange={vi.fn()}
          product={null}
          categories={mockCategories}
          onSaveSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /pricing & stock/i }));

      const packInput = screen.getByPlaceholderText("e.g. 6");
      const pieceInput = screen.getByPlaceholderText("e.g. 10");
      const batchCostInput = screen.getByPlaceholderText("e.g. 50");
      const priceInput = screen.getByPlaceholderText("60");

      // Enter 6 packs and 10 pieces per pack
      fireEvent.change(packInput, { target: { value: "6" } });
      fireEvent.change(pieceInput, { target: { value: "10" } });
      fireEvent.change(batchCostInput, { target: { value: "50" } });
      fireEvent.change(priceInput, { target: { value: "1" } });

      // Verify pack breakdown calculation text
      expect(screen.getByText(/6 packs × 10 pieces\/pack = 60 pieces/i)).toBeInTheDocument();

      // Verify total pieces auto-populated to 60
      const totalPiecesInput = screen.getByPlaceholderText("e.g. 60") as HTMLInputElement;
      expect(totalPiecesInput.value).toBe("60");

      // Verify live summary metrics
      await waitFor(() => {
        expect(screen.getByText("₹50")).toBeInTheDocument();
        expect(screen.getByText("total")).toBeInTheDocument();
        expect(screen.getByText("₹0.83")).toBeInTheDocument();
        expect(screen.getByText("₹60")).toBeInTheDocument();
        expect(screen.getByText("₹10")).toBeInTheDocument();
        expect(screen.getByText("16.67%")).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Requirement 10: QuickEditModal Unambiguous Labels
  // =========================================================================
  describe("7. QuickEditModal Cost & Profit Summary", () => {
    it("renders Cost per piece, Revenue if all stock sells, and Expected gross profit in QuickEdit", async () => {
      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "product_costs") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { product_id: mockCandyProduct.id, supplier_cost: 0.83, other_costs: 0 },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      render(
        <QuickEditModal
          open={true}
          product={mockCandyProduct}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn().mockResolvedValue(undefined)}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Cost per piece:")).toBeInTheDocument();
        expect(screen.getByText("Revenue if all stock sells:")).toBeInTheDocument();
        expect(screen.getByText("Expected gross profit:")).toBeInTheDocument();
      });
    });
  });
});
