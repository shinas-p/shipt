/**
 * Shipt Mart — Authoritative Real-Time Admin Notification Engine
 *
 * Provides durable notification persistence, real-time Supabase Realtime synchronization,
 * unread badges, idempotent deduplication, Web Audio chime synthesizer, and browser notifications.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type NotificationEventType =
  | "new_order"
  | "order_cancelled"
  | "payment_attention"
  | "new_suggestion"
  | "low_stock"
  | "system_alert"
  | "payment_initiated"
  | "payment_success"
  | "payment_failed"
  | "payment_pending_timeout"
  | "payment_suspicious_callback"
  | "refund_requested"
  | "refund_status_changed"
  | "order_status_changed";

export interface AdminNotification {
  id: string;
  order_id?: string | null | undefined;
  order_number?: string | null | undefined;
  event_type: NotificationEventType;
  title: string;
  message: string;
  metadata?: Record<string, any> | undefined;
  is_read: boolean;
  read_at?: string | null | undefined;
  read_by?: string | null | undefined;
  dedup_key?: string | null | undefined;
  created_at: string;
}

export const NOTIF_STORAGE_KEY = "shipt_admin_notifications_cache_v1";
export const NOTIF_SOUND_KEY = "shipt_admin_notif_sound_pref_v1";

// In-memory set of order IDs for which sound has already played (prevents repeat chimes)
const soundPlayedKeys = new Set<string>();

/**
 * Web Audio API Synth: Crisp 2-tone chime for new order alerts without external assets
 */
export function playNotificationSound(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return false;

    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => { });
    }

    const now = ctx.currentTime;

    // Tone 1: Note D5 (587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.25, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.26);

    // Tone 2: Note A5 (880.00 Hz) - higher pitch confirmation
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880.0, now + 0.12);
    gain2.gain.setValueAtTime(0, now + 0.12);
    gain2.gain.linearRampToValueAtTime(0.3, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.46);

    // Close audio context after playback
    setTimeout(() => {
      try {
        ctx.close();
      } catch { }
    }, 600);

    return true;
  } catch {
    return false;
  }
}

/**
 * Browser Notification Helper: Only triggers if permission is already explicitly granted
 */
export function triggerDesktopNotification(
  title: string,
  options?: NotificationOptions | undefined
): Notification | null {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return null;
  }

  if (Notification.permission === "granted") {
    try {
      const notif = new Notification(title, {
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        ...options,
      });

      notif.onclick = () => {
        window.focus();
        notif.close();
      };

      return notif;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Requests desktop notification permission on explicit user click
 */
export async function requestDesktopNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch {
    return "denied";
  }
}

/**
 * Email backup dispatcher for new orders
 */
export async function sendAdminOrderEmailBackup(
  orderId: string,
  orderNumber: string,
  totalAmount: number,
  deliveryMethod: string
): Promise<{ success: boolean; delivered: boolean; error?: string | undefined }> {
  if (!isSupabaseConfigured) {
    return {
      success: false,
      delivered: false,
      error: "Supabase client is not configured.",
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke("notify-admin-order", {
      body: {
        orderId,
        orderNumber,
        totalAmount,
        deliveryMethod,
      },
    });

    if (error) {
      // Truthful reporting: do not claim delivered
      return {
        success: false,
        delivered: false,
        error: error.message || "Failed to invoke notify-admin-order Edge Function.",
      };
    }

    const delivered = Boolean(data?.delivered || data?.success);
    return {
      success: true,
      delivered,
    };
  } catch (err: any) {
    return {
      success: false,
      delivered: false,
      error: err?.message || "Email provider connection failed.",
    };
  }
}

/**
 * Idempotently creates an admin notification in Supabase and local cache
 */
export async function createAdminNotification(params: {
  order_id?: string | null | undefined;
  order_number?: string | null | undefined;
  event_type: NotificationEventType;
  title: string;
  message: string;
  metadata?: Record<string, any> | undefined;
  dedup_key?: string | null | undefined;
}): Promise<{ success: boolean; notification?: AdminNotification | undefined; error?: string | undefined }> {
  const dedup = params.dedup_key || `event_${params.event_type}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const localNotif: AdminNotification = {
    id: `local_notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    order_id: params.order_id || null,
    order_number: params.order_number || null,
    event_type: params.event_type,
    title: params.title,
    message: params.message,
    metadata: params.metadata || {},
    is_read: false,
    dedup_key: dedup,
    created_at: new Date().toISOString(),
  };

  // Cache locally
  if (typeof window !== "undefined") {
    try {
      const cached = localStorage.getItem(NOTIF_STORAGE_KEY);
      const list: AdminNotification[] = cached ? JSON.parse(cached) : [];
      // Deduplicate by dedup_key
      if (!list.some((n) => n.dedup_key === dedup)) {
        list.unshift(localNotif);
        localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(list.slice(0, 50)));
      }
    } catch { }
  }

  if (!isSupabaseConfigured) {
    return { success: true, notification: localNotif };
  }

  try {
    const payload = {
      order_id: params.order_id || null,
      order_number: params.order_number || null,
      event_type: params.event_type,
      title: params.title,
      message: params.message,
      metadata: params.metadata || {},
      dedup_key: dedup,
    };

    const { data, error } = await supabase
      .from("admin_notifications")
      .upsert([payload], { onConflict: "dedup_key" })
      .select()
      .maybeSingle();

    if (error) {
      // If table is missing or migration not applied yet, the local fallback already caught it
      return { success: true, notification: localNotif };
    }

    return {
      success: true,
      notification: (data as AdminNotification) || localNotif,
    };
  } catch (err: any) {
    return { success: true, notification: localNotif };
  }
}

