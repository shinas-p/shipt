import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
// @ts-ignore npm specifier in Deno Edge Runtime
import webpush from "npm:web-push@3.6.7";

/**
 * Standard CORS headers for Shipt Mart Edge Requests
 */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SendPushPayload {
  type?: "order" | "test";
  orderId?: string | null;
  orderNumber?: string | null;
  totalAmount?: number | null;
  deliveryMethod?: string | null;
  eventType?: string;
  title?: string | null;
  body?: string | null;
}

/**
 * Edge Function: send-admin-push
 *
 * Dispatches genuine Web Push notifications to subscribed campus administrators
 * when new orders arrive or when a diagnostic test notification is requested.
 *
 * Guarantees:
 * 1. Operates across closed browser tabs via browser PushManager endpoints.
 * 2. Idempotent delivery using public.admin_push_logs (prevents duplicate alerts).
 * 3. Minimal sensitive data: Only transmits order number, amount, and delivery method;
 *    never customer address, phone number, or payment details.
 * 4. Automatic pruning of expired (HTTP 410 / 404) subscriptions.
 * 5. Diagnostic reporting if VAPID keys are unconfigured.
 */
Deno.serve(async (req: Request) => {
  // 1. CORS Preflight
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

    // 2. VAPID Configuration Check
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@shiptmart.com";

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(
        JSON.stringify({
          success: false,
          setupRequired: true,
          message: "VAPID keys not configured in Supabase Edge Runtime.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    // 3. Service Client
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // 4. Parse Payload
    const payload: SendPushPayload = await req.json().catch(() => ({}));
    const isTest = payload.type === "test";

    let dedupKey = "";
    let pushTitle = "";
    let pushBody = "";
    let pushUrl = "/admin";
    let orderNumberRecord: string | null = null;
    let orderIdRecord: string | null = null;

    if (isTest) {
      // Test push: caller MUST be an authenticated administrator
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Authorization required for test push notifications." }),
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

      const { data: roleRow } = await adminClient
        .from("admin_roles")
        .select("role")
        .eq("user_id", callerUser.id)
        .maybeSingle();

      const allowedRoles = ["super_admin", "owner", "store_manager", "block_manager"];
      if (!roleRow || !allowedRoles.includes(roleRow.role)) {
        return new Response(
          JSON.stringify({ error: "Forbidden: Admin role required to trigger push tests." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      dedupKey = `test_push:${callerUser.id}:${Date.now()}`;
      pushTitle = payload.title || "ShipT Mart • Admin Test Alert";
      pushBody = payload.body || "Web Push is properly connected to your device!";
      pushUrl = "/admin";
    } else {
      // Order push: verify order exists in database to prevent unauthorized spam
      if (!payload.orderId) {
        return new Response(
          JSON.stringify({ error: "Missing required orderId." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: orderData, error: orderError } = await adminClient
        .from("orders")
        .select("id, order_number, total_amount, delivery_method")
        .eq("id", payload.orderId)
        .maybeSingle();

      if (orderError || !orderData) {
        return new Response(
          JSON.stringify({ error: "Order not found in database." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      orderIdRecord = orderData.id;
      orderNumberRecord = orderData.order_number || String(orderData.id).slice(0, 8).toUpperCase();
      dedupKey = `order_created:${orderData.id}`;

      // Check deduplication in admin_push_logs
      const { data: existingLog } = await adminClient
        .from("admin_push_logs")
        .select("id, status")
        .eq("dedup_key", dedupKey)
        .maybeSingle();

      if (existingLog && existingLog.status === "completed") {
        return new Response(
          JSON.stringify({
            success: true,
            dedup: true,
            message: "Push notification already sent for this order.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const formattedAmount = Number(orderData.total_amount || payload.totalAmount || 0).toFixed(2);
      const deliveryMethodStr = orderData.delivery_method || payload.deliveryMethod || "Hostel Delivery";

      pushTitle = `ShipT Mart • New Order #${orderNumberRecord}`;
      pushBody = `₹${formattedAmount} • ${deliveryMethodStr}`;
      pushUrl = `/admin?order=${orderData.id}`;
    }

    // 5. Fetch Active Push Subscriptions
    const { data: subscriptions, error: subsError } = await adminClient
      .from("admin_push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_id, device_label")
      .eq("is_active", true);

    if (subsError) {
      return new Response(
        JSON.stringify({ error: "Failed to query admin push subscriptions." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recipientList = subscriptions || [];
    if (recipientList.length === 0) {
      // Record in log so we know no admins were registered
      await adminClient.from("admin_push_logs").insert({
        dedup_key: dedupKey,
        event_type: isTest ? "test" : "new_order",
        order_id: orderIdRecord,
        order_number: orderNumberRecord,
        total_recipients: 0,
        successful_deliveries: 0,
        failed_deliveries: 0,
        pruned_subscriptions: 0,
        payload_summary: { title: pushTitle, body: pushBody, note: "No active admin subscriptions" },
        status: "completed",
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: "No active admin push subscriptions registered.",
          recipientCount: 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Build Push Payload
    const notificationPayload = JSON.stringify({
      title: pushTitle,
      body: pushBody,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      tag: isTest ? "test-alert" : `order-${orderIdRecord || "new"}`,
      data: {
        url: pushUrl,
        orderId: orderIdRecord,
        eventType: isTest ? "test" : "new_order",
      },
    });

    let successCount = 0;
    let failCount = 0;
    let prunedCount = 0;

    // 7. Dispatch to Each Subscribed Device
    const dispatchPromises = recipientList.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, notificationPayload, {
          TTL: 60 * 60 * 24, // 24 hours
          urgency: "high",
        });
        successCount++;

        // Update last_used_at timestamp
        await adminClient
          .from("admin_push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", sub.id);
      } catch (err: any) {
        failCount++;
        const statusCode = err?.statusCode;
        // 410 Gone or 404 Not Found indicates subscription expired / unsubscribed
        if (statusCode === 410 || statusCode === 404) {
          prunedCount++;
          try {
            await adminClient.rpc("admin_prune_expired_push_subscription", {
              p_endpoint: sub.endpoint,
            });
          } catch {
            // Fallback soft delete
            await adminClient
              .from("admin_push_subscriptions")
              .update({ is_active: false })
              .eq("endpoint", sub.endpoint);
          }
        }
      }
    });

    await Promise.allSettled(dispatchPromises);

    // 8. Log in public.admin_push_logs
    await adminClient.from("admin_push_logs").upsert(
      {
        dedup_key: dedupKey,
        event_type: isTest ? "test" : "new_order",
        order_id: orderIdRecord,
        order_number: orderNumberRecord,
        total_recipients: recipientList.length,
        successful_deliveries: successCount,
        failed_deliveries: failCount,
        pruned_subscriptions: prunedCount,
        payload_summary: {
          title: pushTitle,
          body: pushBody,
        },
        status: "completed",
      },
      { onConflict: "dedup_key" }
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Dispatched push to ${successCount} device(s).`,
        totalRecipients: recipientList.length,
        successfulDeliveries: successCount,
        failedDeliveries: failCount,
        prunedSubscriptions: prunedCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || "Internal server error dispatching push." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
