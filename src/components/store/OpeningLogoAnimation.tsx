import { useEffect, useState, useCallback } from "react";
import { ShoppingBag } from "lucide-react";
import { useBranding } from "@/lib/branding";
import { BRAND_NAME, BRAND_TAGLINE } from "@/data/products";

export const INTRO_SESSION_STORAGE_KEY = "shipt_opening_intro_shown";

/**
 * OpeningLogoAnimation
 *
 * Professional full-screen opening brand intro for the Shipt storefront.
 *
 * Design & Polish:
 * - Full-screen warm cream canvas with soft ambient glow.
 * - Forest green Shipt shopping-bag logo with a smooth pop-in and subtle scale.
 * - Staggered reveal of "Shipt" typography and the official tagline.
 * - Smooth 450ms fade-out transition after ~1.8 seconds.
 *
 * Safety & UX:
 * - Plays strictly ONCE per browser session/tab (stored in sessionStorage).
 * - Restriced to storefront homepage ("/") only.
 * - Never interrupts /checkout, /admin, /account, /accept-invitation, or auth token callbacks.
 * - Respects prefers-reduced-motion accessibility settings.
 * - Click or press Escape to skip immediately.
 * - Non-blocking: unmounts completely from the DOM after completion.
 */
export function OpeningLogoAnimation() {
  const { branding } = useBranding();
  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  const dismissIntro = useCallback(() => {
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

    // 1. Check if already shown in this tab session
    try {
      const alreadyShown = sessionStorage.getItem(INTRO_SESSION_STORAGE_KEY);
      if (alreadyShown === "true") {
        return;
      }
    } catch {
      return;
    }

    // 2. Accessibility: Respect reduced motion preferences
    try {
      const prefersReducedMotion =
        window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (prefersReducedMotion) {
        sessionStorage.setItem(INTRO_SESSION_STORAGE_KEY, "true");
        return;
      }
    } catch {}

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

    // The intro animation should only play when entering the storefront homepage
    const isStorefrontHome = pathname === "/" || pathname === "";

    if (!isStorefrontHome || isExcludedRoute || hasAuthParams) {
      // Mark as seen so navigation within the session remains seamless
      try {
        sessionStorage.setItem(INTRO_SESSION_STORAGE_KEY, "true");
      } catch {}
      return;
    }

    // 4. Activate intro overlay
    setIsVisible(true);

    // 5. Automatically initiate smooth fade-out after ~1.75s
    const fadeTimer = setTimeout(() => {
      setIsFadingOut(true);
      try {
        sessionStorage.setItem(INTRO_SESSION_STORAGE_KEY, "true");
      } catch {}
    }, 1750);

    // 6. Complete removal from DOM at 2.2s (after 450ms fade transition)
    const endTimer = setTimeout(() => {
      setIsVisible(false);
    }, 2200);

    // 7. Keydown listener for instant skip via Escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismissIntro();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(endTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dismissIntro]);

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
