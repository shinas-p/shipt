import { useEffect, useState, useCallback, useRef } from "react";
import { ShoppingBag } from "lucide-react";
import { useBranding } from "@/lib/branding";
import { useStore } from "@/lib/store";
import { BRAND_NAME, BRAND_TAGLINE } from "@/data/products";

export const INTRO_SESSION_STORAGE_KEY = "shipt_opening_intro_shown";

/**
 * Checks whether the opening intro overlay should be visible immediately on client mount.
 * Prevents double-loading flash and excludes non-storefront routes.
 */
function shouldShowInitially(): boolean {
  if (typeof window === "undefined") return false;

  try {
    // 1. Check if already shown in this tab session
    const alreadyShown = sessionStorage.getItem(INTRO_SESSION_STORAGE_KEY);
    if (alreadyShown === "true") {
      return false;
    }

    // 2. Accessibility: Respect reduced motion preferences
    const prefersReducedMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      sessionStorage.setItem(INTRO_SESSION_STORAGE_KEY, "true");
      return false;
    }

    // 3. Route Guard: NEVER interrupt checkout, admin, auth, invitation, or recovery routes
    const pathname = window.location.pathname || "/";
    const search = window.location.search || "";
    const hash = window.location.hash || "";

    const isExcludedRoute =
      pathname.startsWith("/checkout") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/account") ||
      pathname.startsWith("/accept-invitation") ||
      pathname.startsWith("/cart");

    const hasAuthParams =
      hash.includes("access_token") ||
      hash.includes("type=invite") ||
      hash.includes("type=recovery") ||
      search.includes("type=invite") ||
      search.includes("type=recovery") ||
      search.includes("token_hash") ||
      search.includes("code=") ||
      search.includes("error=");

    const isStorefrontHome = pathname === "/" || pathname === "";

    if (!isStorefrontHome || isExcludedRoute || hasAuthParams) {
      sessionStorage.setItem(INTRO_SESSION_STORAGE_KEY, "true");
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * OpeningLogoAnimation
 *
 * Professional full-screen opening brand intro for the Shipt storefront.
 *
 * Design & Polish:
 * - Full-screen warm cream canvas with soft ambient glow.
 * - Forest green Shipt shopping-bag logo with a smooth pop-in and subtle scale.
 * - Staggered reveal of "Shipt" typography and the official tagline.
 * - Smooth 450ms fade-out transition.
 *
 * Safety & UX:
 * - Plays strictly ONCE per browser session/tab (stored in sessionStorage).
 * - Restricted to storefront homepage ("/") only.
 * - Coordinated with store catalog readiness so the store is completely loaded
 *   and ready underneath before the splash screen dismisses.
 * - Minimum legible brand display of 600ms, maximum safety timeout of 1.75s so
 *   slow connections never leave the user hanging.
 * - Never interrupts /checkout, /admin, /account, /accept-invitation, or auth token callbacks.
 * - Respects prefers-reduced-motion accessibility settings.
 * - Click or press Escape to skip immediately.
 * - Non-blocking: unmounts completely from the DOM after completion.
 */
export function OpeningLogoAnimation() {
  const { branding } = useBranding();
  const { isCatalogReady } = useStore();
  const [isVisible, setIsVisible] = useState(() => shouldShowInitially());
  const [isFadingOut, setIsFadingOut] = useState(false);
  const startTimeRef = useRef(Date.now());
  const hasTriggeredDismissRef = useRef(false);

  const dismissIntro = useCallback(() => {
    if (hasTriggeredDismissRef.current) return;
    hasTriggeredDismissRef.current = true;
    setIsFadingOut(true);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(INTRO_SESSION_STORAGE_KEY, "true");
      } catch {
        // Safe fallback if sessionStorage is blocked
      }
    }
    const timer = setTimeout(() => {
      setIsVisible(false);
    }, 450);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Verify should show in case location/session changed after component instance creation
    if (!shouldShowInitially()) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);

    // 1. Fallback maximum timeout: Always initiate fade-out after ~1.75s even on slow networks
    const fallbackTimer = setTimeout(() => {
      dismissIntro();
    }, 1750);

    // 2. Keydown listener for instant skip via Escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismissIntro();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(fallbackTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dismissIntro]);

  // Once the store catalog is ready in the background, smoothly transition out
  // after ensuring a crisp minimum branding display time (600ms)
  useEffect(() => {
    if (!isVisible || !isCatalogReady || hasTriggeredDismissRef.current) return;

    const elapsed = Date.now() - startTimeRef.current;
    const minDisplayTime = 600;

    if (elapsed >= minDisplayTime) {
      dismissIntro();
      return undefined;
    } else {
      const waitTimer = setTimeout(() => {
        dismissIntro();
      }, minDisplayTime - elapsed);
      return () => clearTimeout(waitTimer);
    }
  }, [isVisible, isCatalogReady, dismissIntro]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      role="presentation"
      aria-hidden="true"
      data-testid="shipt-opening-animation"
      onClick={dismissIntro}
      className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-[#FAF7F2] select-none transition-all duration-[450ms] ease-out ${
        isFadingOut
          ? "opacity-0 pointer-events-none scale-[1.01]"
          : "opacity-100 pointer-events-auto scale-100"
      }`}
      style={{
        backgroundColor: "#FAF7F2",
      }}
    >
      {/* Soft ambient radial glow in brand forest-green and warm cream */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(circle at 50% 48%, rgba(30, 61, 47, 0.08) 0%, rgba(250, 247, 242, 0) 65%)",
        }}
      />

      {/* Main Brand Logo & Content Card */}
      <div className="relative flex flex-col items-center text-center px-6">
        {/* Shipt Shopping-Bag Icon Badge or Custom Logo */}
        <div className="animate-shipt-logo-pop relative mb-5">
          {branding.logo_url ? (
            <div className="grid size-20 sm:size-24 place-items-center rounded-3xl bg-primary/10 border border-primary/20 shadow-lift p-2.5 overflow-hidden">
              <img src={branding.logo_url} alt={branding.store_name} className="size-full object-contain" />
            </div>
          ) : (
            <div className="grid size-20 sm:size-24 place-items-center rounded-3xl bg-primary text-primary-foreground shadow-lift">
              <ShoppingBag className="size-10 sm:size-12 stroke-[2.2]" />
            </div>
          )}
          {/* Subtle decorative pulsing ring */}
          <div className="absolute -inset-2 -z-10 rounded-4xl bg-primary/10 animate-pulse" />
        </div>

        {/* Brand Name Typography */}
        <div className="animate-shipt-text-reveal">
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
            {branding.store_name}
          </h1>
        </div>

        {/* Brand Tagline */}
        <div className="animate-shipt-tagline-reveal mt-2">
          <p className="text-xs sm:text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            {branding.tagline}
          </p>
        </div>

        {/* Delicate Accent Indicator */}
        <div className="animate-shipt-tagline-reveal mt-5 flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-primary" />
          <span className="text-[11px] font-medium text-primary/80 tracking-wide">
            Everyday Essentials Store
          </span>
          <span className="size-1.5 rounded-full bg-primary" />
        </div>
      </div>

      {/* Subtle skip prompt for impatient users */}
      <div className="absolute bottom-6 text-[11px] font-medium text-muted-foreground/60 transition-opacity hover:opacity-100">
        Click anywhere to enter
      </div>
    </div>
  );
}
