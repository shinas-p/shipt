import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { Loader2, AlertCircle, ShoppingBag, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useCustomerAuth } from "@/lib/auth";
import { getSafeRedirectUrl } from "@/lib/auth-helpers";
import { BRAND_NAME } from "@/data/products";
import { toast } from "sonner";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [
      { title: `Authenticating — ${BRAND_NAME}` },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuthCallbackPage,
});

type CallbackStatus = "processing" | "success" | "error";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refreshProfile } = useCustomerAuth();
  const [status, setStatus] = useState<CallbackStatus>("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasExecutedRef = useRef(false);
  const refreshProfileRef = useRef(refreshProfile);
  refreshProfileRef.current = refreshProfile;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (hasExecutedRef.current) return;
    hasExecutedRef.current = true;
    let isMounted = true;

    async function handleAuthCallback() {
      if (!isSupabaseConfigured) {
        if (!isMounted) return;
        setStatus("error");
        setErrorMessage("Authentication is not configured in this environment.");
        return;
      }

      if (typeof window === "undefined") return;

      const url = new URL(window.location.href);
      const searchParams = url.searchParams;
      const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
      const hashParams = new URLSearchParams(hash);

      // Check for OAuth cancellation or provider errors
      const errorParam = searchParams.get("error") || hashParams.get("error");
      const errorDescription =
        searchParams.get("error_description") || hashParams.get("error_description");

      if (errorParam) {
        if (!isMounted) return;
        setStatus("error");
        let displayError = errorDescription
          ? decodeURIComponent(errorDescription.replace(/\+/g, " "))
          : "Google sign-in could not be completed.";

        if (errorParam === "access_denied" || errorParam.includes("cancel")) {
          displayError = "Google sign-in was cancelled.";
        }

        setErrorMessage(displayError);
        toast.error(displayError);

        // Safely redirect back to account page with error description after brief pause
        setTimeout(() => {
          if (isMounted) {
            navigate({
              to: "/account",
              search: { error: displayError } as any,
              replace: true,
            });
          }
        }, 1500);
        return;
      }

      try {
        // Resolve intended destination from URL search param or stored sessionStorage
        const rawReturnTo =
          searchParams.get("returnTo") ||
          (() => {
            try {
              const saved = sessionStorage.getItem("shipt_oauth_return_to");
              sessionStorage.removeItem("shipt_oauth_return_to");
              return saved;
            } catch {
              return null;
            }
          })();

        const safeDestination = getSafeRedirectUrl(rawReturnTo, "/account");

        // Handle PKCE code exchange if present in query parameters
        const code = searchParams.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
        }

        // Verify active session
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }

        if (sessionData.session?.user) {
          if (!isMounted) return;
          setStatus("success");
          await refreshProfileRef.current();
          toast.success("Signed in successfully with Google!");

          // Clean up URL and redirect to the validated destination
          navigateRef.current({
            to: safeDestination as any,
            replace: true,
          });
          return;
        }

        // If no session is found after code exchange, listen briefly to onAuthStateChange
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
          if (currentSession?.user && isMounted) {
            subscription.unsubscribe();
            setStatus("success");
            await refreshProfileRef.current();
            toast.success("Signed in successfully with Google!");
            navigateRef.current({
              to: safeDestination as any,
              replace: true,
            });
          }
        });

        // Set safety timeout if no session arrives within 4 seconds
        setTimeout(() => {
          subscription.unsubscribe();
          if (isMounted && status === "processing") {
            setStatus("error");
            setErrorMessage("Session initialization timed out. Please try signing in again.");
            navigateRef.current({
              to: "/account",
              search: { error: "Session expired or timed out. Please sign in again." } as any,
              replace: true,
            });
          }
        }, 4000);
      } catch (err: any) {
        if (!isMounted) return;
        setStatus("error");
        const msg = err?.message || "An unexpected error occurred during Google authentication.";
        setErrorMessage(msg);
        toast.error(msg);
        setTimeout(() => {
          if (isMounted) {
            navigateRef.current({
              to: "/account",
              search: { error: msg } as any,
              replace: true,
            });
          }
        }, 2000);
      }
    }

    handleAuthCallback();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-soft">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <ShoppingBag className="size-7" />
        </div>

        {status === "processing" && (
          <div className="space-y-4">
            <h1 className="font-display text-xl font-bold text-foreground">
              Completing secure sign-in...
            </h1>
            <p className="text-xs text-muted-foreground">
              Please wait while we verify your Google credentials and set up your session.
            </p>
            <div className="flex justify-center pt-2">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          </div>
        )}

        {status === "success" && (
          <div className="space-y-3">
            <h1 className="font-display text-xl font-bold text-foreground">
              Welcome to {BRAND_NAME}!
            </h1>
            <p className="text-xs text-muted-foreground">
              Redirecting you to your destination...
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="size-5" />
            </div>
            <h1 className="font-display text-lg font-bold text-foreground">
              Sign-in Unsuccessful
            </h1>
            <p className="text-xs text-destructive">{errorMessage}</p>
            <Button
              type="button"
              variant="hero"
              className="mt-2 w-full h-10 text-xs"
              onClick={() => navigate({ to: "/account", replace: true })}
            >
              <span>Back to Account</span>
              <ArrowRight className="ml-1.5 size-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
