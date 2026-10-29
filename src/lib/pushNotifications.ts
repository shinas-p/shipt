/**
 * ShipT Mart — Web Push Notification Client Engine & Subscription Lifecycle
 *
 * Provides:
 * 1. Standards-compliant VAPID key conversion and PushManager subscription.
 * 2. Authenticated persistence to public.admin_push_subscriptions.
 * 3. Multi-device tracking and device removal.
 * 4. Diagnostics for browser capabilities, HTTPS, and VAPID setup.
 * 5. Server-side push invocation via Edge Function send-admin-push.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface AdminPushSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null | undefined;
  device_label: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null | undefined;
  last_used_at?: string | null | undefined;
}

export type PushSubscriptionRow = AdminPushSubscription;

export interface PushDiagnostics {
  supported: boolean;
  serviceWorkerReady: boolean;
  secureContext: boolean;
  vapidConfigured: boolean;
  permission: NotificationPermission;
  error?: string | null | undefined;
}

export const PUSH_STORAGE_KEY = "shipt_admin_push_sub_cache_v1";

/**
 * Converts a URL-safe Base64 string to a Uint8Array for applicationServerKey
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Detects browser and OS for user-friendly device label
 */
export function getDeviceLabel(customUa?: string): string {
  const ua = customUa || (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (!ua) return "Unknown Device";
  let browser = "Browser";
  let os = "Device";

  if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Safari/") || ua.includes("Mobile/")) browser = "Safari";

  if (ua.includes("iPhone")) os = "iPhone";
  else if (ua.includes("iPad")) os = "iPad";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS") || ua.includes("Macintosh")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";

  return `${browser} on ${os}`;
}

/**
 * Safely reads the VAPID Public Key from environment variables
 */
export function getVapidPublicKey(): string {
  const metaEnv = typeof import.meta !== "undefined" ? (import.meta as any).env : null;
  const key =
    (metaEnv && (
      metaEnv["VITE_VAPID_PUBLIC_KEY"] ||
      metaEnv["NEXT_PUBLIC_VAPID_PUBLIC_KEY"] ||
      metaEnv["VITE_PUBLIC_VAPID_KEY"]
    )) ||
    (typeof process !== "undefined" && process.env && (
      process.env["VITE_VAPID_PUBLIC_KEY"] ||
      process.env["NEXT_PUBLIC_VAPID_PUBLIC_KEY"]
    )) ||
    "";

  return typeof key === "string" ? key.trim() : "";
}

/**
 * Checks whether the environment supports Web Push
 */
export function isPushSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Checks if the context is HTTPS or localhost
 */
export function isSecureContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext !== undefined) return window.isSecureContext;
  const proto = window.location.protocol;
  const host = window.location.hostname;
  return proto === "https:" || host === "localhost" || host === "127.0.0.1";
}

/**
 * Ensures the service worker at /sw.js is registered
 */
export async function getOrRegisterServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration("/");
    if (existing) {
      return existing;
    }
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    console.warn("[ShipT Push] Service worker registration error:", err);
    return null;
  }
}

/**
 * Trigger server-side Web Push delivery via Supabase Edge Function
 */
export async function triggerAdminWebPush(params: {
  order_id?: string | null | undefined;
  order_number?: string | null | undefined;
  total_amount?: number | null | undefined;
  delivery_method?: string | null | undefined;
  event_type?: string | undefined;
  title?: string | undefined;
  body?: string | undefined;
  type?: "test" | "order" | undefined;
}): Promise<{ success: boolean; message?: string; setupRequired?: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      setupRequired: true,
      error: "Supabase client is not configured.",
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke("send-admin-push", {
      body: {
        type: params.type || (params.order_id ? "order" : "test"),
        orderId: params.order_id || null,
        orderNumber: params.order_number || null,
        totalAmount: params.total_amount || null,
        deliveryMethod: params.delivery_method || null,
        eventType: params.event_type || "new_order",
        title: params.title || null,
        body: params.body || null,
      },
    });

    if (error) {
      return {
        success: false,
        error: error.message || "Failed to invoke send-admin-push Edge Function.",
      };
    }

    if (data?.setupRequired) {
      return {
        success: false,
        setupRequired: true,
        error: data.message || "VAPID keys not configured in Supabase Edge Runtime.",
      };
    }

    return {
      success: Boolean(data?.success),
      message: data?.message || "Push dispatched successfully",
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Failed to reach push dispatcher.",
    };
  }
}

