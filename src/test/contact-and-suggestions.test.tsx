import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { STORE_CONTACT, getWhatsAppChatLink, cleanPhoneNumber } from "@/data/contact";
import { SuggestProductFab } from "@/components/store/SuggestProductFab";
import { ContactPage } from "@/routes/contact";
import { SuggestProductPage } from "@/routes/suggest-product";
import { Footer } from "@/components/store/Footer";

// Mock router
const mockNavigate = vi.fn();
let mockPath = "/";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPath, search: "", hash: "" }),
  createFileRoute: () => (opts: any) => opts,
}));

// Mock Supabase
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
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "sug-123",
              product_name: "Hostel Kettle 1.5L",
              customer_name: "Rohan",
              customer_email: "rohan@campus.edu",
              status: "pending",
              created_at: new Date().toISOString(),
            },
            error: null,
          }),
        }),
      }),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({
          data: { publicUrl: "https://example.com/photo.jpg" },
        }),
      })),
    },
  },
  isSupabaseConfigured: true,
}));

// Mock customer auth
vi.mock("@/lib/auth", () => ({
  useCustomerAuth: () => ({
    user: { id: "test-user-1", email: "student@campus.edu" },
    profile: { full_name: "Campus Student", phone: "9876543210" },
    isLoading: false,
  }),
}));

describe("Feature A & B — Contact Us, Footer & Floating Product Suggestion FAB", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPath = "/";
  });

  it("1. Contact coordinates match exact requirements", () => {
    expect(STORE_CONTACT.phone).toBe("+91 9605174298");
    expect(STORE_CONTACT.email).toBe("dhemartforyou@gmail.com");
    expect(STORE_CONTACT.whatsapp).toBe("+91 9605174298");

    expect(STORE_CONTACT.phoneHref).toBe("tel:+919605174298");
    expect(STORE_CONTACT.emailHref).toBe("mailto:dhemartforyou@gmail.com");
    expect(STORE_CONTACT.whatsappHref).toBe("https://wa.me/919605174298");
  });

  it("2. WhatsApp link generator creates valid wa.me URLs", () => {
    const link = getWhatsAppChatLink("9605174298", "Hello Shipt Mart");
    expect(link).toContain("https://wa.me/9605174298");
    expect(link).toContain("text=Hello%20Shipt%20Mart");
  });

  it("3. Floating Action Button (FAB) renders with accessible label and navigates to /suggest-product", () => {
    render(<SuggestProductFab />);

    const fab = screen.getByRole("link", { name: /Suggest a Product/i });
    expect(fab).toBeDefined();
    expect(fab.getAttribute("href")).toBe("/suggest-product");
    expect(fab.getAttribute("aria-label")).toBe("Suggest a Product to Shipt Mart");
  });

  it("4. Contact Us page renders phone, email, and WhatsApp links", async () => {
    render(<ContactPage />);

    expect(screen.getByText("We're here to help you")).toBeDefined();

    // Verify WhatsApp button
    const waBtn = screen.getByText("Chat on WhatsApp").closest("a");
    expect(waBtn).toBeDefined();
    expect(waBtn?.getAttribute("href")).toContain("https://wa.me/");

    // Verify Phone button
    const phoneBtn = screen.getByText("Call Helpline").closest("a");
    expect(phoneBtn).toBeDefined();
    expect(phoneBtn?.getAttribute("href")).toContain("tel:+");

    // Verify Email button
    const emailBtn = screen.getByText("Send Email").closest("a");
    expect(emailBtn).toBeDefined();
    expect(emailBtn?.getAttribute("href")).toContain("mailto:");
  });

  it("5. Footer includes Contact Us link to /contact and Suggest a Product link", () => {
    render(<Footer />);

    const contactLink = screen.getByRole("link", { name: "Contact Us" });
    expect(contactLink).toBeDefined();
    expect(contactLink.getAttribute("href")).toBe("/contact");

    const suggestLink = screen.getByRole("link", { name: "Suggest a Product" });
    expect(suggestLink).toBeDefined();
    expect(suggestLink.getAttribute("href")).toBe("/suggest-product");

    // Support contact coordinates in footer
    expect(screen.getByText("+91 9605174298")).toBeDefined();
    expect(screen.getByText("dhemartforyou@gmail.com")).toBeDefined();
  });

  it("6. Suggest Product form inputs start empty with placeholders and validate submission", async () => {
    render(<SuggestProductPage />);

    expect(screen.getByText("Can't find what you need?")).toBeDefined();

    // Verify name and email fields start empty
    const nameInput = screen.getByPlaceholderText("e.g., Andru") as HTMLInputElement;
    const emailInput = screen.getByPlaceholderText("e.g., demo@gmail.com") as HTMLInputElement;

    expect(nameInput.value).toBe("");
    expect(emailInput.value).toBe("");

    // Fill in product name, customer name, and customer email
    const productNameInput = screen.getByPlaceholderText(/Lays Wafer Style/i);
    fireEvent.change(productNameInput, { target: { value: "Organic Dark Chocolate" } });
    fireEvent.change(nameInput, { target: { value: "Andru Campus" } });
    fireEvent.change(emailInput, { target: { value: "andru@campus.edu" } });

    const submitBtn = screen.getByRole("button", { name: /Submit Product Suggestion/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Suggestion Received")).toBeDefined();
    });
  });
});