/**
 * Hook for managing real-time admin notifications
 */
export function useAdminNotifications() {
  const [notifications, setNotifications] = useState<AdminNotification[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(NOTIF_STORAGE_KEY);
        if (cached) return JSON.parse(cached);
      } catch { }
    }
    return [];
  });

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(NOTIF_SOUND_KEY);
        if (stored !== null) return stored === "true";
      } catch { }
    }
    return true; // Default enabled
  });

  const [isLoading, setIsLoading] = useState(false);
  const soundPrefRef = useRef(soundEnabled);
  soundPrefRef.current = soundEnabled;

  const toggleSound = useCallback((enabled: boolean) => {
    setSoundEnabled(enabled);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(NOTIF_SOUND_KEY, String(enabled));
      } catch { }
    }
  }, []);

  // Compute unread count
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Fetch initial notifications from database
  const fetchNotifications = useCallback(async () => {
    if (!isSupabaseConfigured) return;

    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("admin_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(40);

      if (error) {
        // Table may not exist yet, fallback to local cache
        return;
      }

      if (data && Array.isArray(data)) {
        setNotifications(data as AdminNotification[]);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(data));
          } catch { }
        }
      }
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Mark single notification as read
  const markAsRead = useCallback(async (id: string) => {
    // Optimistic local update
    setNotifications((prev) => {
      const next = prev.map((n) =>
        n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
      );
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(next));
        } catch { }
      }
      return next;
    });

    if (!isSupabaseConfigured || id.startsWith("local_")) return;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      await supabase
        .from("admin_notifications")
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
          read_by: session?.user?.id || null,
        })
        .eq("id", id);
    } catch { }
  }, []);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    // Optimistic local update
    setNotifications((prev) => {
      const next = prev.map((n) => ({
        ...n,
        is_read: true,
        read_at: new Date().toISOString(),
      }));
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(next));
        } catch { }
      }
      return next;
    });

    if (!isSupabaseConfigured) return;

    try {
      // Attempt RPC first
      const { error: rpcError } = await supabase.rpc("admin_mark_all_notifications_read");

      if (rpcError) {
        // Fallback to table update
        const {
          data: { session },
        } = await supabase.auth.getSession();
        await supabase
          .from("admin_notifications")
          .update({
            is_read: true,
            read_at: new Date().toISOString(),
            read_by: session?.user?.id || null,
          })
          .eq("is_read", false);
      }
    } catch { }
  }, []);

  // Set up Supabase Realtime subscription
  useEffect(() => {
    fetchNotifications();

    if (!isSupabaseConfigured) return;

    const channel = supabase
      .channel("admin-notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "admin_notifications",
        },
        (payload) => {
          const newNotif = payload.new as AdminNotification;
          if (!newNotif || !newNotif.id) return;

          setNotifications((prev) => {
            if (prev.some((n) => n.id === newNotif.id || (n.dedup_key && n.dedup_key === newNotif.dedup_key))) {
              return prev;
            }
            const updated = [newNotif, ...prev].slice(0, 50);
            if (typeof window !== "undefined") {
              try {
                localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(updated));
              } catch { }
            }
            return updated;
          });

          // Play sound if new order and sound enabled
          const soundKey = newNotif.order_id || newNotif.order_number || newNotif.id;
          if (newNotif.event_type === "new_order" && !soundPlayedKeys.has(soundKey)) {
            soundPlayedKeys.add(soundKey);
            if (soundPrefRef.current) {
              playNotificationSound();
            }

            // Desktop notification
            triggerDesktopNotification(`New Order: #${newNotif.order_number || "Incoming"}`, {
              body: newNotif.message,
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "admin_notifications",
        },
        (payload) => {
          const updatedNotif = payload.new as AdminNotification;
          if (!updatedNotif) return;

          setNotifications((prev) =>
            prev.map((n) => (n.id === updatedNotif.id ? updatedNotif : n))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchNotifications]);

  return {
    notifications,
    unreadCount,
    isLoading,
    soundEnabled,
    toggleSound,
    markAsRead,
    markAllAsRead,
    refreshNotifications: fetchNotifications,
  };
}
