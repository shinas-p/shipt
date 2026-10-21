/**
 * Safe redirect and OAuth URL utilities for Shipt Mart.
 * Prevents open redirects and validates internal application routes.
 */

const ALLOWED_INTERNAL_PREFIXES = [
  "/",
  "/account",
  "/cart",
  "/checkout",
  "/wishlist",
  "/product/",
];

/**
 * Validates and sanitizes a target redirect URL.
 * Strictly ensures the target is an internal relative application path.
 * Disallows protocol-relative URLs (e.g., //evil.com), javascript: schemes, backslashes, and external origins.
 *
 * @param target Potential redirect destination path
 * @param fallback Safe fallback route if target is invalid (defaults to '/account')
 * @returns Safe, sanitized internal relative path
 */
export function getSafeRedirectUrl(target?: string | null, fallback: string = "/account"): string {
  if (!target) return fallback;

  const trimmed = target.trim();

  // Must begin with a single slash, must not be protocol-relative (//) or backslash
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return fallback;
  }

  // Reject URLs containing URI schemes (e.g. javascript:, http:, data:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  try {
    // Resolve against a dummy base origin to inspect parsed pathname
    const parsed = new URL(trimmed, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return fallback;
    }

    // Ensure pathname matches an allowed application route structure
    const path = parsed.pathname;
    const isAllowed = ALLOWED_INTERNAL_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix)
    );

    if (!isAllowed) {
      return fallback;
    }

    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}

/**
 * Constructs the canonical OAuth callback URL for the current window origin.
 */
export function getOAuthCallbackUrl(returnTo?: string): string {
  const origin = typeof window !== "undefined" && window.location.origin
    ? window.location.origin
    : "http://localhost:5173";

  const url = new URL("/auth/callback", origin);
  if (returnTo) {
    const safeReturn = getSafeRedirectUrl(returnTo, "/account");
    url.searchParams.set("returnTo", safeReturn);
  }
  return url.toString();
}
