import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LayoutDashboard,
  Package,
  Layers,
  Building2,
  Settings,
  Image as ImageIcon,
  Users,
  Sparkles,
  ShieldAlert,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";
import {
  canManageCatalog,
  canManageBlocks,
  canAccessSettings,
  canManageBanners,
  canManageRoles,
  canManageBranding,
  canManageMaintenance,
  canManageSuggestions,
  type AdminRole,
} from "@/lib/permissions";

export type AdminTabId =
  | "dashboard"
  | "orders"
  | "products"
  | "blocks"
  | "settings"
  | "banners"
  | "roles"
  | "branding"
  | "maintenance"
  | "suggestions";

export interface AdminTabDefinition {
  id: AdminTabId;
  label: string;
  shortLabel?: string;
  description: string;
  icon: LucideIcon;
  isProtected?: boolean; // Cannot be hidden to guarantee system accessibility (e.g. settings)
  category: "core" | "operations" | "management";
  permissionDescription: string;
  checkPermission: (role: AdminRole | null | undefined) => boolean;
}

export const ADMIN_TAB_DEFINITIONS: AdminTabDefinition[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    shortLabel: "Dashboard",
    description: "Real-time revenue, active orders summary, low stock alerts, and store KPIs.",
    icon: LayoutDashboard,
    category: "core",
    permissionDescription: "Available to all staff and managers",
    checkPermission: () => true,
  },
  {
    id: "orders",
    label: "Orders",
    shortLabel: "Orders",
    description: "Live order dispatch workflows, order claiming, tracking, and customer contact.",
    icon: Package,
    category: "core",
    permissionDescription: "Available to all staff and managers",
    checkPermission: () => true,
  },
  {
    id: "products",
    label: "Products & Stock",
    shortLabel: "Products",
    description: "Complete catalogue management, inventory tracking, categories, pricing, and bulk tools.",
    icon: Layers,
    category: "core",
    permissionDescription: "Requires Catalogue Manager, Owner, or Super Admin",
    checkPermission: (role) => canManageCatalog(role),
  },
  {
    id: "blocks",
    label: "Delivery Blocks",
    shortLabel: "Blocks",
    description: "Campus delivery zones, hostel blocks, and delivery coordinator assignments.",
    icon: Building2,
    category: "operations",
    permissionDescription: "Requires Store Owner or Super Admin",
    checkPermission: (role) => canManageBlocks(role),
  },
  {
    id: "settings",
    label: "Settings",
    shortLabel: "Settings",
    description: "Unified configuration hub: branding, contact, product suggestions, maintenance, and visibility.",
    icon: Settings,
    isProtected: true, // Safety rule: Settings is strictly guaranteed to remain accessible
    category: "core",
    permissionDescription: "Requires Store Owner or Super Admin",
    checkPermission: (role) => canAccessSettings(role),
  },
  {
    id: "banners",
    label: "Promotional Banners",
    shortLabel: "Banners",
    description: "Storefront promotional announcements, top carousels, and campaign banners.",
    icon: ImageIcon,
    category: "management",
    permissionDescription: "Requires Store Owner or Super Admin",
    checkPermission: (role) => canManageBanners(role),
  },
  {
    id: "roles",
    label: "Staff Roles & Security",
    shortLabel: "Staff & Security",
    description: "Staff access delegation, role assignment, and security audit logs.",
    icon: Users,
    category: "management",
    permissionDescription: "Restricted to Super Admin",
    checkPermission: (role) => canManageRoles(role),
  },
  {
    id: "branding",
    label: "Store Identity & Branding",
    shortLabel: "Branding",
    description: "Store logo, display name, marketing tagline, and website favicon.",
    icon: Sparkles,
    category: "management",
    permissionDescription: "Requires Store Owner or Super Admin",
    checkPermission: (role) => canManageBranding(role),
  },
  {
    id: "maintenance",
    label: "Storefront Maintenance",
    shortLabel: "Maintenance",
    description: "Pause storefront browsing for catalogue counts or operational restructuring.",
    icon: ShieldAlert,
    category: "management",
    permissionDescription: "Restricted to Super Admin",
    checkPermission: (role) => canManageMaintenance(role),
  },
  {
    id: "suggestions",
    label: "Product Suggestions",
    shortLabel: "Suggestions",
    description: "Review customer product requests, photo attachments, and procurement statuses.",
    icon: Lightbulb,
    category: "management",
    permissionDescription: "Requires Store Owner or Super Admin",
    checkPermission: (role) => canManageSuggestions(role),
  },
];

