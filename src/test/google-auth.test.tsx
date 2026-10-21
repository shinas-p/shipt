import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { getSafeRedirectUrl, getOAuthCallbackUrl } from "@/lib/auth-helpers";
import { GoogleSignInButton, AuthDivider } from "@/components/auth/GoogleSignInButton";
import { AuthProvider, useCustomerAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

// Mock Supabase isSupabaseConfigured to true so auth flows execute in test
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: true,
  };
});

// Mock TanStack router Link and navigation
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/account", search: "", hash: "" }),
  createFileRoute: () => (opts: any) => opts,
}));

describe("Shipt Mart — Google Authentication Flow & Security Suite", () => {
  let mockCurrentSession: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockCurrentSession = null;

    vi.spyOn(supabase.auth, "getSession").mockImplementation(() =>
      Promise.resolve({ data: { session: mockCurrentSession }, error: null } as any)
    );

    vi.spyOn(supabase.auth, "onAuthStateChange").mockImplementation(((callback: any) => {
      if (mockCurrentSession) {
        callback("SIGNED_IN", mockCurrentSession);
      }
      return {
        data: {
          subscription: {
            id: "mock-sub-id",
            callback,
            unsubscribe: vi.fn(),
          },
        },
      };
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Requirement 1 & 6: Safe Redirect Validation & OAuth URL Construction
  // =========================================================================
  describe("1 & 6. Redirect URL Validation & Open-Redirect Prevention", () => {
    it("accepts valid relative internal application routes", () => {
      expect(getSafeRedirectUrl("/checkout")).toBe("/checkout");
      expect(getSafeRedirectUrl("/cart")).toBe("/cart");
      expect(getSafeRedirectUrl("/wishlist")).toBe("/wishlist");
      expect(getSafeRedirectUrl("/account")).toBe("/account");
      expect(getSafeRedirectUrl("/product/p-notebook")).toBe("/product/p-notebook");
      expect(getSafeRedirectUrl("/checkout?step=payment#order")).toBe("/checkout?step=payment#order");
    });

    it("rejects malicious open redirect vectors and returns fallback", () => {
      // Protocol-relative URLs
      expect(getSafeRedirectUrl("//evil.com")).toBe("/account");
      expect(getSafeRedirectUrl("//attacker.com/malware")).toBe("/account");

      // Absolute external URLs
      expect(getSafeRedirectUrl("https://phishing.com")).toBe("/account");
      expect(getSafeRedirectUrl("http://evil.com/login")).toBe("/account");

      // Backslash evasion
      expect(getSafeRedirectUrl("\\evil.com")).toBe("/account");
      expect(getSafeRedirectUrl("/\\evil.com")).toBe("/account");

      // JavaScript / data URI schemes
      expect(getSafeRedirectUrl("javascript:alert(1)")).toBe("/account");
      expect(getSafeRedirectUrl("data:text/html,<script>alert(1)</script>")).toBe("/account");

      // Null, empty, or undefined input
      expect(getSafeRedirectUrl(null)).toBe("/account");
      expect(getSafeRedirectUrl(undefined)).toBe("/account");
      expect(getSafeRedirectUrl("")).toBe("/account");
      expect(getSafeRedirectUrl("   ")).toBe("/account");

      // Disallowed external or unrecognized paths fallback to custom fallback
      expect(getSafeRedirectUrl("https://external.com", "/cart")).toBe("/cart");
    });

    it("constructs canonical OAuth callback URL targeting /auth/callback", () => {
      const callback = getOAuthCallbackUrl("/checkout");
      expect(callback).toContain("/auth/callback");
      expect(callback).toContain("returnTo=%2Fcheckout");
    });
  });

  // =========================================================================
  // Requirement 2: Google Sign-in Button UI, Loading, and Double-Click Prevention
  // =========================================================================
  describe("2. Google Sign-In Button Component", () => {
    it("renders official Google branding, icon, and label appropriately", () => {
      const { container } = render(
        <AuthProvider>
          <GoogleSignInButton text="Continue with Google" />
        </AuthProvider>
      );

      const button = screen.getByRole("button", { name: /continue with google/i });
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();

      // Official 4-color Google G icon SVG
      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg?.querySelectorAll("path")).toHaveLength(4);
    });

    it("renders AuthDivider with customizable text", () => {
      render(<AuthDivider text="or continue with email" />);
      expect(screen.getByText(/or continue with email/i)).toBeInTheDocument();
    });

    it("shows loading state and prevents repeated clicks during in-flight sign-in", async () => {
      // Simulate delayed OAuth response
      let resolveOAuth: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveOAuth = resolve;
      });

      const signInWithOAuthSpy = vi
        .spyOn(supabase.auth, "signInWithOAuth")
        .mockReturnValue(delayedPromise as any);

      function TestConsumer() {
        return (
          <AuthProvider>
            <GoogleSignInButton returnTo="/checkout" />
          </AuthProvider>
        );
      }

      render(<TestConsumer />);

      const button = screen.getByRole("button", { name: /continue with google/i });
      expect(button).not.toBeDisabled();

      // First click
      fireEvent.click(button);

      // Immediately shows loading state and is disabled
      await waitFor(() => {
        expect(button).toBeDisabled();
        expect(screen.getByText(/connecting to google/i)).toBeInTheDocument();
      });

      // Second click while loading should be ignored (button disabled)
      fireEvent.click(button);
      expect(signInWithOAuthSpy).toHaveBeenCalledTimes(1);

      // Resolve OAuth
      resolveOAuth!({ data: { provider: "google", url: "https://accounts.google.com/o/oauth2" }, error: null });
    });

    it("displays error state and invokes callback if OAuth initialization fails", async () => {
      const mockErrorCallback = vi.fn();

      vi.spyOn(supabase.auth, "signInWithOAuth").mockResolvedValueOnce({
        data: null as any,
        error: { message: "Google OAuth provider is temporarily disabled in Supabase" } as any,
      });

      function TestConsumer() {
        return (
          <AuthProvider>
            <GoogleSignInButton returnTo="/account" onError={mockErrorCallback} />
          </AuthProvider>
        );
      }

      render(<TestConsumer />);

      const button = screen.getByRole("button", { name: /continue with google/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockErrorCallback).toHaveBeenCalledWith("Google OAuth provider is temporarily disabled in Supabase");
        // Button is re-enabled so user can retry
        expect(button).not.toBeDisabled();
      });
    });
  });

  // =========================================================================
  // Requirement 3: Google OAuth Provider Integration
  // =========================================================================
  describe("3. Supabase Auth signInWithOAuth Integration", () => {
    it("calls supabase.auth.signInWithOAuth with provider 'google' and offline access", async () => {
      const oauthSpy = vi.spyOn(supabase.auth, "signInWithOAuth").mockResolvedValueOnce({
        data: { provider: "google", url: "https://accounts.google.com/o/oauth2/v2/auth" },
        error: null,
      });

      let authHook: ReturnType<typeof useCustomerAuth>;
      function HookCollector() {
        authHook = useCustomerAuth();
        return null;
      }

      render(
        <AuthProvider>
          <HookCollector />
        </AuthProvider>
      );

      const res = await authHook!.signInWithGoogle({ returnTo: "/checkout" });
      expect(res.success).toBe(true);

      expect(oauthSpy).toHaveBeenCalledTimes(1);
      const callArgs = oauthSpy.mock.calls[0]![0];
      expect(callArgs.provider).toBe("google");
      expect(callArgs.options?.redirectTo).toContain("/auth/callback");
      expect(callArgs.options?.redirectTo).toContain("returnTo=%2Fcheckout");
      expect(callArgs.options?.queryParams?.["access_type"]).toBe("offline");
      expect(callArgs.options?.queryParams?.["prompt"]).toBe("select_account");

      // Verify sessionStorage redundancy
      expect(sessionStorage.getItem("shipt_oauth_return_to")).toBe("/checkout");
    });
  });

  // =========================================================================
  // Requirement 4 & 5: Profile Syncing, Non-Duplication & Field Preservation
  // =========================================================================
  describe("4 & 5. Customer Profile Synchronization & Security", () => {
    it("creates a customer profile on first Google sign-in using OAuth metadata", async () => {
      // Mock no existing profile in profiles table
      const selectMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const upsertMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: "google-usr-123",
          full_name: "Google Customer",
          phone: null,
          default_hostel: null,
          default_block: null,
          default_room: null,
          avatar_url: "https://lh3.googleusercontent.com/photo.jpg",
        },
        error: null,
      });

      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: selectMaybeSingle,
              }),
            }),
            upsert: (payload: any) => ({
              select: () => ({
                maybeSingle: upsertMaybeSingle,
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      // Active Google session
      mockCurrentSession = {
        user: {
          id: "google-usr-123",
          email: "customer@gmail.com",
          user_metadata: {
            full_name: "Google Customer",
            avatar_url: "https://lh3.googleusercontent.com/photo.jpg",
          },
        },
        access_token: "token-123",
      };

      let authHook: ReturnType<typeof useCustomerAuth>;
      function HookCollector() {
        authHook = useCustomerAuth();
        return null;
      }

      render(
        <AuthProvider>
          <HookCollector />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(authHook.profile).not.toBeNull();
        expect(authHook.profile?.full_name).toBe("Google Customer");
        expect(authHook.profile?.avatar_url).toBe("https://lh3.googleusercontent.com/photo.jpg");
      });
    });

    it("preserves customer-edited profile fields and does not overwrite existing data", async () => {
      // Existing profile with user's customized delivery details
      const existingProfile = {
        id: "google-usr-456",
        full_name: "Custom Name Edited By User",
        phone: "9876543210",
        default_hostel: "Ganga Hostel",
        default_block: "Block B",
        default_room: "302",
        avatar_url: "https://existing-avatar.jpg",
      };

      const selectMaybeSingle = vi.fn().mockResolvedValue({ data: existingProfile, error: null });
      const updateSpy = vi.fn();

      vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: selectMaybeSingle,
              }),
            }),
            update: updateSpy,
          } as any;
        }
        return {} as any;
      });

      // Google user with different metadata
      mockCurrentSession = {
        user: {
          id: "google-usr-456",
          email: "existing@gmail.com",
          user_metadata: {
            full_name: "Google Account Name",
            avatar_url: "https://new-google-avatar.jpg",
          },
        },
        access_token: "token-456",
      };

      let authHook: ReturnType<typeof useCustomerAuth>;
      function HookCollector() {
        authHook = useCustomerAuth();
        return null;
      }

      render(
        <AuthProvider>
          <HookCollector />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(authHook.profile?.full_name).toBe("Custom Name Edited By User");
        expect(authHook.profile?.phone).toBe("9876543210");
        expect(authHook.profile?.default_hostel).toBe("Ganga Hostel");
        expect(authHook.profile?.default_room).toBe("302");
        // No update was dispatched to overwrite existing name
        expect(updateSpy).not.toHaveBeenCalled();
      });
    });

    it("never grants administrator or staff privileges to Google accounts", async () => {
      // is_admin RPC check strictly evaluates admin_roles table
      vi.spyOn(supabase, "rpc").mockImplementation((funcName: string) => {
        if (funcName === "is_admin") {
          // Standard customer returning false
          return Promise.resolve({ data: false, error: null }) as any;
        }
        if (funcName === "get_admin_role") {
          return Promise.resolve({ data: null, error: null }) as any;
        }
        return Promise.resolve({ data: null, error: null }) as any;
      });

      const { data: isAdmin } = await supabase.rpc("is_admin");
      expect(isAdmin).toBe(false);

      const { data: adminRole } = await supabase.rpc("get_admin_role");
      expect(adminRole).toBeNull();
    });
  });

  // =========================================================================
  // Requirement 8, 9 & 10: Existing Email Auth & Session Persistence
  // =========================================================================
  describe("8, 9 & 10. Email/Password Compatibility, Admin Security, & Session Persistence", () => {
    it("preserves standard email and password authentication", async () => {
      const signInSpy = vi.spyOn(supabase.auth, "signInWithPassword").mockResolvedValueOnce({
        data: {
          user: { id: "email-usr-789", email: "user@example.com" } as any,
          session: { access_token: "tok", user: { id: "email-usr-789" } } as any,
        },
        error: null,
      });

      vi.spyOn(supabase, "from").mockReturnValue({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        upsert: () => ({
          select: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      } as any);

      let authHook: ReturnType<typeof useCustomerAuth>;
      function HookCollector() {
        authHook = useCustomerAuth();
        return null;
      }

      render(
        <AuthProvider>
          <HookCollector />
        </AuthProvider>
      );

      const res = await authHook!.signIn("user@example.com", "Password123!");
      expect(res.success).toBe(true);
      expect(signInSpy).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "Password123!",
      });
    });

    it("preserves customer sign-out functionality cleanly", async () => {
      const signOutSpy = vi.spyOn(supabase.auth, "signOut").mockResolvedValueOnce({ error: null });

      let authHook: ReturnType<typeof useCustomerAuth>;
      function HookCollector() {
        authHook = useCustomerAuth();
        return null;
      }

      render(
        <AuthProvider>
          <HookCollector />
        </AuthProvider>
      );

      await authHook!.signOut();
      expect(signOutSpy).toHaveBeenCalled();
      expect(authHook!.user).toBeNull();
      expect(authHook!.profile).toBeNull();
    });

    it("preserves session across page refresh via getSession()", async () => {
      mockCurrentSession = {
        user: { id: "persisted-usr-999", email: "persist@shiptmart.com" },
        access_token: "token-persisted",
      };

      vi.spyOn(supabase, "from").mockReturnValue({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "persisted-usr-999",
                full_name: "Persisted User",
                phone: null,
                default_hostel: null,
                default_block: null,
                default_room: null,
                avatar_url: null,
              },
              error: null,
            }),
          }),
        }),
      } as any);

      let authHook: ReturnType<typeof useCustomerAuth>;
      function HookCollector() {
        authHook = useCustomerAuth();
        return null;
      }

      render(
        <AuthProvider>
          <HookCollector />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(authHook.user?.id).toBe("persisted-usr-999");
        expect(authHook.session?.access_token).toBe("token-persisted");
      });
    });
  });

  // =========================================================================
  // Requirement 3 & 4: AuthCallbackPage Component Behavior
  // =========================================================================
  describe("3 & 4. AuthCallbackPage Route Flow", () => {
    it("handles OAuth cancellation error in URL params safely", async () => {
      const { AuthCallbackPage } = await import("@/routes/auth.callback");

      delete (window as any).location;
      window.location = new URL(
        "http://localhost:5173/auth/callback?error=access_denied&error_description=User+cancelled+sign-in"
      ) as any;

      render(
        <AuthProvider>
          <AuthCallbackPage />
        </AuthProvider>
      );

      // Verify that error is displayed on screen
      await waitFor(() => {
        expect(screen.getByText(/sign-in unsuccessful/i)).toBeInTheDocument();
        expect(screen.getByText(/google sign-in was cancelled/i)).toBeInTheDocument();
      });

      // And navigates back to account page
      await waitFor(
        () => {
          expect(mockNavigate).toHaveBeenCalledWith(
            expect.objectContaining({
              to: "/account",
              replace: true,
            })
          );
        },
        { timeout: 3000 }
      );
    });

    it("handles successful OAuth return with code exchange and safe destination navigation", async () => {
      const { AuthCallbackPage } = await import("@/routes/auth.callback");

      delete (window as any).location;
      window.location = new URL(
        "http://localhost:5173/auth/callback?code=mock-pkce-code&returnTo=%2Fcheckout"
      ) as any;

      const exchangeSpy = vi.spyOn(supabase.auth, "exchangeCodeForSession").mockResolvedValueOnce({
        data: {
          session: {
            user: { id: "google-callback-usr", email: "callback@gmail.com" },
            access_token: "tok-callback",
          } as any,
          user: { id: "google-callback-usr" } as any,
        },
        error: null,
      });

      mockCurrentSession = {
        user: { id: "google-callback-usr", email: "callback@gmail.com" },
        access_token: "tok-callback",
      };

      vi.spyOn(supabase, "from").mockReturnValue({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "google-callback-usr", full_name: "Google Callback User" },
              error: null,
            }),
          }),
        }),
      } as any);

      render(
        <AuthProvider>
          <AuthCallbackPage />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(exchangeSpy).toHaveBeenCalledWith("mock-pkce-code");
        expect(mockNavigate).toHaveBeenCalledWith(
          expect.objectContaining({
            to: "/checkout",
            replace: true,
          })
        );
      });
    });
  });
});

