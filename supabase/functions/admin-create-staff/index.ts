import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Standard CORS headers for browser requests from Shipt storefront & admin
 */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Edge Function: admin-create-staff
 * 
 * Securely invites a new staff member (Store Manager or Super Admin) directly from
 * the Super Admin portal without requiring prior self-registration at /account.
 * 
 * Security Guarantees:
 * 1. Requires valid Authorization Bearer JWT from caller.
 * 2. Caller must be an authenticated and authorized Super Admin in public.admin_roles.
 * 3. Server-only SUPABASE_SERVICE_ROLE_KEY is used exclusively within this edge runtime.
 * 4. The service-role secret is NEVER exposed to the frontend, client logs, or responses.
 * 5. If the email already exists in Auth, returns HTTP 409 (alreadyExists: true) without overwriting.
 * 6. If role assignment fails, rolls back the invited user to prevent orphaned accounts.
 * 7. Never returns passwords or private authentication tokens to the caller.
 */
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
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
    // 1. Resolve Authorization header
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or malformed Authorization header. Bearer token required." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Validate environment configuration
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error: missing Supabase environment variables." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Authenticate caller using their JWT
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user: callerUser },
      error: callerAuthError,
    } = await callerClient.auth.getUser();

    if (callerAuthError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid, expired, or unverified caller session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Verify caller is an authorized Super Admin in admin_roles
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: superAdminRole, error: roleCheckError } = await adminClient
      .from("admin_roles")
      .select("role")
      .eq("user_id", callerUser.id)
      .eq("role", "super_admin")
      .maybeSingle();

    if (roleCheckError || !superAdminRole) {
      return new Response(
        JSON.stringify({
          error: "Access Denied: Only authorized Super Administrators can create staff accounts or assign roles.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Parse and validate payload
    const body = await req.json().catch(() => ({}));
    const rawEmail = typeof body.email === "string" ? body.email : "";
    const rawFullName = typeof body.fullName === "string" ? body.fullName : (typeof body.name === "string" ? body.name : "");
    const requestedRole = body.role;
    const requestedRedirect = typeof body.redirectTo === "string" && body.redirectTo.startsWith("http")
      ? body.redirectTo
      : "https://shiptmart.vercel.app/account";

    const cleanEmail = rawEmail.trim().toLowerCase();
    const cleanFullName = rawFullName.trim().slice(0, 100);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      return new Response(
        JSON.stringify({ error: "A valid email address is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (requestedRole !== "store_manager" && requestedRole !== "super_admin") {
      return new Response(
        JSON.stringify({
          error: `Invalid role "${requestedRole}". Supported roles: store_manager, super_admin.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Safe User Invitation via Supabase Auth Admin API
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      cleanEmail,
      {
        data: {
          full_name: cleanFullName,
          assigned_role: requestedRole,
          invited_by: callerUser.id,
        },
        redirectTo: requestedRedirect,
      }
    );

    if (inviteError) {
      const msg = inviteError.message || "";
      const isAlreadyRegistered =
        msg.toLowerCase().includes("already registered") ||
        msg.toLowerCase().includes("already exists") ||
        (inviteError as any).status === 422;

      if (isAlreadyRegistered) {
        return new Response(
          JSON.stringify({
            alreadyExists: true,
            error: `An account for "${cleanEmail}" is already registered.`,
            email: cleanEmail,
            role: requestedRole,
            suggestedAction: "assign_role",
            message: `User "${cleanEmail}" is already registered with Shipt. Use the "Assign Staff Role" action to grant them staff permissions without creating a duplicate account.`,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: `Failed to invite staff member: ${inviteError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!inviteData?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Unexpected response from authentication service during user creation." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newUserId = inviteData.user.id;

    // 7. Assign requested administrative role
    const { error: roleAssignError } = await adminClient
      .from("admin_roles")
      .upsert(
        {
          user_id: newUserId,
          role: requestedRole,
          created_by: callerUser.id,
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id,role" }
      );

    if (roleAssignError) {
      // Rollback newly invited user to prevent orphaned unassigned user accounts
      try {
        await adminClient.auth.admin.deleteUser(newUserId);
      } catch (rollbackError) {
        console.error("Rollback deleteUser failed:", rollbackError);
      }

      return new Response(
        JSON.stringify({ error: `Failed to assign staff permissions: ${roleAssignError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. Ensure profiles table is synchronized with full_name
    if (cleanFullName) {
      try {
        await adminClient.from("profiles").upsert(
          {
            id: newUserId,
            full_name: cleanFullName,
          },
          { onConflict: "id" }
        );
      } catch (profileError) {
        // Non-blocking for profile name sync
        console.warn("Profile name sync notice:", profileError);
      }
    }

    // 9. Return safe result without exposing tokens, passwords, or service secrets
    return new Response(
      JSON.stringify({
        success: true,
        message: `Staff invitation successfully sent to ${cleanEmail} with role "${requestedRole.replace("_", " ")}".`,
        user: {
          id: newUserId,
          email: cleanEmail,
          fullName: cleanFullName,
          role: requestedRole,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: `Internal server error: ${err?.message || "Unknown error"}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
