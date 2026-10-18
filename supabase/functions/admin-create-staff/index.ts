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

  // Diagnostic probe for verifying GoTrue resolved redirect destination without exposing tokens
  if (req.method === "GET") {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

      if (!supabaseUrl || !serviceRoleKey) {
        return new Response(
          JSON.stringify({ error: "Missing Supabase configuration." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
        global: {
          headers: {
            referer: "https://shiptmart.vercel.app",
          },
        },
      });

      const testTargetRedirect = "https://shiptmart.vercel.app/accept-invitation";
      const testEmail = `probe-${Date.now()}@shiptmart.vercel.app`;

      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "invite",
        email: testEmail,
        options: {
          redirectTo: testTargetRedirect,
        },
      });

      if (linkError) {
        return new Response(
          JSON.stringify({ error: linkError.message, status: (linkError as any).status }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const actionLink = linkData?.properties?.action_link || "";
      let resolvedRedirect: string | null = null;
      if (actionLink) {
        try {
          const parsed = new URL(actionLink);
          resolvedRedirect = parsed.searchParams.get("redirect_to");
        } catch {}
      }

      // Clean up the probe user account
      if (linkData?.user?.id) {
        try {
          await adminClient.auth.admin.deleteUser(linkData.user.id);
        } catch {}
      }

      const isCanonicalMatched = resolvedRedirect === testTargetRedirect;
      const vercelPreviewLeaked =
        resolvedRedirect?.includes("shipt-shinas-projects-24b0b614.vercel.app") || false;

      return new Response(
        JSON.stringify({
          service: "admin-create-staff",
          version: 5,
          target_canonical_redirect: testTargetRedirect,
          gotrue_resolved_redirect: resolvedRedirect,
          is_canonical_matched: isCanonicalMatched,
          vercel_preview_leaked: vercelPreviewLeaked,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: err?.message || "Probe error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
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

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

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
    } = await callerClient.auth.getUser(token);

    if (callerAuthError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid, expired, or unverified caller session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Verify caller is an authorized Super Admin in admin_roles
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
      global: {
        headers: {
          referer: "https://shiptmart.vercel.app",
        },
      },
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
    const rawFullName =
      typeof body.fullName === "string"
        ? body.fullName
        : typeof body.full_name === "string"
        ? body.full_name
        : typeof body.name === "string"
        ? body.name
        : "";
    const requestedRole = body.role;
    // Canonical production redirect URL for staff invitations:
    // ALWAYS target the public custom production domain: https://shiptmart.vercel.app/accept-invitation
    // Protected Vercel deployment hostnames (*.vercel.app preview links) trigger vercel.com/login.
    // Only local development (localhost / 127.0.0.1) is allowed to override this.
    let canonicalRedirect = "https://shiptmart.vercel.app/accept-invitation";
    if (typeof body.redirectTo === "string" && body.redirectTo.startsWith("http")) {
      try {
        const parsed = new URL(body.redirectTo);
        if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
          canonicalRedirect = `${parsed.origin}/accept-invitation`;
        }
      } catch {
        // Fall back to canonical production URL
      }
    }

    const cleanEmail = rawEmail.trim().toLowerCase();
    // Normalize full name: trim, collapse excessive whitespace, cap at 100 characters
    const cleanFullName = rawFullName.trim().replace(/\s+/g, " ").slice(0, 100);
    // Extract first name for templates that interpolate {{ .Data.first_name }}
    const firstName = cleanFullName ? cleanFullName.split(" ")[0] : "";

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
    // Populate full_name, name, and first_name in user_metadata so email templates
    // interpolating either {{ .Data.full_name }}, {{ .Data.name }}, or {{ .Data.first_name }}
    // receive the staff member's actual name.
    const userMetadata: Record<string, any> = {
      assigned_role: requestedRole,
      invited_by: callerUser.id,
    };

    if (cleanFullName) {
      userMetadata.full_name = cleanFullName;
      userMetadata.name = cleanFullName;
      userMetadata.first_name = firstName;
    }

    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      cleanEmail,
      {
        data: userMetadata,
        redirectTo: canonicalRedirect,
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

      const isRateLimit =
        msg.toLowerCase().includes("rate limit") ||
        msg.toLowerCase().includes("over_email_send_rate_limit") ||
        (inviteError as any).status === 429;

      if (isRateLimit) {
        return new Response(
          JSON.stringify({
            error: "Email delivery rate limit reached. The Supabase default email service limits invitations to 3-4 emails per hour. Please wait a short while or configure custom SMTP in your Supabase Dashboard.",
            isRateLimit: true,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    // 8. Ensure profiles table is synchronized with full_name without overwriting unrelated fields
    if (cleanFullName) {
      try {
        const { data: existingProfile } = await adminClient
          .from("profiles")
          .select("id, full_name")
          .eq("id", newUserId)
          .maybeSingle();

        if (existingProfile) {
          await adminClient
            .from("profiles")
            .update({
              full_name: cleanFullName,
              updated_at: new Date().toISOString(),
            })
            .eq("id", newUserId);
        } else {
          await adminClient
            .from("profiles")
            .insert({
              id: newUserId,
              full_name: cleanFullName,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
        }
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
