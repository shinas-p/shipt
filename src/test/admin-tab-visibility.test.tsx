import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ADMIN_TAB_DEFINITIONS,
  loadTabVisibilityPreferences,
  saveTabVisibilityPreferences,
  isTabVisible,
  getSafeFallbackTab,
  getTabVisibilityStorageKey,
  DEFAULT_TAB_VISIBILITY_PREFERENCES,
} from "@/lib/adminTabVisibility";
import { TabVisibilitySettingsSection } from "@/components/admin/TabVisibilitySettingsSection";
import { TabVisibilitySettingsView } from "@/components/admin/TabVisibilitySettingsView";
import type { AdminRole } from "@/lib/permissions";

describe("Admin Tab Visibility Suite", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("1. Tab Discovery & Metadata", () => {
    it("discovers all 10 top-level admin tabs from the codebase", () => {
      const tabIds = ADMIN_TAB_DEFINITIONS.map((t) => t.id);
      expect(tabIds).toContain("dashboard");
      expect(tabIds).toContain("orders");
      expect(tabIds).toContain("products");
      expect(tabIds).toContain("blocks");
      expect(tabIds).toContain("settings");
      expect(tabIds).toContain("banners");
      expect(tabIds).toContain("roles");
      expect(tabIds).toContain("branding");
      expect(tabIds).toContain("maintenance");
      expect(tabIds).toContain("suggestions");
      expect(ADMIN_TAB_DEFINITIONS.length).toBe(10);
    });

    it("marks the settings tab as protected so it cannot be hidden", () => {
      const settingsTab = ADMIN_TAB_DEFINITIONS.find((t) => t.id === "settings");
      expect(settingsTab).toBeDefined();
      expect(settingsTab?.isProtected).toBe(true);
    });
  });

  describe("2. Persistence & Multi-Administrator Isolation", () => {
    it("stores preferences in localStorage keyed by administrator ID", () => {
      const userA = "admin_user_aaa_111";
      const userB = "admin_user_bbb_222";

      saveTabVisibilityPreferences(
        {
          showAllTabs: false,
          visibleTabs: {
            ...DEFAULT_TAB_VISIBILITY_PREFERENCES.visibleTabs,
            blocks: false,
          },
        },
        userA
      );

      saveTabVisibilityPreferences(
        {
          showAllTabs: false,
          visibleTabs: {
            ...DEFAULT_TAB_VISIBILITY_PREFERENCES.visibleTabs,
            products: false,
          },
        },
        userB
      );

      const prefsA = loadTabVisibilityPreferences(userA);
      const prefsB = loadTabVisibilityPreferences(userB);

      // User A hid blocks, but has products visible
      expect(prefsA.visibleTabs.blocks).toBe(false);
      expect(prefsA.visibleTabs.products).toBe(true);

      // User B hid products, but has blocks visible
      expect(prefsB.visibleTabs.products).toBe(false);
      expect(prefsB.visibleTabs.blocks).toBe(true);

      // Distinct localStorage keys were used
      expect(localStorage.getItem(getTabVisibilityStorageKey(userA))).not.toBeNull();
      expect(localStorage.getItem(getTabVisibilityStorageKey(userB))).not.toBeNull();
    });

    it("recovers gracefully with defaults when stored JSON is corrupted", () => {
      localStorage.setItem(getTabVisibilityStorageKey("corrupt_user"), "{ invalid JSON content");
      const prefs = loadTabVisibilityPreferences("corrupt_user");
      expect(prefs.showAllTabs).toBe(true);
      expect(prefs.visibleTabs.settings).toBe(true);
      expect(prefs.visibleTabs.dashboard).toBe(true);
    });
  });

  describe("3. Authorization & Permissions Independence", () => {
    it("never shows unpermitted tabs even if showAllTabs is true", () => {
      const prefs = {
        showAllTabs: true,
        visibleTabs: DEFAULT_TAB_VISIBILITY_PREFERENCES.visibleTabs,
      };

      // Store Manager cannot manage delivery blocks or roles
      const storeManagerRole: AdminRole = "store_manager";
      expect(isTabVisible("blocks", prefs, storeManagerRole)).toBe(false);
      expect(isTabVisible("roles", prefs, storeManagerRole)).toBe(false);
      expect(isTabVisible("maintenance", prefs, storeManagerRole)).toBe(false);
      expect(isTabVisible("settings", prefs, storeManagerRole)).toBe(false);

      // Store Manager CAN see dashboard, orders, products
      expect(isTabVisible("dashboard", prefs, storeManagerRole)).toBe(true);
      expect(isTabVisible("orders", prefs, storeManagerRole)).toBe(true);
      expect(isTabVisible("products", prefs, storeManagerRole)).toBe(true);

      // Block Manager cannot manage catalog, blocks, roles, or settings
      const blockManagerRole: AdminRole = "block_manager";
      expect(isTabVisible("products", prefs, blockManagerRole)).toBe(false);
      expect(isTabVisible("blocks", prefs, blockManagerRole)).toBe(false);
      expect(isTabVisible("roles", prefs, blockManagerRole)).toBe(false);
      expect(isTabVisible("dashboard", prefs, blockManagerRole)).toBe(true);
      expect(isTabVisible("orders", prefs, blockManagerRole)).toBe(true);
    });

    it("allows Super Admin to see all permitted tabs when showAllTabs is true", () => {
      const prefs = {
        showAllTabs: true,
        visibleTabs: DEFAULT_TAB_VISIBILITY_PREFERENCES.visibleTabs,
      };
      const superAdminRole: AdminRole = "super_admin";

      for (const tab of ADMIN_TAB_DEFINITIONS) {
        expect(isTabVisible(tab.id, prefs, superAdminRole)).toBe(true);
      }
    });
  });

  describe("4. Safety Rules: Protected Settings & Fallback Navigation", () => {
    it("guarantees Settings is always visible for permitted administrators", () => {
      // Even if visibleTabs explicitly attempts to set settings: false and showAllTabs: false
      const malformedPrefs = {
        showAllTabs: false,
        visibleTabs: {
          ...DEFAULT_TAB_VISIBILITY_PREFERENCES.visibleTabs,
          settings: false as any,
        },
      };

      expect(isTabVisible("settings", malformedPrefs, "super_admin")).toBe(true);
      expect(isTabVisible("settings", malformedPrefs, "owner")).toBe(true);
    });

    it("redirects safely to another visible permitted tab if current tab is hidden", () => {
      const prefs = {
        showAllTabs: false,
        visibleTabs: {
          ...DEFAULT_TAB_VISIBILITY_PREFERENCES.visibleTabs,
          blocks: false,
        },
      };

      // Current tab is "blocks" but it is now hidden -> fallback to dashboard
      const fallback = getSafeFallbackTab("blocks", prefs, "super_admin");
      expect(fallback).toBe("dashboard");
    });

    it("keeps current tab when it is permitted and visible", () => {
      const prefs = {
        showAllTabs: true,
        visibleTabs: DEFAULT_TAB_VISIBILITY_PREFERENCES.visibleTabs,
      };
      expect(getSafeFallbackTab("products", prefs, "super_admin")).toBe("products");
    });
  });

  describe("5. TabVisibilitySettingsSection UI Component", () => {
    it("renders Admin Tab Visibility section with Master toggle and Reset button", () => {
      render(
        <TabVisibilitySettingsSection
          adminRole="super_admin"
          userId="test_admin_ui"
        />
      );

      expect(screen.getByRole("heading", { name: /admin tab visibility/i })).toBeInTheDocument();
      expect(screen.getAllByText(/show all tabs/i).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /reset to default/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/toggle show all tabs master switch/i)).toBeInTheDocument();
    });

    it("displays Always Visible lock on the Settings tab toggle", () => {
      render(
        <TabVisibilitySettingsSection
          adminRole="super_admin"
          userId="test_admin_ui"
        />
      );

      expect(screen.getByText(/always visible/i)).toBeInTheDocument();
      const settingsToggle = screen.getByLabelText(/settings visibility \(always visible\)/i);
      expect(settingsToggle).toBeDisabled();
    });

    it("allows master toggle to be disabled and individual tabs to be toggled", async () => {
      render(
        <TabVisibilitySettingsSection
          adminRole="super_admin"
          userId="test_admin_ui"
        />
      );

      const masterSwitch = screen.getByLabelText(/toggle show all tabs master switch/i);
      expect(masterSwitch).toHaveAttribute("data-state", "checked");

      // Click master switch to disable
      fireEvent.click(masterSwitch);
      expect(masterSwitch).toHaveAttribute("data-state", "unchecked");

      // Toggle Delivery Blocks off
      const blocksToggle = screen.getByLabelText(/toggle visibility of delivery blocks/i);
      fireEvent.click(blocksToggle);

      // Verify persistence was updated
      await waitFor(() => {
        const stored = loadTabVisibilityPreferences("test_admin_ui");
        expect(stored.showAllTabs).toBe(false);
        expect(stored.visibleTabs.blocks).toBe(false);
      });
    });

    it("restores all tabs when Reset to Default is clicked", async () => {
      render(
        <TabVisibilitySettingsSection
          adminRole="super_admin"
          userId="test_admin_ui"
        />
      );

      // Turn off master toggle
      const masterSwitch = screen.getByLabelText(/toggle show all tabs master switch/i);
      fireEvent.click(masterSwitch);

      // Click Reset to Default
      const resetBtn = screen.getByRole("button", { name: /reset to default/i });
      fireEvent.click(resetBtn);

      await waitFor(() => {
        const stored = loadTabVisibilityPreferences("test_admin_ui");
        expect(stored.showAllTabs).toBe(true);
        expect(stored.visibleTabs.blocks).toBe(true);
      });
    });
  });

  describe("6. TabVisibilitySettingsView SubView", () => {
    it("renders back to dashboard button and triggers onBackToDashboard callback", () => {
      const mockBack = vi.fn();
      render(
        <TabVisibilitySettingsView
          adminRole="super_admin"
          userId="test_subview_admin"
          onBackToDashboard={mockBack}
        />
      );

      const backBtn = screen.getByRole("button", { name: /back to settings hub/i });
      expect(backBtn).toBeInTheDocument();
      fireEvent.click(backBtn);
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });
});
