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
    const merchantKey = (Deno.env.get("PAYU_MERCHANT_KEY") ?? "gtKFFx").trim();
    const merchantSalt = (Deno.env.get("PAYU_MERCHANT_SALT") ?? "eCwWELxi").trim();
    const payuEnv = (Deno.env.get("PAYU_ENV") ?? "test").trim().toLowerCase();

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

    // Secure Server-Side Checkout Hash Preparation (Keeps Merchant Salt 100% Private)
    if (actionParam === "initiate") {
      const {
        order_id,
        order_number,
        customer_name,
        customer_email,
        customer_phone,
        product_info,
        origin,
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
        .select("id, order_number, total_amount, status, payu_txnid")
        .eq("id", order_id)
        .single();

      if (orderErr || !orderData) {
        return new Response(
          JSON.stringify({ error: "Order not found or invalid" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      const baseOrigin = origin || "http://localhost:5173";

      const surl = `${baseOrigin}/checkout?payu_status=success&txnid=${txnid}&order_id=${orderData.id}`;
      const furl = `${baseOrigin}/checkout?payu_status=failed&txnid=${txnid}&order_id=${orderData.id}`;

      // If order's payu_txnid was not set or differed, sync it to database
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
      const u3 = "";
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
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
      error,
      error_Message,
    } = body;

    if (!txnid) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: txnid" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Verify PayU Reverse Hash Checksum
    // Formula when additionalCharges present:
    // sha512(additionalCharges|SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
    // Formula without additionalCharges:
    // sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
    const salt = merchantSalt;
    const u1 = udf1 || "";
    const u2 = udf2 || "";
    const u3 = udf3 || "";
    const u4 = udf4 || "";
    const u5 = udf5 || "";
    const custEmail = email || "";
    const custName = firstname || "";
    const prodInfo = productinfo || "";
    const amt = amount || "";
    const k = key || merchantKey;

    let hashSequence = "";
    if (additionalCharges) {
      hashSequence = `${additionalCharges}|${salt}|${status}||||||${u5}|${u4}|${u3}|${u2}|${u1}|${custEmail}|${custName}|${prodInfo}|${amt}|${txnid}|${k}`;
    } else {
      hashSequence = `${salt}|${status}||||||${u5}|${u4}|${u3}|${u2}|${u1}|${custEmail}|${custName}|${prodInfo}|${amt}|${txnid}|${k}`;
    }

    const calculatedHash = await sha512(hashSequence);
    const isHashValid = hash && calculatedHash.toLowerCase() === hash.toLowerCase();

    if (!isHashValid) {
      // Record suspicious tamper attempt
      await supabase.from("payu_transactions").insert({
        txnid,
        action: "webhook_rejected",
        request_payload: body,
        response_payload: { calculatedHash, receivedHash: hash },
        status: "tamper_detected",
        is_verified: false,
      });

      await supabase.from("admin_notifications").insert({
        event_type: "payment_suspicious_callback",
        title: `Suspicious PayU Hash #${txnid}`,
        message: `PayU webhook callback received for txnid ${txnid} with invalid hash checksum.`,
        metadata: { txnid, calculatedHash, receivedHash: hash },
        dedup_key: `suspicious_hash_${txnid}_${Date.now()}`,
      });

      return new Response(
        JSON.stringify({ error: "Invalid hash checksum. Webhook rejected." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Process Successful Payment
    if (status === "success") {
      const numAmount = parseFloat(amount);
      const { data, error: rpcError } = await supabase.rpc("verify_payu_payment_transaction", {
        p_order_id: null,
        p_txnid: txnid,
        p_mihpayid: mihpayid || txnid,
        p_amount: numAmount,
        p_status: "success",
        p_mode: mode || "online",
        p_response_payload: body,
        p_verified_via: "webhook",
      });

      if (rpcError) {
        return new Response(
          JSON.stringify({ error: rpcError.message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, verified: true, data }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // 3. Process Failed / Cancelled Payment
      const { data, error: failRpcError } = await supabase.rpc("handle_failed_payu_payment", {
        p_order_id: null,
        p_txnid: txnid,
        p_error_code: error || "FAILED",
        p_error_msg: error_Message || "Payment declined or cancelled by customer",
        p_response_payload: body,
      });

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

