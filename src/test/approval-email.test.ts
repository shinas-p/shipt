import { describe, expect, it, vi, beforeEach } from "vitest";
import { updateSuggestionStatus, retryApprovalNotification, type ProductSuggestion } from "@/lib/suggestions";
import { supabase } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => {
  const mockFrom = vi.fn();
  const mockFunctions = {
    invoke: vi.fn(),
  };

  return {
    supabase: {
      from: mockFrom,
      functions: mockFunctions,
    },
    isSupabaseConfigured: true,
  };
});

describe("Requirement D — Automatic Email After Product Suggestion Approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("1. Automatically triggers notify-suggestion-approved Edge Function when transitioning to approved", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    vi.mocked(supabase.from).mockReturnValue({
      update: mockUpdate,
    } as any);

    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {
        success: true,
        delivered: true,
        sentAt: new Date().toISOString(),
      },
      error: null,
    });

    const res = await updateSuggestionStatus(
      "sug-test-1",
      "approved",
      "Accepted for campus stocking",
      "admin-user-id",
      "pending" // Previous status was pending
    );

    expect(res.success).toBe(true);
    expect(res.emailSent).toBe(true);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(supabase.functions.invoke).toHaveBeenCalledWith("notify-suggestion-approved", {
      body: { suggestionId: "sug-test-1" },
    });
  });

  it("2. Does NOT trigger approval email when status remains unchanged (idempotent)", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    vi.mocked(supabase.from).mockReturnValue({
      update: mockUpdate,
    } as any);

    const res = await updateSuggestionStatus(
      "sug-test-1",
      "approved",
      "Updated notes only",
      "admin-user-id",
      "approved" // Previous status was ALREADY approved
    );

    expect(res.success).toBe(true);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("3. Does NOT trigger approval email when status transitions to reviewed or rejected", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    vi.mocked(supabase.from).mockReturnValue({
      update: mockUpdate,
    } as any);

    // Transition to reviewed
    await updateSuggestionStatus("sug-test-1", "reviewed", "Checking suppliers", "admin-user-id", "pending");
    expect(supabase.functions.invoke).not.toHaveBeenCalled();

    // Transition to rejected
    await updateSuggestionStatus("sug-test-1", "rejected", "Cannot source", "admin-user-id", "reviewed");
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("4. Handles email delivery failure gracefully without reverting product approval", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    vi.mocked(supabase.from).mockReturnValue({
      update: mockUpdate,
    } as any);

    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {
        success: false,
        delivered: false,
        error: "Transactional email provider unconfigured in Supabase (RESEND_API_KEY required).",
      },
      error: null,
    });

    const res = await updateSuggestionStatus(
      "sug-test-fail",
      "approved",
      "Approved",
      "admin-user-id",
      "pending"
    );

    // Approval itself must succeed, while error is captured safely for admin
    expect(res.success).toBe(true);
    expect(res.emailSent).toBe(false);
    expect(res.emailError).toContain("Transactional email provider unconfigured");
  });

  it("5. Allows safe retry of email notification for approved suggestions", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {
        success: true,
        delivered: true,
        sentAt: new Date().toISOString(),
      },
      error: null,
    });

    const res = await retryApprovalNotification("sug-test-retry");
    expect(res.success).toBe(true);
    expect(res.emailSent).toBe(true);
    expect(supabase.functions.invoke).toHaveBeenCalledWith("notify-suggestion-approved", {
      body: { suggestionId: "sug-test-retry" },
    });
  });
});
