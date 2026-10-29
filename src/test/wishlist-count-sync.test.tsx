import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StoreProvider, useStore } from "@/lib/store";
import { Header } from "@/components/store/Header";
import { WishlistPage } from "@/routes/wishlist";
import { ProductCard } from "@/components/store/ProductCard";
import { products as defaultProducts } from "@/data/products";

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

// Mock catalogApi to avoid real network requests while providing standard fixture products
vi.mock("@/lib/catalogApi", () => ({
  loadCategories: vi.fn().mockResolvedValue([]),
  loadProducts: vi.fn().mockImplementation(async () => defaultProducts),
  BRAND_FALLBACK_IMAGE: "/placeholder.svg",
}));

// Mock TanStack router
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  createFileRoute: () => (opts: any) => opts,
}));

// Mock reviews API
vi.mock("@/lib/reviewsApi", () => ({
  fetchProductReviews: vi.fn().mockResolvedValue([]),
  calculateReviewSummary: vi.fn().mockReturnValue({
    average_rating: 4.5,
    total_reviews: 12,
  }),
}));

describe("Wishlist Synchronized Count & State System", () => {
  const WISH_KEY = "shiptmart.wishlist";

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("1. Adding product updates header badge count and /wishlist items", async () => {
    // Start with empty wishlist
    const sampleProduct = defaultProducts[0]!; // Spiral Notebook ("notebook-a5")

    function TestApp() {
      const { toggleWish } = useStore();
      return (
        <div>
          <Header />
          <WishlistPage />
          <button
            data-testid="add-btn"
            onClick={() => toggleWish(sampleProduct)}
          >
            Add To Wishlist
          </button>
        </div>
      );
    }

    render(
      <StoreProvider>
        <TestApp />
      </StoreProvider>
    );

    // Initial empty state after catalog mount
    await waitFor(() => {
      expect(screen.getByText(/your wishlist is empty/i)).toBeInTheDocument();
      expect(screen.queryByText("1")).not.toBeInTheDocument();
    });

    // Click add to wishlist
    fireEvent.click(screen.getByTestId("add-btn"));

    // Header badge displays 1 and wishlist page shows product
    await waitFor(() => {
      const wishlistLink = screen.getByTitle("Saved Wishlist");
      expect(wishlistLink.querySelector(".bg-destructive")).toHaveTextContent("1");
      expect(screen.getByText("Spiral Notebook")).toBeInTheDocument();
      expect(screen.queryByText(/your wishlist is empty/i)).not.toBeInTheDocument();
    });
  });

  it("2. Saved products render on /wishlist with price, image, and action buttons", async () => {
    // Seed localStorage with a product
    localStorage.setItem(WISH_KEY, JSON.stringify(["notebook-a5"]));

    render(
      <StoreProvider>
        <div>
          <Header />
          <WishlistPage />
        </div>
      </StoreProvider>
    );

    await waitFor(() => {
      // Product title
      expect(screen.getByText("Spiral Notebook")).toBeInTheDocument();
      // Formatted price (₹60)
      expect(screen.getByText("₹60")).toBeInTheDocument();
      // Product image exists with alt text
      const img = screen.getByAltText("Spiral Notebook");
      expect(img).toBeInTheDocument();
      // Action buttons: "Add" and "Remove from wishlist"
      expect(screen.getByLabelText(/remove spiral notebook from wishlist/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^add$/i })).toBeInTheDocument();
    });
  });

  it("3. Removing a product from /wishlist updates badge count and removes item", async () => {
    localStorage.setItem(WISH_KEY, JSON.stringify(["notebook-a5"]));

    render(
      <StoreProvider>
        <div>
          <Header />
          <WishlistPage />
        </div>
      </StoreProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Spiral Notebook")).toBeInTheDocument();
      const wishlistLink = screen.getByTitle("Saved Wishlist");
      expect(wishlistLink.querySelector(".bg-destructive")).toHaveTextContent("1");
    });

    // Click remove button on the wishlist item
    const removeBtn = screen.getByLabelText(/remove spiral notebook from wishlist/i);
    fireEvent.click(removeBtn);

    // Badge disappears and empty state is rendered
    await waitFor(() => {
      const wishlistLink = screen.getByTitle("Saved Wishlist");
      expect(wishlistLink.querySelector(".bg-destructive")).toBeNull();
      expect(screen.getByText(/your wishlist is empty/i)).toBeInTheDocument();
      expect(screen.queryByText("Spiral Notebook")).not.toBeInTheDocument();
    });
  });

  it("4. Toggling from product card reflects in header badge immediately", async () => {
    const sampleProduct = defaultProducts[1]!; // Blue Ballpoint Pens ("pen-blue-3")

    function TestCardAndHeader() {
      return (
        <div>
          <Header />
          <ProductCard product={sampleProduct} />
        </div>
      );
    }

    render(
      <StoreProvider>
        <TestCardAndHeader />
      </StoreProvider>
    );

    const wishlistLink = screen.getByTitle("Saved Wishlist");
    expect(wishlistLink.querySelector(".bg-destructive")).toBeNull();

    // Toggle on from ProductCard
    const heartBtn = screen.getByLabelText(/add blue ballpoint pens to wishlist/i);
    fireEvent.click(heartBtn);

    await waitFor(() => {
      expect(wishlistLink.querySelector(".bg-destructive")).toHaveTextContent("1");
      expect(heartBtn).toHaveAttribute("aria-pressed", "true");
    });

    // Toggle off from ProductCard
    fireEvent.click(heartBtn);

    await waitFor(() => {
      expect(wishlistLink.querySelector(".bg-destructive")).toBeNull();
      expect(heartBtn).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("5. Page reload preserves wishlist state without mismatch", async () => {
    // Simulate previous session with 2 saved products
    localStorage.setItem(WISH_KEY, JSON.stringify(["notebook-a5", "pen-blue-3"]));

    const { unmount } = render(
      <StoreProvider>
        <div>
          <Header />
          <WishlistPage />
        </div>
      </StoreProvider>
    );

    await waitFor(() => {
      const wishlistLink = screen.getByTitle("Saved Wishlist");
      expect(wishlistLink.querySelector(".bg-destructive")).toHaveTextContent("2");
      expect(screen.getByText("Spiral Notebook")).toBeInTheDocument();
      expect(screen.getByText("Blue Ballpoint Pens")).toBeInTheDocument();
    });

    // Simulate page reload by unmounting and re-mounting
    unmount();

    render(
      <StoreProvider>
        <div>
          <Header />
          <WishlistPage />
        </div>
      </StoreProvider>
    );

    await waitFor(() => {
      const wishlistLink = screen.getByTitle("Saved Wishlist");
      expect(wishlistLink.querySelector(".bg-destructive")).toHaveTextContent("2");
      expect(screen.getByText("Spiral Notebook")).toBeInTheDocument();
      expect(screen.getByText("Blue Ballpoint Pens")).toBeInTheDocument();
    });
  });

  it("6. Stale/unresolvable product IDs do not produce a misleading badge count", async () => {
    // Simulate user having 2 stale/deleted IDs in localStorage
    localStorage.setItem(
      WISH_KEY,
      JSON.stringify(["deleted-product-uuid-111", "non-existent-item-222"])
    );

    render(
      <StoreProvider>
        <div>
          <Header />
          <WishlistPage />
        </div>
      </StoreProvider>
    );

    await waitFor(() => {
      const wishlistLink = screen.getByTitle("Saved Wishlist");
      // Badge must NOT show 2; stale IDs must NOT inflate the badge!
      expect(wishlistLink.querySelector(".bg-destructive")).toBeNull();
      // Wishlist page must show empty state without crashing
      expect(screen.getByText(/your wishlist is empty/i)).toBeInTheDocument();
    });
  });

  it("7. Duplicate IDs in storage are handled without inflating counts", async () => {
    // Simulate duplicate entries in localStorage
    localStorage.setItem(
      WISH_KEY,
      JSON.stringify(["notebook-a5", "notebook-a5", "notebook-a5"])
    );

    render(
      <StoreProvider>
        <div>
          <Header />
          <WishlistPage />
        </div>
      </StoreProvider>
    );

    await waitFor(() => {
      const wishlistLink = screen.getByTitle("Saved Wishlist");
      // Must count unique items only: exactly 1, not 3!
      expect(wishlistLink.querySelector(".bg-destructive")).toHaveTextContent("1");
      expect(screen.getAllByText("Spiral Notebook")).toHaveLength(1);
    });
  });

  it("8. Empty wishlist displays correct empty state and 0 count badge", async () => {
    localStorage.setItem(WISH_KEY, JSON.stringify([]));

    render(
      <StoreProvider>
        <div>
          <Header />
          <WishlistPage />
        </div>
      </StoreProvider>
    );

    await waitFor(() => {
      const wishlistLink = screen.getByTitle("Saved Wishlist");
      expect(wishlistLink.querySelector(".bg-destructive")).toBeNull();
      expect(screen.getByText(/your wishlist is empty/i)).toBeInTheDocument();
      expect(screen.getByText(/continue shopping/i)).toBeInTheDocument();
    });
  });

  it("9. Cross-resolves Supabase seed UUIDs and slug identifiers seamlessly", async () => {
    // Save deterministic seed UUID for Spiral Notebook
    const seedUuid = "a0000000-0000-0000-0000-000000000001";
    localStorage.setItem(WISH_KEY, JSON.stringify([seedUuid]));

    render(
      <StoreProvider>
        <div>
          <Header />
          <WishlistPage />
        </div>
      </StoreProvider>
    );

    await waitFor(() => {
      const wishlistLink = screen.getByTitle("Saved Wishlist");
      expect(wishlistLink.querySelector(".bg-destructive")).toHaveTextContent("1");
      expect(screen.getByText("Spiral Notebook")).toBeInTheDocument();
    });
  });
});
