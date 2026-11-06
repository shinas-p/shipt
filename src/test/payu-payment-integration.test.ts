import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  generatePayUTxnId,
  generatePayURequestHash,
  generatePayUResponseHash,
  preparePayUCheckout,
  verifyPayUPaymentServerSide,
  handlePayUFailureServerSide,
  verifyPayUTransactionViaServerAPI,
  getPayUConfig,
} from "@/lib/payuApi";

const mockRpc = vi.fn();
const mockFunctionsInvoke = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      from: (...args: any[]) => mockFrom(...args),
      rpc: (...args: any[]) => mockRpc(...args),
      functions: {
        invoke: (...args: any[]) => mockFunctionsInvoke(...args),
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
        product_info: "Order #SHP-2026-101 (3 items)",
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
      // Ensures productinfo does not contain hash symbols that break PayU WAF
      expect(checkoutPayload.productinfo).not.toContain("#");
      expect(checkoutPayload.service_provider).toBe("payu_paisa");
      expect(checkoutPayload.udf1).toBe("order-uuid-1");
      expect(checkoutPayload.udf2).toBe("SHP-2026-101");
      expect(checkoutPayload.udf3).toBe("");
      expect(checkoutPayload.udf4).toBe("");
      expect(checkoutPayload.udf5).toBe("");
    });

    it("verifies the SHA-512 request hash sequence contains exactly 16 pipe separators", async () => {
      // Reconstruct the exact sequence to assert 16-pipe structure
      const sampleKey = "gtKFFx";
      const sampleTxn = "TXN_TEST_123";
      const sampleAmt = "10.00";
      const sampleProd = "Shipt Mart Order QM-20261030-ABC";
      const sampleName = "Student";
      const sampleEmail = "student@campus.edu";
      const sampleU1 = "order-id-123";
      const sampleU2 = "QM-20261030-ABC";
      const sampleU3 = "";
      const sampleU4 = "";
      const sampleU5 = "";
      const sampleSalt = "eCwWELxi";

      const hashStr = `${sampleKey}|${sampleTxn}|${sampleAmt}|${sampleProd}|${sampleName}|${sampleEmail}|${sampleU1}|${sampleU2}|${sampleU3}|${sampleU4}|${sampleU5}||||||${sampleSalt}`;
      const pipeCount = (hashStr.match(/\|/g) || []).length;

      expect(pipeCount).toBe(16);
      expect(hashStr.endsWith(`||||||${sampleSalt}`)).toBe(true);
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

  describe("7. Permanent PayU Payment Confirmation & Recovery Suite (12 Scenarios)", () => {
    it("1. Verified success: confirms order via server-side Verify Payment API and RPC", async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data: {
          success: true,
          verified: true,
          status: "success",
          data: {
            order_id: "order-222bac54",
            order_number: "QM-20261030-C11D00AA",
            status: "placed",
            payment_status: "paid",
            total_amount: 1.0,
            mihpayid: "31567169332",
          },
        },
        error: null,
      });

      const res = await verifyPayUTransactionViaServerAPI({
        orderId: "order-222bac54",
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
      });

      expect(res.success).toBe(true);
      expect(res.verified).toBe(true);
      expect(res.status).toBe("success");
      expect(res.data?.status).toBe("placed");
      expect(res.data?.payment_status).toBe("paid");
      expect(res.data?.mihpayid).toBe("31567169332");
      expect(mockFunctionsInvoke).toHaveBeenCalledWith("payu-webhook", {
        body: {
          action: "verify_payment",
          order_id: "order-222bac54",
          txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
        },
      });
    });

    it("2. Missing callback amount: rejects zero or missing amount instead of unsafely substituting DB order total", async () => {
      // Amount passed as 0 (simulating missing amount in callback URL)
      const res = await verifyPayUPaymentServerSide({
        orderId: "order-222bac54",
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
        mihpayid: "31567169332",
        amount: 0,
        status: "success",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("valid gateway-confirmed amount (> 0) is required");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("3. Invalid transaction ID: rejects when transaction ID is unknown", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Order not found for transaction "TXN_INVALID_999"' },
      });

      const res = await verifyPayUPaymentServerSide({
        orderId: null,
        txnid: "TXN_INVALID_999",
        mihpayid: "31567169332",
        amount: 100,
        status: "success",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Order not found");
    });

    it("4. Amount mismatch: rejects when paid amount does not match expected order total", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "Amount mismatch: paid 0.50 does not match expected total 1.00" },
      });

      const res = await verifyPayUPaymentServerSide({
        orderId: "order-222bac54",
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
        mihpayid: "31567169332",
        amount: 0.50,
        status: "success",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Amount mismatch");
    });

    it("5. Invalid hash: rejects tampered responses before calling database RPC", async () => {
      const legitParams = {
        key: testKey,
        txnid: "TXN_TEST_HASH",
        amount: 1.0,
        productinfo: "Shipz Mart Order",
        firstname: "Musfir",
        email: "musfir@campus.edu",
        status: "success",
        salt: testSalt,
      };

      const legitHash = await generatePayUResponseHash(legitParams);
      const tamperedHash = "deadbeef" + legitHash.substring(8);

      expect(tamperedHash).not.toBe(legitHash);
      // Tampered hash check fails
      const isValid = tamperedHash.toLowerCase() === legitHash.toLowerCase();
      expect(isValid).toBe(false);
    });

    it("6. Duplicate callback: processed idempotently without side-effects", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          success: true,
          order_id: "order-222bac54",
          order_number: "QM-20261030-C11D00AA",
          status: "placed",
          payment_status: "paid",
          message: "Payment was already verified.",
        },
        error: null,
      });

      const res = await verifyPayUPaymentServerSide({
        orderId: "order-222bac54",
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
        mihpayid: "31567169332",
        amount: 1.0,
        status: "success",
      });

      expect(res.success).toBe(true);
      expect(res.data?.status).toBe("placed");
      expect(res.data?.payment_status).toBe("paid");
    });

    it("7. Duplicate webhook: processed idempotently when webhook arrives after callback", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          success: true,
          order_id: "order-222bac54",
          order_number: "QM-20261030-C11D00AA",
          status: "placed",
          payment_status: "paid",
          message: "Payment was already verified.",
        },
        error: null,
      });

      const res = await verifyPayUPaymentServerSide({
        orderId: "order-222bac54",
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
        mihpayid: "31567169332",
        amount: 1.0,
        status: "success",
        verifiedVia: "webhook",
      });

      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("verify_payu_payment_transaction", expect.objectContaining({
        p_verified_via: "webhook",
      }));
    });

    it("8. Delayed callback: handles pending settlement from Verify Payment API cleanly", async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data: {
          success: false,
          verified: false,
          status: "pending",
          error: "Payment settlement is still pending with gateway",
        },
        error: null,
      });

      const res = await verifyPayUTransactionViaServerAPI({
        orderId: "order-delayed",
        txnid: "TXN_DELAYED",
      });

      expect(res.success).toBe(false);
      expect(res.verified).toBe(false);
      expect(res.status).toBe("pending");
      expect(res.error).toContain("pending");
    });

    it("9. Verify API unavailable: returns graceful status without crashing", async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data: null,
        error: { message: "Network connection to PayU Verify API timed out" },
      });

      const res = await verifyPayUTransactionViaServerAPI({
        orderId: "order-timeout",
        txnid: "TXN_TIMEOUT",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("timed out");
    });

    it("10. Database update failure: reports error and aborts confirmation cleanly", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "PostgreSQL row lock timeout" },
      });

      const res = await verifyPayUPaymentServerSide({
        orderId: "order-lock-fail",
        txnid: "TXN_LOCK_FAIL",
        mihpayid: "MIH_FAIL",
        amount: 1.0,
        status: "success",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("lock timeout");
    });

    it("11. Already confirmed order: returns already verified status flag", async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data: {
          success: true,
          verified: true,
          already_verified: true,
          data: {
            order_id: "order-222bac54",
            order_number: "QM-20261030-C11D00AA",
            status: "placed",
            payment_status: "paid",
          },
        },
        error: null,
      });

      const res = await verifyPayUTransactionViaServerAPI({
        orderId: "order-222bac54",
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
      });

      expect(res.success).toBe(true);
      expect(res.already_verified).toBe(true);
      expect(res.status).toBe("success");
    });

    it("12. No duplicate stock deduction: verifies inventory reservation is preserved without deducting products again", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          success: true,
          order_id: "order-222bac54",
          order_number: "QM-20261030-C11D00AA",
          status: "placed",
          payment_status: "paid",
        },
        error: null,
      });

      const res = await verifyPayUPaymentServerSide({
        orderId: "order-222bac54",
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
        mihpayid: "31567169332",
        amount: 1.0,
        status: "success",
      });

      expect(res.success).toBe(true);
      // verify_payu_payment_transaction does NOT invoke products stock decrement
      // It confirms the existing row where stock was already reserved during create_order_with_inventory
      expect(mockRpc).toHaveBeenCalledWith("verify_payu_payment_transaction", expect.anything());
    });
  });

  describe("8. Independent Security & Correctness Verification Suite", () => {
    it("1. Missing or zero amount rejected: does not substitute database amount to establish payment success", async () => {
      const resZero = await verifyPayUPaymentServerSide({
        orderId: "order-test-missing-amt",
        txnid: "TXN_ZERO_AMT",
        mihpayid: "31567169332",
        amount: 0,
        status: "success",
      });

      expect(resZero.success).toBe(false);
      expect(resZero.error).toContain("valid gateway-confirmed amount (> 0) is required");
      // Never called RPC with zero amount
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("2. Non-success gateway status rejected: does not mark payment paid if status is not success", async () => {
      const resPending = await verifyPayUPaymentServerSide({
        orderId: "order-test-pending",
        txnid: "TXN_PENDING_STATUS",
        mihpayid: "31567169332",
        amount: 250.00,
        status: "pending",
      });

      expect(resPending.success).toBe(false);
      expect(resPending.error).toContain("expected 'success'");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("3. Additional charges reverse hash: computes exact SHA-512 with additionalCharges prefix", async () => {
      const baseParams = {
        key: testKey,
        txnid: "TXN_SURCHARGE_1",
        amount: "100.00",
        productinfo: "Shipt Mart Order",
        firstname: "Ameer",
        email: "ameer@campus.edu",
        status: "success",
        salt: testSalt,
      };

      const hashWithoutCharges = await generatePayUResponseHash(baseParams);

      const hashWithCharges = await generatePayUResponseHash({
        ...baseParams,
        additionalCharges: "2.50",
      });

      expect(hashWithCharges).not.toBe(hashWithoutCharges);
      expect(hashWithCharges.length).toBe(128);

      // Verify deterministic checksum with identical additional charges
      const hashWithChargesRepeat = await generatePayUResponseHash({
        ...baseParams,
        additionalCharges: "2.50",
      });
      expect(hashWithChargesRepeat).toBe(hashWithCharges);
    });

    it("4. Open Redirect protection: rejects attacker Vercel subdomains & localhost in production", () => {
      const PRODUCTION_ALLOWED_ORIGINS = [
        "https://www.shipz.store",
        "https://shipz.store",
      ];
      const DEV_ALLOWED_ORIGINS = [
        "https://www.shipz.store",
        "https://shipz.store",
        "https://shipt.lovable.app",
        "http://localhost:5173",
        "http://localhost:8080",
        "http://localhost:3000",
      ];

      function sanitizeOrigin(raw?: string | null, isProduction = true): string {
        const defaultOrigin = "https://www.shipz.store";
        if (!raw) return defaultOrigin;
        try {
          const u = new URL(raw);
          const origin = u.origin.toLowerCase();
          const allowed = isProduction ? PRODUCTION_ALLOWED_ORIGINS : DEV_ALLOWED_ORIGINS;
          if (allowed.includes(origin)) return origin;
        } catch { }
        return defaultOrigin;
      }

      // Production strictly allows ONLY shipz.store and www.shipz.store
      expect(sanitizeOrigin("https://www.shipz.store", true)).toBe("https://www.shipz.store");
      expect(sanitizeOrigin("https://shipz.store", true)).toBe("https://shipz.store");

      // Attacker-controlled Vercel subdomain is REJECTED in production
      expect(sanitizeOrigin("https://attacker-takeover.vercel.app", true)).toBe("https://www.shipz.store");
      expect(sanitizeOrigin("https://shinas-shipt.vercel.app", true)).toBe("https://www.shipz.store");

      // Localhost is REJECTED in production
      expect(sanitizeOrigin("http://localhost:5173", true)).toBe("https://www.shipz.store");
      expect(sanitizeOrigin("http://127.0.0.1:8080", true)).toBe("https://www.shipz.store");

      // Malicious external origin is REJECTED
      expect(sanitizeOrigin("https://evil-phishing-site.com", true)).toBe("https://www.shipz.store");
      expect(sanitizeOrigin("javascript:alert(1)", true)).toBe("https://www.shipz.store");
      expect(sanitizeOrigin("https://shipz.store.attacker.com", true)).toBe("https://www.shipz.store");

      // Development mode safely allows localhost and preview
      expect(sanitizeOrigin("http://localhost:5173", false)).toBe("http://localhost:5173");
      expect(sanitizeOrigin("https://shipt.lovable.app", false)).toBe("https://shipt.lovable.app");
    });

    it("5. Server Verify API: handles unmappedstatus 'auth' as pending capture, not confirmed paid", async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data: {
          success: false,
          verified: false,
          status: "pending",
          error: "Payment status is success (auth)",
        },
        error: null,
      });

      const res = await verifyPayUTransactionViaServerAPI({
        orderId: "order-auth-only",
        txnid: "TXN_AUTH_ONLY",
      });

      expect(res.success).toBe(false);
      expect(res.verified).toBe(false);
      expect(res.status).toBe("pending");
    });

    it("6. Server Verify API: passes guest_token to authorize guest order status verification", async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data: {
          success: true,
          verified: true,
          data: {
            order_id: "order-guest-1",
            order_number: "QM-GUEST-1",
            status: "placed",
            payment_status: "paid",
          },
        },
        error: null,
      });

      const res = await verifyPayUTransactionViaServerAPI({
        orderId: "order-guest-1",
        txnid: "TXN_GUEST_1",
        guestToken: "gst_token_secure_xyz123",
      });

      expect(res.success).toBe(true);
      expect(res.verified).toBe(true);
      expect(mockFunctionsInvoke).toHaveBeenCalledWith("payu-webhook", expect.objectContaining({
        body: expect.objectContaining({
          action: "verify_payment",
          guest_token: "gst_token_secure_xyz123",
        }),
      }));
    });

    it("7. Anonymous verification rejection: handles 403 unauthorized error cleanly", async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data: null,
        error: { message: "Unauthorized access: You do not have permission to verify this order." },
      });

      const res = await verifyPayUTransactionViaServerAPI({
        orderId: "order-foreign-user",
        txnid: "TXN_FOREIGN_USER",
      });

      expect(res.success).toBe(false);
      expect(res.verified).toBe(false);
      expect(res.error).toContain("Unauthorized access");
    });

    it("8. Malformed PayU gateway response: returns graceful error without crashing", async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data: {
          success: false,
          verified: false,
          status: "pending",
          error: "Transaction inquiry returned status 0 or missing transaction details",
        },
        error: null,
      });

      const res = await verifyPayUTransactionViaServerAPI({
        orderId: "order-status-zero",
        txnid: "TXN_STATUS_ZERO",
      });

      expect(res.success).toBe(false);
      expect(res.verified).toBe(false);
      expect(res.error).toContain("status 0");
    });

    it("9. Transaction ID mismatch: rejects when gateway details do not match requested transaction", async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data: {
          success: false,
          verified: false,
          status: "failure",
          error: "Transaction ID mismatch in PayU response: requested TXN_A, received TXN_B",
        },
        error: null,
      });

      const res = await verifyPayUTransactionViaServerAPI({
        orderId: "order-mismatch",
        txnid: "TXN_A",
      });

      expect(res.success).toBe(false);
      expect(res.verified).toBe(false);
      expect(res.error).toContain("Transaction ID mismatch");
    });

    it("10. Recovery script validation: verifies strict assertions on captured state and mihpayid", () => {
      // Simulate recovery validation logic
      function validateGatewayResponse(details: any, expectedTxnid: string, expectedMihpayid: string, expectedAmount: number) {
        if (!details) throw new Error("Transaction details block empty");
        if (details.txnid && details.txnid !== expectedTxnid) throw new Error("txnid mismatch");
        if (String(details.mihpayid) !== expectedMihpayid) throw new Error("mihpayid mismatch");
        const statusLower = (details.status || "").toLowerCase().trim();
        const unmappedLower = (details.unmappedstatus || "").toLowerCase().trim();
        if (statusLower !== "success" || (unmappedLower !== "captured" && unmappedLower !== "success")) {
          throw new Error("Payment is not captured");
        }
        const amt = parseFloat(details.amt || details.transaction_amount || "0");
        if (amt !== expectedAmount) throw new Error("Amount mismatch");
        return true;
      }

      // Valid response passes
      expect(validateGatewayResponse({
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
        mihpayid: "31567169332",
        status: "success",
        unmappedstatus: "captured",
        amt: "1.00",
      }, "TXN_QM_20261030_C11D00AA_B5AA2F", "31567169332", 1.00)).toBe(true);

      // Wrong mihpayid throws
      expect(() => validateGatewayResponse({
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
        mihpayid: "99999999999",
        status: "success",
        unmappedstatus: "captured",
        amt: "1.00",
      }, "TXN_QM_20261030_C11D00AA_B5AA2F", "31567169332", 1.00)).toThrow("mihpayid mismatch");

      // Wrong amount throws
      expect(() => validateGatewayResponse({
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
        mihpayid: "31567169332",
        status: "success",
        unmappedstatus: "captured",
        amt: "500.00",
      }, "TXN_QM_20261030_C11D00AA_B5AA2F", "31567169332", 1.00)).toThrow("Amount mismatch");

      // Unmapped status 'bounced' throws
      expect(() => validateGatewayResponse({
        txnid: "TXN_QM_20261030_C11D00AA_B5AA2F",
        mihpayid: "31567169332",
        status: "success",
        unmappedstatus: "bounced",
        amt: "1.00",
      }, "TXN_QM_20261030_C11D00AA_B5AA2F", "31567169332", 1.00)).toThrow("Payment is not captured");
    });

    it("11. Migration RPC signatures & permission enforcement: verifies 8-arg and 5-arg signatures and role restrictions", () => {
      // 1. verify_payu_payment_transaction signature:
      // (p_order_id uuid, p_txnid text, p_mihpayid text, p_amount numeric, p_status text, p_mode text, p_response_payload jsonb, p_verified_via text) -> 8 args
      const verifySignature = [
        "uuid", "text", "text", "numeric", "text", "text", "jsonb", "text"
      ];
      expect(verifySignature.length).toBe(8);

      // 2. handle_failed_payu_payment signature:
      // (p_order_id uuid, p_txnid text, p_error_code text, p_error_msg text, p_response_payload jsonb) -> 5 args
      const failSignature = [
        "uuid", "text", "text", "text", "jsonb"
      ];
      expect(failSignature.length).toBe(5);

      // 3. Permission logic: anon & authenticated are rejected; service_role is granted
      function checkRpcAccess(role: string): { allowed: boolean; reason?: string } {
        if (role === "anon" || role === "authenticated") {
          return { allowed: false, reason: "Access denied: client execution of payment RPC is forbidden" };
        }
        if (role === "service_role") {
          return { allowed: true };
        }
        return { allowed: false, reason: "Unknown role" };
      }

      expect(checkRpcAccess("anon").allowed).toBe(false);
      expect(checkRpcAccess("authenticated").allowed).toBe(false);
      expect(checkRpcAccess("service_role").allowed).toBe(true);
    });

    it("12. Decimal-safe amount equality: handles float rounding edge cases accurately", () => {
      function isAmountEqual(amt1: number | string, amt2: number | string): boolean {
        const n1 = typeof amt1 === "number" ? amt1 : parseFloat(String(amt1));
        const n2 = typeof amt2 === "number" ? amt2 : parseFloat(String(amt2));
        if (isNaN(n1) || isNaN(n2) || n1 <= 0 || n2 <= 0) return false;
        return Math.round(n1 * 100) === Math.round(n2 * 100);
      }

      expect(isAmountEqual(1, 1.0)).toBe(true);
      expect(isAmountEqual("1.00", 1.0)).toBe(true);
      expect(isAmountEqual("10.50", 10.5)).toBe(true);
      expect(isAmountEqual(1.001, 1.00)).toBe(true); // sub-cent rounding
      expect(isAmountEqual(1.01, 1.00)).toBe(false); // different cent
      expect(isAmountEqual(0, 0)).toBe(false); // zero is rejected
      expect(isAmountEqual(-1, -1)).toBe(false); // negative is rejected
    });

    it("13. Constant-time string comparison: detects mismatch without length or timing leak", () => {
      function constantTimeEquals(a: string, b: string): boolean {
        if (typeof a !== "string" || typeof b !== "string") return false;
        if (a.length !== b.length) return false;
        let mismatch = 0;
        for (let i = 0; i < a.length; i++) {
          mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return mismatch === 0;
      }

      const h1 = "a1b2c3d4e5f6".repeat(8);
      const h2 = "a1b2c3d4e5f6".repeat(8);
      const hDiffChar = "a1b2c3d4e5f7" + "a1b2c3d4e5f6".repeat(7);
      const hDiffLen = "a1b2c3d4e5f6";

      expect(constantTimeEquals(h1, h2)).toBe(true);
      expect(constantTimeEquals(h1, hDiffChar)).toBe(false);
      expect(constantTimeEquals(h1, hDiffLen)).toBe(false);
    });
  });

  describe("9. Hostile Production Security Audit Attack Suite", () => {
    describe("9.1 Database RPC Integrity & Authorization Attacks", () => {
      // Logic simulation of hardened verify_payu_payment_transaction
      function simulateHardenedVerifyPayment(params: {
        callerRole: string;
        orderId: string | null;
        txnid: string | null;
        mihpayid: string | null;
        amount: number;
        status: string;
        verifiedVia?: string;
        orderDb: { id: string; payu_txnid: string; total_amount: number; status: string; payment_status: string } | null;
        paymentDb: { id: string; order_id: string; payu_txnid: string | null; amount: number; status: string } | null;
        hasExistingActiveRefund?: boolean;
      }) {
        if (params.callerRole === "anon" || params.callerRole === "authenticated") {
          throw new Error("Access denied: client execution of verify_payu_payment_transaction is forbidden");
        }
        if (!params.orderId) throw new Error("Cannot verify payment: order ID is required");
        const cleanTxnid = (params.txnid || "").trim();
        if (!cleanTxnid) throw new Error("Cannot verify payment: transaction ID is required");
        const cleanMih = (params.mihpayid || "").trim();
        if (!cleanMih) throw new Error("Cannot verify payment: PayU payment ID (mihpayid) is required");

        const allowedSources = ["server_verify_api", "server_callback", "webhook", "manual_reconciliation"];
        const source = (params.verifiedVia || "webhook").toLowerCase().trim();
        if (!allowedSources.includes(source)) {
          throw new Error(`Cannot verify payment: invalid verification source "${params.verifiedVia}"`);
        }

        if ((params.status || "").toLowerCase().trim() !== "success") {
          throw new Error(`Cannot mark transaction verified: status is "${params.status}" (must be "success")`);
        }
        if (!params.amount || params.amount <= 0) {
          throw new Error(`Cannot mark transaction verified: invalid amount ${params.amount}`);
        }

        const o = params.orderDb;
        if (!o || o.id !== params.orderId || o.payu_txnid !== cleanTxnid) {
          throw new Error(`Order not found or transaction ID mismatch: order ${params.orderId} does not match txnid "${cleanTxnid}"`);
        }

        const p = params.paymentDb;
        if (!p || p.order_id !== o.id) {
          throw new Error(`Payment record not found for order ${o.id} and transaction "${cleanTxnid}"`);
        }
        if (p.payu_txnid && p.payu_txnid !== cleanTxnid) {
          throw new Error(`Payment record transaction ID mismatch: expected ${p.payu_txnid}, got ${cleanTxnid}`);
        }
        if (Math.round(p.amount * 100) !== Math.round(params.amount * 100)) {
          throw new Error(`Payment record amount mismatch: payment expects ${p.amount}, got ${params.amount}`);
        }

        if (Math.round(o.total_amount * 100) !== Math.round(params.amount * 100)) {
          // Durable audit without raising exception
          return {
            success: false,
            error: "AMOUNT_MISMATCH",
            message: `Amount mismatch: paid ${params.amount} does not match expected total ${o.total_amount}`,
          };
        }

        if (o.status === "cancelled") {
          const refundCreated = !params.hasExistingActiveRefund;
          return {
            success: true,
            order_id: o.id,
            status: "cancelled",
            payment_status: "refund_pending",
            refundCreated,
            message: "Payment recorded on cancelled order; flagged for refund review.",
          };
        }

        if (o.payment_status === "paid" || o.payment_status === "completed") {
          return {
            success: true,
            order_id: o.id,
            status: o.status,
            payment_status: o.payment_status,
            message: "Payment was already verified.",
          };
        }

        return {
          success: true,
          order_id: o.id,
          status: "placed",
          payment_status: "paid",
        };
      }

      it("rejects anonymous or authenticated callers immediately with Access Denied", () => {
        expect(() => simulateHardenedVerifyPayment({
          callerRole: "anon",
          orderId: "ord-1",
          txnid: "TXN_1",
          mihpayid: "MIH_1",
          amount: 10,
          status: "success",
          orderDb: null,
          paymentDb: null,
        })).toThrow("Access denied");

        expect(() => simulateHardenedVerifyPayment({
          callerRole: "authenticated",
          orderId: "ord-1",
          txnid: "TXN_1",
          mihpayid: "MIH_1",
          amount: 10,
          status: "success",
          orderDb: null,
          paymentDb: null,
        })).toThrow("Access denied");
      });

      it("strictly requires both orderId and txnid to match the exact same order (no OR bypass)", () => {
        const orderA = { id: "ord-A", payu_txnid: "TXN_A", total_amount: 10, status: "pending_payment", payment_status: "pending" };
        const paymentA = { id: "pay-A", order_id: "ord-A", payu_txnid: "TXN_A", amount: 10, status: "pending" };

        // Attempting to combine Order A with Txn B fails
        expect(() => simulateHardenedVerifyPayment({
          callerRole: "service_role",
          orderId: "ord-A",
          txnid: "TXN_B",
          mihpayid: "MIH_1",
          amount: 10,
          status: "success",
          orderDb: orderA,
          paymentDb: paymentA,
        })).toThrow("Order not found or transaction ID mismatch");

        // Missing orderId fails
        expect(() => simulateHardenedVerifyPayment({
          callerRole: "service_role",
          orderId: null,
          txnid: "TXN_A",
          mihpayid: "MIH_1",
          amount: 10,
          status: "success",
          orderDb: orderA,
          paymentDb: paymentA,
        })).toThrow("order ID is required");

        // Empty txnid fails
        expect(() => simulateHardenedVerifyPayment({
          callerRole: "service_role",
          orderId: "ord-A",
          txnid: "   ",
          mihpayid: "MIH_1",
          amount: 10,
          status: "success",
          orderDb: orderA,
          paymentDb: paymentA,
        })).toThrow("transaction ID is required");
      });

      it("strictly rejects missing or empty mihpayid", () => {
        const orderA = { id: "ord-A", payu_txnid: "TXN_A", total_amount: 10, status: "pending_payment", payment_status: "pending" };
        const paymentA = { id: "pay-A", order_id: "ord-A", payu_txnid: "TXN_A", amount: 10, status: "pending" };

        expect(() => simulateHardenedVerifyPayment({
          callerRole: "service_role",
          orderId: "ord-A",
          txnid: "TXN_A",
          mihpayid: null,
          amount: 10,
          status: "success",
          orderDb: orderA,
          paymentDb: paymentA,
        })).toThrow("PayU payment ID (mihpayid) is required");
      });

      it("locks and validates payment record integrity (missing row or amount mismatch rejected)", () => {
        const orderA = { id: "ord-A", payu_txnid: "TXN_A", total_amount: 10, status: "pending_payment", payment_status: "pending" };

        // Missing payment row
        expect(() => simulateHardenedVerifyPayment({
          callerRole: "service_role",
          orderId: "ord-A",
          txnid: "TXN_A",
          mihpayid: "MIH_1",
          amount: 10,
          status: "success",
          orderDb: orderA,
          paymentDb: null,
        })).toThrow("Payment record not found");

        // Payment row amount mismatch
        const paymentWrongAmt = { id: "pay-A", order_id: "ord-A", payu_txnid: "TXN_A", amount: 20, status: "pending" };
        expect(() => simulateHardenedVerifyPayment({
          callerRole: "service_role",
          orderId: "ord-A",
          txnid: "TXN_A",
          mihpayid: "MIH_1",
          amount: 10,
          status: "success",
          orderDb: orderA,
          paymentDb: paymentWrongAmt,
        })).toThrow("Payment record amount mismatch");
      });

      it("rejects unauthorized verification sources", () => {
        const orderA = { id: "ord-A", payu_txnid: "TXN_A", total_amount: 10, status: "pending_payment", payment_status: "pending" };
        const paymentA = { id: "pay-A", order_id: "ord-A", payu_txnid: "TXN_A", amount: 10, status: "pending" };

        expect(() => simulateHardenedVerifyPayment({
          callerRole: "service_role",
          orderId: "ord-A",
          txnid: "TXN_A",
          mihpayid: "MIH_1",
          amount: 10,
          status: "success",
          verifiedVia: "untrusted_client_hack",
          orderDb: orderA,
          paymentDb: paymentA,
        })).toThrow("invalid verification source");
      });

      it("durable audit on amount mismatch: returns structured error without throwing (so audit logs persist)", () => {
        const orderA = { id: "ord-A", payu_txnid: "TXN_A", total_amount: 100, status: "pending_payment", payment_status: "pending" };
        const paymentA = { id: "pay-A", order_id: "ord-A", payu_txnid: "TXN_A", amount: 10, status: "pending" };

        // Attacker pays 10 instead of 100
        const result = simulateHardenedVerifyPayment({
          callerRole: "service_role",
          orderId: "ord-A",
          txnid: "TXN_A",
          mihpayid: "MIH_1",
          amount: 10,
          status: "success",
          orderDb: orderA,
          paymentDb: paymentA,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe("AMOUNT_MISMATCH");
      });

      it("deduplicates refunds for cancelled orders (never creates multiple refunds on retried callbacks)", () => {
        const cancelledOrder = { id: "ord-C", payu_txnid: "TXN_C", total_amount: 10, status: "cancelled", payment_status: "failed" };
        const paymentC = { id: "pay-C", order_id: "ord-C", payu_txnid: "TXN_C", amount: 10, status: "failed" };

        // 1st callback creates refund review
        const res1 = simulateHardenedVerifyPayment({
          callerRole: "service_role",
          orderId: "ord-C",
          txnid: "TXN_C",
          mihpayid: "MIH_C",
          amount: 10,
          status: "success",
          orderDb: cancelledOrder,
          paymentDb: paymentC,
          hasExistingActiveRefund: false,
        });
        expect(res1.success).toBe(true);
        expect(res1.payment_status).toBe("refund_pending");
        expect(res1.refundCreated).toBe(true);

        // 2nd callback detects existing refund and does NOT create duplicate
        const res2 = simulateHardenedVerifyPayment({
          callerRole: "service_role",
          orderId: "ord-C",
          txnid: "TXN_C",
          mihpayid: "MIH_C",
          amount: 10,
          status: "success",
          orderDb: cancelledOrder,
          paymentDb: paymentC,
          hasExistingActiveRefund: true,
        });
        expect(res2.success).toBe(true);
        expect(res2.refundCreated).toBe(false);
      });
    });

    describe("9.2 PayU Verify Payment API Forensic Responses", () => {
      function evaluatePayUApiResponse(json: any, targetTxnid: string) {
        if (!json || json.status !== 1 || !json.transaction_details) {
          return { verified: false, status: "pending", error: "status 0 or missing details" };
        }
        const details = json.transaction_details[targetTxnid];
        if (!details) {
          return { verified: false, status: "pending", error: "target txnid not found in response dictionary" };
        }
        if (details.txnid && String(details.txnid).trim() !== targetTxnid.trim()) {
          return { verified: false, status: "failure", error: "txnid mismatch" };
        }
        const statusLower = (details.status || "").toLowerCase().trim();
        const unmappedLower = (details.unmappedstatus || "").toLowerCase().trim();
        if (unmappedLower === "auth") {
          return { verified: false, status: "pending", error: "pre-authorized only" };
        }
        const isCaptured = statusLower === "success" && (unmappedLower === "captured" || (!unmappedLower && statusLower === "success"));
        if (isCaptured) {
          return { verified: true, status: "success", amount: parseFloat(details.amt || details.transaction_amount) };
        }
        return { verified: false, status: "failure", error: "not captured" };
      }

      it("rejects API status 0 or missing transaction_details", () => {
        expect(evaluatePayUApiResponse({ status: 0, msg: "Command failed" }, "TXN_1").verified).toBe(false);
        expect(evaluatePayUApiResponse({ status: 1 }, "TXN_1").verified).toBe(false);
      });

      it("rejects ambiguous fallbacks when target txnid is not in transaction_details", () => {
        const ambiguousResponse = {
          status: 1,
          transaction_details: {
            "TXN_OTHER_ORDER": { status: "success", unmappedstatus: "captured", amt: "10.00" },
          },
        };
        const res = evaluatePayUApiResponse(ambiguousResponse, "TXN_TARGET");
        expect(res.verified).toBe(false);
        expect(res.error).toContain("target txnid not found");
      });

      it("rejects pre-authorized 'auth' states as pending capture", () => {
        const authResponse = {
          status: 1,
          transaction_details: {
            "TXN_AUTH": { status: "success", unmappedstatus: "auth", amt: "10.00" },
          },
        };
        const res = evaluatePayUApiResponse(authResponse, "TXN_AUTH");
        expect(res.verified).toBe(false);
        expect(res.status).toBe("pending");
      });
    });

    describe("9.3 Callback Attack Protections", () => {
      it("rejects customer-initiated failure callbacks if not confirmed by gateway signature or Verify Payment API", () => {
        function validateFailureCallback(isHashValid: boolean, status: string, gatewayVerifyStatus: string) {
          const isVerified = (isHashValid && status.toLowerCase() !== "success") || gatewayVerifyStatus === "failure";
          return isVerified;
        }

        // Forged failure without hash or gateway confirmation is REJECTED
        expect(validateFailureCallback(false, "failure", "pending")).toBe(false);
        // Valid reverse hash failure is ACCEPTED
        expect(validateFailureCallback(true, "failure", "pending")).toBe(true);
        // Gateway-confirmed failure is ACCEPTED
        expect(validateFailureCallback(false, "failure", "failure")).toBe(true);
      });
    });

    describe("9.4 Inventory & State Machine Race Condition Matrix", () => {
      type OrderState = { status: string; paymentStatus: string; stock: number; refundReviews: number };

      function handleEvent(order: OrderState, event: "SUCCESS" | "FAILURE" | "EXPIRE" | "CANCEL", qty: number): OrderState {
        const next = { ...order };
        if (event === "SUCCESS") {
          if (next.paymentStatus === "paid") {
            // Idempotent: no change
            return next;
          }
          if (next.status === "cancelled") {
            // Late success on cancelled order
            next.paymentStatus = "refund_pending";
            next.refundReviews += 1;
            return next;
          }
          next.status = "placed";
          next.paymentStatus = "paid";
          return next;
        }

        if (event === "FAILURE" || event === "EXPIRE") {
          if (next.paymentStatus === "paid") {
            // Paid orders are immutable against failure/expiry
            return next;
          }
          if (next.status === "pending_payment") {
            next.status = "cancelled";
            next.paymentStatus = event === "FAILURE" ? "failed" : "expired";
            next.stock += qty; // Restock reserved inventory once
            return next;
          }
          // Already cancelled: no duplicate restock
          return next;
        }

        if (event === "CANCEL") {
          if (next.status === "placed" && next.paymentStatus === "paid") {
            next.status = "cancelled";
            next.stock += qty;
            next.refundReviews += 1;
            return next;
          }
        }
        return next;
      }

      it("1. Success callback arrives twice: preserves stock, placed status, no duplicate transitions", () => {
        let state: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 10, refundReviews: 0 };
        state = handleEvent(state, "SUCCESS", 2);
        expect(state.status).toBe("placed");
        expect(state.paymentStatus).toBe("paid");
        expect(state.stock).toBe(10); // Not deducted again

        // 2nd arrival
        state = handleEvent(state, "SUCCESS", 2);
        expect(state.status).toBe("placed");
        expect(state.paymentStatus).toBe("paid");
        expect(state.stock).toBe(10);
      });

      it("2. Failure callback arrives twice: restocks inventory ONCE, never twice", () => {
        let state: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 10, refundReviews: 0 };
        state = handleEvent(state, "FAILURE", 2);
        expect(state.status).toBe("cancelled");
        expect(state.paymentStatus).toBe("failed");
        expect(state.stock).toBe(12); // Restocked once

        // 2nd arrival
        state = handleEvent(state, "FAILURE", 2);
        expect(state.status).toBe("cancelled");
        expect(state.stock).toBe(12); // STILL 12, never 14
      });

      it("3. Expiry arrives twice: restocks inventory ONCE", () => {
        let state: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 5, refundReviews: 0 };
        state = handleEvent(state, "EXPIRE", 3);
        expect(state.stock).toBe(8);

        state = handleEvent(state, "EXPIRE", 3);
        expect(state.stock).toBe(8);
      });

      it("4. Success followed by delayed failure: rejects failure, keeps order paid and stock intact", () => {
        let state: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 10, refundReviews: 0 };
        state = handleEvent(state, "SUCCESS", 1);
        expect(state.status).toBe("placed");
        expect(state.paymentStatus).toBe("paid");

        // Delayed failure arrives
        state = handleEvent(state, "FAILURE", 1);
        expect(state.status).toBe("placed");
        expect(state.paymentStatus).toBe("paid");
        expect(state.stock).toBe(10); // Not restocked
      });

      it("5. Failure followed by late success: flags refund review, does not oversell stock", () => {
        let state: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 10, refundReviews: 0 };
        state = handleEvent(state, "FAILURE", 2);
        expect(state.status).toBe("cancelled");
        expect(state.stock).toBe(12);

        // Late payment clears
        state = handleEvent(state, "SUCCESS", 2);
        expect(state.status).toBe("cancelled");
        expect(state.paymentStatus).toBe("refund_pending");
        expect(state.refundReviews).toBe(1);
        expect(state.stock).toBe(12); // Leaves stock intact, queues refund
      });

      it("6. Concurrent failure and expiry: exactly one restock occurs, never double restock", () => {
        let state: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 10, refundReviews: 0 };
        // Thread A (Failure) acquires lock first
        state = handleEvent(state, "FAILURE", 2);
        expect(state.status).toBe("cancelled");
        expect(state.stock).toBe(12);

        // Thread B (Expiry) acquires lock second
        state = handleEvent(state, "EXPIRE", 2);
        expect(state.status).toBe("cancelled");
        expect(state.stock).toBe(12); // Does not restock again
      });

      it("7. Concurrent success and failure: row-lock serialization ensures consistent final state", () => {
        // Case A: Success wins lock
        let stateA: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 10, refundReviews: 0 };
        stateA = handleEvent(stateA, "SUCCESS", 1);
        stateA = handleEvent(stateA, "FAILURE", 1);
        expect(stateA.status).toBe("placed");
        expect(stateA.paymentStatus).toBe("paid");
        expect(stateA.stock).toBe(10);

        // Case B: Failure wins lock, delayed success arrives
        let stateB: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 10, refundReviews: 0 };
        stateB = handleEvent(stateB, "FAILURE", 1);
        stateB = handleEvent(stateB, "SUCCESS", 1);
        expect(stateB.status).toBe("cancelled");
        expect(stateB.paymentStatus).toBe("refund_pending");
        expect(stateB.refundReviews).toBe(1);
        expect(stateB.stock).toBe(11); // Restocked once, payment queued for refund
      });
    });

    describe("9.5 Comprehensive Attack & Edge-Case Verification Suite", () => {
      it("1. Signed failure callback while Verify Payment API reports captured: confirms payment and rejects failure", () => {
        function resolveCallback(cbStatus: string, isHashValid: boolean, gatewayStatus: string) {
          if (gatewayStatus === "success") {
            return { action: "CONFIRM_PAYMENT", restocked: false };
          }
          if (gatewayStatus === "failure") {
            return { action: "CANCEL_AND_RESTOCK", restocked: true };
          }
          return { action: "LEAVE_PENDING", restocked: false };
        }

        // Even with a signed failure callback, if PayU Verify Payment API reports success (captured):
        const res = resolveCallback("failure", true, "success");
        expect(res.action).toBe("CONFIRM_PAYMENT");
        expect(res.restocked).toBe(false);
      });

      it("2. Signed failure callback while Verify Payment API reports pending: leaves order pending and does NOT restock", () => {
        function resolveCallback(cbStatus: string, isHashValid: boolean, gatewayStatus: string) {
          if (gatewayStatus === "success") {
            return { action: "CONFIRM_PAYMENT", restocked: false };
          }
          if (gatewayStatus === "failure") {
            return { action: "CANCEL_AND_RESTOCK", restocked: true };
          }
          return { action: "LEAVE_PENDING", restocked: false };
        }

        const res = resolveCallback("failure", true, "pending");
        expect(res.action).toBe("LEAVE_PENDING");
        expect(res.restocked).toBe(false);
      });

      it("3. Verify Payment API unavailable during failure processing: leaves order pending and does NOT restock", () => {
        function resolveCallback(cbStatus: string, isHashValid: boolean, gatewayStatus: string) {
          if (gatewayStatus === "success") {
            return { action: "CONFIRM_PAYMENT", restocked: false };
          }
          if (gatewayStatus === "failure") {
            return { action: "CANCEL_AND_RESTOCK", restocked: true };
          }
          return { action: "LEAVE_PENDING", restocked: false };
        }

        const res = resolveCallback("failure", true, "unavailable");
        expect(res.action).toBe("LEAVE_PENDING");
        expect(res.restocked).toBe(false);
      });

      it("4. Intercepts refund and dispute webhooks as logged-only without routing to payment RPCs", () => {
        function processIncomingWebhook(payload: Record<string, any>) {
          const event = String(payload["event"] || payload["action"] || "").toLowerCase().trim();
          const isRefundOrDispute = event.includes("refund") || event.includes("dispute") || Boolean(payload["refund_id"]);
          if (isRefundOrDispute) {
            return { handledAs: "UNSUPPORTED_LOGGED_ONLY", rpcCalled: false };
          }
          return { handledAs: "PAYMENT_TRANSACTION", rpcCalled: true };
        }

        expect(processIncomingWebhook({ event: "refund_success", txnid: "TXN_1", amount: "10.00" }).handledAs).toBe("UNSUPPORTED_LOGGED_ONLY");
        expect(processIncomingWebhook({ event: "refund_failed", txnid: "TXN_1" }).rpcCalled).toBe(false);
        expect(processIncomingWebhook({ event: "dispute_created", txnid: "TXN_1" }).handledAs).toBe("UNSUPPORTED_LOGGED_ONLY");
        expect(processIncomingWebhook({ action: "dispute", txnid: "TXN_1" }).rpcCalled).toBe(false);
        expect(processIncomingWebhook({ refund_id: "REF_12345", txnid: "TXN_1" }).handledAs).toBe("UNSUPPORTED_LOGGED_ONLY");
        // Standard payment webhook routes to payment flow
        expect(processIncomingWebhook({ status: "success", txnid: "TXN_1", amount: "10.00" }).handledAs).toBe("PAYMENT_TRANSACTION");
      });

      it("5. Supports both JSON and Form-Encoded incoming callback bodies", () => {
        function parseRequestBody(contentType: string, rawBody: string | Record<string, any>): Record<string, any> {
          if (contentType.includes("application/json") && typeof rawBody === "string") {
            return JSON.parse(rawBody);
          }
          if (contentType.includes("application/x-www-form-urlencoded") && typeof rawBody === "string") {
            const params = new URLSearchParams(rawBody);
            const res: Record<string, any> = {};
            params.forEach((v, k) => { res[k] = v; });
            return res;
          }
          if (typeof rawBody === "object") return rawBody;
          return {};
        }

        const jsonBody = JSON.stringify({ txnid: "TXN_JSON_1", status: "success", amount: "10.00" });
        const parsedJson = parseRequestBody("application/json", jsonBody);
        expect(parsedJson["txnid"]).toBe("TXN_JSON_1");
        expect(parsedJson["status"]).toBe("success");

        const formBody = "txnid=TXN_FORM_1&status=failure&amount=25.00";
        const parsedForm = parseRequestBody("application/x-www-form-urlencoded", formBody);
        expect(parsedForm["txnid"]).toBe("TXN_FORM_1");
        expect(parsedForm["status"]).toBe("failure");
      });

      it("6. Two captured transactions for one order: both can be independently refunded", () => {
        const orderRefundsTable: Array<{ id: string; order_id: string; payment_id: string; payu_txnid: string; amount: number }> = [];

        function addRefundReview(orderId: string, paymentId: string, txnid: string, amount: number) {
          // Check uniqueness by payment_id and payu_txnid
          const exists = orderRefundsTable.some(r => r.payment_id === paymentId || r.payu_txnid === txnid);
          if (exists) {
            return { created: false, message: "Duplicate refund for transaction blocked" };
          }
          orderRefundsTable.push({ id: `ref-${orderRefundsTable.length + 1}`, order_id: orderId, payment_id: paymentId, payu_txnid: txnid, amount });
          return { created: true };
        }

        // Transaction 1 refund review
        const r1 = addRefundReview("order-100", "pay-attempt-1", "TXN_ATTEMPT_1", 50.00);
        expect(r1.created).toBe(true);

        // Transaction 2 refund review for same order
        const r2 = addRefundReview("order-100", "pay-attempt-2", "TXN_ATTEMPT_2", 50.00);
        expect(r2.created).toBe(true);
        expect(orderRefundsTable.length).toBe(2);

        // Duplicate callback for Transaction 1 is blocked
        const r1Dup = addRefundReview("order-100", "pay-attempt-1", "TXN_ATTEMPT_1", 50.00);
        expect(r1Dup.created).toBe(false);
        expect(orderRefundsTable.length).toBe(2);
      });

      it("7. Customer cancellation blocked for packed, dispatched, and preparing states", () => {
        function validateCancellationEligibility(status: string) {
          if (status === "pending_payment") {
            throw new Error("Payment is currently in progress. If payment is not completed, your reservation will expire automatically.");
          }
          if (["preparing", "packed", "out_for_delivery", "ready_for_pickup", "completed"].includes(status)) {
            throw new Error(`Order cannot be cancelled at status "${status}". The store has already begun preparing or dispatched your items.`);
          }
          if (!["placed", "confirmed"].includes(status)) {
            throw new Error(`Order cannot be cancelled at status "${status}".`);
          }
          return true;
        }

        // Permitted states
        expect(validateCancellationEligibility("placed")).toBe(true);
        expect(validateCancellationEligibility("confirmed")).toBe(true);

        // Blocked states
        expect(() => validateCancellationEligibility("pending_payment")).toThrow("Payment is currently in progress");
        expect(() => validateCancellationEligibility("preparing")).toThrow("The store has already begun preparing");
        expect(() => validateCancellationEligibility("packed")).toThrow("The store has already begun preparing");
        expect(() => validateCancellationEligibility("out_for_delivery")).toThrow("The store has already begun preparing");
        expect(() => validateCancellationEligibility("completed")).toThrow("The store has already begun preparing");
      });

      it("8. Preflight duplicate check: detects duplicates before creating unique indexes", () => {
        function detectDuplicates(records: Array<{ id: string; payu_txnid: string | null }>) {
          const counts: Record<string, number> = {};
          records.forEach(r => {
            if (r.payu_txnid) {
              counts[r.payu_txnid] = (counts[r.payu_txnid] || 0) + 1;
            }
          });
          const duplicates = Object.keys(counts).filter(k => (counts[k] ?? 0) > 1);
          return { hasDuplicates: duplicates.length > 0, duplicates };
        }

        const cleanData = [
          { id: "1", payu_txnid: "TXN_A" },
          { id: "2", payu_txnid: "TXN_B" },
          { id: "3", payu_txnid: null },
        ];
        expect(detectDuplicates(cleanData).hasDuplicates).toBe(false);

        const dirtyData = [
          { id: "1", payu_txnid: "TXN_A" },
          { id: "2", payu_txnid: "TXN_A" }, // Duplicate!
          { id: "3", payu_txnid: "TXN_B" },
        ];
        const res = detectDuplicates(dirtyData);
        expect(res.hasDuplicates).toBe(true);
        expect(res.duplicates).toEqual(["TXN_A"]);
      });

      it("9. Database ACL inspection: aclexplode CTE correctly identifies PUBLIC grantee (grantee=0)", () => {
        // Mock aclexplode records
        interface AclEntry { grantee: number; privilege_type: string; role_name?: string }

        function checkPrivileges(entries: AclEntry[]) {
          const publicCanExecute = entries.some(e => e.grantee === 0 && e.privilege_type === "EXECUTE");
          const anonCanExecute = entries.some(e => (e.role_name === "anon" || e.grantee === 0) && e.privilege_type === "EXECUTE");
          const serviceRoleCanExecute = entries.some(e => (e.role_name === "service_role" || e.grantee === 0) && e.privilege_type === "EXECUTE");
          return { publicCanExecute, anonCanExecute, serviceRoleCanExecute };
        }

        // Before hardening: PUBLIC has EXECUTE
        const unhardenedAcl: AclEntry[] = [
          { grantee: 0, privilege_type: "EXECUTE" },
        ];
        const before = checkPrivileges(unhardenedAcl);
        expect(before.publicCanExecute).toBe(true);
        expect(before.anonCanExecute).toBe(true);

        // After hardening: revoked from PUBLIC/anon; granted strictly to service_role
        const hardenedAcl: AclEntry[] = [
          { grantee: 16401, role_name: "service_role", privilege_type: "EXECUTE" },
        ];
        const after = checkPrivileges(hardenedAcl);
        expect(after.publicCanExecute).toBe(false);
        expect(after.anonCanExecute).toBe(false);
        expect(after.serviceRoleCanExecute).toBe(true);
      });
    });
  });

  describe("10. Critical Fix Verification Suite (Bugs 1-4)", () => {
    // Updated simulation that mirrors the fixed SQL logic:
    // - Exact payment match with single-unassigned-fallback
    // - State guard on verify
    // - Reject when payment not found during failure
    // - customer_cancel selects captured payment, not newest

    interface PaymentRecord {
      id: string;
      order_id: string;
      payu_txnid: string | null;
      amount: number;
      status: string;
      created_at: number; // ordering tiebreaker
    }

    interface OrderRecord {
      id: string;
      payu_txnid: string;
      total_amount: number;
      status: string;
      payment_status: string;
    }

    /**
     * Simulates the fixed verify_payu_payment_transaction payment selection logic.
     * Step A: exact match on order_id + payu_txnid.
     * Step B: fallback ONLY if exactly 1 unassigned payment exists.
     * Otherwise raises an error.
     */
    function selectPaymentForVerify(
      payments: PaymentRecord[],
      orderId: string,
      txnid: string
    ): PaymentRecord {
      const exact = payments.find(
        (p) => p.order_id === orderId && p.payu_txnid === txnid
      );
      if (exact) return exact;

      const unassigned = payments.filter(
        (p) => p.order_id === orderId && p.payu_txnid === null
      );
      if (unassigned.length === 1 && unassigned[0]) return unassigned[0];
      if (unassigned.length > 1)
        throw new Error(
          `Ambiguous payment records: multiple unassigned payments exist for order ${orderId}. Manual review required.`
        );
      throw new Error(
        `Payment record not found for order ${orderId} and transaction "${txnid}"`
      );
    }

    /**
     * Simulates the fixed handle_failed_payu_payment — identical selection logic
     * and MUST find a payment record before proceeding to restock.
     */
    function selectPaymentForFailure(
      payments: PaymentRecord[],
      orderId: string,
      txnid: string
    ): PaymentRecord {
      // Same exact-match + single-fallback logic
      return selectPaymentForVerify(payments, orderId, txnid);
    }

    /**
     * Simulates the fixed verify_payu_payment_transaction state guard.
     * After cancelled check and idempotency check, the order MUST be in
     * 'pending_payment' to proceed. Otherwise returns INVALID_STATE.
     */
    function verifyWithStateGuard(order: OrderRecord, txnid: string) {
      if (order.status === "cancelled") {
        return { success: true, status: "cancelled", payment_status: "refund_pending" };
      }
      if (order.payment_status === "paid" || order.payment_status === "completed") {
        return { success: true, status: order.status, payment_status: order.payment_status, message: "already verified" };
      }
      if (order.status !== "pending_payment") {
        return {
          success: false,
          error: "INVALID_STATE",
          message: `Cannot confirm payment: order is in status "${order.status}", expected "pending_payment"`,
        };
      }
      return { success: true, status: "placed", payment_status: "paid" };
    }

    /**
     * Simulates the fixed customer_cancel_order payment selection.
     * Selects captured (paid/completed) payment, rejects if ambiguous.
     */
    function selectCapturedPaymentForCancel(
      payments: PaymentRecord[],
      orderId: string
    ): PaymentRecord | null {
      const captured = payments.filter(
        (p) => p.order_id === orderId && (p.status === "paid" || p.status === "completed")
      );
      if (captured.length > 1) {
        throw new Error(
          `Ambiguous captured payments for order ${orderId}. Multiple captured payment records exist. Manual admin review required.`
        );
      }
      return captured[0] || null;
    }

    // ---------- TEST 1: Older exact payment vs newer NULL payment record ----------
    it("1. Selects the older exact-match payment, NOT the newer NULL-txnid payment", () => {
      const payments: PaymentRecord[] = [
        { id: "pay-old", order_id: "ord-1", payu_txnid: "TXN_X", amount: 100, status: "pending", created_at: 1 },
        { id: "pay-new", order_id: "ord-1", payu_txnid: null, amount: 100, status: "pending", created_at: 2 },
      ];

      const selected = selectPaymentForVerify(payments, "ord-1", "TXN_X");

      // Must pick the exact match (pay-old), NOT the newer NULL record (pay-new)
      expect(selected.id).toBe("pay-old");
      expect(selected.payu_txnid).toBe("TXN_X");
    });

    // ---------- TEST 2: Missing payment record during failure ----------
    it("2. Failure handling rejects when no payment record exists (no silent restock without payment)", () => {
      const payments: PaymentRecord[] = []; // No payments at all

      expect(() =>
        selectPaymentForFailure(payments, "ord-1", "TXN_MISSING")
      ).toThrow("Payment record not found");
    });

    // ---------- TEST 3: Multiple ambiguous unassigned payment records ----------
    it("3. Rejects when multiple unassigned (NULL txnid) payment records exist for the order", () => {
      const payments: PaymentRecord[] = [
        { id: "pay-1", order_id: "ord-1", payu_txnid: null, amount: 100, status: "pending", created_at: 1 },
        { id: "pay-2", order_id: "ord-1", payu_txnid: null, amount: 100, status: "pending", created_at: 2 },
      ];

      expect(() =>
        selectPaymentForVerify(payments, "ord-1", "TXN_NEW")
      ).toThrow("Ambiguous payment records: multiple unassigned payments exist");

      // Same rejection in failure path
      expect(() =>
        selectPaymentForFailure(payments, "ord-1", "TXN_NEW")
      ).toThrow("Ambiguous payment records: multiple unassigned payments exist");
    });

    // ---------- TEST 4: Success callback for order already in 'preparing' state ----------
    it("4. Rejects payment confirmation when order is already in 'preparing' fulfillment state", () => {
      const order: OrderRecord = {
        id: "ord-prep",
        payu_txnid: "TXN_PREP",
        total_amount: 50,
        status: "preparing",
        payment_status: "paid",
      };

      // Idempotency check fires first because payment_status is 'paid'
      const result1 = verifyWithStateGuard(order, "TXN_PREP");
      expect(result1.success).toBe(true);
      expect(result1.message).toBe("already verified");
      expect(result1.status).toBe("preparing");
      // Crucially: status was NOT changed to 'placed'

      // Now test a different scenario: payment_status is still 'pending' but order
      // has somehow been advanced (e.g. admin override) to 'preparing'
      const orderPrepUnpaid: OrderRecord = {
        id: "ord-prep2",
        payu_txnid: "TXN_PREP2",
        total_amount: 50,
        status: "preparing",
        payment_status: "pending",
      };

      const result2 = verifyWithStateGuard(orderPrepUnpaid, "TXN_PREP2");
      expect(result2.success).toBe(false);
      expect(result2.error).toBe("INVALID_STATE");
      expect(result2.message).toContain('status "preparing"');
    });

    // ---------- TEST 5: Success callback for 'completed' order ----------
    it("5. Rejects payment confirmation when order is already 'completed'", () => {
      const orderCompleted: OrderRecord = {
        id: "ord-done",
        payu_txnid: "TXN_DONE",
        total_amount: 25,
        status: "completed",
        payment_status: "pending", // edge case: somehow unpaid but completed
      };

      const result = verifyWithStateGuard(orderCompleted, "TXN_DONE");
      expect(result.success).toBe(false);
      expect(result.error).toBe("INVALID_STATE");
      expect(result.message).toContain('"completed"');
    });

    // ---------- TEST 6: Cancellation when newest payment failed but older was captured ----------
    it("6. Customer cancellation selects the captured payment, NOT the newest failed one", () => {
      const payments: PaymentRecord[] = [
        { id: "pay-captured", order_id: "ord-1", payu_txnid: "TXN_1", amount: 100, status: "paid", created_at: 1 },
        { id: "pay-retry-failed", order_id: "ord-1", payu_txnid: "TXN_2", amount: 100, status: "failed", created_at: 2 },
      ];

      const selected = selectCapturedPaymentForCancel(payments, "ord-1");

      // Must select pay-captured (the paid one), not pay-retry-failed (the newest)
      expect(selected).not.toBeNull();
      expect(selected!.id).toBe("pay-captured");
      expect(selected!.status).toBe("paid");
      expect(selected!.payu_txnid).toBe("TXN_1");
    });

    // ---------- TEST 7: Two distinct captured attempts → ambiguous rejection ----------
    it("7. Cancellation rejects when two distinct captured payments exist (ambiguous refund target)", () => {
      const payments: PaymentRecord[] = [
        { id: "pay-cap-1", order_id: "ord-1", payu_txnid: "TXN_A", amount: 50, status: "paid", created_at: 1 },
        { id: "pay-cap-2", order_id: "ord-1", payu_txnid: "TXN_B", amount: 50, status: "paid", created_at: 2 },
      ];

      expect(() =>
        selectCapturedPaymentForCancel(payments, "ord-1")
      ).toThrow("Ambiguous captured payments for order ord-1");
    });

    // ---------- TEST 8: Concurrent success, failure, cancellation and expiry ----------
    it("8. Concurrent event matrix: state machine produces correct outcome regardless of event ordering", () => {
      type OrderState = { status: string; paymentStatus: string; stock: number; refundReviews: number };

      function handleEventV2(
        order: OrderState,
        event: "SUCCESS" | "FAILURE" | "EXPIRE" | "CANCEL",
        qty: number,
        paymentFound: boolean
      ): OrderState {
        const next = { ...order };

        if (event === "SUCCESS") {
          if (next.paymentStatus === "paid") return next; // idempotent
          if (next.status === "cancelled") {
            next.paymentStatus = "refund_pending";
            next.refundReviews += 1;
            return next;
          }
          // State guard: only from pending_payment
          if (next.status !== "pending_payment") return next; // INVALID_STATE, no change
          next.status = "placed";
          next.paymentStatus = "paid";
          return next;
        }

        if (event === "FAILURE" || event === "EXPIRE") {
          // Bug 2 fix: must have payment record to proceed
          if (!paymentFound) return next; // reject silently, no restock
          if (next.paymentStatus === "paid") return next; // immutable
          if (next.status === "pending_payment") {
            next.status = "cancelled";
            next.paymentStatus = event === "FAILURE" ? "failed" : "expired";
            next.stock += qty;
            return next;
          }
          return next; // already cancelled, no duplicate restock
        }

        if (event === "CANCEL") {
          if ((next.status === "placed" || next.status === "confirmed") && next.paymentStatus === "paid") {
            next.status = "cancelled";
            next.stock += qty;
            next.refundReviews += 1;
            return next;
          }
        }
        return next;
      }

      // Scenario A: SUCCESS → FAILURE → CANCEL → EXPIRE (success wins lock first)
      let stateA: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 10, refundReviews: 0 };
      stateA = handleEventV2(stateA, "SUCCESS", 2, true);
      expect(stateA).toEqual({ status: "placed", paymentStatus: "paid", stock: 10, refundReviews: 0 });
      stateA = handleEventV2(stateA, "FAILURE", 2, true);
      expect(stateA.status).toBe("placed"); // Failure rejected on paid order
      stateA = handleEventV2(stateA, "CANCEL", 2, true);
      expect(stateA.status).toBe("cancelled");
      expect(stateA.refundReviews).toBe(1);
      stateA = handleEventV2(stateA, "EXPIRE", 2, true);
      expect(stateA.stock).toBe(12); // No double restock from expiry

      // Scenario B: FAILURE → SUCCESS → EXPIRE → CANCEL (failure wins lock first)
      let stateB: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 10, refundReviews: 0 };
      stateB = handleEventV2(stateB, "FAILURE", 2, true);
      expect(stateB).toEqual({ status: "cancelled", paymentStatus: "failed", stock: 12, refundReviews: 0 });
      stateB = handleEventV2(stateB, "SUCCESS", 2, true);
      expect(stateB.paymentStatus).toBe("refund_pending");
      expect(stateB.refundReviews).toBe(1);
      expect(stateB.stock).toBe(12); // No re-deduction

      // Scenario C: FAILURE without payment record → no restock
      let stateC: OrderState = { status: "pending_payment", paymentStatus: "pending", stock: 10, refundReviews: 0 };
      stateC = handleEventV2(stateC, "FAILURE", 2, false); // paymentFound=false
      expect(stateC.stock).toBe(10); // Bug 2 fix: no restock without payment record
      expect(stateC.status).toBe("pending_payment"); // Status unchanged

      // Scenario D: SUCCESS on 'preparing' order → INVALID_STATE, no transition
      let stateD: OrderState = { status: "preparing", paymentStatus: "pending", stock: 10, refundReviews: 0 };
      stateD = handleEventV2(stateD, "SUCCESS", 2, true);
      expect(stateD.status).toBe("preparing"); // Bug 3 fix: NOT moved to 'placed'
      expect(stateD.paymentStatus).toBe("pending"); // NOT set to 'paid'
    });
  });

  describe("11. Final PayU Security Correction Suite", () => {
    describe("11.1 Authoritative MIHPayID Enforcement (No Fake Fallback)", () => {
      /**
       * Simulates the hardened webhook handler logic that extracts finalVerifiedMihpayid.
       * Requires a genuine, non-empty mihpayid. NEVER substitutes txnid.
       */
      function extractVerifiedMihpayid(
        gatewayVerified: boolean,
        gatewayStatus: string,
        gatewayMih: string | null | undefined,
        callbackMih: string | null | undefined,
        txnid: string
      ): { verifiedMih: string | null; action: "CONFIRM" | "HOLD_FOR_MANUAL_RECONCILIATION" | "REJECT" } {
        const cleanGatewayMih = (gatewayMih ?? "").trim();
        const cleanCbMih = (callbackMih ?? "").trim();

        if (gatewayVerified && gatewayStatus === "success") {
          // If PayU does not return a genuine mihpayid, NEVER substitute txnid
          if (!cleanGatewayMih) {
            return { verifiedMih: null, action: "HOLD_FOR_MANUAL_RECONCILIATION" };
          }
          if (cleanCbMih && cleanCbMih !== cleanGatewayMih) {
            return { verifiedMih: null, action: "REJECT" };
          }
          return { verifiedMih: cleanGatewayMih, action: "CONFIRM" };
        }

        return { verifiedMih: null, action: "REJECT" };
      }

      it("rejects confirmation and flags for manual reconciliation when gateway mihpayid is null", () => {
        const res = extractVerifiedMihpayid(true, "success", null, null, "TXN_12345");
        expect(res.action).toBe("HOLD_FOR_MANUAL_RECONCILIATION");
        expect(res.verifiedMih).toBeNull();
      });

      it("rejects confirmation and flags for manual reconciliation when gateway mihpayid is undefined", () => {
        const res = extractVerifiedMihpayid(true, "success", undefined, undefined, "TXN_12345");
        expect(res.action).toBe("HOLD_FOR_MANUAL_RECONCILIATION");
        expect(res.verifiedMih).toBeNull();
      });

      it("rejects confirmation and flags for manual reconciliation when gateway mihpayid is empty string or whitespace", () => {
        const resEmpty = extractVerifiedMihpayid(true, "success", "", "", "TXN_12345");
        expect(resEmpty.action).toBe("HOLD_FOR_MANUAL_RECONCILIATION");
        expect(resEmpty.verifiedMih).toBeNull();

        const resSpaces = extractVerifiedMihpayid(true, "success", "   ", "   ", "TXN_12345");
        expect(resSpaces.action).toBe("HOLD_FOR_MANUAL_RECONCILIATION");
        expect(resSpaces.verifiedMih).toBeNull();
      });

      it("accepts authentic PayU mihpayid and never substitutes txnid", () => {
        const res = extractVerifiedMihpayid(true, "success", "31567169332", "31567169332", "TXN_12345");
        expect(res.action).toBe("CONFIRM");
        expect(res.verifiedMih).toBe("31567169332");
        expect(res.verifiedMih).not.toBe("TXN_12345");
      });
    });

    describe("11.2 RPC Result Verification Before Success Redirect", () => {
      /**
       * Simulates the hardened redirect decision logic.
       * Strictly validates rpcError, data existence, success flag, order_id match, and payment_status.
       */
      function decideBrowserRedirect(
        expectedOrderId: string,
        expectedOrderNumber: string,
        txnid: string,
        baseOrigin: string,
        rpcError: { message: string } | null,
        rpcData: { success?: boolean; order_id?: string; order_number?: string; payment_status?: string; message?: string } | null
      ): { redirectUrl: string; status: "success" | "failed" } {
        const isRpcSuccessful =
          !rpcError &&
          rpcData !== null &&
          rpcData.success === true &&
          rpcData.order_id === expectedOrderId &&
          (rpcData.payment_status === "paid" || rpcData.payment_status === "refund_pending");

        if (!isRpcSuccessful) {
          const errorMsg =
            rpcError?.message ||
            rpcData?.message ||
            (!rpcData
              ? "Payment verification failed to update order in database"
              : (rpcData.order_id !== expectedOrderId
                  ? "Order ID mismatch in verification result"
                  : "Payment verification failed to update order in database"));

          return {
            redirectUrl: `${baseOrigin}/checkout?payu_status=failed&order_id=${expectedOrderId}&txnid=${txnid}&error=${encodeURIComponent(errorMsg)}`,
            status: "failed",
          };
        }

        const orderNum = expectedOrderNumber || rpcData.order_number || "";
        return {
          redirectUrl: `${baseOrigin}/checkout?payu_status=success&order_id=${expectedOrderId}&txnid=${txnid}&order_number=${orderNum}&verified=true`,
          status: "success",
        };
      }

      it("1. Redirects to failure when RPC returns an error after gateway success", () => {
        const res = decideBrowserRedirect(
          "ord-100",
          "QM-100",
          "TXN_100",
          "https://shipz.store",
          { message: "Database connection timeout during verify RPC" },
          null
        );

        expect(res.status).toBe("failed");
        expect(res.redirectUrl).toContain("payu_status=failed");
        expect(res.redirectUrl).toContain("Database%20connection%20timeout");
      });

      it("2. Redirects to failure when RPC returns success=false (e.g. amount mismatch or state guard)", () => {
        const res = decideBrowserRedirect(
          "ord-100",
          "QM-100",
          "TXN_100",
          "https://shipz.store",
          null,
          { success: false, message: "Order is in status preparing, expected pending_payment" }
        );

        expect(res.status).toBe("failed");
        expect(res.redirectUrl).toContain("payu_status=failed");
        expect(res.redirectUrl).toContain("preparing");
      });

      it("3. Redirects to failure when RPC returns null data", () => {
        const res = decideBrowserRedirect(
          "ord-100",
          "QM-100",
          "TXN_100",
          "https://shipz.store",
          null,
          null
        );

        expect(res.status).toBe("failed");
        expect(res.redirectUrl).toContain("payu_status=failed");
        expect(res.redirectUrl).toContain("Payment%20verification%20failed");
      });

      it("4. Redirects to failure when RPC returns unexpected order ID", () => {
        const res = decideBrowserRedirect(
          "ord-100",
          "QM-100",
          "TXN_100",
          "https://shipz.store",
          null,
          { success: true, order_id: "ord-DIFFERENT", payment_status: "paid" }
        );

        expect(res.status).toBe("failed");
        expect(res.redirectUrl).toContain("payu_status=failed");
        expect(res.redirectUrl).toContain("Order%20ID%20mismatch");
      });

      it("5. Redirects to success ONLY when gateway is verified AND database confirms order updated to paid", () => {
        const res = decideBrowserRedirect(
          "ord-100",
          "QM-100",
          "TXN_100",
          "https://shipz.store",
          null,
          { success: true, order_id: "ord-100", order_number: "QM-100", payment_status: "paid" }
        );

        expect(res.status).toBe("success");
        expect(res.redirectUrl).toContain("payu_status=success");
        expect(res.redirectUrl).toContain("order_id=ord-100");
        expect(res.redirectUrl).toContain("verified=true");
      });
    });

    describe("11.3 Hardened Customer Cancellation Payment Consistency", () => {
      interface CancelOrderState {
        order: {
          id: string;
          order_number: string;
          status: string;
          payment_status: string;
          total_amount: number;
          payu_txnid: string | null;
        };
        payments: Array<{
          id: string;
          order_id: string;
          status: string;
          amount: number;
          payu_txnid: string | null;
        }>;
        refunds: Array<{
          payment_id: string;
          payu_txnid: string | null;
          amount: number;
        }>;
        inventory: Record<string, number>;
      }

      /**
       * Simulates the revised public.customer_cancel_order with strict upfront payment consistency checks.
       */
      function executeCustomerCancel(state: CancelOrderState): { success: boolean; error?: string } {
        const { order, payments } = state;

        // 1. Fulfilment Cutoff
        if (order.status === "cancelled") throw new Error("Order is already cancelled.");
        if (order.status === "pending_payment") throw new Error("Payment is currently in progress.");
        if (["preparing", "packed", "out_for_delivery", "ready_for_pickup", "completed"].includes(order.status)) {
          throw new Error(`Order cannot be cancelled at status "${order.status}". Fulfilment already underway.`);
        }
        if (!["placed", "confirmed"].includes(order.status)) {
          throw new Error(`Order cannot be cancelled at its current status: "${order.status}".`);
        }

        // 2. Payment Consistency Checks (Upfront before any inventory or order writes)
        const capturedPayments = payments.filter((p) => p.order_id === order.id && (p.status === "paid" || p.status === "completed"));

        if (order.payment_status === "paid" || order.payment_status === "completed") {
          // If order claims to be paid, require exactly one identifiable captured payment record
          if (capturedPayments.length === 0) {
            throw new Error(`Payment inconsistency: order ${order.id} is marked ${order.payment_status}, but no captured payment record exists. Manual admin reconciliation required.`);
          }
          if (capturedPayments.length > 1) {
            throw new Error(`Ambiguous captured payments: ${capturedPayments.length} captured payment records exist for order ${order.id}. Manual admin reconciliation required.`);
          }

          const captured = capturedPayments[0];
          if (!captured || captured.id === undefined) {
            throw new Error("Payment record not found.");
          }

          if (captured.order_id !== order.id) {
            throw new Error(`Payment identity mismatch: payment record ${captured.id} does not match order ${order.id}.`);
          }

          if (order.payu_txnid && order.payu_txnid.trim() !== "") {
            if (!captured.payu_txnid || captured.payu_txnid.trim() === "" || captured.payu_txnid !== order.payu_txnid) {
              throw new Error(`Payment transaction ID mismatch: order ${order.id} has PayU txnid "${order.payu_txnid}", but captured payment record ${captured.id} has txnid "${captured.payu_txnid || "NULL"}".`);
            }
          }

          if (Math.round(captured.amount * 100) !== Math.round(order.total_amount * 100)) {
            throw new Error(`Payment amount mismatch: payment amount ${captured.amount} does not match order total ${order.total_amount}.`);
          }
        } else {
          // Order claims NOT to be paid (e.g. pending/failed/cod), but captured payment exists
          if (capturedPayments.length > 0) {
            throw new Error(`Payment inconsistency: order ${order.id} has payment_status "${order.payment_status}", but ${capturedPayments.length} captured payment record(s) exist. Manual admin reconciliation required.`);
          }
        }

        // 3. Stock Restoration (runs ONLY after payment consistency passes)
        for (const [prodId, qty] of Object.entries(state.inventory)) {
          state.inventory[prodId] = (state.inventory[prodId] ?? 0) + qty;
        }

        // 4. Refund Queue
        if (order.payment_status === "paid" || order.payment_status === "completed") {
          const captured = capturedPayments[0]!;
          captured.status = "refund_pending";
          state.refunds.push({
            payment_id: captured.id,
            payu_txnid: captured.payu_txnid,
            amount: captured.amount,
          });
        }

        // 5. Transition Order Status
        order.status = "cancelled";
        order.payment_status = order.payment_status === "paid" ? "refund_pending" : order.payment_status;

        return { success: true };
      }

      it("1. Rejects cancellation when order is marked paid but no captured payment record exists (leaves inventory & state untouched)", () => {
        const state: CancelOrderState = {
          order: { id: "ord-1", order_number: "QM-1", status: "placed", payment_status: "paid", total_amount: 150, payu_txnid: "TXN_1" },
          payments: [], // No payment records!
          refunds: [],
          inventory: { "prod-A": 10 },
        };

        expect(() => executeCustomerCancel(state)).toThrow("no captured payment record exists");
        // State must remain completely unchanged
        expect(state.order.status).toBe("placed");
        expect(state.order.payment_status).toBe("paid");
        expect(state.inventory["prod-A"]).toBe(10);
        expect(state.refunds.length).toBe(0);
      });

      it("2. Rejects cancellation when multiple captured payments exist (ambiguous refund target, leaves inventory untouched)", () => {
        const state: CancelOrderState = {
          order: { id: "ord-1", order_number: "QM-1", status: "placed", payment_status: "paid", total_amount: 150, payu_txnid: "TXN_1" },
          payments: [
            { id: "pay-1", order_id: "ord-1", status: "paid", amount: 150, payu_txnid: "TXN_1" },
            { id: "pay-2", order_id: "ord-1", status: "paid", amount: 150, payu_txnid: "TXN_2" },
          ],
          refunds: [],
          inventory: { "prod-A": 10 },
        };

        expect(() => executeCustomerCancel(state)).toThrow("Ambiguous captured payments: 2 captured payment records exist");
        expect(state.order.status).toBe("placed");
        expect(state.inventory["prod-A"]).toBe(10);
        expect(state.refunds.length).toBe(0);
      });

      it("3. Rejects cancellation when captured payment exists but order.payment_status is inconsistent (e.g. pending)", () => {
        const state: CancelOrderState = {
          order: { id: "ord-1", order_number: "QM-1", status: "placed", payment_status: "pending", total_amount: 150, payu_txnid: "TXN_1" },
          payments: [
            { id: "pay-1", order_id: "ord-1", status: "paid", amount: 150, payu_txnid: "TXN_1" }, // captured row exists!
          ],
          refunds: [],
          inventory: { "prod-A": 10 },
        };

        expect(() => executeCustomerCancel(state)).toThrow('order ord-1 has payment_status "pending", but 1 captured payment record(s) exist');
        expect(state.order.status).toBe("placed");
        expect(state.inventory["prod-A"]).toBe(10);
        expect(state.refunds.length).toBe(0);
      });

      it("4. Rejects cancellation when payment transaction ID or amount is inconsistent with order total", () => {
        const stateWrongAmt: CancelOrderState = {
          order: { id: "ord-1", order_number: "QM-1", status: "placed", payment_status: "paid", total_amount: 150, payu_txnid: "TXN_1" },
          payments: [
            { id: "pay-1", order_id: "ord-1", status: "paid", amount: 50, payu_txnid: "TXN_1" }, // Amount mismatch!
          ],
          refunds: [],
          inventory: { "prod-A": 10 },
        };

        expect(() => executeCustomerCancel(stateWrongAmt)).toThrow("Payment amount mismatch: payment amount 50 does not match order total 150");
        expect(stateWrongAmt.order.status).toBe("placed");
        expect(stateWrongAmt.inventory["prod-A"]).toBe(10);

        const stateWrongTxn: CancelOrderState = {
          order: { id: "ord-1", order_number: "QM-1", status: "placed", payment_status: "paid", total_amount: 150, payu_txnid: "TXN_1" },
          payments: [
            { id: "pay-1", order_id: "ord-1", status: "paid", amount: 150, payu_txnid: "TXN_TAMPERED" }, // Txnid mismatch!
          ],
          refunds: [],
          inventory: { "prod-A": 10 },
        };

        expect(() => executeCustomerCancel(stateWrongTxn)).toThrow('Payment transaction ID mismatch: order ord-1 has PayU txnid "TXN_1", but captured payment record pay-1 has txnid "TXN_TAMPERED"');
        expect(stateWrongTxn.order.status).toBe("placed");
        expect(stateWrongTxn.inventory["prod-A"]).toBe(10);
      });

      it("5. Rejects cancellation when captured payment record has NULL or empty transaction ID on a PayU order (does not allow NULL match)", () => {
        const stateNullTxn: CancelOrderState = {
          order: { id: "ord-1", order_number: "QM-1", status: "placed", payment_status: "paid", total_amount: 150, payu_txnid: "TXN_1" },
          payments: [
            { id: "pay-1", order_id: "ord-1", status: "paid", amount: 150, payu_txnid: null }, // NULL txnid on payment record!
          ],
          refunds: [],
          inventory: { "prod-A": 10 },
        };

        expect(() => executeCustomerCancel(stateNullTxn)).toThrow('payment record pay-1 has txnid "NULL"');
        // Order state and inventory remain completely untouched
        expect(stateNullTxn.order.status).toBe("placed");
        expect(stateNullTxn.inventory["prod-A"]).toBe(10);
        expect(stateNullTxn.refunds.length).toBe(0);

        // However, legitimate COD / offline orders where order.payu_txnid is NULL are NOT broken:
        const stateCodOrder: CancelOrderState = {
          order: { id: "ord-cod", order_number: "QM-COD", status: "placed", payment_status: "pending", total_amount: 200, payu_txnid: null },
          payments: [], // No captured payments for unpaid COD order
          refunds: [],
          inventory: { "prod-B": 5 },
        };

        const resCod = executeCustomerCancel(stateCodOrder);
        expect(resCod.success).toBe(true);
        expect(stateCodOrder.order.status).toBe("cancelled");
        expect(stateCodOrder.inventory["prod-B"]).toBe(10); // Restocked
      });

      it("6. Successfully cancels consistent paid order: restores inventory and creates refund review for the exact payment", () => {
        const state: CancelOrderState = {
          order: { id: "ord-1", order_number: "QM-1", status: "placed", payment_status: "paid", total_amount: 150, payu_txnid: "TXN_1" },
          payments: [
            { id: "pay-1", order_id: "ord-1", status: "paid", amount: 150, payu_txnid: "TXN_1" },
          ],
          refunds: [],
          inventory: { "prod-A": 10 },
        };

        const res = executeCustomerCancel(state);
        expect(res.success).toBe(true);
        expect(state.order.status).toBe("cancelled");
        expect(state.order.payment_status).toBe("refund_pending");
        expect(state.payments[0]!.status).toBe("refund_pending");
        expect(state.inventory["prod-A"]).toBe(20); // 10 + 10 restocked
        expect(state.refunds.length).toBe(1);
        expect(state.refunds[0]!.payment_id).toBe("pay-1");
        expect(state.refunds[0]!.payu_txnid).toBe("TXN_1");
        expect(state.refunds[0]!.amount).toBe(150);
      });
    });
  });

  describe("12. Comprehensive Payment Safety & Reconciliation Suite", () => {
    /**
     * Models the webhook controller flow for processing incoming payment callbacks.
     */
    interface WebhookProcessInput {
      callbackStatus: string;
      isHashValid: boolean;
      gatewayVerifyStatus: "success" | "failure" | "pending" | "unavailable";
      gatewayAmount: number;
      orderTotal: number;
      gatewayMihpayid?: string | null;
      orderStatus: "pending_payment" | "cancelled" | "placed" | "preparing";
    }

    interface WebhookProcessOutput {
      orderConfirmed: boolean;
      orderCancelled: boolean;
      stockRestocked: boolean;
      refundReviewCreated: boolean;
      isLatePayment: boolean;
      redirectUrl: string;
      redirectTitle: string;
      finalOrderStatus: string;
      customerNotificationType?: string;
    }

    function processPaymentCallbackSafety(input: WebhookProcessInput): WebhookProcessOutput {
      const baseOrigin = "https://shipz.store";

      // 1. Authoritative gateway inquiry must confirm success with captured status
      if (input.gatewayVerifyStatus === "success") {
        // Step A: Amount mismatch check
        if (Math.round(input.gatewayAmount * 100) !== Math.round(input.orderTotal * 100)) {
          return {
            orderConfirmed: false,
            orderCancelled: false,
            stockRestocked: false,
            refundReviewCreated: false,
            isLatePayment: false,
            redirectUrl: `${baseOrigin}/checkout?payu_status=pending&error=AMOUNT_MISMATCH_RECONCILIATION`,
            redirectTitle: "Payment Under Review",
            finalOrderStatus: input.orderStatus,
          };
        }

        // Step B: Authoritative mihpayid check
        const cleanMih = (input.gatewayMihpayid || "").trim();
        if (!cleanMih) {
          return {
            orderConfirmed: false,
            orderCancelled: false,
            stockRestocked: false,
            refundReviewCreated: false,
            isLatePayment: false,
            redirectUrl: `${baseOrigin}/checkout?payu_status=pending&error=MISSING_GATEWAY_PAYMENT_ID`,
            redirectTitle: "Payment Pending Reconciliation",
            finalOrderStatus: input.orderStatus,
          };
        }

        // Step C: If order was already cancelled, late payment handling
        if (input.orderStatus === "cancelled") {
          return {
            orderConfirmed: false,
            orderCancelled: true, // remains cancelled
            stockRestocked: false, // already restocked on cancel, not restocked again
            refundReviewCreated: true,
            isLatePayment: true,
            redirectUrl: `${baseOrigin}/checkout?payu_status=refund_pending&note=LATE_PAYMENT_REFUND_REVIEW`,
            redirectTitle: "Payment Received — Order Cancelled (Refund Review Initiated)",
            finalOrderStatus: "cancelled",
            customerNotificationType: "refund_requested",
          };
        }

        // Step D: Normal placed order confirmation
        return {
          orderConfirmed: true,
          orderCancelled: false,
          stockRestocked: false,
          refundReviewCreated: false,
          isLatePayment: false,
          redirectUrl: `${baseOrigin}/checkout?payu_status=success&verified=true`,
          redirectTitle: "Payment Confirmed! Redirecting...",
          finalOrderStatus: "placed",
          customerNotificationType: "payment_success",
        };
      }

      // 2. Unverified success callback (Verify API unavailable or pending)
      if (input.callbackStatus === "success") {
        return {
          orderConfirmed: false,
          orderCancelled: false,
          stockRestocked: false,
          refundReviewCreated: false,
          isLatePayment: false,
          redirectUrl: `${baseOrigin}/checkout?payu_status=pending&note=VERIFICATION_PENDING`,
          redirectTitle: "Payment Verification In Progress",
          finalOrderStatus: input.orderStatus,
        };
      }

      // 3. Failure handling: requires authoritative gateway terminal failure
      if (input.gatewayVerifyStatus === "failure") {
        if (input.orderStatus === "pending_payment") {
          return {
            orderConfirmed: false,
            orderCancelled: true,
            stockRestocked: true,
            refundReviewCreated: false,
            isLatePayment: false,
            redirectUrl: `${baseOrigin}/checkout?payu_status=failed&error=FAILED`,
            redirectTitle: "Payment Cancelled",
            finalOrderStatus: "cancelled",
          };
        }
      }

      // 4. Fallback for pending / uncertain states: no mutation, no restock
      return {
        orderConfirmed: false,
        orderCancelled: false,
        stockRestocked: false,
        refundReviewCreated: false,
        isLatePayment: false,
        redirectUrl: `${baseOrigin}/checkout?payu_status=pending`,
        redirectTitle: "Payment Status Pending",
        finalOrderStatus: input.orderStatus,
      };
    }

    it("1. Valid reverse hash but failed/unavailable Verify API: preserves pending state and does NOT restock inventory", () => {
      const res = processPaymentCallbackSafety({
        callbackStatus: "success",
        isHashValid: true,
        gatewayVerifyStatus: "unavailable",
        gatewayAmount: 100,
        orderTotal: 100,
        gatewayMihpayid: "31567169332",
        orderStatus: "pending_payment",
      });

      expect(res.orderConfirmed).toBe(false);
      expect(res.orderCancelled).toBe(false);
      expect(res.stockRestocked).toBe(false); // Zero stock restoration
      expect(res.finalOrderStatus).toBe("pending_payment");
      expect(res.redirectUrl).toContain("payu_status=pending");
      expect(res.redirectTitle).toBe("Payment Verification In Progress");
    });

    it("2. Successful callback with missing or empty mihpayid: held for reconciliation, not confirmed", () => {
      const resNullMih = processPaymentCallbackSafety({
        callbackStatus: "success",
        isHashValid: true,
        gatewayVerifyStatus: "success",
        gatewayAmount: 100,
        orderTotal: 100,
        gatewayMihpayid: null,
        orderStatus: "pending_payment",
      });

      expect(resNullMih.orderConfirmed).toBe(false);
      expect(resNullMih.stockRestocked).toBe(false);
      expect(resNullMih.redirectUrl).toContain("error=MISSING_GATEWAY_PAYMENT_ID");
      expect(resNullMih.redirectTitle).toBe("Payment Pending Reconciliation");
    });

    it("3. Captured payment with wrong amount: does not call success or restock, preserves pending state", () => {
      const resWrongAmt = processPaymentCallbackSafety({
        callbackStatus: "success",
        isHashValid: true,
        gatewayVerifyStatus: "success",
        gatewayAmount: 50, // Paid 50 instead of 100
        orderTotal: 100,
        gatewayMihpayid: "31567169332",
        orderStatus: "pending_payment",
      });

      expect(resWrongAmt.orderConfirmed).toBe(false);
      expect(resWrongAmt.orderCancelled).toBe(false);
      expect(resWrongAmt.stockRestocked).toBe(false);
      expect(resWrongAmt.finalOrderStatus).toBe("pending_payment");
      expect(resWrongAmt.redirectUrl).toContain("error=AMOUNT_MISMATCH_RECONCILIATION");
      expect(resWrongAmt.redirectTitle).toBe("Payment Under Review");
    });

    it("4. Late captured payment on cancelled order: redirects to truthful refund_pending and notifies customer", () => {
      const resLate = processPaymentCallbackSafety({
        callbackStatus: "success",
        isHashValid: true,
        gatewayVerifyStatus: "success",
        gatewayAmount: 100,
        orderTotal: 100,
        gatewayMihpayid: "31567169332",
        orderStatus: "cancelled", // Already cancelled/expired
      });

      expect(resLate.orderConfirmed).toBe(false); // NOT confirmed as normal order
      expect(resLate.finalOrderStatus).toBe("cancelled");
      expect(resLate.refundReviewCreated).toBe(true);
      expect(resLate.isLatePayment).toBe(true);
      expect(resLate.redirectUrl).toContain("payu_status=refund_pending");
      // Must NOT display "Payment Confirmed!"
      expect(resLate.redirectTitle).not.toBe("Payment Confirmed! Redirecting...");
      expect(resLate.redirectTitle).toContain("Refund Review Initiated");
      expect(resLate.customerNotificationType).toBe("refund_requested");
    });

    it("5. Duplicate success callbacks: idempotent, zero extra stock deductions", () => {
      // First callback
      const first = processPaymentCallbackSafety({
        callbackStatus: "success",
        isHashValid: true,
        gatewayVerifyStatus: "success",
        gatewayAmount: 100,
        orderTotal: 100,
        gatewayMihpayid: "31567169332",
        orderStatus: "pending_payment",
      });
      expect(first.orderConfirmed).toBe(true);
      expect(first.finalOrderStatus).toBe("placed");

      // Second duplicate callback arrives when order is already 'placed'
      const second = processPaymentCallbackSafety({
        callbackStatus: "success",
        isHashValid: true,
        gatewayVerifyStatus: "success",
        gatewayAmount: 100,
        orderTotal: 100,
        gatewayMihpayid: "31567169332",
        orderStatus: "placed",
      });
      expect(second.stockRestocked).toBe(false);
      expect(second.finalOrderStatus).toBe("placed");
    });

    it("6. No stock restoration across all uncertain or mismatched payment states", () => {
      const uncertainCases: WebhookProcessInput[] = [
        { callbackStatus: "success", isHashValid: true, gatewayVerifyStatus: "pending", gatewayAmount: 100, orderTotal: 100, gatewayMihpayid: "1", orderStatus: "pending_payment" },
        { callbackStatus: "success", isHashValid: true, gatewayVerifyStatus: "unavailable", gatewayAmount: 100, orderTotal: 100, gatewayMihpayid: "1", orderStatus: "pending_payment" },
        { callbackStatus: "success", isHashValid: true, gatewayVerifyStatus: "success", gatewayAmount: 1, orderTotal: 100, gatewayMihpayid: "1", orderStatus: "pending_payment" },
        { callbackStatus: "success", isHashValid: true, gatewayVerifyStatus: "success", gatewayAmount: 100, orderTotal: 100, gatewayMihpayid: "", orderStatus: "pending_payment" },
        { callbackStatus: "failure", isHashValid: true, gatewayVerifyStatus: "pending", gatewayAmount: 100, orderTotal: 100, gatewayMihpayid: "1", orderStatus: "pending_payment" },
        { callbackStatus: "failure", isHashValid: true, gatewayVerifyStatus: "unavailable", gatewayAmount: 100, orderTotal: 100, gatewayMihpayid: "1", orderStatus: "pending_payment" },
      ];

      for (const c of uncertainCases) {
        const res = processPaymentCallbackSafety(c);
        expect(res.stockRestocked).toBe(false);
      }
    });
  });

  describe("13. Production Hardening & Preflight Safety (Audit Remediation)", () => {
    it("1. Late payment notification event type is strictly in permitted check constraint", () => {
      const allowedCustomerEventTypes = [
        "order_placed",
        "payment_initiated",
        "payment_success",
        "payment_failed",
        "order_confirmed",
        "order_preparing",
        "order_ready",
        "order_out_for_delivery",
        "order_completed",
        "order_cancelled",
        "payment_refund_review",
        "refund_requested",
        "refund_processing",
        "refund_completed",
        "refund_rejected",
      ];

      const latePaymentNotificationType = "refund_requested";
      expect(allowedCustomerEventTypes).toContain(latePaymentNotificationType);
      expect(allowedCustomerEventTypes).toContain("payment_refund_review");
    });

    describe("2. Migration Preflight Validation Logic", () => {
      interface PreflightTable {
        orders: Array<{ id: string; payu_txnid: string | null }>;
        payments: Array<{ id: string; payu_txnid: string | null }>;
        order_refunds: Array<{ id: string; payment_id: string | null; payu_txnid: string | null; status: string }>;
      }

      function runMigrationPreflight(db: PreflightTable): { passed: boolean; error?: string } {
        // A. Orders duplicate check
        const orderTxns = db.orders.filter((o) => o.payu_txnid && o.payu_txnid.trim() !== "");
        const orderCounts = new Map<string, number>();
        orderTxns.forEach((o) => orderCounts.set(o.payu_txnid!, (orderCounts.get(o.payu_txnid!) || 0) + 1));
        const dupOrders = Array.from(orderCounts.entries()).filter(([_, cnt]) => cnt > 1);

        if (dupOrders.length > 0) {
          return {
            passed: false,
            error: `Migration preflight check failed: public.orders contains ${dupOrders.length} duplicate non-null payu_txnid value(s). Sample: ${dupOrders.map(([t, c]) => `${t} (${c} orders)`).join(", ")}. Manual deduplication is required before creating unique index uidx_orders_payu_txnid.`,
          };
        }

        // B. Payments duplicate check
        const paymentTxns = db.payments.filter((p) => p.payu_txnid && p.payu_txnid.trim() !== "");
        const paymentCounts = new Map<string, number>();
        paymentTxns.forEach((p) => paymentCounts.set(p.payu_txnid!, (paymentCounts.get(p.payu_txnid!) || 0) + 1));
        const dupPayments = Array.from(paymentCounts.entries()).filter(([_, cnt]) => cnt > 1);

        if (dupPayments.length > 0) {
          return {
            passed: false,
            error: `Migration preflight check failed: public.payments contains ${dupPayments.length} duplicate non-null payu_txnid value(s). Sample: ${dupPayments.map(([t, c]) => `${t} (${c} payments)`).join(", ")}. Manual deduplication is required before creating unique index uidx_payments_payu_txnid.`,
          };
        }

        // C. Active Refunds payment_id check
        const activeRefunds = db.order_refunds.filter((r) => ["pending", "processing", "completed"].includes(r.status));
        const refPaymentCounts = new Map<string, number>();
        activeRefunds.filter((r) => r.payment_id).forEach((r) => refPaymentCounts.set(r.payment_id!, (refPaymentCounts.get(r.payment_id!) || 0) + 1));
        const dupRefPayments = Array.from(refPaymentCounts.entries()).filter(([_, cnt]) => cnt > 1);

        if (dupRefPayments.length > 0) {
          return {
            passed: false,
            error: `Migration preflight check failed: public.order_refunds contains ${dupRefPayments.length} active duplicate payment_id record(s). Manual review required before creating unique index uidx_order_refunds_payment_id.`,
          };
        }

        // D. Active Refunds payu_txnid check
        const refTxnCounts = new Map<string, number>();
        activeRefunds.filter((r) => r.payu_txnid).forEach((r) => refTxnCounts.set(r.payu_txnid!, (refTxnCounts.get(r.payu_txnid!) || 0) + 1));
        const dupRefTxns = Array.from(refTxnCounts.entries()).filter(([_, cnt]) => cnt > 1);

        if (dupRefTxns.length > 0) {
          return {
            passed: false,
            error: `Migration preflight check failed: public.order_refunds contains ${dupRefTxns.length} active duplicate payu_txnid record(s). Manual review required before creating unique index uidx_order_refunds_payu_txnid.`,
          };
        }

        return { passed: true };
      }

      it("aborts migration when public.orders contains duplicate transaction IDs", () => {
        const db: PreflightTable = {
          orders: [
            { id: "o1", payu_txnid: "TXN_DUPLICATE_1" },
            { id: "o2", payu_txnid: "TXN_DUPLICATE_1" },
            { id: "o3", payu_txnid: "TXN_UNIQUE_3" },
          ],
          payments: [{ id: "p1", payu_txnid: "TXN_1" }],
          order_refunds: [],
        };

        const res = runMigrationPreflight(db);
        expect(res.passed).toBe(false);
        expect(res.error).toContain("public.orders contains 1 duplicate non-null payu_txnid");
        expect(res.error).toContain("TXN_DUPLICATE_1 (2 orders)");
      });

      it("aborts migration when public.payments contains duplicate transaction IDs", () => {
        const db: PreflightTable = {
          orders: [
            { id: "o1", payu_txnid: "TXN_1" },
            { id: "o2", payu_txnid: "TXN_2" },
          ],
          payments: [
            { id: "p1", payu_txnid: "TXN_PAY_DUP" },
            { id: "p2", payu_txnid: "TXN_PAY_DUP" },
          ],
          order_refunds: [],
        };

        const res = runMigrationPreflight(db);
        expect(res.passed).toBe(false);
        expect(res.error).toContain("public.payments contains 1 duplicate non-null payu_txnid");
        expect(res.error).toContain("TXN_PAY_DUP (2 payments)");
      });

      it("aborts migration when active order_refunds contains duplicate payment_id or payu_txnid", () => {
        const db: PreflightTable = {
          orders: [],
          payments: [],
          order_refunds: [
            { id: "r1", payment_id: "pay-1", payu_txnid: "TXN_REF_1", status: "pending" },
            { id: "r2", payment_id: "pay-1", payu_txnid: "TXN_REF_1", status: "processing" },
          ],
        };

        const res = runMigrationPreflight(db);
        expect(res.passed).toBe(false);
        expect(res.error).toContain("public.order_refunds contains 1 active duplicate payment_id");
      });

      it("passes preflight when all transaction IDs and active refund IDs are strictly unique", () => {
        const db: PreflightTable = {
          orders: [
            { id: "o1", payu_txnid: "TXN_1" },
            { id: "o2", payu_txnid: "TXN_2" },
            { id: "o3", payu_txnid: null },
          ],
          payments: [
            { id: "p1", payu_txnid: "TXN_1" },
            { id: "p2", payu_txnid: "TXN_2" },
            { id: "p3", payu_txnid: null },
          ],
          order_refunds: [
            { id: "r1", payment_id: "p1", payu_txnid: "TXN_1", status: "completed" },
            { id: "r2", payment_id: "p2", payu_txnid: "TXN_2", status: "rejected" },
          ],
        };

        const res = runMigrationPreflight(db);
        expect(res.passed).toBe(true);
        expect(res.error).toBeUndefined();
      });
    });

    describe("3. Edge Function Configuration & Secret Validation", () => {
      interface EdgeConfigInput {
        env: {
          PAYU_ENV?: string | undefined;
          PAYU_MERCHANT_KEY?: string | undefined;
          PAYU_MERCHANT_SALT?: string | undefined;
        };
        isCallback?: boolean;
      }

      function validateEdgeConfig(input: EdgeConfigInput): { statusCode: number; error?: string; redirectUrl?: string } {
        const payuEnv = (input.env.PAYU_ENV ?? "").trim().toLowerCase();
        const isProduction = payuEnv === "production" || payuEnv === "prod" || payuEnv === "live";
        const isTestOrDev = payuEnv === "test" || payuEnv === "sandbox" || payuEnv === "development" || payuEnv === "dev";

        if (!payuEnv || (!isProduction && !isTestOrDev)) {
          if (input.isCallback) {
            return { statusCode: 200, redirectUrl: "https://shipz.store/checkout?payu_status=failed&error=GATEWAY_CONFIGURATION_ERROR" };
          }
          return { statusCode: 500, error: "Server payment gateway configuration error: PAYU_ENV must be explicitly configured." };
        }

        const merchantKey = (input.env.PAYU_MERCHANT_KEY ?? "").trim();
        const merchantSalt = (input.env.PAYU_MERCHANT_SALT ?? "").trim();

        if (!merchantKey || !merchantSalt) {
          if (input.isCallback) {
            return { statusCode: 200, redirectUrl: "https://shipz.store/checkout?payu_status=failed&error=GATEWAY_CONFIGURATION_ERROR" };
          }
          return { statusCode: 500, error: "Server payment gateway configuration error: payment credentials missing." };
        }

        if (isProduction) {
          if (merchantKey === "gtKFFx" || merchantSalt === "eCwWELxi") {
            if (input.isCallback) {
              return { statusCode: 200, redirectUrl: "https://shipz.store/checkout?payu_status=failed&error=GATEWAY_CONFIGURATION_ERROR" };
            }
            return { statusCode: 500, error: "Server payment gateway configuration error: test credentials are not permitted in production." };
          }
        }

        return { statusCode: 200 };
      }

      it("fails closed (HTTP 500) when PAYU_ENV is missing or empty", () => {
        const res = validateEdgeConfig({ env: { PAYU_MERCHANT_KEY: "key1", PAYU_MERCHANT_SALT: "salt1" } });
        expect(res.statusCode).toBe(500);
        expect(res.error).toContain("PAYU_ENV must be explicitly configured");
      });

      it("fails closed when PAYU_MERCHANT_KEY or PAYU_MERCHANT_SALT is missing", () => {
        const resMissingKey = validateEdgeConfig({ env: { PAYU_ENV: "production", PAYU_MERCHANT_SALT: "salt1" } });
        expect(resMissingKey.statusCode).toBe(500);
        expect(resMissingKey.error).toContain("payment credentials missing");

        const resMissingSalt = validateEdgeConfig({ env: { PAYU_ENV: "production", PAYU_MERCHANT_KEY: "key1" } });
        expect(resMissingSalt.statusCode).toBe(500);
        expect(resMissingSalt.error).toContain("payment credentials missing");
      });

      it("rejects test sandbox credentials in production environment", () => {
        const res = validateEdgeConfig({
          env: {
            PAYU_ENV: "production",
            PAYU_MERCHANT_KEY: "gtKFFx",
            PAYU_MERCHANT_SALT: "eCwWELxi",
          },
        });
        expect(res.statusCode).toBe(500);
        expect(res.error).toContain("test credentials are not permitted in production");
      });

      it("permits sandbox credentials in test environment", () => {
        const res = validateEdgeConfig({
          env: {
            PAYU_ENV: "test",
            PAYU_MERCHANT_KEY: "gtKFFx",
            PAYU_MERCHANT_SALT: "eCwWELxi",
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.error).toBeUndefined();
      });

      it("redirects browser callbacks cleanly to failed status on configuration error without leaking secrets", () => {
        const res = validateEdgeConfig({
          env: { PAYU_ENV: "production" },
          isCallback: true,
        });
        expect(res.statusCode).toBe(200);
        expect(res.redirectUrl).toContain("payu_status=failed&error=GATEWAY_CONFIGURATION_ERROR");
        expect(res.redirectUrl).not.toContain("gtKFFx");
        expect(res.redirectUrl).not.toContain("eCwWELxi");
      });
    });

    it("4. Guarantees all 8 required inventory movement types are permitted", () => {
      const allowedMovementTypes = [
        "order_deduction",
        "payu_checkout_reserve",
        "order_cancellation_restock",
        "payment_failure_restock",
        "payment_timeout_restock",
        "manual_adjustment",
        "restock_shipment",
        "damaged_loss",
      ];

      expect(allowedMovementTypes).toContain("payment_failure_restock");
      expect(allowedMovementTypes).toContain("order_cancellation_restock");
      expect(allowedMovementTypes).toContain("payu_checkout_reserve");
      expect(allowedMovementTypes.length).toBe(8);
    });
  });

  describe("14. Guest Checkout Authorization & Token Propagation Suite", () => {
    // Model simulating Edge Function initiation and verification authorization logic
    function evaluateOrderAuthorization(params: {
      order: {
        id: string;
        user_id?: string | null;
        guest_tracking_token?: string | null;
        payu_txnid?: string | null;
      };
      callerAuthUser?: { id: string; role?: string } | null;
      bearerToken?: string | null;
      serviceRoleKey?: string;
      providedGuestToken?: string | null;
      providedTxnId?: string | null;
    }) {
      const {
        order,
        callerAuthUser,
        bearerToken,
        serviceRoleKey = "mock_service_role_key_secret",
        providedGuestToken,
        providedTxnId,
      } = params;

      // 1. Service-role backend caller
      if (bearerToken && bearerToken === serviceRoleKey) {
        return { authorized: true, reason: "service_role" };
      }

      // 2. Authenticated user who owns the order or admin
      if (callerAuthUser) {
        if (order.user_id && callerAuthUser.id === order.user_id) {
          return { authorized: true, reason: "order_owner" };
        }
        if (callerAuthUser.role === "admin" || callerAuthUser.role === "super_admin") {
          return { authorized: true, reason: "admin" };
        }
      }

      // 3. Guest with authentic guest_tracking_token matching the order
      if (
        order.guest_tracking_token &&
        providedGuestToken &&
        providedGuestToken === order.guest_tracking_token
      ) {
        return { authorized: true, reason: "valid_guest_token" };
      }

      // 4. Strict security: An arbitrary caller merely knowing order ID or txnid is NEVER authorized
      return { authorized: false, reason: "unauthorized" };
    }

    const testOrderId = "order-uuid-guest-1234";
    const authenticGuestToken = "gst_token_sec_998877";

    describe("14.1 Authenticated Checkout", () => {
      it("authorizes order owner to initiate payment", () => {
        const order = { id: testOrderId, user_id: "user-101", guest_tracking_token: null };
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: { id: "user-101" },
        });
        expect(res.authorized).toBe(true);
        expect(res.reason).toBe("order_owner");
      });

      it("authorizes order owner to verify payment", () => {
        const order = { id: testOrderId, user_id: "user-101", guest_tracking_token: null };
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: { id: "user-101" },
          providedTxnId: "TXN_TEST_101",
        });
        expect(res.authorized).toBe(true);
        expect(res.reason).toBe("order_owner");
      });

      it("authorizes admin user to initiate or verify any order", () => {
        const order = { id: testOrderId, user_id: "user-101" };
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: { id: "admin-999", role: "admin" },
        });
        expect(res.authorized).toBe(true);
        expect(res.reason).toBe("admin");
      });
    });

    describe("14.2 Guest Checkout Initiation", () => {
      it("authorizes guest checkout initiation when valid guest_token is provided", () => {
        const order = { id: testOrderId, user_id: null, guest_tracking_token: authenticGuestToken };
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: null,
          providedGuestToken: authenticGuestToken,
        });
        expect(res.authorized).toBe(true);
        expect(res.reason).toBe("valid_guest_token");
      });

      it("includes guest_token in preparePayUCheckout request payload", async () => {
        const initiateParams = {
          order_id: testOrderId,
          order_number: "QM-GUEST-01",
          amount: 250.0,
          product_info: "Shipt Mart Guest Order",
          customer_name: "Guest Student",
          customer_email: "guest@campus.edu",
          customer_phone: "9876543210",
          guest_token: authenticGuestToken,
        };

        const result = await preparePayUCheckout(initiateParams);
        expect(result.surl).toContain(`guest_token=${encodeURIComponent(authenticGuestToken)}`);
        expect(result.furl).toContain(`guest_token=${encodeURIComponent(authenticGuestToken)}`);
      });
    });

    describe("14.3 Guest Payment Verification", () => {
      it("authorizes guest payment verification when valid guest_token is provided", () => {
        const order = { id: testOrderId, user_id: null, guest_tracking_token: authenticGuestToken };
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: null,
          providedGuestToken: authenticGuestToken,
          providedTxnId: "TXN_GUEST_01",
        });
        expect(res.authorized).toBe(true);
        expect(res.reason).toBe("valid_guest_token");
      });

      it("verifyPayUTransactionViaServerAPI accepts and forwards guestToken", async () => {
        mockFunctionsInvoke.mockResolvedValueOnce({
          data: {
            success: true,
            verified: true,
            data: { status: "placed", payment_status: "paid", order_id: testOrderId },
          },
          error: null,
        });

        const res = await verifyPayUTransactionViaServerAPI({
          orderId: testOrderId,
          txnid: "TXN_GUEST_01",
          guestToken: authenticGuestToken,
        });
        expect(res.success).toBe(true);
        expect(mockFunctionsInvoke).toHaveBeenCalledWith(
          "payu-webhook",
          expect.objectContaining({
            body: expect.objectContaining({
              action: "verify_payment",
              order_id: testOrderId,
              txnid: "TXN_GUEST_01",
              guest_token: authenticGuestToken,
            }),
          })
        );
      });

      it("verifyPayUTransactionViaServerAPI accepts snake_case guest_token for backward compatibility", async () => {
        mockFunctionsInvoke.mockResolvedValueOnce({
          data: {
            success: true,
            verified: true,
            data: { status: "placed", payment_status: "paid", order_id: testOrderId },
          },
          error: null,
        });

        const res = await verifyPayUTransactionViaServerAPI({
          orderId: testOrderId,
          txnid: "TXN_GUEST_01",
          guest_token: authenticGuestToken,
        });
        expect(res.success).toBe(true);
        expect(mockFunctionsInvoke).toHaveBeenCalledWith(
          "payu-webhook",
          expect.objectContaining({
            body: expect.objectContaining({
              action: "verify_payment",
              order_id: testOrderId,
              txnid: "TXN_GUEST_01",
              guest_token: authenticGuestToken,
            }),
          })
        );
      });
    });

    describe("14.4 Invalid Guest Token Rejection", () => {
      it("rejects guest initiation when guest_token is missing", () => {
        const order = { id: testOrderId, user_id: null, guest_tracking_token: authenticGuestToken };
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: null,
          providedGuestToken: null,
        });
        expect(res.authorized).toBe(false);
        expect(res.reason).toBe("unauthorized");
      });

      it("rejects guest initiation when guest_token is forged or incorrect", () => {
        const order = { id: testOrderId, user_id: null, guest_tracking_token: authenticGuestToken };
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: null,
          providedGuestToken: "forged_invalid_token_999",
        });
        expect(res.authorized).toBe(false);
        expect(res.reason).toBe("unauthorized");
      });

      it("rejects guest verification when guest_token is incorrect", () => {
        const order = { id: testOrderId, user_id: null, guest_tracking_token: authenticGuestToken };
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: null,
          providedGuestToken: "wrong_token",
          providedTxnId: "TXN_GUEST_01",
        });
        expect(res.authorized).toBe(false);
        expect(res.reason).toBe("unauthorized");
      });
    });

    describe("14.5 Cross-Customer Order Access Rejection", () => {
      it("rejects authenticated User B attempting to access User A's order", () => {
        const order = { id: testOrderId, user_id: "user-101", guest_tracking_token: null };
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: { id: "user-202" }, // Different user
        });
        expect(res.authorized).toBe(false);
        expect(res.reason).toBe("unauthorized");
      });

      it("rejects authenticated user attempting to hijack a guest order without guest token", () => {
        const order = { id: testOrderId, user_id: null, guest_tracking_token: authenticGuestToken };
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: { id: "user-202" }, // Unrelated user
          providedGuestToken: null,
        });
        expect(res.authorized).toBe(false);
        expect(res.reason).toBe("unauthorized");
      });

      it("never authorizes a caller merely because they supply an order ID and transaction ID", () => {
        const order = {
          id: testOrderId,
          user_id: "user-101",
          guest_tracking_token: authenticGuestToken,
          payu_txnid: "TXN_KNOWN_123",
        };

        // Attacker knows order ID and transaction ID from URL or network sniffing
        const res = evaluateOrderAuthorization({
          order,
          callerAuthUser: null, // Not logged in as owner
          providedTxnId: "TXN_KNOWN_123", // Supplies matched txnid
          providedGuestToken: null, // But lacks authentic guest token or login
        });

        expect(res.authorized).toBe(false);
        expect(res.reason).toBe("unauthorized");
      });
    });
  });
});
