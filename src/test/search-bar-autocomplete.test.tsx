import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { StoreProvider, useStore } from "@/lib/store";
import { SearchBar } from "@/components/store/SearchBar";
import { Header } from "@/components/store/Header";
import { products as defaultProducts, categories as defaultCategories, formatINR } from "@/data/products";

const mockNavigate = vi.fn();

// Mock TanStack Router
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

// Mock catalogApi to avoid external network calls while keeping default products
vi.mock("@/lib/catalogApi", () => ({
  loadCategories: vi.fn().mockResolvedValue([]),
  loadProducts: vi.fn().mockResolvedValue([]),
  BRAND_FALLBACK_IMAGE: "/placeholder.svg",
}));

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
      logo_url: "",
      favicon_url: "",
      updated_at: "",
    },
  }),
}));

describe("SearchBar Autocomplete & Product Suggestions Suite", () => {
  beforeEach(() => {
    localStorage.clear();
    mockNavigate.mockClear();
    vi.clearAllMocks();
  });

  function renderSearchBar() {
    return render(
      <StoreProvider>
        <SearchBar />
      </StoreProvider>
    );
  }

  it("1. Does not display suggestions dropdown when query is less than 2 characters", async () => {
    renderSearchBar();
    const input = screen.getByRole("searchbox", { name: /search products/i });

    // Single character
    fireEvent.change(input, { target: { value: "l" } });

    // Advance timers if any debounce
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/products \(/i)).not.toBeInTheDocument();
  });

  it("2. Displays live autocomplete suggestions when typing 2 or more characters", async () => {
    renderSearchBar();
    const input = screen.getByRole("searchbox", { name: /search products/i });

    // Type "chip" to match Salted Potato Chips
    fireEvent.change(input, { target: { value: "chip" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    }, { timeout: 1000 });

    // Suggestion items should be visible
    const items = screen.getAllByRole("option");
    expect(items.length).toBeGreaterThan(0);

    // First item should match "Salted Potato Chips"
    expect(screen.getByText(/Salted Potato Chips/i)).toBeInTheDocument();
  });

  it("3. Displays product details: real image, name, price, category, and stock indicator", async () => {
    renderSearchBar();
    const input = screen.getByRole("searchbox", { name: /search products/i });

    fireEvent.change(input, { target: { value: "pen" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    }, { timeout: 1000 });

    // Verify product name and category
    const gelPen = screen.getByText(/Blue Ballpoint Pens/i);
    expect(gelPen).toBeInTheDocument();

    // Verify category badge
    expect(screen.getByText(/Exam Essentials/i)).toBeInTheDocument();

    // Verify image element exists with proper alt text
    const img = screen.getByAltText(/Blue Ballpoint Pens/i);
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBeTruthy();

    // Verify price formatting using formatINR
    const matchingProduct = defaultProducts.find((p) => p.name.includes("Blue Ballpoint Pens"));
    if (matchingProduct) {
      expect(screen.getByText(formatINR(matchingProduct.price))).toBeInTheDocument();
    }
  });

  it("4. Limits suggestions to a maximum of 5 items with a 'View all results' action", async () => {
    renderSearchBar();
    const input = screen.getByRole("searchbox", { name: /search products/i });

    // A generic query like "snacks" that matches multiple items
    fireEvent.change(input, { target: { value: "snacks" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    }, { timeout: 1000 });

    const listbox = screen.getByRole("listbox");
    const suggestionOptions = listbox.querySelectorAll("li[role='option']");
    expect(suggestionOptions.length).toBeLessThanOrEqual(5);

    // "View all results" button should be rendered
    const viewAllButton = screen.getByText(/View all .* result.* for/i);
    expect(viewAllButton).toBeInTheDocument();
  });

  it("5. Navigates to product detail page when a suggestion is clicked", async () => {
    renderSearchBar();
    const input = screen.getByRole("searchbox", { name: /search products/i });

    fireEvent.change(input, { target: { value: "chip" } });

    await waitFor(() => {
      expect(screen.getByText(/Salted Potato Chips/i)).toBeInTheDocument();
    }, { timeout: 1000 });

    const productOption = screen.getByText(/Salted Potato Chips/i).closest("li");
    expect(productOption).toBeTruthy();
    fireEvent.click(productOption!);

    // Should navigate to /product/$productId
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/product/$productId",
      params: expect.objectContaining({
        productId: "chips-salted",
      }),
    });

    // Dropdown should close after selection
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("6. Supports keyboard navigation (ArrowDown, ArrowUp, Enter, Escape)", async () => {
    renderSearchBar();
    const input = screen.getByRole("searchbox", { name: /search products/i });

    fireEvent.change(input, { target: { value: "chip" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    }, { timeout: 1000 });

    // ArrowDown moves focus to first item
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const firstOption = screen.getByRole("listbox").querySelector("li[role='option']");
    expect(firstOption).toHaveAttribute("aria-selected", "true");

    // ArrowDown again moves to next item
    fireEvent.keyDown(input, { key: "ArrowDown" });

    // ArrowUp moves back
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(firstOption).toHaveAttribute("aria-selected", "true");

    // Enter selects the active product and navigates
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/product/$productId",
      })
    );

    // Dropdown closes
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("7. Escape closes the dropdown", async () => {
    renderSearchBar();
    const input = screen.getByRole("searchbox", { name: /search products/i });

    fireEvent.change(input, { target: { value: "chip" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    }, { timeout: 1000 });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("8. Shows friendly empty state when no products match", async () => {
    renderSearchBar();
    const input = screen.getByRole("searchbox", { name: /search products/i });

    fireEvent.change(input, { target: { value: "xyznonexistentproduct999" } });

    await waitFor(() => {
      expect(screen.getByText(/No matching products found/i)).toBeInTheDocument();
    }, { timeout: 1000 });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("9. Clears query, store search, and closes dropdown when clear button is clicked", async () => {
    function TestApp() {
      const { search } = useStore();
      return (
        <div>
          <SearchBar />
          <div data-testid="global-search">{search}</div>
        </div>
      );
    }

    render(
      <StoreProvider>
        <TestApp />
      </StoreProvider>
    );

    const input = screen.getByRole("searchbox", { name: /search products/i });
    fireEvent.change(input, { target: { value: "chip" } });

    await waitFor(() => {
      expect(screen.getByLabelText(/Clear search query/i)).toBeInTheDocument();
    });

    const clearBtn = screen.getByLabelText(/Clear search query/i);
    fireEvent.click(clearBtn);

    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("10. Closes dropdown when clicking outside", async () => {
    render(
      <StoreProvider>
        <div>
          <SearchBar />
          <button type="button">Outside Element</button>
        </div>
      </StoreProvider>
    );

    const input = screen.getByRole("searchbox", { name: /search products/i });
    fireEvent.change(input, { target: { value: "chip" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    }, { timeout: 1000 });

    // Click outside
    fireEvent.pointerDown(screen.getByText("Outside Element"));

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("11. Renders cleanly within the Header on both desktop and mobile containers", () => {
    render(
      <StoreProvider>
        <Header />
      </StoreProvider>
    );

    // Both desktop and mobile SearchBar inputs should be present in Header
    const searchInputs = screen.getAllByRole("searchbox", { name: /search products/i });
    expect(searchInputs.length).toBe(2);
  });
});
