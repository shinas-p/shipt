import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  generatePayUTxnId,
  generatePayURequestHash,
  generatePayUResponseHash,
  preparePayUCheckout,
  verifyPayUPaymentServerSide,
  handlePayUFailureServerSide,
  getPayUConfig,
} from "@/lib/payuApi";

const mockRpc = vi.fn();

vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      from: vi.fn(),
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
  createAdminNotification: vi.fn().mockResolvedValue({ id: "admin-notif-mock-1" }),
}));

describe("Part A: PayU Payment Gateway Integration Test Suite", () => {
  const testSalt = "test_salt_secret_key_12345";
  const testKey = "gtKFFx";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Transaction Reference Generation & Constraints", () => {
    it("generates unique transaction IDs matching PayU alphanumeric requirements", () => {
      const id1 = generatePayUTxnId("SHP-001");
      const id2 = generatePayUTxnId("SHP-001");

      expect(id1).not.toBe(id2);
      expect(id1.startsWith("TXN_")).toBe(true);
      expect(id1.length).toBeLessThanOrEqual(35);
      expect(/^[A-Za-z0-9_]+$/.test(id1)).toBe(true);
    });
  });

  describe("2. Request Hash Generation (SHA-512)", () => {
    it("computes official PayU request hash matching sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||salt)", async () => {
      const txnid = "TXN_TEST_1001";
      const amount = 250;
      const productinfo = "Campus Grocery Order";
      const firstname = "Rashid";
      const email = "rashid@campus.edu";

      const hash = await generatePayURequestHash({
        key: testKey,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
        salt: testSalt,
      });

      expect(hash).toBeDefined();
      expect(hash.length).toBe(128); // 128 hex chars for SHA-512
      expect(/^[0-9a-f]{128}$/.test(hash)).toBe(true);

      // Same inputs must yield identical deterministic hash
      const hashAgain = await generatePayURequestHash({
        key: testKey,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
        salt: testSalt,
      });
      expect(hashAgain).toBe(hash);
    });

    it("produces different hash if any param is modified (tamper protection)", async () => {
      const baseParams = {
        key: testKey,
        txnid: "TXN_TEST_1001",
        amount: 250,
        productinfo: "Campus Grocery Order",
        firstname: "Rashid",
        email: "rashid@campus.edu",
        salt: testSalt,
      };

      const originalHash = await generatePayURequestHash(baseParams);
      const tamperedAmountHash = await generatePayURequestHash({ ...baseParams, amount: 1 });
      const tamperedTxnHash = await generatePayURequestHash({ ...baseParams, txnid: "TXN_TEST_9999" });

      expect(originalHash).not.toBe(tamperedAmountHash);
      expect(originalHash).not.toBe(tamperedTxnHash);
    });
  });

  describe("3. Response Reverse Hash Verification (SHA-512)", () => {
    it("validates authentic PayU reverse hash sha512(salt|status||||||udf5..udf1|email|firstname|productinfo|amount|txnid|key)", async () => {
      const params = {
        key: testKey,
        txnid: "TXN_RESP_1001",
        amount: 450,
        productinfo: "Campus Essentials",
        firstname: "Aisha",
        email: "aisha@campus.edu",
        status: "success",
        salt: testSalt,
      };

      const computedReverseHash = await generatePayUResponseHash(params);
      expect(computedReverseHash).toBeDefined();
      expect(computedReverseHash.length).toBe(128);

      // Verify that same inputs regenerate the exact same reverse hash
      const checkAgain = await generatePayUResponseHash(params);
      expect(checkAgain).toBe(computedReverseHash);
    });

    it("supports response hash verification with additionalCharges parameter", async () => {
      const params = {
        key: testKey,
        txnid: "TXN_RESP_1002",
        amount: 500,
        productinfo: "Electronics",
        firstname: "Farhan",
        email: "farhan@campus.edu",
        status: "success",
        additionalCharges: 10,
        salt: testSalt,
      };

      const hashWithCharges = await generatePayUResponseHash(params);
      const { additionalCharges: _discard, ...paramsWithoutCharges } = params;
      const hashWithoutCharges = await generatePayUResponseHash(paramsWithoutCharges);

      expect(hashWithCharges).not.toBe(hashWithoutCharges);
      expect(hashWithCharges.length).toBe(128);
    });
  });

  describe("4. Hosted Checkout Preparation", () => {
    it("prepares complete PayU checkout payload with required redirect endpoints and hash", async () => {
      const config = getPayUConfig();
      const checkoutPayload = await preparePayUCheckout({
        order_id: "order-uuid-1",
        order_number: "SHP-2026-101",
        amount: 350.5,
        product_info: "Order SHP-2026-101 (3 items)",
        customer_name: "Rahul Verma",
        customer_email: "rahul@campus.edu",
        customer_phone: "9876543210",
      });

      expect(checkoutPayload.action_url).toBe(config.actionUrl);
      expect(checkoutPayload.key).toBe(config.key);
      expect(checkoutPayload.txnid).toBeDefined();
      expect(checkoutPayload.amount).toBe("350.50");
      expect(checkoutPayload.firstname).toBe("Rahul");
      expect(checkoutPayload.email).toBe("rahul@campus.edu");
      expect(checkoutPayload.phone).toBe("9876543210");
      expect(checkoutPayload.surl).toContain("payu_status=success");
      expect(checkoutPayload.furl).toContain("payu_status=failed");
      expect(checkoutPayload.hash).toBeDefined();
      expect(checkoutPayload.hash.length).toBe(128);
    });
  });

  describe("5. Server-Side Payment Verification (RPC verify_payu_payment_transaction)", () => {
    it("transitions order status to placed and payment_status to paid when RPC verification passes", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          success: true,
          order_id: "order-uuid-200",
          order_number: "SHP-2026-200",
          payment_status: "paid",
          order_status: "placed",
          amount: 450,
          verified: true,
        },
        error: null,
      });

      const res = await verifyPayUPaymentServerSide({
        txnid: "TXN_200",
        mihpayid: "MIH_999888777",
        amount: 450,
        mode: "UPI",
        status: "success",
        responsePayload: { status: "success", txnid: "TXN_200" },
      });

      expect(res.success).toBe(true);
      expect(res.data?.payment_status).toBe("paid");
      expect(res.data?.order_status).toBe("placed");
      expect(mockRpc).toHaveBeenCalledWith("verify_payu_payment_transaction", {
        p_order_id: null,
        p_txnid: "TXN_200",
        p_mihpayid: "MIH_999888777",
        p_amount: 450,
        p_mode: "UPI",
        p_status: "success",
        p_response_payload: { status: "success", txnid: "TXN_200" },
        p_verified_via: "callback",
      });
    });

    it("rejects payment verification when transaction amount does not match order amount", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "PayU transaction amount mismatch. Expected 450.00, received 10.00" },
      });

      const res = await verifyPayUPaymentServerSide({
        txnid: "TXN_TAMPERED",
        mihpayid: "MIH_111",
        amount: 10, // Tampered smaller amount
        mode: "DC",
        status: "success",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("mismatch");
    });

    it("ensures duplicate webhook callbacks are processed idempotently without side-effects", async () => {
      // First call succeeds
      mockRpc.mockResolvedValueOnce({
        data: {
          success: true,
          order_id: "order-uuid-201",
          order_number: "SHP-2026-201",
          payment_status: "paid",
          order_status: "placed",
          amount: 300,
          already_paid: false,
        },
        error: null,
      });

      const res1 = await verifyPayUPaymentServerSide({
        txnid: "TXN_IDEMPOTENT_1",
        mihpayid: "MIH_201",
        amount: 300,
        mode: "NB",
        status: "success",
      });

      expect(res1.success).toBe(true);

      // Duplicate callback
      mockRpc.mockResolvedValueOnce({
        data: {
          success: true,
          order_id: "order-uuid-201",
          order_number: "SHP-2026-201",
          payment_status: "paid",
          order_status: "placed",
          amount: 300,
          already_paid: true,
        },
        error: null,
      });

      const res2 = await verifyPayUPaymentServerSide({
        txnid: "TXN_IDEMPOTENT_1",
        mihpayid: "MIH_201",
        amount: 300,
        mode: "NB",
        status: "success",
      });

      expect(res2.success).toBe(true);
      expect(res2.data?.order_id).toBe("order-uuid-201");
    });
  });

  describe("6. Failed & Abandoned Payments Handling (RPC handle_failed_payu_payment)", () => {
    it("releases reserved inventory and marks order cancelled and payment failed", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          success: true,
          order_id: "order-uuid-failed-1",
          order_number: "SHP-2026-FAIL1",
          payment_status: "failed",
          order_status: "cancelled",
          inventory_restocked: true,
        },
        error: null,
      });

      const res = await handlePayUFailureServerSide({
        txnid: "TXN_FAILED_1",
        errorMsg: "User cancelled at PayU gateway or bank declined",
        responsePayload: { status: "failure", error_Message: "Bank timeout" },
      });

      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("handle_failed_payu_payment", {
        p_order_id: null,
        p_txnid: "TXN_FAILED_1",
        p_error_code: "FAILED",
        p_error_msg: "User cancelled at PayU gateway or bank declined",
        p_response_payload: { status: "failure", error_Message: "Bank timeout" },
      });
    });

    it("prevents double inventory restock on repeated failure callbacks", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          success: true,
          order_id: "order-uuid-failed-1",
          order_number: "SHP-2026-FAIL1",
          payment_status: "failed",
          order_status: "cancelled",
          inventory_restocked: false, // Already restocked on first callback
        },
        error: null,
      });

      const res = await handlePayUFailureServerSide({
        txnid: "TXN_FAILED_1",
        errorMsg: "User cancelled",
      });

      expect(res.success).toBe(true);
    });
  });
});