export interface AdminTabVisibilityPreferences {
  showAllTabs: boolean;
  visibleTabs: Record<AdminTabId, boolean>;
}

export const DEFAULT_TAB_VISIBILITY_PREFERENCES: AdminTabVisibilityPreferences = {
  showAllTabs: true,
  visibleTabs: {
    dashboard: true,
    orders: true,
    products: true,
    blocks: true,
    settings: true,
    banners: true,
    roles: true,
    branding: true,
    maintenance: true,
    suggestions: true,
  },
};

const STORAGE_KEY_PREFIX = "shipt_admin_tab_visibility_";

/**
 * Derives a dedicated storage key per administrator to isolate preferences.
 */
export function getTabVisibilityStorageKey(userId?: string | null): string {
  const sanitized = (userId || "default").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${STORAGE_KEY_PREFIX}${sanitized}`;
}

/**
 * Loads persisted tab visibility preferences for the specified administrator.
 */
export function loadTabVisibilityPreferences(
  userId?: string | null
): AdminTabVisibilityPreferences {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_TAB_VISIBILITY_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(getTabVisibilityStorageKey(userId));
    if (!raw) return DEFAULT_TAB_VISIBILITY_PREFERENCES;

    const parsed = JSON.parse(raw);
    const parsedVisible = parsed?.visibleTabs || {};

    const visibleTabs: Record<AdminTabId, boolean> = {
      ...DEFAULT_TAB_VISIBILITY_PREFERENCES.visibleTabs,
      ...parsedVisible,
      settings: true, // Enforce safety protection: Settings can never be disabled
    };

    return {
      showAllTabs: typeof parsed?.showAllTabs === "boolean" ? parsed.showAllTabs : true,
      visibleTabs,
    };
  } catch (err) {
    console.error("[AdminTabVisibility] Failed to parse stored preferences:", err);
    return DEFAULT_TAB_VISIBILITY_PREFERENCES;
  }
}

/**
 * Persists tab visibility preferences for the specified administrator.
 */
export function saveTabVisibilityPreferences(
  preferences: AdminTabVisibilityPreferences,
  userId?: string | null
): { success: boolean; error?: string } {
  if (typeof window === "undefined" || !window.localStorage) {
    return { success: false, error: "Browser storage is unavailable" };
  }

  try {
    const safeToSave: AdminTabVisibilityPreferences = {
      showAllTabs: Boolean(preferences.showAllTabs),
      visibleTabs: {
        ...preferences.visibleTabs,
        settings: true, // Always enforce Settings protection
      },
    };

    window.localStorage.setItem(
      getTabVisibilityStorageKey(userId),
      JSON.stringify(safeToSave)
    );

    // Dispatch custom event to notify all active components reactively
    window.dispatchEvent(
      new CustomEvent("shipt:tab-visibility-updated", {
        detail: { userId, preferences: safeToSave },
      })
    );

    return { success: true };
  } catch (err: any) {
    console.error("[AdminTabVisibility] Failed to save preferences:", err);
    return {
      success: false,
      error: err?.message || "Failed to persist tab visibility preferences",
    };
  }
}

/**
 * Evaluates whether an individual tab is visible given preferences and permissions.
 *
 * Rules:
 * 1. If not permitted by RBAC -> strictly FALSE (visibility never grants access).
 * 2. If tab is 'settings' and permitted -> strictly TRUE (cannot lock admin out).
 * 3. If showAllTabs is TRUE -> TRUE for all permitted tabs.
 * 4. If showAllTabs is FALSE -> respects individual visibleTabs preference.
 */
export function isTabVisible(
  tabId: AdminTabId,
  preferences: AdminTabVisibilityPreferences,
  adminRole: AdminRole | null | undefined
): boolean {
  const def = ADMIN_TAB_DEFINITIONS.find((t) => t.id === tabId);
  if (!def) return false;

  // 1. RBAC check is supreme: unpermitted tabs can NEVER be visible
  if (!def.checkPermission(adminRole)) {
    return false;
  }

  // 2. Settings safety lock: if role has settings access, Settings is unconditionally visible
  if (tabId === "settings") {
    return true;
  }

  // 3. Master toggle: when enabled, all permitted tabs are visible
  if (preferences.showAllTabs) {
    return true;
  }

  // 4. Individual preference
  return preferences.visibleTabs[tabId] !== false;
}

/**
 * Returns a safe, visible, and permitted tab if the current tab is hidden.
 */
export function getSafeFallbackTab(
  currentTab: AdminTabId,
  preferences: AdminTabVisibilityPreferences,
  adminRole: AdminRole | null | undefined
): AdminTabId {
  if (isTabVisible(currentTab, preferences, adminRole)) {
    return currentTab;
  }

  // If currently on settings and permitted, stay on settings
  if (currentTab === "settings" && canAccessSettings(adminRole)) {
    return "settings";
  }

  // Find all permitted and visible tabs in order
  const permittedVisible = ADMIN_TAB_DEFINITIONS.filter((d) =>
    isTabVisible(d.id, preferences, adminRole)
  );

  if (permittedVisible.length > 0) {
    // Prefer dashboard if visible, otherwise the first permitted visible tab
    const hasDashboard = permittedVisible.some((d) => d.id === "dashboard");
    if (hasDashboard) return "dashboard";
    return permittedVisible[0]?.id || "dashboard";
  }

  // Ultimate fallback
  return "dashboard";
}

/**
 * Hook to manage reactive admin tab visibility state per administrator.
 */
export function useAdminTabVisibility(
  userId?: string | null,
  adminRole?: AdminRole | null
) {
  const [preferences, setPreferences] = useState<AdminTabVisibilityPreferences>(() =>
    loadTabVisibilityPreferences(userId)
  );

  // Sync if userId changes
  useEffect(() => {
    setPreferences(loadTabVisibilityPreferences(userId));
  }, [userId]);

  // Listen for storage / custom events for multi-tab or reactive updates
  useEffect(() => {
    function handleUpdate(e: Event) {
      const custom = e as CustomEvent;
      if (custom.detail?.preferences) {
        setPreferences(custom.detail.preferences);
      } else {
        setPreferences(loadTabVisibilityPreferences(userId));
      }
    }

    window.addEventListener("shipt:tab-visibility-updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("shipt:tab-visibility-updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [userId]);

  const updatePreferences = useCallback(
    (
      updater: (
        prev: AdminTabVisibilityPreferences
      ) => AdminTabVisibilityPreferences
    ) => {
      setPreferences((prev) => {
        const next = updater(prev);
        saveTabVisibilityPreferences(next, userId);
        return next;
      });
    },
    [userId]
  );

  const setShowAllTabs = useCallback(
    (showAll: boolean) => {
      updatePreferences((prev) => ({
        ...prev,
        showAllTabs: showAll,
      }));
    },
    [updatePreferences]
  );

  const setTabVisible = useCallback(
    (tabId: AdminTabId, visible: boolean) => {
      if (tabId === "settings") return; // Safety: Settings is protected
      updatePreferences((prev) => ({
        ...prev,
        visibleTabs: {
          ...prev.visibleTabs,
          [tabId]: visible,
        },
      }));
    },
    [updatePreferences]
  );

  const resetToDefault = useCallback(() => {
    updatePreferences(() => DEFAULT_TAB_VISIBILITY_PREFERENCES);
  }, [updatePreferences]);

  const visibleTabList = useMemo(() => {
    return ADMIN_TAB_DEFINITIONS.filter((def) =>
      isTabVisible(def.id, preferences, adminRole)
    );
  }, [preferences, adminRole]);

  return {
    preferences,
    setShowAllTabs,
    setTabVisible,
    resetToDefault,
    isTabVisible: (tabId: AdminTabId) => isTabVisible(tabId, preferences, adminRole),
    visibleTabList,
    allTabs: ADMIN_TAB_DEFINITIONS,
  };
}
