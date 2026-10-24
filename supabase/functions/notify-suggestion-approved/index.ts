import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

/**
 * Standard CORS headers for Shipt Mart browser requests
 */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface NotifySuggestionPayload {
  suggestionId: string;
}

/**
 * Edge Function: notify-suggestion-approved
 *
 * Automatically dispatches a professional brand email notification to a customer
 * when their suggested product is approved by an authorized Owner or Super Admin.
 *
 * Reliability & Security Guarantees:
 * 1. Requires valid Authorization Bearer JWT from caller.
 * 2. Caller must be an authorized Super Admin or Owner.
 * 3. Server-side service-role client verifies the suggestion's persisted 'approved' status.
 * 4. Strictly IDEMPOTENT: Never sends duplicate emails if approval_email_sent_at is already recorded.
 * 5. Uses verified account email from Auth when user_id is present to prevent spoofing.
 * 6. Graceful failure isolation: Email delivery failures are recorded in approval_email_error
 *    and observable in the admin UI without rolling back the valid product approval.
 * 7. Never exposes secrets, SMTP credentials, or provider API keys to client code.
 */
Deno.serve(async (req: Request) => {
  // 1. Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Supabase service configuration missing in Edge Runtime." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Validate Caller Authentication & Admin Role
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: { user: callerUser }, error: userError } = await userClient.auth.getUser();
    if (userError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired authorization token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service-role client for privileged database and auth operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Check caller's role in public.admin_roles
    const { data: roleRow, error: roleError } = await adminClient
      .from("admin_roles")
      .select("role")
      .eq("user_id", callerUser.id)
      .maybeSingle();

    const allowedRoles = ["super_admin", "owner"];
    if (roleError || !roleRow || !allowedRoles.includes(roleRow.role)) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Only Super Admin and Owner can approve product suggestions." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Parse and Validate Request Payload
    const body: NotifySuggestionPayload = await req.json().catch(() => ({}));
    if (!body.suggestionId) {
      return new Response(
        JSON.stringify({ error: "Missing required suggestionId in request body." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Fetch the Persisted Suggestion Record
    const { data: suggestion, error: fetchError } = await adminClient
      .from("product_suggestions")
      .select("*")
      .eq("id", body.suggestionId)
      .maybeSingle();

    if (fetchError || !suggestion) {
      return new Response(
        JSON.stringify({ error: "Product suggestion not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Verify the Persisted Status is Actually 'approved'
    if (suggestion.status !== "approved") {
      return new Response(
        JSON.stringify({
          error: `Cannot send approval notification: suggestion status is '${suggestion.status}', expected 'approved'.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Strict Idempotency Check
    // If notification was already dispatched, prevent duplicate emails on repeated saves
    if (suggestion.approval_email_sent_at) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Approval email notification has already been sent to the customer.",
          alreadySent: true,
          sentAt: suggestion.approval_email_sent_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Resolve Customer Recipient Email
    let recipientEmail = suggestion.customer_email?.trim() || "";
    // If associated with a verified account, prefer verified email from auth
    if (suggestion.user_id) {
      const { data: authUserData } = await adminClient.auth.admin.getUserById(suggestion.user_id);
      if (authUserData?.user?.email) {
        recipientEmail = authUserData.user.email.trim();
      }
    }

    if (!recipientEmail || !recipientEmail.includes("@")) {
      const missingEmailMsg = "Missing valid customer email for notification dispatch.";
      await adminClient
        .from("product_suggestions")
        .update({ approval_email_error: missingEmailMsg })
        .eq("id", suggestion.id);

      return new Response(
        JSON.stringify({ success: false, error: missingEmailMsg }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. Generate Responsive HTML and Text Email Content
    const siteUrl = "https://shiptmart.vercel.app";
    const productName = suggestion.product_name;
    const customerName = suggestion.customer_name || "Campus Shopper";
    const categoryName = suggestion.category || "Campus Essentials";
    const brandName = suggestion.brand || "Quality Brand";

    const subject = `Good news! Your product suggestion "${productName}" was approved — Shipt Mart`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; }
    .header { background: #15803d; padding: 28px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0; font-size: 13px; color: #bbf7d0; font-weight: 500; }
    .badge { display: inline-block; background: #fef08a; color: #854d0e; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px; }
    .content { padding: 32px 28px; line-height: 1.6; }
    .content h2 { margin: 0 0 16px; font-size: 20px; font-weight: 700; color: #0f172a; }
    .alert-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin: 20px 0; font-size: 13px; color: #166534; }
    .details-table { width: 100%; border-collapse: collapse; margin: 24px 0; background: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
    .details-table td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid #e2e8f0; }
    .details-table td.label { font-weight: 600; color: #64748b; width: 35%; }
    .details-table td.value { font-weight: 700; color: #0f172a; }
    .btn-container { text-align: center; margin: 32px 0 20px; }
    .btn { display: inline-block; background: #15803d; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-size: 14px; font-weight: 700; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    .footer { background: #f1f5f9; padding: 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
    .footer a { color: #15803d; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div style="padding: 24px 12px;">
    <div class="container">
      <div class="header">
        <div class="badge">Shipt Mart Campus Store</div>
        <h1>Good News for Your Suggestion!</h1>
        <p>Everyday Essentials. Delivered Fast to Your Hostel.</p>
      </div>

      <div class="content">
        <h2>Hello ${customerName},</h2>
        <p>
          Thank you for taking the time to share your feedback and helping us make Shipt Mart better for everyone on campus!
        </p>
        <p>
          We are pleased to let you know that our management team has reviewed your product suggestion for <strong>${productName}</strong> and it has officially been <strong>Approved</strong>.
        </p>

        <div class="alert-box">
          <strong>Important Clarification:</strong>
          <div style="margin-top: 4px;">
            Approval means our procurement team has accepted this suggestion for stocking and sourcing consideration. While it may not be immediately available on our live shelves today, we are actively coordinating with campus distributors to make it available for order as soon as possible.
          </div>
        </div>

        <table class="details-table">
          <tr>
            <td class="label">Suggested Product:</td>
            <td class="value">${productName}</td>
          </tr>
          <tr>
            <td class="label">Category:</td>
            <td class="value">${categoryName}</td>
          </tr>
          <tr>
            <td class="label">Preferred Brand:</td>
            <td class="value">${brandName}</td>
          </tr>
          <tr>
            <td class="label">Status:</td>
            <td class="value" style="color: #15803d;">Approved for Sourcing</td>
          </tr>
        </table>

        <p>
          You can keep an eye on our campus catalogue to see when new stock arrives.
        </p>

        <div class="btn-container">
          <a href="${siteUrl}" class="btn" target="_blank">Visit Shipt Mart Campus Store</a>
        </div>
      </div>

      <div class="footer">
        <p style="margin: 0 0 8px;"><strong>Shipt Mart / Quick Mart</strong> — Campus Online Delivery</p>
        <p style="margin: 0 0 8px;">Helpline: +91 9605174298 &bull; WhatsApp: +91 9605174298 &bull; Email: dhemartforyou@gmail.com</p>
        <p style="margin: 0; font-size: 11px;">You received this email because you submitted a product suggestion at <a href="${siteUrl}">shiptmart.vercel.app</a>.</p>
      </div>
    </div>
  </div>
</body>
</html>
    `.trim();

    const textFallback = `
Hello ${customerName},

Thank you for helping us make Shipt Mart better for everyone on campus!

We are pleased to let you know that our management team has reviewed your suggestion for "${productName}" and it has officially been APPROVED for sourcing consideration.

Please note: Approval means our procurement team has accepted this product for stocking and sourcing consideration. While it may not be instantly available on the shelves today, we are actively coordinating with distributors to make it available for purchase.

Suggestion Summary:
- Product: ${productName}
- Category: ${categoryName}
- Brand: ${brandName}
- Status: Approved for Sourcing

Visit the store anytime at: ${siteUrl}

Best regards,
The Shipt Mart Campus Store Team
Helpline / WhatsApp: +91 9605174298
Email: dhemartforyou@gmail.com
    `.trim();

    // 9. Dispatch Email via Configured Transactional Provider
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    let delivered = false;
    let providerError: string | null = null;

    if (resendApiKey) {
      try {
        const resendResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: Deno.env.get("EMAIL_FROM") || "Shipt Mart <notifications@shiptmart.vercel.app>",
            to: [recipientEmail],
            subject: subject,
            html: htmlContent,
            text: textFallback,
          }),
        });

        if (resendResponse.ok) {
          delivered = true;
        } else {
          const errData = await resendResponse.json().catch(() => ({}));
          providerError = errData?.message || `Resend delivery failed with HTTP ${resendResponse.status}`;
        }
      } catch (err: any) {
        providerError = err?.message || "Network error contacting email provider";
      }
    } else {
      // No external transactional email provider (RESEND_API_KEY) configured in the Supabase runtime
      providerError = "Transactional email provider unconfigured in Supabase (RESEND_API_KEY or SMTP required in environment).";
      console.log(`[notify-suggestion-approved] Notification logged for ${recipientEmail}. Provider setup required.`);
    }

    // 10. Persist Dispatch Outcome Idempotently
    if (delivered) {
      const nowIso = new Date().toISOString();
      await adminClient
        .from("product_suggestions")
        .update({
          approval_email_sent_at: nowIso,
          approval_email_error: null,
        })
        .eq("id", suggestion.id);

      return new Response(
        JSON.stringify({
          success: true,
          delivered: true,
          recipient: recipientEmail,
          sentAt: nowIso,
          message: "Approval email sent successfully to customer.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Record failure observable to admin without rolling back approval
      await adminClient
        .from("product_suggestions")
        .update({
          approval_email_error: providerError,
        })
        .eq("id", suggestion.id);

      return new Response(
        JSON.stringify({
          success: false,
          delivered: false,
          recipient: recipientEmail,
          error: providerError,
          providerConfigured: !!resendApiKey,
          message: "Product was approved, but email delivery could not be completed. Check provider configuration.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || "Internal server error in notification dispatcher." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
