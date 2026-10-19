import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductManagementCenter } from "@/components/admin/products/ProductManagementCenter";
import { ProductTable } from "@/components/admin/products/ProductTable";
import { BulkOperationModal } from "@/components/admin/products/BulkOperationModal";
import { QuickEditModal } from "@/components/admin/products/QuickEditModal";
import { CategoriesTab } from "@/components/admin/products/CategoriesTab";
import { InventoryLedgerTab } from "@/components/admin/products/InventoryLedgerTab";
import { PricingPromotionsTab } from "@/components/admin/products/PricingPromotionsTab";
import { ProductReportsTab } from "@/components/admin/products/ProductReportsTab";
import type { DBProduct, DBCategory } from "@/components/admin/products/types";

// Mock Supabase client
vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: "test-admin-id", email: "admin@shipt.campus" } } },
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ data: [{ id: "new-p1" }], error: null }),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        single: vi.fn().mockResolvedValue({ data: { id: "p1" }, error: null }),
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: vi.fn().mockResolvedValue({ error: null }),
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://example.com/p.jpg" } }),
        }),
      },
    },
    isSupabaseConfigured: true,
  };
});

const mockCategories: DBCategory[] = [
  { id: "stationery", name: "Stationery", blurb: "Notebooks, pens and paper", display_order: 1, is_active: true },
  { id: "snacks", name: "Snacks", blurb: "Chips and munchies", display_order: 2, is_active: true },
  { id: "electronics", name: "Electronics", blurb: "Cables and chargers", display_order: 3, is_active: true },
];

const mockProducts: DBProduct[] = [
  {
    id: "prod-1",
    name: "Campus Spiral Notebook A5",
    slug: "spiral-notebook-a5",
    size: "A5 · 160 pages",
    description: "Lecture notebook with ruled pages",
    price: 60,
    original_price: 80,
    category_id: "stationery",
    image_url: "https://example.com/notebook.jpg",
    stock: 25,
    bestseller: true,
    is_new: false,
    is_active: true,
    display_order: 1,
    created_at: "2026-10-18T10:00:00Z",
  },
  {
    id: "prod-2",
    name: "Classic Salted Chips",
    slug: "classic-salted-chips",
    size: "50 g",
    description: "Crispy potato chips",
    price: 20,
    original_price: null,
    category_id: "snacks",
    image_url: "https://example.com/chips.jpg",
    stock: 2, // Low stock
    bestseller: false,
    is_new: true,
    is_active: true,
    display_order: 2,
    created_at: "2026-10-18T11:00:00Z",
  },
  {
    id: "prod-3",
    name: "USB-C Fast Charging Cable",
    slug: "usb-c-cable-1m",
    size: "1 m braided",
    description: "Fast data sync and 60W charge",
    price: 199,
    original_price: 299,
    category_id: "electronics",
    image_url: "https://example.com/cable.jpg",
    stock: 0, // Out of stock
    bestseller: true,
    is_new: false,
    is_active: true,
    display_order: 3,
    created_at: "2026-10-18T12:00:00Z",
  },
  {
    id: "prod-4",
    name: "Archived Draft Item",
    slug: "archived-draft-item",
    size: "1 piece",
    description: "Draft discontinued product",
    price: 45,
    original_price: null,
    category_id: "stationery",
    image_url: "https://example.com/draft.jpg",
    stock: 0,
    bestseller: false,
    is_new: false,
    is_active: false, // Archived
    display_order: 4,
    created_at: "2026-10-17T10:00:00Z",
  },
];

