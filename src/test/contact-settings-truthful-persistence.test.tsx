import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ContactSettingsView } from "@/components/admin/ContactSettingsView";
import { CONTACT_STORAGE_KEY } from "@/data/contact";

// Router mock
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/admin", search: "", hash: "" }),
}));

// Supabase mock handles
let mockSelectResponse: { data: any; error: any } = {
  data: {
    contact_phone: "+91 9605174298",
    contact_email: "dhemartforyou@gmail.com",
    contact_whatsapp: "+91 9605174298",
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

describe("Shipt Mart — Contact Settings Truthful Persistence Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSelectResponse = {
      data: {
        contact_phone: "+91 9605174298",
        contact_email: "dhemartforyou@gmail.com",
        contact_whatsapp: "+91 9605174298",
      },
      error: null,
    };
    mockUpdateResponse = { error: null };
  });

  it("1. Confirmed database save: shows success banner and persists to Supabase", async () => {
    mockUpdateResponse = { error: null };

    render(<ContactSettingsView adminRole="super_admin" />);

    const phoneInput = screen.getByLabelText(/Support Phone Number/i) as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "+91 9876543210" } });

    const saveBtn = screen.getByRole("button", { name: /Save Contact Settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // Must show the confirmed database save banner
      expect(screen.getByText(/Contact coordinates successfully updated and saved to database!/i)).toBeDefined();
    });

    // Local-only warning must NOT be shown
    expect(screen.queryByText(/Saved Locally in Browser Only/i)).toBeNull();
  });

  it("2. Missing-column database failure: local-only fallback NEVER produces a database success message and displays clear warning", async () => {
    // Simulate PostgreSQL 42703 (missing column on store_settings) for both select and update
    mockSelectResponse = {
      data: null,
      error: {
        code: "42703",
        message: "column store_settings.contact_phone does not exist",
      },
    };
    mockUpdateResponse = {
      error: {
        code: "42703",
        message: "column store_settings.contact_phone does not exist",
      },
    };

    render(<ContactSettingsView adminRole="super_admin" />);

    const phoneInput = screen.getByLabelText(/Support Phone Number/i) as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "+91 9123456780" } });

    const saveBtn = screen.getByRole("button", { name: /Save Contact Settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // Must show the amber local-only fallback warning banner
      expect(screen.getByText(/Saved Locally in Browser Only/i)).toBeDefined();
      expect(screen.getByText(/Database migration required/i)).toBeDefined();

      // Verify local storage was updated so current browser isn't broken
      const cached = localStorage.getItem(CONTACT_STORAGE_KEY);
      expect(cached).not.toBeNull();
      expect(JSON.parse(cached!).phone).toBe("+91 9123456780");
    });

    // CRITICAL: Must NEVER display the database success banner!
    expect(screen.queryByText(/saved to database/i)).toBeNull();
    expect(screen.queryByText(/successfully updated across the store/i)).toBeNull();
  });

  it("3. Schema-cache / PGRST204 failure: also correctly routes to local-only warning", async () => {
    mockSelectResponse = {
      data: null,
      error: {
        code: "PGRST204",
        message: "Could not find the 'contact_email' column of 'store_settings' in the schema cache",
      },
    };
    mockUpdateResponse = {
      error: {
        code: "PGRST204",
        message: "Could not find the 'contact_email' column of 'store_settings' in the schema cache",
      },
    };

    render(<ContactSettingsView adminRole="super_admin" />);

    const emailInput = screen.getByLabelText(/Support Email/i) as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "support@shiptmart.com" } });

    const saveBtn = screen.getByRole("button", { name: /Save Contact Settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Saved Locally in Browser Only/i)).toBeDefined();
    });

    expect(screen.queryByText(/saved to database/i)).toBeNull();
  });

  it("4. Non-schema database error (e.g. network/permission): displays error banner and no success", async () => {
    mockUpdateResponse = {
      error: {
        code: "42501",
        message: "new row violates row-level security policy for table store_settings",
      },
    };

    render(<ContactSettingsView adminRole="super_admin" />);

    const saveBtn = screen.getByRole("button", { name: /Save Contact Settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/row-level security policy/i)).toBeDefined();
    });

    // Neither success nor local-only warning should be shown
    expect(screen.queryByText(/saved to database/i)).toBeNull();
    expect(screen.queryByText(/Saved Locally in Browser Only/i)).toBeNull();
  });

  it("5. Initial load when remote columns are missing: displays Database Columns Pending Migration notice", async () => {
    mockSelectResponse = {
      data: null,
      error: {
        code: "42703",
        message: "column store_settings.contact_phone does not exist",
      },
    };

    render(<ContactSettingsView adminRole="super_admin" />);

    await waitFor(() => {
      expect(screen.getByText(/Database Columns Pending Migration/i)).toBeDefined();
      expect(screen.getByText(/20261026000000_contact_and_suggestions.sql/i)).toBeDefined();
    });
  });
});