/**
 * Authoritative Hook for Web Push Subscription Management
 */
export function usePushNotifications() {
  const [isSupported] = useState<boolean>(() => isPushSupported());
  const [isSecure] = useState<boolean>(() => isSecureContext());
  const [vapidKey, setVapidKey] = useState<string>(() => getVapidPublicKey());
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      return Notification.permission;
    }
    return "default";
  });

  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<AdminPushSubscription[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isActionInProgress, setIsActionInProgress] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync VAPID Key if loaded dynamically
  useEffect(() => {
    const key = getVapidPublicKey();
    if (key && key !== vapidKey) {
      setVapidKey(key);
    }
  }, [vapidKey]);

  // Sync active subscription from browser PushManager
  const checkCurrentSubscription = useCallback(async () => {
    if (!isPushSupported()) {
      setIsLoading(false);
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub && sub.endpoint) {
        setIsSubscribed(true);
        setCurrentEndpoint(sub.endpoint);
      } else {
        setIsSubscribed(false);
        setCurrentEndpoint(null);
      }
    } catch {
      setIsSubscribed(false);
      setCurrentEndpoint(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch all registered subscriptions for this administrator
  const fetchSubscriptions = useCallback(async () => {
    if (!isSupabaseConfigured) return;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data, error } = await supabase
        .from("admin_push_subscriptions")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });

      if (error) {
        // Table may be pending migration
        return;
      }

      if (data && Array.isArray(data)) {
        setSubscriptions(data as AdminPushSubscription[]);
      }
    } catch {
      // Graceful fallback
    }
  }, []);

  useEffect(() => {
    checkCurrentSubscription();
    fetchSubscriptions();
  }, [checkCurrentSubscription, fetchSubscriptions]);

  /**
   * Subscribe the current device to Web Push
   * NOTE: Must only be invoked from an explicit user click gesture!
   */
  const enablePush = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!isPushSupported()) {
      const err = "Web Push is not supported on this browser or platform.";
      setErrorMessage(err);
      return { success: false, error: err };
    }

    if (!isSecureContext()) {
      const err = "Web Push requires a secure HTTPS connection or localhost.";
      setErrorMessage(err);
      return { success: false, error: err };
    }

    const key = vapidKey || getVapidPublicKey();
    if (!key) {
      const err = "VAPID Public Key is not configured (VITE_VAPID_PUBLIC_KEY required).";
      setErrorMessage(err);
      return { success: false, error: err };
    }

    setIsActionInProgress(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      // 1. Request Notification Permission
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== "granted") {
        const err =
          perm === "denied"
            ? "Notification permission was blocked in your browser settings. Please enable notifications for this site."
            : "Notification permission was dismissed.";
        setErrorMessage(err);
        return { success: false, error: err };
      }

      // 2. Ensure Service Worker is registered
      const reg = await getOrRegisterServiceWorker();
      if (!reg) {
        throw new Error("Unable to register service worker for push.");
      }
      await navigator.serviceWorker.ready;

      // 3. Subscribe through PushManager
      const convertedKey = urlBase64ToUint8Array(key);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey as unknown as BufferSource,
      });

      const subJson = sub.toJSON();
      const subKeys = (subJson.keys || {}) as Record<string, string>;
      const p256dh = subKeys["p256dh"];
      const auth = subKeys["auth"];

      if (!p256dh || !auth) {
        throw new Error("Push subscription returned invalid crypto keys.");
      }

      // 4. Persist to Supabase Database
      const deviceLabel = getDeviceLabel();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        // Use RPC or table upsert
        const { error: dbError } = await supabase.rpc("admin_upsert_push_subscription", {
          p_endpoint: sub.endpoint,
          p_p256dh: p256dh,
          p_auth: auth,
          p_user_agent: navigator.userAgent,
          p_device_label: deviceLabel,
        });

        if (dbError) {
          // Direct table fallback if RPC is not present
          await supabase.from("admin_push_subscriptions").upsert(
            [
              {
                user_id: session.user.id,
                endpoint: sub.endpoint,
                p256dh: p256dh,
                auth: auth,
                user_agent: navigator.userAgent,
                device_label: deviceLabel,
                is_active: true,
              },
            ],
            { onConflict: "endpoint" }
          );
        }
      }

      setIsSubscribed(true);
      setCurrentEndpoint(sub.endpoint);
      setStatusMessage("Web Push notifications enabled for this device!");
      await fetchSubscriptions();
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || "Failed to subscribe to Web Push.";
      setErrorMessage(msg);
      return { success: false, error: msg };
    } finally {
      setIsActionInProgress(false);
    }
  }, [vapidKey, fetchSubscriptions]);

  /**
   * Disable Web Push on the current device
   */
  const disablePush = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setIsActionInProgress(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (isPushSupported()) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();

          // Remove from database
          if (isSupabaseConfigured) {
            await supabase.rpc("admin_delete_push_subscription", { p_endpoint: endpoint });
            await supabase.from("admin_push_subscriptions").delete().eq("endpoint", endpoint);
          }
        }
      }

      setIsSubscribed(false);
      setCurrentEndpoint(null);
      setStatusMessage("Push notifications disabled for this device.");
      await fetchSubscriptions();
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || "Failed to unsubscribe from push.";
      setErrorMessage(msg);
      return { success: false, error: msg };
    } finally {
      setIsActionInProgress(false);
    }
  }, [fetchSubscriptions]);

  /**
   * Remove a specific device subscription
   */
  const removeDevice = useCallback(
    async (endpoint: string): Promise<{ success: boolean; error?: string }> => {
      setIsActionInProgress(true);
      try {
        if (currentEndpoint === endpoint && isPushSupported()) {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            await sub.unsubscribe();
          }
          setIsSubscribed(false);
          setCurrentEndpoint(null);
        }

        if (isSupabaseConfigured) {
          await supabase.rpc("admin_delete_push_subscription", { p_endpoint: endpoint });
          await supabase.from("admin_push_subscriptions").delete().eq("endpoint", endpoint);
        }

        setSubscriptions((prev) => prev.filter((s) => s.endpoint !== endpoint));
        setStatusMessage("Device removed successfully.");
        return { success: true };
      } catch (err: any) {
        const msg = err?.message || "Failed to remove device.";
        setErrorMessage(msg);
        return { success: false, error: msg };
      } finally {
        setIsActionInProgress(false);
      }
    },
    [currentEndpoint]
  );

  /**
   * Dispatch a test push notification to authorized devices
   */
  const sendTestPush = useCallback(async (): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> => {
    setIsActionInProgress(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const result = await triggerAdminWebPush({
        type: "test",
        title: "ShipT Admin: Test Alert",
        body: "Web Push is functioning correctly across your devices!",
      });

      if (!result.success) {
        const msg = result.error || "Push test could not be completed.";
        setErrorMessage(msg);
        return { success: false, message: msg, error: msg };
      }

      const msg = result.message || "Test push notification sent successfully!";
      setStatusMessage(msg);
      return { success: true, message: msg };
    } catch (err: any) {
      const msg = err?.message || "Failed to dispatch test notification.";
      setErrorMessage(msg);
      return { success: false, message: msg, error: msg };
    } finally {
      setIsActionInProgress(false);
    }
  }, []);

  const diagnostics: PushDiagnostics = {
    supported: isSupported,
    serviceWorkerReady: true,
    secureContext: isSecure,
    vapidConfigured: Boolean(vapidKey || getVapidPublicKey()),
    permission: permission,
    error: errorMessage,
  };

  return {
    isSupported,
    isSecureContext: isSecure,
    vapidKey,
    permission,
    isSubscribed,
    currentEndpoint,
    subscriptions,
    isLoading,
    isActionInProgress,
    loading: isLoading || isActionInProgress,
    statusMessage,
    errorMessage,
    diagnostics,
    enablePush,
    disablePush,
    removeDevice,
    sendTestPush,
    refreshSubscriptions: fetchSubscriptions,
  };
}
