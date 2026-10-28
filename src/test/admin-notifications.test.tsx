import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import {
  createAdminNotification,
  sendAdminOrderEmailBackup,
  requestDesktopNotificationPermission,
  NOTIF_STORAGE_KEY,
  NOTIF_SOUND_KEY,
  type AdminNotification,
} from "@/lib/notifications";
import { AdminNotificationBell } from "@/components/admin/AdminNotificationBell";

// Supabase mock handles
let mockNotificationsTable: AdminNotification[] = [];
let mockFunctionsInvokeResponse: { data: any; error: any } = {
  data: { success: true },
  error: null,
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === "admin_notifications") {
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockImplementation(() =>
            Promise.resolve({ data: [...mockNotificationsTable], error: null })
          ),
          insert: vi.fn().mockImplementation((payload: any) => {
            const newItem: AdminNotification = {
              id: "notif-" + Math.random().toString(36).substring(2, 8),
              event_type: payload.event_type,
              title: payload.title,
              message: payload.message,
              order_id: payload.order_id || null,
              order_number: payload.order_number || null,
              dedup_key: payload.dedup_key || null,
              metadata: payload.metadata || {},
              is_read: false,
              created_at: new Date().toISOString(),
            };
            mockNotificationsTable.unshift(newItem);
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: newItem, error: null }),
            };
          }),
          upsert: vi.fn().mockImplementation((payloads: any[]) => {
            const payload = payloads[0];
            const newItem: AdminNotification = {
              id: "notif-" + Math.random().toString(36).substring(2, 8),
              event_type: payload.event_type,
              title: payload.title,
              message: payload.message,
              order_id: payload.order_id || null,
              order_number: payload.order_number || null,
              dedup_key: payload.dedup_key || null,
              metadata: payload.metadata || {},
              is_read: false,
              created_at: new Date().toISOString(),
            };
            mockNotificationsTable.unshift(newItem);
            return {
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: newItem, error: null }),
            };
          }),
          update: vi.fn().mockImplementation((updates: any) => ({
            eq: vi.fn().mockImplementation((col: string, val: any) => {
              mockNotificationsTable = mockNotificationsTable.map((n) =>
                n.id === val ? { ...n, ...updates } : n
              );
              return Promise.resolve({ error: null });
            }),
            in: vi.fn().mockImplementation(() => {
              mockNotificationsTable = mockNotificationsTable.map((n) => ({
                ...n,
                ...updates,
              }));
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
      };
    }),
    rpc: vi.fn().mockImplementation((funcName: string, args: any) => {
      if (funcName === "admin_mark_all_notifications_read") {
        mockNotificationsTable = mockNotificationsTable.map((n) => ({ ...n, is_read: true }));
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
    functions: {
      invoke: vi.fn().mockImplementation(() => Promise.resolve(mockFunctionsInvokeResponse)),
    },
  },
  isSupabaseConfigured: true,
}));

describe("Shipt Mart — Real-Time Admin Notifications Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockNotificationsTable = [];
    mockFunctionsInvokeResponse = { data: { success: true }, error: null };
  });

  describe("1. Idempotent Notification Emission & Deduplication", () => {
    it("creates an order notification with dedup_key when order is persisted", async () => {
      const res = await createAdminNotification({
        order_id: "order-101",
        order_number: "QM-20261028-TEST1",
        event_type: "new_order",
        title: "New Order Placed",
        message: "Order #QM-20261028-TEST1 placed (2 items)",
        dedup_key: "order_created:order-101",
        metadata: { total_amount: 120, delivery_method: "campus_pickup" },
      });

      expect(res.success).toBe(true);
      expect(res.notification?.order_id).toBe("order-101");
      expect(res.notification?.order_number).toBe("QM-20261028-TEST1");
      expect(res.notification?.event_type).toBe("new_order");
    });

    it("prevents duplicate notifications when same dedup_key is submitted repeatedly", async () => {
      const first = await createAdminNotification({
        order_id: "order-202",
        order_number: "QM-20261028-TEST2",
        event_type: "new_order",
        title: "New Order Placed",
        message: "Order #QM-20261028-TEST2 placed",
        dedup_key: "order_created:order-202",
      });

      const second = await createAdminNotification({
        order_id: "order-202",
        order_number: "QM-20261028-TEST2",
        event_type: "new_order",
        title: "New Order Placed (Retry)",
        message: "Order #QM-20261028-TEST2 placed retry",
        dedup_key: "order_created:order-202",
      });

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);

      const saved = JSON.parse(localStorage.getItem(NOTIF_STORAGE_KEY) || "[]");
      const matches = saved.filter((n: any) => n.dedup_key === "order_created:order-202");
      expect(matches.length).toBe(1);
    });

    it("supports extensible events like customer suggestions and cancellations", async () => {
      const suggestionRes = await createAdminNotification({
        event_type: "new_suggestion",
        title: "New Product Suggestion",
        message: "Customer suggested 'Lotus Biscoff Spread'",
        metadata: { product_name: "Lotus Biscoff Spread" },
      });

      expect(suggestionRes.success).toBe(true);
      expect(suggestionRes.notification?.event_type).toBe("new_suggestion");
      expect(suggestionRes.notification?.title).toContain("Product Suggestion");

      const cancelRes = await createAdminNotification({
        order_id: "order-303",
        order_number: "QM-20261028-CANCEL",
        event_type: "order_cancelled",
        title: "Order Cancelled",
        message: "Order #QM-20261028-CANCEL has been cancelled",
        dedup_key: "order_cancelled:order-303",
      });

      expect(cancelRes.success).toBe(true);
      expect(cancelRes.notification?.event_type).toBe("order_cancelled");
    });
  });

  describe("2. AdminNotificationBell Component & Navigation", () => {
    it("renders unread counter badge and opens popover with details on click", async () => {
      const sampleNotif: AdminNotification = {
        id: "notif-abc",
        event_type: "new_order",
        title: "New Order Placed",
        message: "Order #QM-9999 placed",
        order_id: "order-9999",
        order_number: "QM-9999",
        dedup_key: "order_created:order-9999",
        metadata: { total_amount: 350, delivery_method: "room_delivery" },
        is_read: false,
        created_at: new Date().toISOString(),
      };
      mockNotificationsTable = [sampleNotif];
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify([sampleNotif]));

      const handleSelectOrder = vi.fn();
      render(<AdminNotificationBell onSelectOrder={handleSelectOrder} />);

      // Badge displays "1"
      await waitFor(() => {
        expect(screen.getByText("1")).toBeInTheDocument();
      });

      // Open popover by clicking bell button
      const bellBtn = screen.getByRole("button", { name: /Admin Notifications/i });
      fireEvent.click(bellBtn);

      await waitFor(() => {
        expect(screen.getByText(/Admin Notifications/i, { selector: "span" })).toBeInTheDocument();
        expect(screen.getByText(/QM-9999/)).toBeInTheDocument();
        expect(screen.getByText(/Total: ₹350/i)).toBeInTheDocument();
        expect(screen.getByText(/Room delivery/i)).toBeInTheDocument();
      });

      // Click notification item to navigate to order
      const notifItem = screen.getByText(/QM-9999/);
      fireEvent.click(notifItem);

      expect(handleSelectOrder).toHaveBeenCalledWith("order-9999", "QM-9999");
    });

    it("allows marking single notification as read and marking all as read", async () => {
      const items: AdminNotification[] = [
        {
          id: "notif-1",
          event_type: "new_order",
          title: "Order 1",
          message: "First order",
          order_id: "order-1",
          order_number: "QM-1",
          is_read: false,
          created_at: new Date().toISOString(),
        },
        {
          id: "notif-2",
          event_type: "new_suggestion",
          title: "Suggestion 2",
          message: "New snack suggestion",
          is_read: false,
          created_at: new Date().toISOString(),
        },
      ];
      mockNotificationsTable = [...items];
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(items));

      render(<AdminNotificationBell />);

      await waitFor(() => {
        expect(screen.getByText("2")).toBeInTheDocument();
      });

      const bellBtn = screen.getByRole("button", { name: /Admin Notifications/i });
      fireEvent.click(bellBtn);

      // Click "Mark all read"
      const markAllBtn = screen.getByRole("button", { name: /Mark All Read/i });
      fireEvent.click(markAllBtn);

      await waitFor(() => {
        expect(screen.queryByText("2")).not.toBeInTheDocument();
      });
    });
  });

  describe("3. Desktop & Sound Preferences & Safe Permission Handling", () => {
    it("toggles sound preference in localStorage without playing audio when muted", async () => {
      render(<AdminNotificationBell />);

      const bellBtn = screen.getByRole("button", { name: /Admin Notifications/i });
      fireEvent.click(bellBtn);

      // Sound is enabled by default
      const soundBtn = screen.getByRole("button", { name: /Mute notification sound/i });
      expect(soundBtn).toBeInTheDocument();

      fireEvent.click(soundBtn);
      expect(localStorage.getItem(NOTIF_SOUND_KEY)).toBe("false");
    });

    it("desktop notification permission is never requested on mount, only on explicit user click", async () => {
      // Mock Notification API
      const requestPermissionSpy = vi.fn().mockResolvedValue("granted");
      (window as any).Notification = {
        permission: "default",
        requestPermission: requestPermissionSpy,
      };

      render(<AdminNotificationBell />);

      // On initial render, permission is NOT requested
      expect(requestPermissionSpy).not.toHaveBeenCalled();

      // Open popover
      const bellBtn = screen.getByRole("button", { name: /Admin Notifications/i });
      fireEvent.click(bellBtn);

      // Click explicit "Enable" button
      const enableAlertsBtn = screen.getByRole("button", { name: /^Enable$/i });
      fireEvent.click(enableAlertsBtn);

      await waitFor(() => {
        expect(requestPermissionSpy).toHaveBeenCalled();
      });
    });

    it("handles denied desktop permission gracefully without throwing", async () => {
      (window as any).Notification = {
        permission: "denied",
        requestPermission: vi.fn().mockResolvedValue("denied"),
      };

      const result = await requestDesktopNotificationPermission();
      expect(result).toBe("denied");
      // Does not throw
    });
  });

  describe("4. Email Backup Integration & Truthful Reporting", () => {
    it("reports failure truthfully when edge function fails", async () => {
      mockFunctionsInvokeResponse = {
        data: null,
        error: { message: "Edge Function returned 500" },
      };

      const result = await sendAdminOrderEmailBackup("order-fail", "QM-FAIL", 100, "campus_pickup");

      expect(result.delivered).toBe(false);
      expect(result.error).toContain("500");
    });

    it("reports success truthfully when edge function confirms delivery", async () => {
      mockFunctionsInvokeResponse = {
        data: { success: true, delivered: true },
        error: null,
      };

      const result = await sendAdminOrderEmailBackup("order-ok", "QM-OK", 250, "room_delivery");

      expect(result.delivered).toBe(true);
      expect(result.success).toBe(true);
    });
  });
});
