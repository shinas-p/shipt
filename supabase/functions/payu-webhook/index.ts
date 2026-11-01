import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Standard CORS headers for Shipt Mart Edge Requests
 */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

/**
 * Computes SHA-512 hex checksum in Edge Runtime
 */
async function sha512(str: string): Promise<string> {
  const buffer = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-512", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Explicit allowed origin domains for redirects
// In production: only exact production storefront domains are accepted (no wildcards, no localhost)
const PRODUCTION_ALLOWED_ORIGINS = [
  "https://www.shipz.store",
  "https://shipz.store",
];

// Development origins (isolated strictly to development environment)
const DEV_ALLOWED_ORIGINS = [
  "https://www.shipz.store",
  "https://shipz.store",
  "https://shipt.lovable.app",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
];

/**
 * Constant-time string comparison to prevent timing attack vulnerabilities
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Decimal-safe currency comparison (compares exact integer cents)
 */
function isAmountEqual(amt1: number | string | undefined | null, amt2: number | string | undefined | null): boolean {
  if (amt1 === undefined || amt1 === null || amt2 === undefined || amt2 === null) return false;
  const n1 = typeof amt1 === "number" ? amt1 : parseFloat(String(amt1));
  const n2 = typeof amt2 === "number" ? amt2 : parseFloat(String(amt2));
  if (isNaN(n1) || isNaN(n2) || n1 <= 0 || n2 <= 0) return false;
  return Math.round(n1 * 100) === Math.round(n2 * 100);
}

/**
 * Sanitizes and validates return redirect origins against domain allowlist
 * Production strictly permits ONLY https://shipz.store and https://www.shipz.store
 */
function sanitizeOrigin(rawOrigin?: string | null, isProduction = true): string {
  const defaultOrigin = "https://www.shipz.store";
  if (!rawOrigin) return defaultOrigin;
  try {
    const parsed = new URL(rawOrigin);
    const origin = parsed.origin.toLowerCase();
    const allowed = isProduction ? PRODUCTION_ALLOWED_ORIGINS : DEV_ALLOWED_ORIGINS;
    if (allowed.includes(origin)) {
      return origin;
    }
  } catch {
    // Malformed URL falls back to primary production domain
  }
  return defaultOrigin;
}

/**
 * Creates a cross-browser HTML auto-redirect response with smooth progress indicator
 */
function createRedirectHtml(redirectUrl: string, title = "Payment Confirmed — Redirecting..."): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0;url=${redirectUrl}" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0b0f19; color: #fff; }
    .card { text-align: center; max-width: 420px; padding: 36px; background: #121826; border-radius: 20px; border: 1px solid #232d42; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    .spinner { width: 38px; height: 38px; border: 3px solid rgba(255,255,255,0.1); border-top-color: #22c55e; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #f8fafc; }
    p { margin: 0 0 16px; font-size: 14px; color: #94a3b8; }
    a { color: #22c55e; text-decoration: none; font-weight: 600; font-size: 13px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>${title}</h2>
    <p>Transferring securely to your order summary...</p>
    <a href="${redirectUrl}">Click here if you are not redirected automatically</a>
  </div>
  <script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

/**
 * Executes PayU India's official Verify Payment API (command: "verify_payment")
 * Official endpoints:
 *   Production: https://info.payu.in/merchant/postservice.php?form=2
 *   Sandbox:    https://test.payu.in/merchant/postservice.php?form=2
 * Hash formula: sha512(key|command|var1|salt)
 */
async function verifyPaymentWithPayU(
  merchantKey: string,
  merchantSalt: string,
  txnid: string,
  payuEnv: string
): Promise<{
  verified: boolean;
  status: "success" | "failure" | "pending" | "unavailable";
  mihpayid?: string;
  amount?: number;
  mode?: string;
  error?: string;
  raw?: any;
}> {
  try {
    const postServiceUrl =
      payuEnv === "production"
        ? "https://info.payu.in/merchant/postservice.php?form=2"
        : "https://test.payu.in/merchant/postservice.php?form=2";

    const hashString = `${merchantKey}|verify_payment|${txnid}|${merchantSalt}`;
    const hash = await sha512(hashString);

    const formParams = new URLSearchParams();
    formParams.append("key", merchantKey);
    formParams.append("command", "verify_payment");
    formParams.append("var1", txnid);
    formParams.append("hash", hash);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(postServiceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: formParams.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return { verified: false, status: "unavailable", error: `PayU HTTP status ${res.status}` };
    }

    const json = await res.json();
    // PayU Verify Payment API protocol:
    // json.status === 1 means the inquiry command succeeded.
    // json.status === 0 means command failed or no transaction found.
    if (!json || json.status !== 1 || !json.transaction_details) {
      return {
        verified: false,
        status: "pending",
        error: json?.msg || "Transaction inquiry returned status 0 or missing transaction details",
        raw: json,
      };
    }

    // Strict transaction ID lookup - never fallback to an arbitrary transaction in the dictionary
    const details = json.transaction_details[txnid];
    if (!details) {
      return {
        verified: false,
        status: "pending",
        error: `Transaction ${txnid} not found in PayU gateway response`,
        raw: json,
      };
    }

    // Verify transaction ID in details strictly matches requested txnid
    if (details.txnid && String(details.txnid).trim() !== txnid.trim()) {
      return {
        verified: false,
        status: "failure",
        error: `Transaction ID mismatch in PayU response: requested ${txnid}, received ${details.txnid}`,
        raw: details,
      };
    }

    const statusLower = (details.status || "").toLowerCase().trim();
    const unmappedLower = (details.unmappedstatus || "").toLowerCase().trim();

    // In official PayU Verify Payment API:
    // status is "success" AND unmappedstatus is "captured" (or omitted / "success")
    // Non-captured states: "auth" (authorized only, not captured), "bounced", "failed", "usercancelled", "pending"
    const isExplicitNonCapture =
      ["bounced", "failed", "usercancelled", "pending", "auth", "dropped"].includes(unmappedLower) ||
      statusLower === "failure" ||
      statusLower === "pending";

    // Strict state verification: Normal payment confirmation requires status 'success' AND unmappedstatus 'captured' (or omitted when status is success)
    const isCaptured =
      statusLower === "success" &&
      !isExplicitNonCapture &&
      (unmappedLower === "captured" || (!unmappedLower && statusLower === "success"));

    if (unmappedLower === "auth") {
      return {
        verified: false,
        status: "pending",
        mihpayid: String(details.mihpayid || ""),
        error: "Payment authorized but not yet captured (unmappedstatus: auth)",
        raw: details,
      };
    }

    if (isCaptured) {
      const parsedAmt = parseFloat(details.amt || details.transaction_amount || "0");
      const mihpayid = String(details.mihpayid || "").trim();

      if (!mihpayid) {
        return {
          verified: false,
          status: "pending",
          error: "PayU response missing required mihpayid",
          raw: details,
        };
      }

      if (parsedAmt <= 0) {
        return {
          verified: false,
          status: "pending",
          error: "PayU verified transaction amount is zero or invalid",
          raw: details,
        };
      }

      return {
        verified: true,
        status: "success",
        mihpayid,
        amount: parsedAmt,
        mode: details.mode || details.bankcode || "online",
        raw: details,
      };
    }

    const isFailed =
      statusLower === "failure" ||
      ["failed", "bounced", "usercancelled"].includes(unmappedLower);

    if (isFailed) {
      return {
        verified: false,
        status: "failure",
        mihpayid: String(details.mihpayid || ""),
        error: details.error_Message || details.error_code || `Payment failed at gateway (${details.unmappedstatus || details.status})`,
        raw: details,
      };
    }

    return {
      verified: false,
      status: "pending",
      mihpayid: String(details.mihpayid || ""),
      error: `Payment status is ${details.status} (${details.unmappedstatus || "in progress"})`,
      raw: details,
    };
  } catch (err: any) {
    return {
      verified: false,
      status: "unavailable",
      error: err?.message || "Verify Payment API connection failed",
    };
  }
}

/**
 * PayU Webhook & Callback Verification Handler
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const rawMerchantKey = Deno.env.get("PAYU_MERCHANT_KEY");
    const rawMerchantSalt = Deno.env.get("PAYU_MERCHANT_SALT");
    const rawPayuEnv = Deno.env.get("PAYU_ENV");

    const payuEnv = (rawPayuEnv ?? "").trim().toLowerCase();
    const isProduction = payuEnv === "production" || payuEnv === "prod" || payuEnv === "live";
    const isTestOrDev = payuEnv === "test" || payuEnv === "sandbox" || payuEnv === "development" || payuEnv === "dev";

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let body: Record<string, any> = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      formData.forEach((value, key) => {
        body[key] = value.toString();
      });
    } else {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    const url = new URL(req.url);
    const actionParam = url.searchParams.get("action") || body.action;
    const isCallbackAction = actionParam === "callback";
    const initialRawOrigin = url.searchParams.get("origin") || body.origin;
    const initialSafeOrigin = sanitizeOrigin(initialRawOrigin, isProduction);

    // Fail closed: Require explicit PAYU_ENV
    if (!payuEnv || (!isProduction && !isTestOrDev)) {
      console.error("[PayU Configuration Error] PAYU_ENV is not configured. Must be set to 'production' or 'test'.");
      if (isCallbackAction) {
        return createRedirectHtml(`${initialSafeOrigin}/checkout?payu_status=failed&error=GATEWAY_CONFIGURATION_ERROR`, "Payment Configuration Error");
      }
      return new Response(
        JSON.stringify({ error: "Server payment gateway configuration error: PAYU_ENV must be explicitly configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const merchantKey = (rawMerchantKey ?? "").trim();
    const merchantSalt = (rawMerchantSalt ?? "").trim();

    // Fail closed: Require non-empty PAYU_MERCHANT_KEY and PAYU_MERCHANT_SALT
    if (!merchantKey || !merchantSalt) {
      console.error("[PayU Configuration Error] PAYU_MERCHANT_KEY or PAYU_MERCHANT_SALT is missing from environment.");
      if (isCallbackAction) {
        return createRedirectHtml(`${initialSafeOrigin}/checkout?payu_status=failed&error=GATEWAY_CONFIGURATION_ERROR`, "Payment Configuration Error");
      }
      return new Response(
        JSON.stringify({ error: "Server payment gateway configuration error: payment credentials missing." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fail closed: In production, strictly reject known test/sandbox credentials
    if (isProduction) {
      if (merchantKey === "gtKFFx" || merchantSalt === "eCwWELxi") {
        console.error("[PayU Configuration Error] Insecure configuration: Test sandbox credentials cannot be used in production.");
        if (isCallbackAction) {
          return createRedirectHtml(`${initialSafeOrigin}/checkout?payu_status=failed&error=GATEWAY_CONFIGURATION_ERROR`, "Payment Configuration Error");
        }
        return new Response(
          JSON.stringify({ error: "Server payment gateway configuration error: test credentials are not permitted in production." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // =========================================================================
    // 0. INTERCEPT REFUND & DISPUTE WEBHOOKS (Acknowledged & Logged for Admin Review)
    // =========================================================================
    const webhookEvent = String(body.event || body.action || url.searchParams.get("event") || "").toLowerCase().trim();
    const isRefundOrDispute =
      webhookEvent.includes("refund") ||
      webhookEvent.includes("dispute") ||
      !!body.refund_id ||
      !!body.refundId;

    if (isRefundOrDispute) {
      const eventTxnid = body.txnid || body.merchantTransactionId || url.searchParams.get("txnid") || "UNSPECIFIED";
      await supabase.from("payu_transactions").insert({
        txnid: eventTxnid,
        action: `webhook_${webhookEvent || "refund_dispute"}`,
        request_payload: body,
        response_payload: { acknowledged: true, note: "Refund/dispute webhook recorded for manual reconciliation" },
        status: "logged_only",
        is_verified: false,
      });

      return new Response(
        JSON.stringify({
          success: true,
          acknowledged: true,
          event: webhookEvent || "refund_dispute",
          message: "Refund/dispute event recorded. Manual admin review required.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // 1. ACTION: INITIATE CHECKOUT (Sign SHA-512 request hash server-side)
    // =========================================================================
    if (actionParam === "initiate") {
      const {
        order_id,
        order_number,
        customer_name,
        customer_email,
        customer_phone,
        product_info,
        origin,
        guest_token,
      } = body;

      if (!order_id) {
        return new Response(
          JSON.stringify({ error: "Missing required parameter: order_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate order exists in DB to prevent arbitrary hash generation
      const { data: orderData, error: orderErr } = await supabase
        .from("orders")
        .select("id, order_number, total_amount, status, payu_txnid, user_id, guest_tracking_token")
        .eq("id", order_id)
        .single();

      if (orderErr || !orderData) {
        return new Response(
          JSON.stringify({ error: "Order not found or invalid" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Secure Order Initiation Access Authorization Check:
      // Caller must be authenticated customer who owns the order, admin, service_role, or have matching guest_token
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

      let isInitiateAuthorized = false;
      if (bearerToken && bearerToken === serviceRoleKey) {
        isInitiateAuthorized = true;
      } else if (bearerToken) {
        const { data: authUserData } = await supabase.auth.getUser(bearerToken);
        const authUser = authUserData?.user;
        if (authUser && (authUser.id === orderData.user_id || authUser.app_metadata?.role === "admin" || authUser.user_metadata?.role === "admin")) {
          isInitiateAuthorized = true;
        }
      }

      if (!isInitiateAuthorized && orderData.guest_tracking_token && guest_token && guest_token === orderData.guest_tracking_token) {
        isInitiateAuthorized = true;
      }

      if (!isInitiateAuthorized) {
        return new Response(
          JSON.stringify({ error: "Unauthorized access: You do not have permission to initiate payment for this order." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cleanPrefix = (orderData.order_number || order_number || "QM").replace(/[^a-zA-Z0-9]/g, "");
      const txnid = (body.txnid || orderData.payu_txnid || `TXN_${cleanPrefix}_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`).trim();
      const formattedAmount = Number(orderData.total_amount).toFixed(2);
      const cleanName = (customer_name || "Customer")
        .trim()
        .split(" ")[0]
        ?.replace(/[^a-zA-Z0-9]/g, "") || "Customer";
      const cleanEmail = (customer_email || "student@campus.edu").trim().toLowerCase();
      const cleanPhone = (customer_phone || "").replace(/[^0-9]/g, "").slice(-10);
      const cleanProdInfo = (product_info || `Shipt Mart Order ${cleanPrefix}`)
        .replace(/[#<>{}$%^&*()+=/\\|~`]/g, "")
        .replace(/\s+/g, " ")
        .trim() || "Shipt Mart Order";
      const isProd = payuEnv === "production" || payuEnv === "prod" || payuEnv === "live";
      const safeOrigin = sanitizeOrigin(origin, isProd);

      // Server-side Callback Endpoint: POST requests from PayU reach this edge function first
      const edgeCallbackEndpoint = supabaseUrl ? `${supabaseUrl}/functions/v1/payu-webhook` : "";
      const surl = edgeCallbackEndpoint
        ? `${edgeCallbackEndpoint}?action=callback&origin=${encodeURIComponent(safeOrigin)}&order_id=${orderData.id}&txnid=${txnid}&amount=${formattedAmount}`
        : `${safeOrigin}/checkout?payu_status=success&txnid=${txnid}&order_id=${orderData.id}&amount=${formattedAmount}`;
      const furl = edgeCallbackEndpoint
        ? `${edgeCallbackEndpoint}?action=callback&origin=${encodeURIComponent(safeOrigin)}&order_id=${orderData.id}&txnid=${txnid}&amount=${formattedAmount}`
        : `${safeOrigin}/checkout?payu_status=failed&txnid=${txnid}&order_id=${orderData.id}&amount=${formattedAmount}`;

      // Sync generated txnid to database
      if (orderData.payu_txnid !== txnid) {
        await supabase
          .from("orders")
          .update({ payu_txnid: txnid, updated_at: new Date().toISOString() })
          .eq("id", orderData.id);

        await supabase
          .from("payments")
          .update({ payu_txnid: txnid, updated_at: new Date().toISOString() })
          .eq("order_id", orderData.id);
      }

      const u1 = (orderData.id || "").trim();
      const u2 = (orderData.order_number || "").trim();
      const u3 = (orderData.guest_tracking_token || guest_token || "").trim();
      const u4 = "";
      const u5 = "";

      // Official PayU Hosted Checkout SHA-512 request hash formula (Classic 32-bit Salt):
      // sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
      // Exactly 16 pipes: 10 between key and udf5, plus 6 trailing pipes representing udf6..udf10 and salt.
      const hashString = `${merchantKey}|${txnid}|${formattedAmount}|${cleanProdInfo}|${cleanName}|${cleanEmail}|${u1}|${u2}|${u3}|${u4}|${u5}||||||${merchantSalt}`;
      const hash = await sha512(hashString);
      const actionUrl = payuEnv === "production" ? "https://secure.payu.in/_payment" : "https://test.payu.in/_payment";

      return new Response(
        JSON.stringify({
          success: true,
          payload: {
            key: merchantKey,
            txnid,
            amount: formattedAmount,
            productinfo: cleanProdInfo,
            firstname: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            surl,
            furl,
            hash,
            action_url: actionUrl,
            udf1: u1,
            udf2: u2,
            udf3: u3,
            udf4: u4,
            udf5: u5,
            service_provider: "payu_paisa",
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // 2. ACTION: ON-DEMAND SERVER-SIDE VERIFY (Via PayU Verify Payment API)
    // =========================================================================
    if (actionParam === "verify" || actionParam === "verify_payment") {
      const order_id = body.order_id || url.searchParams.get("order_id");
      const txnid = body.txnid || url.searchParams.get("txnid");
      const guest_token = body.guest_token || url.searchParams.get("guest_token");

      if (!txnid && !order_id) {
        return new Response(
          JSON.stringify({ error: "Missing required parameter: txnid or order_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Query order in database with ownership details
      let query = supabase.from("orders").select("id, order_number, total_amount, status, payment_status, payu_txnid, user_id, guest_tracking_token");
      if (order_id) query = query.eq("id", order_id);
      else if (txnid) query = query.eq("payu_txnid", txnid);

      const { data: orderData, error: fetchErr } = await query.single();
      if (fetchErr || !orderData) {
        return new Response(
          JSON.stringify({ error: "Order not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Secure Order Access Authorization Check:
      // Verify caller is either:
      // 1. Authenticated customer who owns the order
      // 2. Service-role backend caller
      // 3. Guest with matching guest_tracking_token
      // 4. Guest checkout where txnid exactly matches orderData.payu_txnid
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

      let isAuthorized = false;
      if (bearerToken && bearerToken === serviceRoleKey) {
        isAuthorized = true;
      } else if (bearerToken) {
        const { data: authUserData } = await supabase.auth.getUser(bearerToken);
        const authUser = authUserData?.user;
        if (authUser && (authUser.id === orderData.user_id || authUser.app_metadata?.role === "admin" || authUser.user_metadata?.role === "admin")) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized && orderData.guest_tracking_token && guest_token && guest_token === orderData.guest_tracking_token) {
        isAuthorized = true;
      }

      if (!isAuthorized && !orderData.user_id && txnid && orderData.payu_txnid === txnid) {
        isAuthorized = true;
      }

      if (!isAuthorized) {
        return new Response(
          JSON.stringify({ error: "Unauthorized access: You do not have permission to verify this order." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Idempotency: if already paid, return confirmed
      if (orderData.payment_status === "paid" || orderData.status === "placed") {
        return new Response(
          JSON.stringify({
            success: true,
            verified: true,
            already_verified: true,
            data: {
              order_id: orderData.id,
              order_number: orderData.order_number,
              status: orderData.status,
              payment_status: orderData.payment_status,
            },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const activeTxnId = orderData.payu_txnid || txnid;
      const verifyRes = await verifyPaymentWithPayU(merchantKey, merchantSalt, activeTxnId, payuEnv);

      if (verifyRes.verified && verifyRes.status === "success") {
        // Double-check amount matches expected order total
        const expectedAmt = Number(orderData.total_amount).toFixed(2);
        const verifiedAmt = Number(verifyRes.amount).toFixed(2);

        if (expectedAmt !== verifiedAmt) {
          return new Response(
            JSON.stringify({
              error: `Amount mismatch: expected ${expectedAmt}, gateway verified ${verifiedAmt}`,
              verified: false,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const validMih = String(verifyRes.mihpayid || "").trim();
        if (!validMih) {
          await supabase.from("payu_transactions").insert({
            order_id: orderData.id,
            txnid: activeTxnId,
            action: "missing_mihpayid",
            request_payload: { order_id: orderData.id, txnid: activeTxnId },
            response_payload: verifyRes.raw || {},
            status: "pending_reconciliation",
            is_verified: false,
          });

          return new Response(
            JSON.stringify({
              success: false,
              verified: false,
              status: "pending",
              error: "PayU Verify API returned empty mihpayid. Flagged for manual reconciliation.",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: rpcData, error: rpcErr } = await supabase.rpc("verify_payu_payment_transaction", {
          p_order_id: orderData.id,
          p_txnid: activeTxnId,
          p_mihpayid: validMih,
          p_amount: verifyRes.amount,
          p_status: "success",
          p_mode: verifyRes.mode || "online",
          p_response_payload: verifyRes.raw || {},
          p_verified_via: "server_verify_api",
        });

        const isRpcSuccessful =
          !rpcErr &&
          rpcData &&
          rpcData.success === true &&
          rpcData.order_id === orderData.id &&
          (rpcData.payment_status === "paid" || rpcData.payment_status === "refund_pending");

        if (!isRpcSuccessful) {
          const errorMsg =
            rpcErr?.message ||
            rpcData?.message ||
            (!rpcData
              ? "Payment verification failed to update order in database"
              : (rpcData.order_id !== orderData.id
                  ? "Order ID mismatch in verification result"
                  : "Payment verification failed to update order in database"));

          return new Response(
            JSON.stringify({ error: errorMsg, rpcResult: rpcData }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            verified: true,
            data: rpcData,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else if (verifyRes.status === "failure") {
        await supabase.rpc("handle_failed_payu_payment", {
          p_order_id: orderData.id,
          p_txnid: activeTxnId,
          p_error_code: "FAILED",
          p_error_msg: verifyRes.error || "Payment failed at gateway",
          p_response_payload: verifyRes.raw || {},
        });

        return new Response(
          JSON.stringify({ success: false, verified: false, status: "failed", error: verifyRes.error }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: false, verified: false, status: "pending", error: verifyRes.error || "Payment verification pending with gateway" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // 3. ACTION: CLIENT-REPORTED PAYMENT FAILURE / CANCELLATION
    // =========================================================================
    if (actionParam === "handle_failure" || actionParam === "fail") {
      const order_id = body.order_id || url.searchParams.get("order_id");
      const txnid = body.txnid || url.searchParams.get("txnid");
      const guest_token = body.guest_token || url.searchParams.get("guest_token");
      const error_code = body.error_code || "FAILED";
      const error_msg = body.error_msg || "Payment cancelled or declined";

      if (!txnid && !order_id) {
        return new Response(
          JSON.stringify({ error: "Missing required parameter: txnid or order_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let query = supabase.from("orders").select("id, status, payment_status, payu_txnid, user_id, guest_tracking_token");
      if (order_id) query = query.eq("id", order_id);
      else if (txnid) query = query.eq("payu_txnid", txnid);

      const { data: orderData, error: fetchErr } = await query.single();
      if (fetchErr || !orderData) {
        return new Response(
          JSON.stringify({ error: "Order not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check authorization: caller must own order, have matching guest token, or be service_role
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

      let isAuthorized = false;
      if (bearerToken && bearerToken === serviceRoleKey) {
        isAuthorized = true;
      } else if (bearerToken) {
        const { data: authUserData } = await supabase.auth.getUser(bearerToken);
        const authUser = authUserData?.user;
        if (authUser && (authUser.id === orderData.user_id || authUser.app_metadata?.role === "admin" || authUser.user_metadata?.role === "admin")) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized && orderData.guest_tracking_token && guest_token && guest_token === orderData.guest_tracking_token) {
        isAuthorized = true;
      }

      if (!isAuthorized) {
        return new Response(
          JSON.stringify({ error: "Unauthorized access: You do not have permission to update this order." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const activeTxnId = orderData.payu_txnid || txnid;

      // Verification before restocking: A client cannot unilaterally trigger inventory restocking.
      // Must verify with PayU Verify Payment API that the transaction did not succeed or has explicitly failed.
      const verifyRes = await verifyPaymentWithPayU(merchantKey, merchantSalt, activeTxnId, payuEnv);

      // If PayU reports payment captured/success, reject failure report
      if (verifyRes.verified && verifyRes.status === "success") {
        return new Response(
          JSON.stringify({ error: "Cannot mark payment failed: PayU gateway confirms payment is captured and successful.", verified: true }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Restocking & cancellation is permitted ONLY if PayU explicitly reported failure/cancellation,
      // OR if caller is trusted service_role backend
      if (verifyRes.status !== "failure" && bearerToken !== serviceRoleKey) {
        return new Response(
          JSON.stringify({
            success: false,
            verified: false,
            status: "pending",
            message: "Payment status is pending with gateway. Order cannot be cancelled or restocked until gateway confirms failure or reservation expires.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error: failRpcError } = await supabase.rpc("handle_failed_payu_payment", {
        p_order_id: orderData.id,
        p_txnid: activeTxnId,
        p_error_code: error_code,
        p_error_msg: error_msg,
        p_response_payload: { reported_by: "client_cancellation", error_code, error_msg, verifyRes },
      });

      if (failRpcError) {
        return new Response(
          JSON.stringify({ error: failRpcError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // 4. ACTION: CALLBACK / WEBHOOK POST (From PayU Redirect or Webhook Worker)
    // =========================================================================
    const {
      status,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      mihpayid,
      mode,
      hash,
      key,
      additionalCharges,
      additional_charges,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
      error,
      error_Message,
    } = body;

    const isBrowserCallback = actionParam === "callback";
    const rawOrigin = url.searchParams.get("origin") || body.origin;
    const isProd = payuEnv === "production" || payuEnv === "prod" || payuEnv === "live";
    const baseOrigin = sanitizeOrigin(rawOrigin, isProd);
    const orderIdParam = url.searchParams.get("order_id") || body.order_id || udf1 || null;

    if (!txnid) {
      if (isBrowserCallback) {
        return createRedirectHtml(`${baseOrigin}/checkout?payu_status=failed&error=MISSING_TXNID`, "Payment Failed");
      }
      return new Response(
        JSON.stringify({ error: "Missing required parameter: txnid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up target order row
    let orderRowQuery = supabase.from("orders").select("id, order_number, total_amount, status, payment_status, payu_txnid");
    if (orderIdParam) orderRowQuery = orderRowQuery.eq("id", orderIdParam);
    else orderRowQuery = orderRowQuery.eq("payu_txnid", txnid);

    const { data: currentOrder } = await orderRowQuery.maybeSingle();

    if (!currentOrder) {
      if (isBrowserCallback) {
        return createRedirectHtml(`${baseOrigin}/checkout?payu_status=failed&error=ORDER_NOT_FOUND`, "Order Not Found");
      }
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate transaction ID and order reference consistency
    if (currentOrder.payu_txnid && currentOrder.payu_txnid.trim() !== txnid.trim()) {
      if (isBrowserCallback) {
        return createRedirectHtml(`${baseOrigin}/checkout?payu_status=failed&error=TXNID_MISMATCH`, "Transaction Mismatch");
      }
      return new Response(
        JSON.stringify({ error: "Transaction ID does not match order record" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (udf1 && udf1.trim() !== currentOrder.id.trim()) {
      if (isBrowserCallback) {
        return createRedirectHtml(`${baseOrigin}/checkout?payu_status=failed&error=ORDER_MISMATCH`, "Order Mismatch");
      }
      return new Response(
        JSON.stringify({ error: "Order ID reference (udf1) does not match target order" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate merchant key matches our configured merchant key
    if (key && key.trim() !== merchantKey.trim()) {
      if (isBrowserCallback) {
        return createRedirectHtml(`${baseOrigin}/checkout?payu_status=failed&error=MERCHANT_KEY_MISMATCH`, "Authentication Failed");
      }
      return new Response(
        JSON.stringify({ error: "Merchant key mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Verify Reverse Hash Checksum
    const salt = merchantSalt;
    const u1 = udf1 || "";
    const u2 = udf2 || "";
    const u3 = udf3 || "";
    const u4 = udf4 || "";
    const u5 = udf5 || "";
    const custEmail = email || "";
    const custName = firstname || "";
    const prodInfo = productinfo || "";
    const rawAmt = amount !== undefined && amount !== null ? String(amount).trim() : "";
    const k = merchantKey;

    // Handle additional_charges / additionalCharges in PayU reverse hash formula
    const effectiveAddCharges = (additionalCharges || additional_charges || "").trim();

    let hashSequence = "";
    if (effectiveAddCharges) {
      hashSequence = `${effectiveAddCharges}|${salt}|${status}||||||${u5}|${u4}|${u3}|${u2}|${u1}|${custEmail}|${custName}|${prodInfo}|${rawAmt}|${txnid}|${k}`;
    } else {
      hashSequence = `${salt}|${status}||||||${u5}|${u4}|${u3}|${u2}|${u1}|${custEmail}|${custName}|${prodInfo}|${rawAmt}|${txnid}|${k}`;
    }

    const calculatedHash = await sha512(hashSequence);
    // Constant-time hash equality verification
    const isHashValid = !!hash && constantTimeEquals(calculatedHash.toLowerCase(), hash.toLowerCase());

    // 2. Perform Official PayU Verify Payment API Check
    const verifyApiResult = await verifyPaymentWithPayU(merchantKey, merchantSalt, txnid, payuEnv);

    // CRITICAL SECURITY RULE:
    // Do NOT mark an order paid using only a reverse hash and browser callback.
    // Payment confirmation STRICTLY requires a successful server-side PayU Verify Payment API response:
    // 1. Transaction details for exact merchant txnid are returned
    // 2. Status is 'success' AND unmappedstatus is 'captured'
    // 3. Genuine non-empty PayU mihpayid is provided
    // 4. Amount exactly matches database order total
    let isConfirmedSuccess = false;
    let finalVerifiedAmount = 0;
    let finalVerifiedMihpayid = "";
    let finalVerifiedMode = mode || "online";

    if (verifyApiResult.verified && verifyApiResult.status === "success") {
      // Step A: Check Amount Mismatch
      if (!isAmountEqual(verifyApiResult.amount, currentOrder.total_amount)) {
        await supabase.from("payu_transactions").insert({
          txnid,
          order_id: currentOrder.id,
          action: "amount_mismatch_detected",
          request_payload: { status, txnid, mihpayid, paid_amount: verifyApiResult.amount, expected_amount: currentOrder.total_amount },
          response_payload: { verifyApiResult: verifyApiResult.raw },
          status: "amount_mismatch",
          is_verified: false,
        });

        await supabase.from("admin_notifications").insert({
          order_id: currentOrder.id,
          order_number: currentOrder.order_number,
          event_type: "payment_suspicious_callback",
          title: `Amount Mismatch on Order #${currentOrder.order_number}`,
          message: `PayU verified ₹${verifyApiResult.amount} but order total is ₹${currentOrder.total_amount}. Held for admin reconciliation.`,
          metadata: { txnid, paid_amount: verifyApiResult.amount, expected_amount: currentOrder.total_amount },
          dedup_key: `amount_mismatch_${txnid}`,
        });

        if (isBrowserCallback) {
          return createRedirectHtml(
            `${baseOrigin}/checkout?payu_status=pending&error=AMOUNT_MISMATCH_RECONCILIATION&order_id=${currentOrder.id}&txnid=${txnid}`,
            "Payment Under Review"
          );
        }

        return new Response(
          JSON.stringify({
            success: false,
            verified: false,
            status: "pending",
            error: `Payment amount mismatch: verified ${verifyApiResult.amount} vs expected ${currentOrder.total_amount}. Order held pending admin reconciliation.`,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Step B: Check Authoritative MIHPayID
      const gatewayMih = String(verifyApiResult.mihpayid || "").trim();
      const cbMih = String(mihpayid || "").trim();

      if (!gatewayMih) {
        await supabase.from("payu_transactions").insert({
          txnid,
          order_id: currentOrder.id,
          action: "missing_mihpayid",
          request_payload: { status, txnid, mihpayid },
          response_payload: { verifyApiResult: verifyApiResult.raw },
          status: "pending_reconciliation",
          is_verified: false,
        });

        await supabase.from("admin_notifications").insert({
          order_id: currentOrder.id,
          order_number: currentOrder.order_number,
          event_type: "payment_attention",
          title: `Missing PayU MIHPayID #${txnid}`,
          message: `PayU payment captured but missing authoritative mihpayid. Held for reconciliation.`,
          metadata: { txnid, order_id: currentOrder.id },
          dedup_key: `missing_mih_${txnid}`,
        });

        if (isBrowserCallback) {
          return createRedirectHtml(
            `${baseOrigin}/checkout?payu_status=pending&error=MISSING_GATEWAY_PAYMENT_ID&order_id=${currentOrder.id}&txnid=${txnid}`,
            "Payment Pending Reconciliation"
          );
        }

        return new Response(
          JSON.stringify({
            success: false,
            verified: false,
            status: "pending",
            error: "PayU Verify API returned empty mihpayid. Transaction held pending manual reconciliation.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (cbMih && cbMih !== gatewayMih) {
        await supabase.from("payu_transactions").insert({
          txnid,
          order_id: currentOrder.id,
          action: "mihpayid_mismatch",
          request_payload: { status, txnid, cbMih, gatewayMih },
          response_payload: { verifyApiResult: verifyApiResult.raw },
          status: "tamper_detected",
          is_verified: false,
        });

        if (isBrowserCallback) {
          return createRedirectHtml(
            `${baseOrigin}/checkout?payu_status=pending&error=MIHPAYID_MISMATCH&order_id=${currentOrder.id}&txnid=${txnid}`,
            "Payment Pending Reconciliation"
          );
        }

        return new Response(
          JSON.stringify({
            success: false,
            verified: false,
            status: "pending",
            error: "Mihpayid mismatch between callback and gateway verification. Held for reconciliation.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Authoritative verification succeeded!
      isConfirmedSuccess = true;
      finalVerifiedAmount = verifyApiResult.amount!;
      finalVerifiedMihpayid = gatewayMih;
      finalVerifiedMode = verifyApiResult.mode || finalVerifiedMode;
    }

    // If client claims success but Verify Payment API is unavailable, incomplete, pending, or failed:
    // Preserves pending state without restocking or marking failed.
    if (status?.toLowerCase() === "success" && !isConfirmedSuccess) {
      await supabase.from("payu_transactions").insert({
        txnid,
        order_id: currentOrder.id,
        action: "verification_pending_reconciliation",
        request_payload: { status, txnid, mihpayid, mode },
        response_payload: { isHashValid, verifyStatus: verifyApiResult.status, error: verifyApiResult.error },
        status: "pending_verification",
        is_verified: false,
      });

      await supabase.from("admin_notifications").insert({
        order_id: currentOrder.id,
        order_number: currentOrder.order_number,
        event_type: "payment_attention",
        title: `Payment Verification Pending #${currentOrder.order_number}`,
        message: `Customer callback received with status 'success', but server Verify Payment API status is '${verifyApiResult.status || "unavailable"}'. Order held pending verification.`,
        metadata: { txnid, isHashValid, gatewayStatus: verifyApiResult.status },
        dedup_key: `pending_verify_${txnid}`,
      });

      if (isBrowserCallback) {
        return createRedirectHtml(
          `${baseOrigin}/checkout?payu_status=pending&order_id=${currentOrder.id}&txnid=${txnid}&note=VERIFICATION_PENDING`,
          "Payment Verification In Progress"
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          verified: false,
          status: "pending",
          message: "Payment verification is in progress with gateway. Order preserved in pending state for reconciliation.",
          gatewayStatus: verifyApiResult.status,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Process Successful Payment (with strict post-RPC verification & late-payment handling)
    if (isConfirmedSuccess) {
      const { data, error: rpcError } = await supabase.rpc("verify_payu_payment_transaction", {
        p_order_id: currentOrder.id,
        p_txnid: txnid,
        p_mihpayid: finalVerifiedMihpayid,
        p_amount: finalVerifiedAmount,
        p_status: "success",
        p_mode: finalVerifiedMode,
        p_response_payload: { ...body, verifyApiResult: verifyApiResult.raw },
        p_verified_via: "server_verify_api",
      });

      // Strict RPC result verification:
      // - Check rpcError is null
      // - Check data exists
      // - Check data.success === true
      // - Check data.order_id matches expected order
      // - Check data.payment_status is expected state ('paid' or 'refund_pending')
      const isRpcSuccessful =
        !rpcError &&
        data &&
        data.success === true &&
        data.order_id === currentOrder.id &&
        (data.payment_status === "paid" || data.payment_status === "refund_pending");

      if (!isRpcSuccessful) {
        const errorMsg =
          rpcError?.message ||
          data?.message ||
          (!data
            ? "Payment verification failed to update order in database"
            : (data.order_id !== currentOrder.id
                ? "Order ID mismatch in verification result"
                : "Payment verification failed to update order in database"));

        if (isBrowserCallback) {
          const redirectFail = `${baseOrigin}/checkout?payu_status=failed&order_id=${currentOrder.id}&txnid=${txnid}&error=${encodeURIComponent(errorMsg)}`;
          return createRedirectHtml(redirectFail, "Order Processing Failed");
        }
        return new Response(
          JSON.stringify({ error: errorMsg, rpcResult: data }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Late payment handling: when payment was captured on an already-cancelled or expired order
      const isLatePayment =
        data.is_late_payment === true ||
        data.status === "cancelled" ||
        data.payment_status === "refund_pending" ||
        currentOrder.status === "cancelled";

      if (isLatePayment) {
        if (isBrowserCallback) {
          const orderNum = currentOrder.order_number || data?.order_number || "";
          const orderId = currentOrder.id || data?.order_id || "";
          const redirectLate = `${baseOrigin}/checkout?payu_status=refund_pending&order_id=${orderId}&txnid=${txnid}&order_number=${orderNum}&note=LATE_PAYMENT_REFUND_REVIEW`;
          return createRedirectHtml(
            redirectLate,
            "Payment Received — Order Cancelled (Refund Review Initiated)"
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            verified: true,
            is_late_payment: true,
            status: "cancelled",
            payment_status: "refund_pending",
            message: "Payment captured after order was cancelled; flagged for refund review.",
            data,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Normal payment confirmation redirect
      if (isBrowserCallback) {
        const orderNum = currentOrder.order_number || data?.order_number || "";
        const orderId = currentOrder.id || data?.order_id || "";
        const redirectSuccess = `${baseOrigin}/checkout?payu_status=success&order_id=${orderId}&txnid=${txnid}&order_number=${orderNum}&verified=true`;
        return createRedirectHtml(redirectSuccess, "Payment Confirmed! Redirecting...");
      }

      return new Response(
        JSON.stringify({ success: true, verified: true, data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // 4. Process Failed / Cancelled Payment
      // CRITICAL RULE: A valid reverse hash alone MUST NEVER authorize inventory restocking.
      // Inventory restocking and order cancellation strictly require the server-to-server
      // PayU Verify Payment API to confirm an explicit, terminal failed state.

      // Restocking & cancellation requires documented terminal failure from gateway
      const isTerminalGatewayFailure = verifyApiResult.status === "failure";

      if (!isTerminalGatewayFailure) {
        // Gateway has not confirmed terminal failure (pending, auth, status 0, or API unavailable).
        // Leave order and reservation pending to prevent invalid restocking.
        await supabase.from("payu_transactions").insert({
          txnid,
          order_id: currentOrder?.id || null,
          action: "failure_callback_pending",
          request_payload: { status, txnid, error, error_Message },
          response_payload: { isHashValid, verifyStatus: verifyApiResult.status, error: verifyApiResult.error },
          status: "pending_unconfirmed",
          is_verified: false,
        });

        if (isBrowserCallback) {
          return createRedirectHtml(
            `${baseOrigin}/checkout?payu_status=pending&order_id=${currentOrder.id}&txnid=${txnid}`,
            "Payment Status Pending"
          );
        }

        return new Response(
          JSON.stringify({
            success: false,
            verified: false,
            status: "pending",
            message: "Payment status is pending with gateway. Order and stock reservation remain pending until gateway confirms terminal failure or reservation window expires.",
            gatewayStatus: verifyApiResult.status,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error: failRpcError } = await supabase.rpc("handle_failed_payu_payment", {
        p_order_id: currentOrder.id,
        p_txnid: txnid,
        p_error_code: error || "FAILED",
        p_error_msg: error_Message || "Payment declined or cancelled by customer",
        p_response_payload: body,
      });

      if (isBrowserCallback) {
        const redirectFail = `${baseOrigin}/checkout?payu_status=failed&order_id=${currentOrder.id}&txnid=${txnid}&error=${encodeURIComponent(error || "FAILED")}&error_Message=${encodeURIComponent(error_Message || "Payment cancelled or declined")}`;
        return createRedirectHtml(redirectFail, "Payment Cancelled");
      }

      return new Response(
        JSON.stringify({ success: true, verified: true, failedHandled: true, data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
