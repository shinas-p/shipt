import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import {
  urlBase64ToUint8Array,
  getDeviceLabel,
  isSecureContext,
  getVapidPublicKey,
  triggerAdminWebPush,
  type PushSubscriptionRow,
} from "@/lib/pushNotifications";
import { PushNotificationSettingsView } from "@/components/admin/PushNotificationSettingsView";
import { AdminNotificationBell } from "@/components/admin/AdminNotificationBell";

// Mock Supabase client
let mockSubscriptions: PushSubscriptionRow[] = [];
let mockFunctionsInvokeResponse: { data: any; error: any } = {
  data: { success: true },
  error: null,
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            user: { id: "test-admin-uuid", email: "admin@shiptmart.com" },
          },
        },
        error: null,
      }),
    },
    rpc: vi.fn((fnName: string, params: any) => {
      if (fnName === "admin_upsert_push_subscription") {
        const row: PushSubscriptionRow = {
          id: "sub-123",
          user_id: "test-admin-uuid",
          endpoint: params.p_endpoint,
          p256dh: params.p_p256dh,
          auth: params.p_auth,
          user_agent: params.p_user_agent || "",
          device_label: params.p_device_label || "Chrome on Windows",
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_used_at: null,
        };
        mockSubscriptions = [row];
        return Promise.resolve({ data: { success: true }, error: null });
      }
      if (fnName === "admin_delete_push_subscription") {
        mockSubscriptions = mockSubscriptions.filter((s) => s.endpoint !== params.p_endpoint);
        return Promise.resolve({ data: { success: true }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    from: vi.fn((table: string) => {
      if (table === "admin_push_subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockImplementation(() =>
            Promise.resolve({ data: [...mockSubscriptions], error: null })
          ),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((col: string, val: any) => {
            if (col === "endpoint") {
              mockSubscriptions = mockSubscriptions.filter((s) => s.endpoint !== val);
            }
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
    functions: {
      invoke: vi.fn((fnName: string, options: any) => {
        if (fnName === "send-admin-push") {
          return Promise.resolve(mockFunctionsInvokeResponse);
        }
        return Promise.resolve({ data: { success: true }, error: null });
      }),
    },
  },
  isSupabaseConfigured: true,
}));

describe("ShipT Mart — Web Push Notifications System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscriptions = [
      {
        id: "sub-desktop-1",
        user_id: "test-admin-uuid",
        endpoint: "https://fcm.googleapis.com/fcm/send/sample-desktop-endpoint",
        p256dh: "mockP256dhKeyBase64String==",
        auth: "mockAuthKey==",
        user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
        device_label: "Chrome on Windows",
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_used_at: null,
      },
    ];
    mockFunctionsInvokeResponse = {
      data: { success: true, message: "Push dispatched successfully" },
      error: null,
    };
  });

  describe("1. Cryptographic VAPID Converter & Utilities", () => {
    it("converts base64url VAPID public key into Uint8Array with correct byte length", () => {
      // Standard 65-byte uncompressed P-256 public key encoded as URL-safe base64
      const sampleVapidKey = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bPghwVu30p293Vcxpxo07pOCmQ96KaR-n2M_4nL3L00uU";
      const converted = urlBase64ToUint8Array(sampleVapidKey);

      expect(converted).toBeInstanceOf(Uint8Array);
      expect(converted.length).toBe(65);
      expect(converted[0]).toBe(0x04); // ANSI X9.62 uncompressed point tag
    });

    it("parses user agents into recognizable device labels", () => {
      const windowsChrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      const macSafari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15";
      const androidChrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
      const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

      expect(getDeviceLabel(windowsChrome)).toContain("Chrome");
      expect(getDeviceLabel(macSafari)).toContain("Safari");
      expect(getDeviceLabel(androidChrome)).toContain("Android");
      expect(getDeviceLabel(iphoneSafari)).toContain("iPhone");
    });

    it("detects secure context correctly", () => {
      expect(isSecureContext()).toBe(true);
    });
  });

  describe("2. Server-side Edge Push Dispatcher (send-admin-push)", () => {
    it("dispatches Web Push payload with minimal non-sensitive order data", async () => {
      const result = await triggerAdminWebPush({
        order_id: "order-test-uuid-1",
        order_number: "QM-20261029-ABC",
        total_amount: 450,
        delivery_method: "hostel_delivery",
        event_type: "new_order",
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("reports setupRequired when VAPID keys are missing without crashing", async () => {
      mockFunctionsInvokeResponse = {
        data: {
          success: false,
          setupRequired: true,
          message: "VAPID keys not configured in Supabase Edge Runtime.",
        },
        error: null,
      };

      const result = await triggerAdminWebPush({
        type: "test",
      });

      expect(result.success).toBe(false);
      expect(result.setupRequired).toBe(true);
      expect(result.error).toContain("VAPID keys not configured");
    });
  });

  describe("3. Admin Web Push Settings View Component", () => {
    it("renders push settings interface with current device status and registered devices", async () => {
      render(
        <PushNotificationSettingsView
          adminRole="super_admin"
          onBackToDashboard={vi.fn()}
        />
      );

      expect(screen.getAllByText(/Web Push Notifications/i)[0]).toBeInTheDocument();
      expect(screen.getByText(/even when all website tabs are closed/i)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText(/Your Subscribed Devices/i)).toBeInTheDocument();
      });
    });

    it("displays diagnostics panel with browser compatibility and secure context status", () => {
      render(
        <PushNotificationSettingsView
          adminRole="super_admin"
          onBackToDashboard={vi.fn()}
        />
      );

      expect(screen.getByText(/System & Browser Diagnostics/i)).toBeInTheDocument();
      expect(screen.getByText(/Security Context \(HTTPS\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Browser Push API/i)).toBeInTheDocument();
    });

    it("allows authorized administrators to trigger a diagnostic test push", async () => {
      render(
        <PushNotificationSettingsView
          adminRole="super_admin"
          onBackToDashboard={vi.fn()}
        />
      );

      const sendTestBtn = screen.getByRole("button", { name: /Send Test Notification/i });
      expect(sendTestBtn).toBeInTheDocument();

      fireEvent.click(sendTestBtn);

      const successBadges = await screen.findAllByText(/Push dispatched successfully/i);
      expect(successBadges.length).toBeGreaterThan(0);
    });
  });

  describe("4. Admin Notification Bell Integration", () => {
    it("renders notification bell with push status and settings link", () => {
      const handleOpenPushSettings = vi.fn();
      render(
        <AdminNotificationBell
          onSelectOrder={vi.fn()}
          onOpenPushSettings={handleOpenPushSettings}
        />
      );

      const bellBtn = screen.getByRole("button", { name: /Admin Notifications/i });
      fireEvent.click(bellBtn);

      expect(screen.getByText(/Admin Notifications/i)).toBeInTheDocument();
    });
  });
});
