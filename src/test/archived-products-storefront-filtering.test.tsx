import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StoreProvider, useStore } from "@/lib/store";
import { ProductGrid, CategoryGrid } from "@/components/store/Sections";
import { CartDrawer } from "@/components/store/CartDrawer";
import { CheckoutForm } from "@/components/store/CheckoutForm";
import { ProductTable } from "@/components/admin/products/ProductTable";
import * as catalogApi from "@/lib/catalogApi";
import { supabase } from "@/lib/supabase";
import type { Product, Category } from "@/lib/types";
import type { DBProduct, DBCategory } from "@/components/admin/products/types";

// Mock customer auth
vi.mock("@/lib/auth", () => ({
  useCustomerAuth: () => ({
    user: null,
    profile: null,
    isLoading: false,
  }),
}));

// Mock branding
vi.mock("@/lib/branding", () => ({
  useBranding: () => ({
    branding: {
      store_name: "Shipt Mart",
      tagline: "Everyday Essentials. Delivered Fast.",
    },
  }),
}));

// Mock router
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useParams: () => ({ productId: "test-id" }),
  createFileRoute: () => (opts: any) => opts,
}));

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
  },
  isSupabaseConfigured: true,
}));


const mockCategories: Category[] = [
  { id: "snacks", name: "Snacks & Munchies", blurb: "Chips and bites" },
  { id: "stationery", name: "Stationery", blurb: "Notebooks and pens" },
];

const mockActiveProduct: Product = {
  id: "prod-active-1",
  name: "Active Campus Chips",
  size: "50g",
  description: "Fresh crispy chips",
  price: 25,
  category: "snacks",
  image: "/chips.jpg",
  stock: 20,
  bestseller: false,
  isNew: true,
};

const mockSecondActiveProduct: Product = {
  id: "prod-active-2",
  name: "Active Ballpoint Pen",
  size: "Pack of 3",
  description: "Smooth ink pens",
  price: 30,
  category: "stationery",
  image: "/pen.jpg",
  stock: 15,
  bestseller: true,
  isNew: false,
};

