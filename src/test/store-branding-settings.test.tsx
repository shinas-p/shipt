import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StoreBrandingTab } from "@/components/admin/StoreBrandingTab";
import { BrandingProvider, DEFAULT_BRANDING, useBranding } from "@/lib/branding";
import { Logo, Header } from "@/components/store/Header";
import { Footer } from "@/components/store/Footer";
import { OpeningLogoAnimation } from "@/components/store/OpeningLogoAnimation";

// Mock Supabase
const { mockUpsert, mockUpload, mockGetPublicUrl } = vi.hoisted(() => {
  return {
    mockUpsert: vi.fn().mockResolvedValue({ error: null }),
    mockUpload: vi.fn().mockResolvedValue({ error: null }),
    mockGetPublicUrl: vi.fn().mockReturnValue({
      data: { publicUrl: "https://example.com/branding/custom-logo.png" },
    }),
  };
});

vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: "super-admin-uid", email: "admin@shipt.campus" } } },
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                store_name: "Shipt Campus Mart",
                tagline: "Speedy Delivery for Hostels",
                logo_url: "https://example.com/logo.png",
                favicon_url: "https://example.com/favicon.ico",
                updated_at: "2026-10-19T10:00:00Z",
              },
              error: null,
            }),
          }),
        }),
        upsert: mockUpsert,
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          upload: mockUpload,
          getPublicUrl: mockGetPublicUrl,
        }),
      },
    },
    isSupabaseConfigured: true,
  };
});

// Mock customer auth & store
vi.mock("@/lib/auth", () => ({
  useCustomerAuth: () => ({
    user: null,
    profile: null,
    isLoading: false,
  }),
}));

vi.mock("@/lib/store", () => ({
  useStore: () => ({
    itemCount: 0,
    wishlist: [],
    wishlistCount: 0,
    savedWishlistProducts: [],
    isWished: () => false,
    setCartOpen: vi.fn(),
    setCategory: vi.fn(),
    search: "",
    setSearch: vi.fn(),
  }),
}));

// Mock tanstack router Link and useNavigate
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

describe("Shipt — Store Branding & App Identity Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("provides sensible default branding when settings are uninitialized", () => {
    function TestConsumer() {
      const { branding } = useBranding();
      return (
        <div>
          <span data-testid="store-name">{branding.store_name}</span>
          <span data-testid="tagline">{branding.tagline}</span>
        </div>
      );
    }

    render(
      <BrandingProvider>
        <TestConsumer />
      </BrandingProvider>
    );

    // Initial render before network or on fallback matches default
    expect(screen.getByTestId("store-name")).toHaveTextContent(DEFAULT_BRANDING.store_name);
    expect(screen.getByTestId("tagline")).toHaveTextContent(DEFAULT_BRANDING.tagline);
  });

  it("renders StoreBrandingTab with full controls for Super Admin", async () => {
    render(
      <BrandingProvider>
        <StoreBrandingTab adminRole="super_admin" />
      </BrandingProvider>
    );

    expect(screen.getByText("Store Branding & App Identity")).toBeInTheDocument();
    expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/store tagline/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByText("Live Storefront Preview")).toBeInTheDocument();
  });

  it("enforces role restriction: blocks Store Managers from modifying branding", () => {
    render(
      <BrandingProvider>
        <StoreBrandingTab adminRole="store_manager" />
      </BrandingProvider>
    );

    expect(screen.getByText(/Store Manager View \(Read-Only\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Only authorized/i)).toBeInTheDocument();
    expect(screen.getByText(/Super Admins/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload logo/i })).not.toBeInTheDocument();
  });

  it("validates logo file upload: rejects invalid mime types and files over 2 MB", async () => {
    render(
      <BrandingProvider>
        <StoreBrandingTab adminRole="super_admin" />
      </BrandingProvider>
    );

    const fileInput = document.getElementById("logo-upload-input") as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    // 1. Invalid MIME type (e.g. text/plain)
    const invalidFile = new File(["dummy content"], "test.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });
    expect(mockUpload).not.toHaveBeenCalled();

    // 2. File exceeding 2 MB (3 MB file)
    const largeContent = new Uint8Array(3 * 1024 * 1024);
    const oversizedFile = new File([largeContent], "huge.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("uploads valid logo image, updates preview, and allows resetting to default icon", async () => {
    render(
      <BrandingProvider>
        <StoreBrandingTab adminRole="super_admin" />
      </BrandingProvider>
    );

    const fileInput = document.getElementById("logo-upload-input") as HTMLInputElement;
    const validFile = new File(["valid image"], "campus-logo.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith(
        expect.stringContaining("branding/logo-"),
        validFile,
        { upsert: true }
      );
    });

    // Check Remove/Reset button is displayed
    const removeBtn = await screen.findByRole("button", { name: /reset to default icon/i });
    expect(removeBtn).toBeInTheDocument();

    fireEvent.click(removeBtn);
    expect(screen.getByText(/Default Icon/i)).toBeInTheDocument();
  });

  it("detects unsaved changes and allows resetting form to last saved values", async () => {
    render(
      <BrandingProvider>
        <StoreBrandingTab adminRole="super_admin" />
      </BrandingProvider>
    );

    const nameInput = screen.getByLabelText(/store name/i);
    fireEvent.change(nameInput, { target: { value: "Completely New Store Name" } });

    // Expect unsaved badge to be shown
    expect(screen.getByText(/^unsaved changes$/i)).toBeInTheDocument();

    // Click Reset Unsaved Changes
    const resetBtn = screen.getByRole("button", { name: /reset unsaved changes/i });
    fireEvent.click(resetBtn);

    // Unsaved badge should disappear
    expect(screen.queryByText(/^unsaved changes$/i)).not.toBeInTheDocument();
  });

  it("updates store branding persistently via updateBranding and saves to Supabase", async () => {
    render(
      <BrandingProvider>
        <StoreBrandingTab adminRole="super_admin" />
      </BrandingProvider>
    );

    const nameInput = screen.getByLabelText(/store name/i);
    const taglineInput = screen.getByLabelText(/store tagline/i);

    fireEvent.change(nameInput, { target: { value: "Shipt Express" } });
    fireEvent.change(taglineInput, { target: { value: "Ultra Fast Campus Delivery" } });

    const saveBtn = screen.getByRole("button", { name: /save changes/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "default",
          store_name: "Shipt Express",
          tagline: "Ultra Fast Campus Delivery",
        }),
        { onConflict: "id" }
      );
    });
  });

  it("renders dynamic branding in Header Logo, Top Announcement, and Footer", () => {
    render(
      <BrandingProvider>
        <Header />
        <Footer />
      </BrandingProvider>
    );

    // Announcement bar contains tagline
    expect(screen.getByText(/Fast doorstep delivery/i)).toBeInTheDocument();
    // Footer contains copyright with current year
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()}`, "i"))).toBeInTheDocument();
  });

  it("renders dynamic branding in OpeningLogoAnimation", () => {
    render(
      <BrandingProvider>
        <OpeningLogoAnimation />
      </BrandingProvider>
    );

    // Checks that the component mounts without throwing and renders brand text
    expect(document.querySelector(".animate-shipt-logo-pop")).toBeInTheDocument();
  });
});
