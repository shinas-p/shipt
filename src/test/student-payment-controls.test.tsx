import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  resolveStudentPaymentPolicy,
  loadStorePaymentSettings,
  updateStorePaymentSettings,
  updateStudentPaymentPolicy,
  recordStudentNoShow,
  restoreStudentCashPrivileges,
  disputeStudentNoShowRecord,
  verifyPaymentTransaction,
  DEFAULT_STORE_PAYMENT_SETTINGS,
} from "@/lib/studentPaymentApi";
import type { StudentProfile, StorePaymentSettings } from "@/lib/types";

// Mock supabase
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      from: (...args: any[]) => mockFrom(...args),
      rpc: (...args: any[]) => mockRpc(...args),
      auth: {
        getSession: vi.fn(),
        getUser: vi.fn(),
      },
    },
    isSupabaseConfigured: true,
  };
});

vi.mock("@/lib/notifications", () => ({
  createAdminNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}));

describe("Feature 1: Student Payment Policies & Trust Controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveStudentPaymentPolicy", () => {
    const baseStoreSettings: StorePaymentSettings = {
      cash_payment_enabled: true,
      online_payment_enabled: true,
      guest_cash_allowed: true,
      max_cash_no_shows_threshold: 2,
    };

    it("evaluates default policy to inherit store-wide settings for registered student", () => {
      const student: Partial<StudentProfile> = {
        payment_policy: "default",
        cash_restricted: false,
      };

      const result = resolveStudentPaymentPolicy(student as StudentProfile, baseStoreSettings, true);
      expect(result.cashAllowed).toBe(true);
      expect(result.onlineAllowed).toBe(true);
      expect(result.policy).toBe("default");
    });

    it("enforces Online Only policy rejecting cash even when cash is globally enabled", () => {
      const student: Partial<StudentProfile> = {
        payment_policy: "online_only",
        cash_restricted: false,
      };

      const result = resolveStudentPaymentPolicy(student as StudentProfile, baseStoreSettings, true);
      expect(result.cashAllowed).toBe(false);
      expect(result.onlineAllowed).toBe(true);
      expect(result.cashReason).toMatch(/Online payment is required for your account/i);
    });

    it("permits Cash + Online when both methods are globally enabled", () => {
      const student: Partial<StudentProfile> = {
        payment_policy: "cash_and_online",
        cash_restricted: false,
      };

      const result = resolveStudentPaymentPolicy(student as StudentProfile, baseStoreSettings, true);
      expect(result.cashAllowed).toBe(true);
      expect(result.onlineAllowed).toBe(true);
    });

    it("enforces Cash Only policy rejecting online payments", () => {
      const student: Partial<StudentProfile> = {
        payment_policy: "cash_only",
        cash_restricted: false,
      };

      const result = resolveStudentPaymentPolicy(student as StudentProfile, baseStoreSettings, true);
      expect(result.cashAllowed).toBe(true);
      expect(result.onlineAllowed).toBe(false);
      expect(result.onlineReason).toMatch(/Cash payment only is configured for your account/i);
    });

    it("overrides student policy when global cash is disabled by store admin", () => {
      const storeWithCashDisabled: StorePaymentSettings = {
        ...baseStoreSettings,
        cash_payment_enabled: false,
      };

      const student: Partial<StudentProfile> = {
        payment_policy: "cash_and_online",
        cash_restricted: false,
      };

      const result = resolveStudentPaymentPolicy(student as StudentProfile, storeWithCashDisabled, true);
      expect(result.cashAllowed).toBe(false);
      expect(result.cashReason).toMatch(/Cash payment is temporarily disabled store-wide/i);
    });

    it("overrides student policy when global online payment is disabled", () => {
      const storeWithOnlineDisabled: StorePaymentSettings = {
        ...baseStoreSettings,
        online_payment_enabled: false,
      };

      const student: Partial<StudentProfile> = {
        payment_policy: "online_only",
        cash_restricted: false,
      };

      const result = resolveStudentPaymentPolicy(student as StudentProfile, storeWithOnlineDisabled, true);
      expect(result.onlineAllowed).toBe(false);
      expect(result.onlineReason).toMatch(/Online payment is currently unavailable store-wide/i);
    });

    it("strictly blocks cash orders when student has cash_restricted = true due to uncollected orders", () => {
      const restrictedStudent: Partial<StudentProfile> = {
        payment_policy: "cash_and_online",
        cash_restricted: true,
        cash_restriction_reason: "2 verified uncollected orders recorded",
      };

      const result = resolveStudentPaymentPolicy(restrictedStudent as StudentProfile, baseStoreSettings, true);
      expect(result.cashAllowed).toBe(false);
      expect(result.cashReason).toContain("2 verified uncollected orders recorded");
      expect(result.onlineAllowed).toBe(true);
    });

    it("applies guest cash policy to unauthenticated visitors", () => {
      const guestSettingsNoCash: StorePaymentSettings = {
        ...baseStoreSettings,
        guest_cash_allowed: false,
      };

      const result = resolveStudentPaymentPolicy(null, guestSettingsNoCash, false);
      expect(result.cashAllowed).toBe(false);
      expect(result.cashReason).toMatch(/Guest cash orders are restricted/i);
      expect(result.onlineAllowed).toBe(true);
    });
  });

  describe("Administrative Policy & Trust APIs", () => {
    it("calls admin_update_student_payment_policy RPC with admin reason and logging", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { success: true, policy: "online_only" },
        error: null,
      });

      const res = await updateStudentPaymentPolicy("user-123", "online_only", "Repeated non-payment warning issued");

      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_update_student_payment_policy", {
        p_student_id: "user-123",
        p_policy: "online_only",
        p_reason: "Repeated non-payment warning issued",
      });
    });

    it("rejects unauthorized policy modification gracefully", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "Unauthorized: only administrators can alter student payment policies." },
      });

      const res = await updateStudentPaymentPolicy("user-123", "online_only");

      expect(res.success).toBe(false);
      expect(res.error).toContain("Unauthorized");
    });

    it("records verified no-show, triggering cash restriction at threshold", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          success: true,
          no_show_count: 2,
          cash_restricted: true,
          message: "No-show recorded. Cash restricted as threshold was reached.",
        },
        error: null,
      });

      const res = await recordStudentNoShow(
        "user-123",
        "order-456",
        "Student confirmed they would not pick up order"
      );

      expect(res.success).toBe(true);
      expect(res.data?.cash_restricted).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_record_student_no_show", {
        p_student_id: "user-123",
        p_order_id: "order-456",
        p_notes: "Student confirmed they would not pick up order",
      });
    });

    it("allows authorized administrators to restore student cash privileges", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { success: true, message: "Cash privileges restored." },
        error: null,
      });

      const res = await restoreStudentCashPrivileges("user-123", "Student met warden and settled outstanding dues");
      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_restore_cash_privileges", {
        p_student_id: "user-123",
        p_reason: "Student met warden and settled outstanding dues",
      });
    });

    it("allows disputing and correcting an incorrectly recorded no-show", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { success: true, disputed: true, remaining_no_shows: 0 },
        error: null,
      });

      const res = await disputeStudentNoShowRecord("rec-789", "Store was closed early due to campus event; not student fault");
      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_dispute_no_show_record", {
        p_record_id: "rec-789",
        p_reason: "Store was closed early due to campus event; not student fault",
      });
    });

    it("updates store-wide payment settings through RPC", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { success: true },
        error: null,
      });

      const res = await updateStorePaymentSettings({
        cash_payment_enabled: false,
        online_payment_enabled: true,
        guest_cash_allowed: false,
        max_cash_no_shows_threshold: 3,
      });

      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_update_store_payment_settings", {
        p_cash_enabled: false,
        p_online_enabled: true,
        p_guest_cash_allowed: false,
        p_threshold: 3,
      });
    });
  });

  describe("Server Payment Verification", () => {
    it("verifies payment through trusted server verification RPC", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          verified: true,
          status: "PAID",
          transaction_id: "upi_txn_987654",
          amount: 250,
        },
        error: null,
      });

      const res = await verifyPaymentTransaction("order-101", "upi_txn_987654");
      expect(res.verified).toBe(true);
      expect(res.status).toBe("PAID");
      expect(mockRpc).toHaveBeenCalledWith("verify_payment_transaction", {
        p_order_id: "order-101",
        p_reference: "upi_txn_987654",
        p_notes: null,
      });
    });

    it("rejects untrusted or unverified payment responses", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "Payment verification failed: transaction not verified" },
      });

      const res = await verifyPaymentTransaction("order-102", "unverified_ref");
      expect(res.verified).toBe(false);
      expect(res.success).toBe(false);
      expect(res.error).toContain("Payment verification failed");
    });
  });
});