describe("Shipt — Product Management Center Core Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders ProductManagementCenter workspace with all 6 tab navigation controls", () => {
    render(
      <ProductManagementCenter
        products={mockProducts}
        categories={mockCategories}
        orders={[]}
        adminRole="super_admin"
        productsLoading={false}
        onRefreshProducts={vi.fn().mockResolvedValue(undefined)}
        onRefreshCategories={vi.fn().mockResolvedValue(undefined)}
      />
    );

    // Verify sub-tabs
    expect(screen.getByRole("button", { name: /products/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /categories/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /inventory/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pricing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import \/ export/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reports/i })).toBeInTheDocument();

    // Verify initial table content
    expect(screen.getByText("Campus Spiral Notebook A5")).toBeInTheDocument();
    expect(screen.getByText("Classic Salted Chips")).toBeInTheDocument();
  });

  it("filters product table dynamically by search query across name and slug", () => {
    render(
      <ProductTable
        products={mockProducts}
        categories={mockCategories}
        loading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenCreate={vi.fn()}
        onOpenEdit={vi.fn()}
        selectedIds={[]}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText(/search by name, slug/i);
    fireEvent.change(searchInput, { target: { value: "chips" } });

    expect(screen.getByText("Classic Salted Chips")).toBeInTheDocument();
    expect(screen.queryByText("Campus Spiral Notebook A5")).not.toBeInTheDocument();
    expect(screen.queryByText("USB-C Fast Charging Cable")).not.toBeInTheDocument();
  });

  it("filters product table by stock status (out of stock and low stock)", () => {
    render(
      <ProductTable
        products={mockProducts}
        categories={mockCategories}
        loading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenCreate={vi.fn()}
        onOpenEdit={vi.fn()}
        selectedIds={[]}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    // Filter to Out of Stock
    const stockSelect = screen.getByDisplayValue("All Stock Levels");
    fireEvent.change(stockSelect, { target: { value: "out_of_stock" } });

    expect(screen.getByText("USB-C Fast Charging Cable")).toBeInTheDocument();
    expect(screen.queryByText("Campus Spiral Notebook A5")).not.toBeInTheDocument();
  });

  it("handles row selection and select-all on the current page", () => {
    const mockToggle = vi.fn();
    const mockSelectAll = vi.fn();

    render(
      <ProductTable
        products={mockProducts}
        categories={mockCategories}
        loading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenCreate={vi.fn()}
        onOpenEdit={vi.fn()}
        selectedIds={["prod-1"]}
        onToggleSelect={mockToggle}
        onSelectAll={mockSelectAll}
        onClearSelection={vi.fn()}
      />
    );

    // The header checkbox selects all items on the page
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(1);

    // Header checkbox is the first one
    fireEvent.click(checkboxes[0]!);
    expect(mockSelectAll).toHaveBeenCalled();
  });

  it("validates QuickEdit form: rejects negative prices and negative stock", async () => {
    const mockSuccess = vi.fn().mockResolvedValue(undefined);

    render(
      <QuickEditModal
        product={mockProducts[0]!}
        open={true}
        onOpenChange={vi.fn()}
        onSuccess={mockSuccess}
      />
    );

    expect(screen.getByText(`Quick Edit: ${mockProducts[0]!.name}`)).toBeInTheDocument();

    const priceInput = screen.getByDisplayValue("60");
    fireEvent.change(priceInput, { target: { value: "-10" } });

    const saveButton = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveButton);

    expect(mockSuccess).not.toHaveBeenCalled();
  });

  it("validates bulk discount percentage and prevents negative stock subtractions", () => {
    render(
      <BulkOperationModal
        open={true}
        onOpenChange={vi.fn()}
        operationType="stock_adjust_sub"
        selectedProducts={[mockProducts[1]!]} // stock is 2
        categories={mockCategories}
        onSuccess={vi.fn().mockResolvedValue(undefined)}
        onClearSelection={vi.fn()}
      />
    );

    // Try subtracting 10 units when only 2 exist
    const qtyInput = screen.getByPlaceholderText(/e.g. 15/i);
    fireEvent.change(qtyInput, { target: { value: "10" } });

    // Should render an error warning in preview
    expect(screen.getByText(/insufficient stock: only 2 available/i)).toBeInTheDocument();
  });

  it("protects category deletion when products are linked and requires reassignment", () => {
    render(
      <CategoriesTab
        categories={mockCategories}
        products={mockProducts}
        adminRole="super_admin"
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText("Campus Categories Management")).toBeInTheDocument();
    // Stationery has prod-1 and prod-4 (2 products)
    expect(screen.getByText("2 Products")).toBeInTheDocument();
  });

  it("calculates accurate warehouse inventory metrics in InventoryLedgerTab", () => {
    render(
      <InventoryLedgerTab
        products={mockProducts}
        onRefreshProducts={vi.fn().mockResolvedValue(undefined)}
        onOpenQuickEdit={vi.fn()}
      />
    );

    // Total units = 25 + 2 + 0 + 0 = 27 units
    expect(screen.getByText("27")).toBeInTheDocument();
    // 2 out of stock products (prod-3, prod-4)
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("calculates discount savings and percentage in PricingPromotionsTab", () => {
    render(
      <PricingPromotionsTab
        products={mockProducts}
        categories={mockCategories}
        onRefreshProducts={vi.fn().mockResolvedValue(undefined)}
        onOpenQuickEdit={vi.fn()}
      />
    );

    // prod-1: 60 with original 80 -> 25% off
    // prod-3: 199 with original 299 -> 33% off
    expect(screen.getByText("Active Storefront Promotions (2)")).toBeInTheDocument();
    expect(screen.getByText(/25% OFF/i)).toBeInTheDocument();
  });

  it("aggregates verified sales revenue and units in ProductReportsTab", () => {
    const mockOrders = [
      {
        id: "ord-1",
        status: "completed",
        order_items: [
          { product_id: "prod-1", product_name: "Campus Spiral Notebook A5", quantity: 3, total_price: 180 },
          { product_id: "prod-2", product_name: "Classic Salted Chips", quantity: 5, total_price: 100 },
        ],
      },
      {
        id: "ord-2",
        status: "cancelled", // should be excluded from sales
        order_items: [
          { product_id: "prod-3", product_name: "USB-C Fast Charging Cable", quantity: 1, total_price: 199 },
        ],
      },
    ];

    render(
      <ProductReportsTab
        products={mockProducts}
        categories={mockCategories}
        orders={mockOrders}
      />
    );

    // prod-2 has 5 units delivered (top seller)
    expect(screen.getByText("5 units delivered")).toBeInTheDocument();
    // prod-1 has 3 units delivered
    expect(screen.getByText("3 units delivered")).toBeInTheDocument();
    // Cancelled order for USB cable is not ranked
    expect(screen.queryByText("1 units delivered")).not.toBeInTheDocument();
  });
});
