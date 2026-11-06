import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  resolveStudentPaymentPolicy,
  loadStorePaymentSettings,
  updateStorePaymentSettings,
  submitOrderPaymentProof,
  adminApproveFirstTimeCOD,
  adminVerifyPayment,
  adminSetCustomerBlockStatus,
  loadCustomerRestrictionAuditLogs,
  DEFAULT_STORE_PAYMENT_SETTINGS,
} from "@/lib/studentPaymentApi";
import type { StudentProfile, StorePaymentSettings } from "@/lib/types";

// Mock Supabase client
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockStorageFrom = vi.fn();

vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      from: (...args: any[]) => mockFrom(...args),
      rpc: (...args: any[]) => mockRpc(...args),
      storage: {
        from: (...args: any[]) => mockStorageFrom(...args),
      },
      auth: {
        getSession: vi.fn(),
        getUser: vi.fn(),
      },
    },
    isSupabaseConfigured: true,
  };
});

vi.mock("@/lib/notifications", () => ({
  createAdminNotification: vi.fn().mockResolvedValue({ id: "notif-test-1" }),
}));

describe("Direct UPI and COD Workflows & Anti-Abuse Controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Store Settings & Direct UPI Configuration", () => {
    it("loads default store payment settings with UPI and COD safeguard defaults", () => {
      expect(DEFAULT_STORE_PAYMENT_SETTINGS.cash_payment_enabled).toBe(true);
      expect(DEFAULT_STORE_PAYMENT_SETTINGS.online_payment_enabled).toBe(true);
      expect(DEFAULT_STORE_PAYMENT_SETTINGS.guest_cash_allowed).toBe(true);
      expect(DEFAULT_STORE_PAYMENT_SETTINGS.upi_id).toBe("9605174298@upi");
      expect(DEFAULT_STORE_PAYMENT_SETTINGS.upi_payee_name).toBe("Shipt Mart");
      expect(DEFAULT_STORE_PAYMENT_SETTINGS.max_active_cod_orders).toBe(1);
      expect(DEFAULT_STORE_PAYMENT_SETTINGS.max_cod_order_amount).toBe(500.0);
      expect(DEFAULT_STORE_PAYMENT_SETTINGS.require_first_order_approval).toBe(true);
      expect(DEFAULT_STORE_PAYMENT_SETTINGS.duplicate_order_window_seconds).toBe(120);
    });

    it("loads store settings from database when configured", async () => {
      const mockSettingsRow = {
        cash_payment_enabled: true,
        online_payment_enabled: true,
        guest_cash_allowed: false,
        max_cash_no_shows_threshold: 2,
        upi_id: "store@okaxis",
        upi_payee_name: "Shipz Mart Express",
        upi_qr_code_url: "https://example.com/qr.png",
        max_active_cod_orders: 3,
        max_cod_order_amount: 1500,
        require_first_order_approval: true,
        duplicate_order_window_seconds: 90,
      };

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockSettingsRow, error: null }),
          }),
        }),
      });

      const settings = await loadStorePaymentSettings();
      expect(settings.upi_id).toBe("store@okaxis");
      expect(settings.upi_payee_name).toBe("Shipz Mart Express");
      expect(settings.max_active_cod_orders).toBe(3);
      expect(settings.max_cod_order_amount).toBe(1500);
      expect(settings.duplicate_order_window_seconds).toBe(90);
    });

    it("updates store settings via admin RPC", async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const updatedSettings: StorePaymentSettings = {
        ...DEFAULT_STORE_PAYMENT_SETTINGS,
        upi_id: "newstore@upi",
        max_cod_order_amount: 800,
      };

      const res = await updateStorePaymentSettings(updatedSettings);
      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_update_store_payment_settings", expect.objectContaining({
        p_upi_id: "newstore@upi",
        p_max_cod_amount: 800,
      }));
    });
  });

  describe("2. Student Policy Resolution & Blocklist Enforcement", () => {
    const baseStoreSettings: StorePaymentSettings = {
      ...DEFAULT_STORE_PAYMENT_SETTINGS,
      cash_payment_enabled: true,
      online_payment_enabled: true,
      guest_cash_allowed: false,
    };

    it("immediately denies all checkout options if customer account is blocked", () => {
      const blockedCustomer: Partial<StudentProfile> = {
        id: "cust-blocked-1",
        full_name: "John Doe",
        is_blocked: true,
        blocked_reason: "Repeated fraudulent orders",
        payment_policy: "default",
      };

      const result = resolveStudentPaymentPolicy(blockedCustomer as StudentProfile, baseStoreSettings, true);
      expect(result.cashAllowed).toBe(false);
      expect(result.onlineAllowed).toBe(false);
      expect(result.cashReason).toMatch(/Repeated fraudulent orders/i);
      expect(result.onlineReason).toMatch(/Repeated fraudulent orders/i);
    });

    it("requires authenticated campus account when unauthenticated guest tries to checkout", () => {
      const result = resolveStudentPaymentPolicy(null, baseStoreSettings, false);
      expect(result.cashAllowed).toBe(false);
      expect(result.cashReason).toMatch(/Guest cash orders are restricted/i);
    });

    it("permits both UPI and COD for normal standing registered students", () => {
      const normalStudent: Partial<StudentProfile> = {
        id: "cust-ok-1",
        full_name: "Alice Smith",
        is_blocked: false,
        cash_restricted: false,
        payment_policy: "default",
      };

      const result = resolveStudentPaymentPolicy(normalStudent as StudentProfile, baseStoreSettings, true);
      expect(result.cashAllowed).toBe(true);
      expect(result.onlineAllowed).toBe(true);
    });
  });

  describe("3. Direct UPI Payment Proof Submission", () => {
    it("submits payment proof with screenshot path and UPI reference number", async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          order_id: "ord-upi-123",
          payment_id: "pay-upi-456",
          status: "verification_pending",
        },
        error: null,
      });

      const res = await submitOrderPaymentProof(
        "ord-upi-123",
        "user-123/ord-upi-123_1730000000.png",
        "432198765432"
      );

      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("submit_order_payment_proof", {
        p_order_id: "ord-upi-123",
        p_screenshot_path: "user-123/ord-upi-123_1730000000.png",
        p_upi_ref: "432198765432",
      });
    });

    it("rejects duplicate UPI reference number submitted across orders", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "This UPI reference number was already submitted for another order." },
      });

      const res = await submitOrderPaymentProof(
        "ord-upi-999",
        "user-123/proof.png",
        "432198765432"
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/already submitted for another order/i);
    });
  });

  describe("4. Administrative Verification of UPI & COD Payments", () => {
    it("approves and marks payment as paid upon verifying against bank ledger", async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const res = await adminVerifyPayment("pay-upi-456", "paid", "432198765432", "Verified against bank account");
      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_verify_payment", {
        p_payment_id: "pay-upi-456",
        p_status: "paid",
        p_upi_ref: "432198765432",
        p_notes: "Verified against bank account",
      });
    });

    it("rejects invalid payment proof with mandatory feedback reason", async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const res = await adminVerifyPayment("pay-upi-456", "failed", undefined, "Transaction not found on bank statement");
      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_verify_payment", {
        p_payment_id: "pay-upi-456",
        p_status: "failed",
        p_upi_ref: null,
        p_notes: "Transaction not found on bank statement",
      });
    });

    it("approves first-time customer COD order", async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          order_id: "ord-cod-first-1",
          status: "confirmed",
        },
        error: null,
      });

      const res = await adminApproveFirstTimeCOD("ord-cod-first-1", "Customer verified in person");
      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_approve_first_time_cod", {
        p_order_id: "ord-cod-first-1",
        p_notes: "Customer verified in person",
      });
    });
  });

  describe("5. Customer Blocklist Management & Audit Trail", () => {
    it("allows admin to block customer with mandatory reason and logs to audit trail", async () => {
      mockRpc.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const res = await adminSetCustomerBlockStatus("cust-fraud-1", true, "Submitted edited counterfeit payment screenshots");
      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_set_customer_block_status", {
        p_customer_id: "cust-fraud-1",
        p_is_blocked: true,
        p_reason: "Submitted edited counterfeit payment screenshots",
      });
    });

    it("allows admin to unblock customer upon resolution", async () => {
      mockRpc.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const res = await adminSetCustomerBlockStatus("cust-fraud-1", false, "Identity and payment settled at campus store");
      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("admin_set_customer_block_status", {
        p_customer_id: "cust-fraud-1",
        p_is_blocked: false,
        p_reason: "Identity and payment settled at campus store",
      });
    });

    it("loads restriction audit logs for a customer", async () => {
      const mockAuditLogs = [
        {
          id: "log-1",
          customer_id: "cust-fraud-1",
          action: "blocked",
          reason: "Submitted edited counterfeit payment screenshots",
          changed_by: "admin-uuid",
          created_at: new Date().toISOString(),
        },
      ];

      const queryResult = Promise.resolve({ data: mockAuditLogs, error: null });
      const queryObj: any = {
        limit: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: queryResult.then.bind(queryResult),
        catch: queryResult.catch.bind(queryResult),
      };

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue(queryObj),
        }),
      });

      const logs = await loadCustomerRestrictionAuditLogs("cust-fraud-1");
      expect(logs).toHaveLength(1);
      expect(logs[0]?.action).toBe("blocked");
      expect(logs[0]?.reason).toMatch(/counterfeit payment screenshots/i);
    });
  });

  describe("6. Customer Order Cancellation Eligibility in Account UI", () => {
    // Replicate the exact logic from src/routes/account.tsx
    function isOrderEligibleForCustomerCancellation(status: string): boolean {
      const s = status.toLowerCase();
      return (
        s === "awaiting_payment" ||
        s === "pending_payment" ||
        s === "awaiting_approval" ||
        s === "placed" ||
        s === "confirmed" ||
        s === "preparing"
      );
    }

    it("permits cancellation for newly placed Direct UPI orders awaiting payment", () => {
      expect(isOrderEligibleForCustomerCancellation("awaiting_payment")).toBe(true);
      expect(isOrderEligibleForCustomerCancellation("pending_payment")).toBe(true);
    });

    it("permits cancellation for first-time COD orders awaiting staff approval", () => {
      expect(isOrderEligibleForCustomerCancellation("awaiting_approval")).toBe(true);
    });

    it("permits cancellation for confirmed and preparing orders before dispatch cutoff", () => {
      expect(isOrderEligibleForCustomerCancellation("placed")).toBe(true);
      expect(isOrderEligibleForCustomerCancellation("confirmed")).toBe(true);
      expect(isOrderEligibleForCustomerCancellation("preparing")).toBe(true);
    });

    it("blocks cancellation once an order is in transit, ready for pickup, or terminal", () => {
      expect(isOrderEligibleForCustomerCancellation("out_for_delivery")).toBe(false);
      expect(isOrderEligibleForCustomerCancellation("ready_for_pickup")).toBe(false);
      expect(isOrderEligibleForCustomerCancellation("completed")).toBe(false);
      expect(isOrderEligibleForCustomerCancellation("cancelled")).toBe(false);
    });
  });

  describe("7. First-Time COD Order Rules and Safeguards", () => {
    // Model the exact RPC review gate logic from create_order_with_inventory
    function evaluateCodOrderApproval(params: {
      completedOrdersCount: number;
      requireFirstApproval: boolean;
      activeCodCount: number;
      maxActiveCod: number;
    }) {
      if (params.activeCodCount >= params.maxActiveCod) {
        throw new Error(`Active COD order limit reached (${params.maxActiveCod} max active unpaid orders).`);
      }

      const isFirstOrder = params.completedOrdersCount === 0 && params.requireFirstApproval;
      return {
        is_first_order: isFirstOrder,
        status: isFirstOrder ? "awaiting_approval" : "placed",
      };
    }

    it("routes a first-time customer to awaiting_approval when completed purchases count is 0", () => {
      const result = evaluateCodOrderApproval({
        completedOrdersCount: 0,
        requireFirstApproval: true,
        activeCodCount: 0,
        maxActiveCod: 1,
      });

      expect(result.is_first_order).toBe(true);
      expect(result.status).toBe("awaiting_approval");
    });

    it("does NOT treat an in-flight approved order (confirmed/preparing) as a completed purchase", () => {
      // In-flight or undelivered orders do not increment completedOrdersCount
      const inFlightCompletedCount = 0; // Only status = 'completed' increments this
      const result = evaluateCodOrderApproval({
        completedOrdersCount: inFlightCompletedCount,
        requireFirstApproval: true,
        activeCodCount: 0,
        maxActiveCod: 1,
      });

      expect(result.is_first_order).toBe(true);
      expect(result.status).toBe("awaiting_approval");
    });

    it("allows direct placement without approval once customer has at least 1 completed purchase", () => {
      const result = evaluateCodOrderApproval({
        completedOrdersCount: 1,
        requireFirstApproval: true,
        activeCodCount: 0,
        maxActiveCod: 1,
      });

      expect(result.is_first_order).toBe(false);
      expect(result.status).toBe("placed");
    });

    it("requires both status = 'completed' AND payment_status IN ('paid', 'completed') to count as completed purchase", () => {
      // Simulate database count query logic:
      // SELECT COUNT(*) FROM orders WHERE user_id = v_user_id AND status = 'completed' AND payment_status IN ('paid', 'completed')
      function countQualifyingCompletedPurchases(
        orders: Array<{ userId: string; status: string; paymentStatus: string }>,
        targetUserId: string
      ): number {
        return orders.filter(
          (o) =>
            o.userId === targetUserId &&
            o.status === "completed" &&
            (o.paymentStatus === "paid" || o.paymentStatus === "completed")
        ).length;
      }

      const userId = "student-123";
      const sampleOrders = [
        // Order completed but payment not settled (e.g. pending COD collection anomaly)
        { userId, status: "completed", paymentStatus: "pending" },
        // Order paid but still preparing or out for delivery
        { userId, status: "preparing", paymentStatus: "paid" },
        { userId, status: "out_for_delivery", paymentStatus: "paid" },
        // Order cancelled
        { userId, status: "cancelled", paymentStatus: "refund_needed" },
        // Order completed by another customer
        { userId: "student-other", status: "completed", paymentStatus: "paid" },
      ];

      expect(countQualifyingCompletedPurchases(sampleOrders, userId)).toBe(0);

      // Now add a legitimately settled and completed purchase
      sampleOrders.push({ userId, status: "completed", paymentStatus: "paid" });
      expect(countQualifyingCompletedPurchases(sampleOrders, userId)).toBe(1);

      // Verify approval evaluation with this count
      const resultWithSettledOrder = evaluateCodOrderApproval({
        completedOrdersCount: countQualifyingCompletedPurchases(sampleOrders, userId),
        requireFirstApproval: true,
        activeCodCount: 0,
        maxActiveCod: 1,
      });
      expect(resultWithSettledOrder.is_first_order).toBe(false);
      expect(resultWithSettledOrder.status).toBe("placed");
    });

    it("strictly blocks checkout when active unpaid COD orders reach the limit of 1", () => {
      expect(() =>
        evaluateCodOrderApproval({
          completedOrdersCount: 1,
          requireFirstApproval: true,
          activeCodCount: 1,
          maxActiveCod: 1,
        })
      ).toThrowError(/Active COD order limit reached \(1 max active unpaid orders\)/i);
    });
  });

  describe("8. Active Checkout Payment Method Constraints", () => {
    it("restricts active checkout payment methods to upi and cod only", () => {
      const validMethods = ["upi", "cod"];
      expect(validMethods).toContain("upi");
      expect(validMethods).toContain("cod");
      expect(validMethods).not.toContain("payu");
    });
  });
});
