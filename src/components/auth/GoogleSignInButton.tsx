import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { useCustomerAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface GoogleSignInButtonProps {
  /**
   * Text displayed inside the button. Defaults to "Continue with Google".
   */
  text?: string | undefined;
  /**
   * Relative internal destination route after authentication completes.
   */
  returnTo?: string | undefined;
  /**
   * Optional custom error callback.
   */
  onError?: ((error: string) => void) | undefined;
  /**
   * Optional additional CSS classes.
   */
  className?: string | undefined;
  /**
   * Force disabled state if parent form is submitting.
   */
  disabled?: boolean | undefined;
}

/**
 * Official Google "G" logo SVG with authentic Google brand color paths:
 * Blue (#4285F4), Green (#34A853), Yellow (#FBBC05), Red (#EA4335).
 */
export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-5 shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
      />
    </svg>
  );
}

/**
 * Professional, accessible "Continue with Google" button for Shipt Mart.
 * Integrates with Supabase Auth Google provider and preserves user session.
 */
export function GoogleSignInButton({
  text = "Continue with Google",
  returnTo,
  onError,
  className,
  disabled = false,
}: GoogleSignInButtonProps) {
  const { signInWithGoogle } = useCustomerAuth();
  const [isStarting, setIsStarting] = useState(false);

  const handleClick = async () => {
    if (isStarting || disabled) return;

    setIsStarting(true);
    try {
      const res = await signInWithGoogle({ returnTo });
      if (!res.success && res.error) {
        setIsStarting(false);
        onError?.(res.error);
        toast.error(res.error);
      }
      // On success, Supabase initiates browser redirect to Google OAuth consent
    } catch (err: any) {
      setIsStarting(false);
      const msg = err?.message || "Unable to start Google sign-in. Please try again.";
      onError?.(msg);
      toast.error(msg);
    }
  };

  const isDisabled = disabled || isStarting;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      aria-label={text}
      aria-busy={isStarting}
      className={cn(
        "relative flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-input bg-background px-4 text-sm font-semibold text-foreground shadow-xs transition-all",
        "hover:bg-secondary/70 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
    >
      {isStarting ? (
        <>
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">Connecting to Google...</span>
        </>
      ) : (
        <>
          <GoogleIcon />
          <span>{text}</span>
        </>
      )}
    </button>
  );
}

/**
 * Elegant divider element separating OAuth buttons from traditional email/password forms.
 */
export function AuthDivider({ text = "or continue with email" }: { text?: string }) {
  return (
    <div className="relative my-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center text-[11px] uppercase">
        <span className="bg-card px-3 text-muted-foreground font-semibold tracking-wider">
          {text}
        </span>
      </div>
    </div>
  );
}
