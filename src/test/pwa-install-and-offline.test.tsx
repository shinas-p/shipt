import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { PwaInstallPrompt, PWA_DISMISSED_KEY } from "@/components/pwa/PwaInstallPrompt";

describe("ShipT Mart — Progressive Web App (PWA) & Offline Safeguards", () => {
  const rootDir = process.cwd();

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("1. Web App Manifest (site.webmanifest)", () => {
    const manifestPath = path.join(rootDir, "public", "site.webmanifest");

    it("exists and is valid JSON", () => {
      expect(fs.existsSync(manifestPath)).toBe(true);
      const content = fs.readFileSync(manifestPath, "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it("conforms to ShipT PWA specifications", () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      expect(manifest.name).toBe("ShipT");
      expect(manifest.short_name).toBe("ShipT");
      expect(manifest.start_url).toBe("/");
      expect(manifest.scope).toBe("/");
      expect(manifest.display).toBe("standalone");
      expect(manifest.theme_color).toBe("#15803d");
      expect(manifest.background_color).toBe("#ffffff");

      // Verify icons configuration
      expect(Array.isArray(manifest.icons)).toBe(true);
      const icon192 = manifest.icons.find((i: any) => i.sizes === "192x192");
      const icon512 = manifest.icons.find((i: any) => i.sizes === "512x512");
      const maskable = manifest.icons.find((i: any) => i.purpose?.includes("maskable"));

      expect(icon192).toBeDefined();
      expect(icon512).toBeDefined();
      expect(maskable).toBeDefined();
    });
  });

  describe("2. Offline HTML Fallback Page (offline.html)", () => {
    const offlineHtmlPath = path.join(rootDir, "public", "offline.html");

    it("exists and contains ShipT brand styling", () => {
      expect(fs.existsSync(offlineHtmlPath)).toBe(true);
      const html = fs.readFileSync(offlineHtmlPath, "utf-8");

      expect(html).toContain("ShipT Mart");
      expect(html).toContain("You're Offline");
      expect(html).toContain("Retry Connection");
      expect(html).toContain("#15803d"); // Primary brand green
    });

    it("enforces strict offline safety notice for payments & orders", () => {
      const html = fs.readFileSync(offlineHtmlPath, "utf-8");

      // Verifies offline financial safeguards
      expect(html).toContain("orders and payments are never processed offline");
      expect(html).toContain("requires an active internet connection");
    });
  });

  describe("3. Combined Service Worker (sw.js) Architecture", () => {
    const swPath = path.join(rootDir, "public", "sw.js");

    it("exists and handles both PWA caching and Web Push", () => {
      expect(fs.existsSync(swPath)).toBe(true);
      const swCode = fs.readFileSync(swPath, "utf-8");

      // Push and notificationclick listeners
      expect(swCode).toContain('self.addEventListener("push"');
      expect(swCode).toContain('self.addEventListener("notificationclick"');

      // Install and fetch listeners
      expect(swCode).toContain('self.addEventListener("install"');
      expect(swCode).toContain('self.addEventListener("fetch"');
    });

    it("strictly excludes sensitive routes and APIs from offline caching", () => {
      const swCode = fs.readFileSync(swPath, "utf-8");

      // Sensitive routes must never be cached
      expect(swCode).toContain('path.startsWith("/admin")');
      expect(swCode).toContain('path.startsWith("/auth")');
      expect(swCode).toContain('path.startsWith("/checkout")');
      expect(swCode).toContain('path.startsWith("/order")');
      expect(swCode).toContain('url.hostname.includes("supabase.co")');
    });
  });

  describe("4. PwaInstallPrompt Component", () => {
    it("renders nothing when neither native prompt nor iOS is active", () => {
      const { container } = render(<PwaInstallPrompt />);
      expect(container).toBeEmptyDOMElement();
    });

    it("captures native beforeinstallprompt and respects user dismissal", async () => {
      render(<PwaInstallPrompt />);

      const mockEvent = new Event("beforeinstallprompt") as any;
      mockEvent.prompt = vi.fn().mockResolvedValue(undefined);
      mockEvent.userChoice = Promise.resolve({ outcome: "dismissed" });

      act(() => {
        window.dispatchEvent(mockEvent);
      });

      // Dismiss button
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Dismiss app install banner/i })).toBeInTheDocument();
      });

      const dismissBtn = screen.getByRole("button", { name: /Dismiss app install banner/i });
      fireEvent.click(dismissBtn);

      expect(localStorage.getItem(PWA_DISMISSED_KEY)).toBeTruthy();
    });

    it("does not display when already dismissed in localStorage", () => {
      localStorage.setItem(PWA_DISMISSED_KEY, Date.now().toString());

      const mockEvent = new Event("beforeinstallprompt") as any;
      mockEvent.prompt = vi.fn();
      render(<PwaInstallPrompt />);

      act(() => {
        window.dispatchEvent(mockEvent);
      });

      expect(screen.queryByText(/Install ShipT App/i)).not.toBeInTheDocument();
    });
  });
});
