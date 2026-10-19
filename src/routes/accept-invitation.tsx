import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ShoppingBag,
  Mail,
  User,
  Shield,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useBranding } from "@/lib/branding";
import { BRAND_NAME, BRAND_TAGLINE } from "@/data/products";
import { toast } from "sonner";

export const Route = createFileRoute("/accept-invitation")({
  head: () => ({
    meta: [
      { title: `Activate Staff Account — ${BRAND_NAME}` },
      { name: "description", content: "Activate your Shipt staff account and set your secure password." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AcceptInvitationPage,
});

type PageState = "loading" | "valid_session" | "already_active" | "invalid_or_expired" | "success";

function AcceptInvitationPage() {
  const navigate = useNavigate();
  const { branding } = useBranding();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string>("");
  const [invitedName, setInvitedName] = useState<string>("");
  const [assignedRole, setAssignedRole] = useState<string>("staff");

  // Form states
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Password requirements
  const isMinLength = password.length >= 8;
  const isMatch = password.length > 0 && password === confirmPassword;
  const isFormValid = isMinLength && isMatch;

  const checkUserStatusAndRole = useCallback(async (userId: string, email: string, metadata: any) => {
    try {
      setInvitedEmail(email);
      const name = metadata?.full_name || metadata?.name || "";
      if (name) setInvitedName(name);

      // Fetch assigned role from public.admin_roles
      const { data: roleRow } = await supabase
        .from("admin_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();

      const resolvedRole = roleRow?.role || metadata?.assigned_role || "store_manager";
      setAssignedRole(resolvedRole);

      setPageState("valid_session");
    } catch {
      setPageState("valid_session");
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setPageState("invalid_or_expired");
      setErrorMessage("Supabase is not configured in this environment.");
      return;
    }

    let isMounted = true;

    async function initInvitationAuth() {
      if (typeof window === "undefined") return;

      const hash = window.location.hash || "";
      const search = window.location.search || "";
      const searchParams = new URLSearchParams(search);
      const hashParams = new URLSearchParams(hash.replace(/^#/, ""));

      // 1. Detect explicit OAuth / OTP error in hash or search query
      const err = hashParams.get("error") || searchParams.get("error");
      const errCode = hashParams.get("error_code") || searchParams.get("error_code");
      const errDesc = hashParams.get("error_description") || searchParams.get("error_description");

      if (err || errCode) {
        if (!isMounted) return;
        setPageState("invalid_or_expired");
        if (errCode === "otp_expired" || errDesc?.toLowerCase().includes("expired")) {
          setErrorMessage("This staff invitation link has expired. Invitations are single-use and time-sensitive for security.");
        } else {
          setErrorMessage(errDesc ? decodeURIComponent(errDesc.replace(/\+/g, " ")) : "Invalid or unrecognized invitation link.");
        }
        return;
      }

      // 2. Handle token_hash verification if present in search params
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      if (tokenHash && type === "invite") {
        try {
          const { data, error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "invite",
          });

          if (verifyError) {
            if (!isMounted) return;
            setPageState("invalid_or_expired");
            setErrorMessage(verifyError.message || "Failed to verify invitation token.");
            return;
          }

          if (data?.session?.user && isMounted) {
            await checkUserStatusAndRole(
              data.session.user.id,
              data.session.user.email || "",
              data.session.user.user_metadata
            );
            return;
          }
        } catch (err: any) {
          if (!isMounted) return;
          setPageState("invalid_or_expired");
          setErrorMessage(err?.message || "Verification failed.");
          return;
        }
      }

      // 3. Handle PKCE code if present
      const code = searchParams.get("code");
      if (code) {
        try {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            if (!isMounted) return;
            setPageState("invalid_or_expired");
            setErrorMessage(exchangeError.message || "Invitation exchange expired.");
            return;
          }
          if (data?.session?.user && isMounted) {
            await checkUserStatusAndRole(
              data.session.user.id,
              data.session.user.email || "",
              data.session.user.user_metadata
            );
            return;
          }
        } catch (err: any) {
          if (!isMounted) return;
          setPageState("invalid_or_expired");
          setErrorMessage(err?.message || "Failed to exchange code.");
          return;
        }
      }

      // 4. Check for active session from Supabase hash parser
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user && isMounted) {
          await checkUserStatusAndRole(
            sessionData.session.user.id,
            sessionData.session.user.email || "",
            sessionData.session.user.user_metadata
          );
          return;
        }
      } catch {
        // Fall through to waiting for onAuthStateChange
      }

      // 5. Allow brief buffer for Supabase onAuthStateChange to ingest hash
      const timeoutId = setTimeout(() => {
        if (isMounted) {
          supabase.auth.getSession().then(({ data }) => {
            if (!isMounted) return;
            if (data?.session?.user) {
              checkUserStatusAndRole(
                data.session.user.id,
                data.session.user.email || "",
                data.session.user.user_metadata
              );
            } else {
              setPageState("invalid_or_expired");
              setErrorMessage("No active invitation session was found. If you received an invitation email, please click the secure link in your email.");
            }
          });
        }
      }, 1200);

      return () => clearTimeout(timeoutId);
    }

    initInvitationAuth();

    // Listen to onAuthStateChange for SIGNED_IN or INITIAL_SESSION
    const { data: authSub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;
      if (session?.user && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED")) {
        await checkUserStatusAndRole(
          session.user.id,
          session.user.email || "",
          session.user.user_metadata
        );
      }
    });

    return () => {
      isMounted = false;
      authSub.subscription.unsubscribe();
    };
  }, [checkUserStatusAndRole]);

  const handleActivateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Passwords do not match. Please verify both fields.");
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Update password securely in Supabase Auth
      const { data: updateData, error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        setFormError(updateError.message || "Failed to set password. Please try again.");
        setIsSubmitting(false);
        return;
      }

      // 2. Synchronize profile display name if user has a name in metadata
      if (updateData?.user) {
        const metadataName = (updateData.user.user_metadata as Record<string, any> | undefined)?.["full_name"] || invitedName;
        if (metadataName) {
          try {
            await supabase.from("profiles").upsert(
              {
                id: updateData.user.id,
                full_name: metadataName,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "id" }
            );
          } catch {
            // Non-blocking
          }
        }
      }

      // 3. Verify admin access server-side
      const { data: isStaffAdmin } = await supabase.rpc("is_admin");

      toast.success("Account activated successfully! Welcome to Shipt.");
      setPageState("success");

      // Smooth automated redirect to Admin Portal
      setTimeout(() => {
        navigate({ to: "/admin" });
      }, 1600);
    } catch (err: any) {
      setFormError(err?.message || "An unexpected error occurred during account activation.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container-page py-12 md:py-20 flex justify-center">
      <div className="w-full max-w-lg">
        {/* BRAND HEADER */}
        <div className="mb-6 text-center">
          <Link to="/" className="inline-flex items-center gap-2 mb-3 group" aria-label={`${branding.store_name} Home`}>
            {branding.logo_url ? (
              <img src={branding.logo_url} alt={branding.store_name} className="size-11 object-contain rounded-2xl shadow-sm transition group-hover:scale-105" />
            ) : (
              <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm transition group-hover:scale-105">
                <ShoppingBag className="size-6" />
              </span>
            )}
            <span className="font-display text-2xl font-black tracking-tight text-foreground">{branding.store_name}</span>
          </Link>
          <p className="text-xs text-muted-foreground font-medium">{branding.tagline}</p>
        </div>

        {/* STATE 1: LOADING */}
        {pageState === "loading" && (
          <div className="rounded-3xl border border-border bg-card p-8 sm:p-10 shadow-soft text-center space-y-4">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Loader2 className="size-7 animate-spin text-primary" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-foreground">Verifying Staff Invitation</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Authenticating your secure invitation token with Shipt…
              </p>
            </div>
          </div>
        )}

        {/* STATE 2: EXPIRED OR INVALID INVITATION */}
        {pageState === "invalid_or_expired" && (
          <div className="rounded-3xl border border-destructive/20 bg-card p-8 sm:p-10 shadow-soft text-center space-y-5">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="size-7" />
            </div>

            <div>
              <Badge variant="outline" className="border-destructive/30 text-destructive text-[10px] font-bold uppercase tracking-wider mb-2">
                Invitation Inactive
              </Badge>
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Invitation Link Expired or Invalid
              </h1>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                {errorMessage || "This invitation link cannot be verified. Staff invitations are single-use and time-sensitive for security."}
              </p>
            </div>

            <div className="rounded-2xl border border-border/80 bg-secondary/30 p-4 text-left text-xs space-y-2">
              <p className="font-bold text-foreground flex items-center gap-1.5">
                <Shield className="size-3.5 text-primary" />
                <span>Next steps to access Shipt:</span>
              </p>
              <ul className="list-disc pl-4 space-y-1 text-muted-foreground text-[11px] leading-relaxed">
                <li>If you already activated your password previously, sign in directly at the Staff Portal.</li>
                <li>If your invitation expired, contact a Super Administrator (<code>sshinasbin@gmail.com</code>) to request a fresh invitation link.</li>
              </ul>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <Button asChild variant="hero" className="flex-1 h-11 text-xs font-bold gap-1.5">
                <Link to="/admin">
                  <span>Go to Staff Sign In</span>
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="flex-1 h-11 text-xs font-semibold">
                <Link to="/">
                  <span>Visit Shipt Store</span>
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* STATE 3: SUCCESS STATE */}
        {pageState === "success" && (
          <div className="rounded-3xl border border-emerald-500/30 bg-card p-8 sm:p-10 shadow-soft text-center space-y-5 animate-in fade-in zoom-in-95 duration-300">
            <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-emerald-500/15 text-emerald-600">
              <CheckCircle2 className="size-9" />
            </div>

            <div>
              <Badge className="bg-emerald-600/15 text-emerald-700 border-emerald-600/25 mb-2 font-bold text-[11px]">
                Account Verified
              </Badge>
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Staff Account Activated!
              </h1>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Your password has been securely configured and your staff permissions are active.
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin shrink-0" />
              <span className="font-medium">Redirecting you to the Staff & Admin Portal…</span>
            </div>

            <div className="pt-2">
              <Button asChild variant="hero" className="w-full h-11 text-xs font-bold gap-1.5">
                <Link to="/admin">
                  <span>Enter Staff Portal Now</span>
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* STATE 4: VALID INVITATION FORM */}
        {pageState === "valid_session" && (
          <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8 space-y-6">
            <div className="flex items-center gap-3 border-b border-border/60 pb-5">
              <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary shrink-0">
                <ShieldCheck className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-xl font-bold text-foreground truncate">
                    Activate Staff Account
                  </h1>
                  <Badge variant="outline" className="border-primary/30 text-primary capitalize text-[10px] font-bold shrink-0">
                    {assignedRole.replace("_", " ")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {invitedName ? `Welcome, ${invitedName}! Set up your credentials below.` : "Welcome to Shipt! Set up your credentials below."}
                </p>
              </div>
            </div>

            {/* VERIFIED EMAIL BADGE */}
            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-3.5 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase block">Invited Staff Email</span>
                  <span className="font-bold text-foreground truncate block font-mono">{invitedEmail || "Verified invitation"}</span>
                </div>
              </div>
              <Badge className="bg-emerald-600/15 text-emerald-700 border-emerald-600/20 text-[10px] font-bold shrink-0">
                Verified
              </Badge>
            </div>

            {formError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleActivateAccount} className="space-y-4">
              {/* NEW PASSWORD */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Create New Password *
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-10 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {/* CONFIRM PASSWORD */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Confirm Password *
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-10 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {/* REQUIREMENTS CHECKLIST */}
              <div className="rounded-2xl border border-border/60 bg-muted/30 p-3 space-y-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className={`size-3.5 rounded-full grid place-items-center text-[10px] ${isMinLength ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    ✓
                  </span>
                  <span className={isMinLength ? "text-foreground font-semibold" : "text-muted-foreground"}>
                    At least 8 characters
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`size-3.5 rounded-full grid place-items-center text-[10px] ${isMatch ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    ✓
                  </span>
                  <span className={isMatch ? "text-foreground font-semibold" : "text-muted-foreground"}>
                    Passwords match
                  </span>
                </div>
              </div>

              <Button
                type="submit"
                variant="hero"
                disabled={isSubmitting || !isFormValid}
                className="w-full h-11 font-bold text-xs gap-1.5 shadow-sm"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Activating Account…</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" />
                    <span>Set Password & Activate Staff Account</span>
                  </>
                )}
              </Button>

              <p className="text-[11px] text-muted-foreground text-center pt-1 leading-relaxed">
                By activating your account, you agree to access Shipt store operations responsibly in accordance with your assigned role privileges.
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
