import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  OpeningLogoAnimation,
  INTRO_SESSION_STORAGE_KEY,
} from "@/components/store/OpeningLogoAnimation";
import { BRAND_NAME, BRAND_TAGLINE } from "@/data/products";

describe("Shipt Opening Logo Animation Component", () => {
  let originalLocation: Location;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();

    // Store original window.location
    originalLocation = window.location;

    // Default to storefront homepage
    delete (window as any).location;
    window.location = {
      ...originalLocation,
      pathname: "/",
      search: "",
      hash: "",
    } as any;

    // Default to reduced motion false
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    (window as any).location = originalLocation;
  });

  it("renders on first visit to storefront homepage with Shipt brand and tagline", () => {
    render(<OpeningLogoAnimation />);

    // Should render the overlay
    const overlay = screen.getByTestId("shipt-opening-animation");
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveTextContent(BRAND_NAME);
    expect(overlay).toHaveTextContent(BRAND_TAGLINE);
  });

  it("does not render if already seen in current browser tab/session", () => {
    sessionStorage.setItem(INTRO_SESSION_STORAGE_KEY, "true");

    render(<OpeningLogoAnimation />);
    expect(screen.queryByTestId("shipt-opening-animation")).not.toBeInTheDocument();
  });

  it("respects prefers-reduced-motion accessibility preference", () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<OpeningLogoAnimation />);
    expect(screen.queryByTestId("shipt-opening-animation")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(INTRO_SESSION_STORAGE_KEY)).toBe("true");
  });

  it("never interrupts checkout, admin, account, or staff invitation acceptance routes", () => {
    const protectedRoutes = [
      "/checkout",
      "/admin",
      "/account",
      "/accept-invitation",
      "/cart",
    ];

    for (const route of protectedRoutes) {
      sessionStorage.clear();
      window.location = {
        ...originalLocation,
        pathname: route,
        search: "",
        hash: "",
      } as any;

      const { unmount } = render(<OpeningLogoAnimation />);
      expect(screen.queryByTestId("shipt-opening-animation")).not.toBeInTheDocument();
      // Marks as seen so user is not interrupted later
      expect(sessionStorage.getItem(INTRO_SESSION_STORAGE_KEY)).toBe("true");
      unmount();
    }
  });

  it("never interrupts auth callback sessions with token hashes or query params", () => {
    const authUrlVariations = [
      { pathname: "/", hash: "#access_token=xyz&type=invite", search: "" },
      { pathname: "/", hash: "#type=recovery", search: "" },
      { pathname: "/", hash: "", search: "?token_hash=abc&type=invite" },
      { pathname: "/", hash: "", search: "?code=123" },
      { pathname: "/", hash: "", search: "?error=access_denied" },
    ];

    for (const urlState of authUrlVariations) {
      sessionStorage.clear();
      window.location = {
        ...originalLocation,
        pathname: urlState.pathname,
        search: urlState.search,
        hash: urlState.hash,
      } as any;

      const { unmount } = render(<OpeningLogoAnimation />);
      expect(screen.queryByTestId("shipt-opening-animation")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("smoothly fades out at 1.75s and unmounts from DOM at 2.2s", () => {
    render(<OpeningLogoAnimation />);
    const overlay = screen.getByTestId("shipt-opening-animation");
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveClass("opacity-100");

    // Advance to 1.8s: fade-out transition is triggered
    act(() => {
      vi.advanceTimersByTime(1800);
    });
    expect(overlay).toHaveClass("opacity-0");
    expect(sessionStorage.getItem(INTRO_SESSION_STORAGE_KEY)).toBe("true");

    // Advance past 2.2s: component unmounts completely
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId("shipt-opening-animation")).not.toBeInTheDocument();
  });

  it("allows impatient visitors to skip immediately by clicking or pressing Escape", () => {
    // Test 1: Click to skip
    const { unmount } = render(<OpeningLogoAnimation />);
    let overlay = screen.getByTestId("shipt-opening-animation");
    expect(overlay).toBeInTheDocument();

    fireEvent.click(overlay);
    expect(overlay).toHaveClass("opacity-0");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId("shipt-opening-animation")).not.toBeInTheDocument();
    unmount();

    // Test 2: Escape key to skip
    sessionStorage.clear();
    render(<OpeningLogoAnimation />);
    overlay = screen.getByTestId("shipt-opening-animation");
    expect(overlay).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlay).toHaveClass("opacity-0");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId("shipt-opening-animation")).not.toBeInTheDocument();
  });
});
