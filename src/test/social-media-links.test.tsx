import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { validateSocialUrl, SOCIAL_STORAGE_KEY } from "@/lib/social";
import { Footer } from "@/components/store/Footer";
import { SocialSettingsView } from "@/components/admin/SocialSettingsView";

// Router mock
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/", search: "", hash: "" }),
}));

// Mock catalog context
vi.mock("@/context/CatalogContext", () => ({
  useCatalog: () => ({
    categories: [
      { id: "all", name: "All Products" },
      { id: "snacks", name: "Snacks" },
    ],
    selectedCategory: "all",
    setSelectedCategory: vi.fn(),
    searchQuery: "",
    setSearchQuery: vi.fn(),
  }),
}));

// Supabase mock handles
let mockSelectResponse: { data: any; error: any } = {
  data: {
    social_whatsapp: null,
    social_instagram: null,
    social_facebook: null,
  },
  error: null,
};

let mockUpdateResponse: { error: any } = { error: null };

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      update: vi.fn(() => ({
        eq: vi.fn().mockImplementation(() => Promise.resolve(mockUpdateResponse)),
      })),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(mockSelectResponse)),
    })),
  },
  isSupabaseConfigured: true,
}));

describe("Shipt Mart — Configurable Social Media Links Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSelectResponse = {
      data: {
        social_whatsapp: null,
        social_instagram: null,
        social_facebook: null,
      },
      error: null,
    };
    mockUpdateResponse = { error: null };
  });

  describe("1. URL Validation & Permitted Hosts", () => {
    it("accepts valid WhatsApp channels and invite links", () => {
      expect(validateSocialUrl("whatsapp", "https://whatsapp.com/channel/0029Va4K").isValid).toBe(true);
      expect(validateSocialUrl("whatsapp", "https://chat.whatsapp.com/invite123").isValid).toBe(true);
      expect(validateSocialUrl("whatsapp", "https://wa.me/919605174298").isValid).toBe(true);
      expect(validateSocialUrl("whatsapp", "").isValid).toBe(true); // empty is valid (clearing)
    });

    it("rejects invalid hosts or schemes for WhatsApp", () => {
      const wrongHost = validateSocialUrl("whatsapp", "https://not-whatsapp.com/channel/123");
      expect(wrongHost.isValid).toBe(false);
      expect(wrongHost.error).toContain("whatsapp.com");

      const disallowedScheme = validateSocialUrl("whatsapp", "ftp://whatsapp.com/channel/123");
      expect(disallowedScheme.isValid).toBe(false);

      const maliciousScheme = validateSocialUrl("whatsapp", "javascript:alert(1)");
      expect(maliciousScheme.isValid).toBe(false);
    });

    it("accepts valid Instagram URLs and rejects foreign domains", () => {
      expect(validateSocialUrl("instagram", "https://instagram.com/shiptmart").isValid).toBe(true);
      expect(validateSocialUrl("instagram", "https://www.instagram.com/shipt_campus").isValid).toBe(true);
      expect(validateSocialUrl("instagram", "https://instagr.am/shiptmart").isValid).toBe(true);

      const wrongDomain = validateSocialUrl("instagram", "https://twitter.com/shiptmart");
      expect(wrongDomain.isValid).toBe(false);
      expect(wrongDomain.error).toContain("instagram.com");
    });

    it("accepts valid Facebook URLs and rejects unpermitted domains", () => {
      expect(validateSocialUrl("facebook", "https://facebook.com/shiptmart").isValid).toBe(true);
      expect(validateSocialUrl("facebook", "https://www.facebook.com/groups/shipt").isValid).toBe(true);
      expect(validateSocialUrl("facebook", "https://fb.com/shiptmart").isValid).toBe(true);
      expect(validateSocialUrl("facebook", "https://fb.me/shiptmart").isValid).toBe(true);

      const wrongDomain = validateSocialUrl("facebook", "https://myspace.com/shiptmart");
      expect(wrongDomain.isValid).toBe(false);
      expect(wrongDomain.error).toContain("facebook.com");
    });
  });

  describe("2. Storefront Footer Display & Safety", () => {
    it("hides social links section when no links are configured", async () => {
      render(<Footer />);

      await waitFor(() => {
        expect(screen.queryByText(/Follow Us & Updates/i)).not.toBeInTheDocument();
      });
      expect(screen.queryByLabelText(/Follow our WhatsApp Channel/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Follow us on Instagram/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Follow us on Facebook/i)).not.toBeInTheDocument();
    });

    it("displays only configured links with safe target and accessible aria-labels", async () => {
      const configuredLinks = {
        social_whatsapp: "https://whatsapp.com/channel/test123",
        social_instagram: "https://instagram.com/test_shipt",
        social_facebook: null,
      };
      mockSelectResponse = { data: configuredLinks, error: null };
      localStorage.setItem(
        SOCIAL_STORAGE_KEY,
        JSON.stringify({
          whatsapp: "https://whatsapp.com/channel/test123",
          instagram: "https://instagram.com/test_shipt",
          facebook: null,
        })
      );

      render(<Footer />);

      await waitFor(() => {
        expect(screen.getByText(/Follow Us & Updates/i)).toBeInTheDocument();
      });

      const waLink = screen.getByLabelText(/Follow our WhatsApp Channel/i) as HTMLAnchorElement;
      expect(waLink).toBeInTheDocument();
      expect(waLink.href).toBe("https://whatsapp.com/channel/test123");
      expect(waLink.target).toBe("_blank");
      expect(waLink.rel).toContain("noopener");
      expect(waLink.rel).toContain("noreferrer");

      const igLink = screen.getByLabelText(/Follow us on Instagram/i) as HTMLAnchorElement;
      expect(igLink).toBeInTheDocument();
      expect(igLink.href).toBe("https://instagram.com/test_shipt");
      expect(igLink.target).toBe("_blank");

      // Facebook is null, so it must NOT be rendered
      expect(screen.queryByLabelText(/Follow us on Facebook/i)).not.toBeInTheDocument();
    });
  });

  describe("3. Admin Social Settings View", () => {
    it("allows Super Admin to edit and save valid social links", async () => {
      mockUpdateResponse = { error: null };

      render(<SocialSettingsView adminRole="super_admin" />);

      const saveBtn = screen.getByRole("button", { name: /Save Social Links/i });
      await waitFor(() => {
        expect(saveBtn).not.toBeDisabled();
      });

      const waInput = screen.getByLabelText(/WhatsApp Channel URL/i) as HTMLInputElement;
      const igInput = screen.getByLabelText(/Instagram Page URL/i) as HTMLInputElement;
      const fbInput = screen.getByLabelText(/Facebook Page URL/i) as HTMLInputElement;

      fireEvent.change(waInput, { target: { value: "https://whatsapp.com/channel/testchannel" } });
      fireEvent.change(igInput, { target: { value: "https://instagram.com/shiptmart_official" } });
      fireEvent.change(fbInput, { target: { value: "https://facebook.com/shiptmart" } });

      fireEvent.submit(saveBtn.closest("form")!);

      await waitFor(() => {
        expect(screen.getByText(/Social media links.*successfully/i)).toBeInTheDocument();
      });

      // Verify localStorage was updated
      const saved = JSON.parse(localStorage.getItem(SOCIAL_STORAGE_KEY) || "{}");
      expect(saved.whatsapp).toBe("https://whatsapp.com/channel/testchannel");
      expect(saved.instagram).toBe("https://instagram.com/shiptmart_official");
      expect(saved.facebook).toBe("https://facebook.com/shiptmart");
    });

    it("prevents saving invalid URLs with inline error feedback", async () => {
      render(<SocialSettingsView adminRole="super_admin" />);

      const saveBtn = screen.getByRole("button", { name: /Save Social Links/i });
      await waitFor(() => {
        expect(saveBtn).not.toBeDisabled();
      });

      const waInput = screen.getByLabelText(/WhatsApp Channel URL/i) as HTMLInputElement;
      fireEvent.change(waInput, { target: { value: "https://invalid-site.com/channel" } });

      // Live validation shows error
      await waitFor(() => {
        expect(screen.getByText(/Invalid hostname for whatsapp/i)).toBeInTheDocument();
      });

      expect(saveBtn).toBeDisabled();
    });

    it("restricts saving for unauthorized admin roles with clear banner", async () => {
      render(<SocialSettingsView adminRole="block_manager" />);

      expect(screen.getByText(/Administrative Permission Required/i)).toBeInTheDocument();
      const saveBtn = screen.getByRole("button", { name: /Save Social Links/i });
      expect(saveBtn).toBeDisabled();
    });

    it("truthfully reports database fallback when Supabase write fails", async () => {
      mockUpdateResponse = { error: { message: "column social_whatsapp does not exist" } };

      render(<SocialSettingsView adminRole="super_admin" />);

      const saveBtn = screen.getByRole("button", { name: /Save Social Links/i });
      await waitFor(() => {
        expect(saveBtn).not.toBeDisabled();
      });

      const waInput = screen.getByLabelText(/WhatsApp Channel URL/i) as HTMLInputElement;
      fireEvent.change(waInput, { target: { value: "https://whatsapp.com/channel/campus" } });

      fireEvent.submit(saveBtn.closest("form")!);

      await waitFor(() => {
        // Truthful warning banner instead of claiming database success
        expect(screen.getByText(/saved in this browser only/i)).toBeInTheDocument();
      });
    });
  });
});
