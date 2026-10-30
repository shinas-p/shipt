/**
 * Shipt Mart — Customer In-App Notification Client & Realtime Engine
 *
 * Provides customer-facing notifications, unread badges, mark-as-read,
 * and Supabase Realtime synchronization with strict customer data isolation.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { CustomerNotification, CustomerNotificationEventType } from "@/lib/types";

export const CUSTOMER_NOTIF_STORAGE_KEY = "shipt_customer_notifications_cache_v1";

/**
 * Loads notification history for authenticated customer
 */
export async function loadCustomerNotifications(userId?: string): Promise<CustomerNotification[]> {
  if (!isSupabaseConfigured || !userId) {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(CUSTOMER_NOTIF_STORAGE_KEY);
        return cached ? JSON.parse(cached) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("customer_notifications")
      .select("id, user_id, order_id, order_number, event_type, title, message, metadata, is_read, read_at, dedup_key, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40);

    if (error || !data) {
      return [];
    }

    const items: CustomerNotification[] = data.map((d: any) => ({
      id: d.id,
      user_id: d.user_id,
      order_id: d.order_id,
      order_number: d.order_number,
      event_type: d.event_type as CustomerNotificationEventType,
      title: d.title,
      message: d.message,
      metadata: d.metadata || {},
      is_read: !!d.is_read,
      read_at: d.read_at,
      dedup_key: d.dedup_key,
      created_at: d.created_at,
    }));

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(CUSTOMER_NOTIF_STORAGE_KEY, JSON.stringify(items));
      } catch { }
    }

    return items;
  } catch {
    return [];
  }
}

/**
 * Marks a single customer notification as read
 */
export async function markCustomerNotificationRead(notificationId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return true;

  try {
    const { error } = await supabase
      .from("customer_notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", notificationId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Marks all notifications as read for current user
 */
export async function markAllCustomerNotificationsRead(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured || !userId) return true;

  try {
    const { error } = await supabase
      .from("customer_notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("is_read", false);

    return !error;
  } catch {
    return false;
  }
}

/**
 * React Hook for Customer In-App Notification Center with Realtime Subscription
 */
export function useCustomerNotifications(userId?: string | null) {
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const isMounted = useRef(true);

  const fetchNotifs = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      return;
    }
    setLoading(true);
    try {
      const items = await loadCustomerNotifications(userId);
      if (isMounted.current) {
        setNotifications(items);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    isMounted.current = true;
    fetchNotifs();

    if (!isSupabaseConfigured || !userId) {
      return () => {
        isMounted.current = false;
      };
    }

    // Subscribe to customer's own notifications in Supabase Realtime
    const channel = supabase
      .channel(`cust_notifs_${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "customer_notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as CustomerNotification;
          setNotifications((prev) => {
            if (prev.some((n) => n.id === newNotif.id || (n.dedup_key && n.dedup_key === newNotif.dedup_key))) {
              return prev;
            }
            return [newNotif, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "customer_notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as CustomerNotification;
          setNotifications((prev) =>
            prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n))
          );
        }
      )
      .subscribe();

    return () => {
      isMounted.current = false;
      channel.unsubscribe();
    };
  }, [userId, fetchNotifs]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
    );
    await markCustomerNotificationRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
    );
    await markAllCustomerNotificationsRead(userId);
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return {
    notifications,
    unreadCount,
    loading,
    refresh: fetchNotifs,
    markRead,
    markAllRead,
  };
}