describe("Shipt Storefront — Archived Products Suppression & Empty State Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  // =========================================================================
  // 1. Active products appear on storefront
  // =========================================================================
  it("1. displays active products on the storefront product grid", async () => {
    vi.spyOn(catalogApi, "loadCategories").mockResolvedValue(mockCategories);
    vi.spyOn(catalogApi, "loadProducts").mockResolvedValue([mockActiveProduct]);

    render(
      <StoreProvider>
        <ProductGrid />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Active Campus Chips")).toBeInTheDocument();
    });
    expect(screen.getByText("₹25")).toBeInTheDocument();
  });

  // =========================================================================
  // 2. Archived products are hidden and loadProducts filters by is_active = true
  // =========================================================================
  it("2. suppresses archived products from the public storefront and loadProducts strictly queries is_active = true", async () => {
    const eqMock = vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: "prod-active-1",
            name: "Active Campus Chips",
            size: "50g",
            description: "Fresh crispy chips",
            price: 25,
            category_id: "snacks",
            image_url: "/chips.jpg",
            stock: 20,
            bestseller: false,
            is_new: true,
            is_active: true,
            display_order: 1,
          },
        ],
        error: null,
      }),
    });

    const selectMock = vi.fn().mockReturnValue({
      eq: eqMock,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "products") {
        return {
          select: selectMock,
        };
      }
      return {};
    });

    const prods = await catalogApi.loadProducts();

    // Verify .eq("is_active", true) is strictly enforced in Supabase query
    expect(mockFrom).toHaveBeenCalledWith("products");
    expect(eqMock).toHaveBeenCalledWith("is_active", true);
    expect(prods).toHaveLength(1);
    expect(prods[0]!.id).toBe("prod-active-1");
  });

  // =========================================================================
  // 3. When all products are archived, storefront displays the branded empty state
  // =========================================================================
  it("3. displays clean branded empty state with refresh action when all products are archived (never demo products)", async () => {
    vi.spyOn(catalogApi, "loadCategories").mockResolvedValue(mockCategories);
    // When all products are archived in DB, loadProducts returns []
    vi.spyOn(catalogApi, "loadProducts").mockResolvedValue([]);

    render(
      <StoreProvider>
        <CategoryGrid />
        <ProductGrid />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("No products available right now")).toBeInTheDocument();
      expect(
        screen.getByText("Please check back soon. We're updating our store.")
      ).toBeInTheDocument();
    });

    // Verify Refresh Store button is visible
    expect(screen.getByRole("button", { name: /refresh store/i })).toBeInTheDocument();

    // Verify hardcoded demo products are NOT present anywhere
    expect(screen.queryByText("Blue Ballpoint Pens")).toBeNull();
    expect(screen.queryByText("Salted Potato Chips")).toBeNull();
    expect(screen.queryByText("Spiral Notebook")).toBeNull();
    expect(screen.queryByText("Cream Biscuits")).toBeNull();
    expect(screen.queryByText("Herbal Bathing Soap")).toBeNull();
  });

  // =========================================================================
  // 4. Failed product request shows error state with retry, not demo products
  // =========================================================================
  it("4. displays error state with retry action when product query fails, not demo products", async () => {
    vi.spyOn(catalogApi, "loadCategories").mockResolvedValue(mockCategories);
    vi.spyOn(catalogApi, "loadProducts").mockRejectedValue(
      new Error("Network connection lost. Please check connection.")
    );

    render(
      <StoreProvider>
        <ProductGrid />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Unable to load store products")).toBeInTheDocument();
      expect(
        screen.getByText("Network connection lost. Please check connection.")
      ).toBeInTheDocument();
    });

    // Shows Retry button
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();

    // Must never show fallback products on error
    expect(screen.queryByText("Blue Ballpoint Pens")).toBeNull();
    expect(screen.queryByText("Salted Potato Chips")).toBeNull();
  });

  // =========================================================================
  // 5. Unarchived products reappear after refresh/cache invalidation
  // =========================================================================
  it("5. unarchived products reappear after refreshCatalog is triggered", async () => {
    vi.spyOn(catalogApi, "loadCategories").mockResolvedValue(mockCategories);
    const loadProductsMock = vi
      .spyOn(catalogApi, "loadProducts")
      .mockResolvedValueOnce([]) // Initially all archived
      .mockResolvedValueOnce([mockActiveProduct]); // Unarchived product appears on refresh

    function Consumer() {
      const { refreshCatalog } = useStore();
      return (
        <div>
          <button onClick={() => refreshCatalog()} data-testid="manual-refresh">
            Refresh
          </button>
          <ProductGrid />
        </div>
      );
    }

    render(
      <StoreProvider>
        <Consumer />
      </StoreProvider>
    );

    // Initial load: 0 products -> empty state
    await waitFor(() => {
      expect(screen.getByText("No products available right now")).toBeInTheDocument();
    });

    // Admin unarchives product and storefront refreshes
    fireEvent.click(screen.getByTestId("manual-refresh"));

    await waitFor(() => {
      expect(screen.getByText("Active Campus Chips")).toBeInTheDocument();
      expect(screen.queryByText("No products available right now")).toBeNull();
    });

    expect(loadProductsMock).toHaveBeenCalledTimes(2);
  });

  // =========================================================================
  // 6. Search and category pages exclude archived products
  // =========================================================================
  it("6. category view shows category-specific empty state when that category has no active items", async () => {
    // Only 1 item in stationery, none in snacks
    vi.spyOn(catalogApi, "loadCategories").mockResolvedValue(mockCategories);
    vi.spyOn(catalogApi, "loadProducts").mockResolvedValue([mockSecondActiveProduct]);

    function FilterConsumer() {
      const { setCategory } = useStore();
      return (
        <div>
          <button onClick={() => setCategory("snacks")} data-testid="select-snacks">
            Select Snacks
          </button>
          <ProductGrid />
        </div>
      );
    }

    render(
      <StoreProvider>
        <FilterConsumer />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Active Ballpoint Pen")).toBeInTheDocument();
    });

    // Switch to category that has no active products
    fireEvent.click(screen.getByTestId("select-snacks"));

    await waitFor(() => {
      expect(
        screen.getByText("No products available in Snacks & Munchies")
      ).toBeInTheDocument();
      expect(
        screen.getByText("We don't have any items in this category right now. Check back soon or explore other essentials.")
      ).toBeInTheDocument();
    });

    // Click "View all products"
    fireEvent.click(screen.getByRole("button", { name: /view all products/i }));

    await waitFor(() => {
      expect(screen.getByText("Active Ballpoint Pen")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 7. Archived products cannot be purchased through checkout
  // =========================================================================
  it("7. blocks checkout and displays warning when an item in cart was archived", async () => {
    vi.spyOn(catalogApi, "loadCategories").mockResolvedValue(mockCategories);
    vi.spyOn(catalogApi, "loadProducts").mockResolvedValue([mockActiveProduct]);

    // Simulate pre-existing cart with an archived product ID ("archived-prod-id")
    localStorage.setItem(
      "shiptmart.cart",
      JSON.stringify([{ productId: "archived-prod-id", quantity: 2 }])
    );

    render(
      <StoreProvider>
        <CartDrawer />
        <CheckoutForm />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
    });

    // Checkout button is disabled and displays warning
    const checkoutBtn = screen.getByRole("button", { name: /remove unavailable items/i });
    expect(checkoutBtn).toBeDisabled();
  });

  // =========================================================================
  // 8. Admins can view and restore archived products in ProductTable
  // =========================================================================
  it("8. allows admins to view archived products and toggle restore", async () => {
    const mockDbProducts: DBProduct[] = [
      {
        id: "prod-archived-1",
        name: "Archived Blue Pen",
        size: "Pack of 3",
        description: "Old model",
        price: 20,
        original_price: null,
        category_id: "stationery",
        image_url: "/pen.jpg",
        stock: 5,
        bestseller: false,
        is_new: false,
        is_active: false, // Archived
        display_order: 1,
        created_at: new Date().toISOString(),
      },
    ];

    const onRefreshMock = vi.fn().mockResolvedValue(undefined);
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });

    mockFrom.mockImplementation((table: string) => {
      if (table === "products") {
        return {
          update: updateMock,
        };
      }
      return {};
    });

    render(
      <ProductTable
        products={mockDbProducts}
        categories={[{ id: "stationery", name: "Stationery", blurb: "", display_order: 1, is_active: true }]}
        loading={false}
        selectedIds={[]}
        onRefresh={onRefreshMock}
        onOpenCreate={vi.fn()}
        onOpenEdit={vi.fn()}
        onToggleSelect={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
      />
    );

    // Shows Archived status
    expect(screen.getByText("Archived Blue Pen")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();

    // Click Restore button
    const restoreBtn = screen.getByTitle("Restore Product");
    expect(restoreBtn).toBeInTheDocument();

    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("products");
      expect(updateMock).toHaveBeenCalledWith({ is_active: true });
      expect(onRefreshMock).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 9. Existing cart and checkout behavior remains correct for active products
  // =========================================================================
  it("9. allows placing orders normally for active products", async () => {
    vi.spyOn(catalogApi, "loadCategories").mockResolvedValue(mockCategories);
    vi.spyOn(catalogApi, "loadProducts").mockResolvedValue([mockActiveProduct]);
    vi.spyOn(catalogApi, "loadActiveDeliveryBlocks").mockResolvedValue([
      { id: "Block A", name: "Block A", is_active: true },
    ]);

    const placeOrderMock = vi.spyOn(catalogApi, "placeOrder").mockResolvedValue({
      success: true,
      data: {
        order_id: "order-123",
        order_number: "QM-20261029-ABCD",
        guest_tracking_token: "guest_token_12345",
        total_amount: 50,
        status: "placed",
        payment_method: "upi",
        payment_status: "pending",
      },
    });

    function TestCheckout() {
      const { add } = useStore();
      return (
        <div>
          <button onClick={() => add(mockActiveProduct, 2)} data-testid="add-btn">
            Add
          </button>
          <CheckoutForm />
        </div>
      );
    }

    render(
      <StoreProvider>
        <TestCheckout />
      </StoreProvider>
    );

    // Wait for store to load
    await waitFor(() => {
      expect(screen.getByTestId("add-btn")).toBeInTheDocument();
    });

    // Add active product to cart
    fireEvent.click(screen.getByTestId("add-btn"));

    await waitFor(() => {
      expect(screen.getByText(/Customer details/i)).toBeInTheDocument();
    });

    // Fill valid checkout details
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Aarav Sharma" } });
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: "9876543210" } });
    fireEvent.change(screen.getByLabelText(/room \/ unit number/i), { target: { value: "B-204" } });
    fireEvent.change(screen.getByLabelText(/delivery block/i), { target: { value: "Block A" } });

    // Submit order
    const submitBtn = screen.getByRole("button", { name: /place order/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(placeOrderMock).toHaveBeenCalled();
      expect(screen.getByText(/Order Placed Successfully!/i)).toBeInTheDocument();
      expect(screen.getByText("QM-20261029-ABCD")).toBeInTheDocument();
    });
  });
});
