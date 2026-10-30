import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  loadCustomerNotifications,
  markCustomerNotificationRead,
  markAllCustomerNotificationsRead,
} from "@/lib/customerNotificationsApi";
import {
  createAdminNotification,
  type AdminNotification,
} from "@/lib/notifications";

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockSingle = vi.fn();

vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      from: (table: string) => {
        if (table === "customer_notifications") {
          return {
            select: (...args: any[]) => {
              mockSelect(...args);
              return {
                eq: (col: string, val: any) => {
                  mockEq(col, val);
                  return {
                    order: (...orderArgs: any[]) => {
                      mockOrder(...orderArgs);
                      return {
                        limit: (...limitArgs: any[]) => mockLimit(...limitArgs),
                      };
                    },
                  };
                },
              };
            },
            update: (...args: any[]) => {
              mockUpdate(...args);
              return {
                eq: (col: string, val: any) => {
                  mockEq(col, val);
                  return {
                    eq: (col2: string, val2: any) => {
                      mockEq(col2, val2);
                      return Promise.resolve({ error: null });
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "admin_notifications") {
          return {
            insert: (...args: any[]) => {
              mockInsert(...args);
              return {
                select: () => ({
                  single: () => mockSingle(),
                }),
              };
            },
          };
        }

        return {
          select: vi.fn(),
          insert: vi.fn(),
          update: vi.fn(),
        };
      },
      rpc: vi.fn(),
      auth: {
        getUser: vi.fn(),
        getSession: vi.fn(),
      },
    },
    isSupabaseConfigured: true,
  };
});

describe("Part B & C: Comprehensive Admin & Customer Notification System", () => {
  const customerUserId = "cust-user-uuid-101";
  const testOrderId = "order-uuid-500";
  const testOrderNumber = "SHP-2026-500";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Customer In-App Notification Center API", () => {
    it("loads notification history filtered specifically by customer user_id", async () => {
      const mockNotifs = [
        {
          id: "c-notif-1",
          user_id: customerUserId,
          order_id: testOrderId,
          order_number: testOrderNumber,
          event_type: "order_confirmed",
          title: "Order Confirmed",
          message: "Campus store has accepted your order and begun packing.",
          metadata: { status: "confirmed" },
          is_read: false,
          read_at: null,
          dedup_key: "cust_order_confirmed_500",
          created_at: new Date().toISOString(),
        },
        {
          id: "c-notif-2",
          user_id: customerUserId,
          order_id: testOrderId,
          order_number: testOrderNumber,
          event_type: "payment_success",
          title: "PayU Payment Verified",
          message: "Your payment of ₹350.00 was verified successfully via UPI.",
          metadata: { amount: 350 },
          is_read: true,
          read_at: new Date().toISOString(),
          dedup_key: "cust_payu_paid_500",
          created_at: new Date().toISOString(),
        },
      ];

      mockLimit.mockResolvedValueOnce({ data: mockNotifs, error: null });

      const notifications = await loadCustomerNotifications(customerUserId);

      expect(notifications.length).toBe(2);
      expect(notifications[0]!.order_number).toBe(testOrderNumber);
      expect(notifications[0]!.event_type).toBe("order_confirmed");
      expect(mockEq).toHaveBeenCalledWith("user_id", customerUserId);
    });

    it("marks a single notification as read with timestamp", async () => {
      mockUpdate.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValueOnce({ error: null }),
      });

      const success = await markCustomerNotificationRead("c-notif-1");
      expect(success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          is_read: true,
          read_at: expect.any(String),
        })
      );
    });

    it("marks all unread notifications as read for current customer", async () => {
      const success = await markAllCustomerNotificationsRead(customerUserId);
      expect(success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          is_read: true,
          read_at: expect.any(String),
        })
      );
    });
  });

  describe("2. Admin Notification Dispatch & Event Types", () => {
    it("emits new_order event with order details and admin routing link", async () => {
      mockSingle.mockResolvedValueOnce({
        data: {
          id: "admin-notif-new-order",
          event_type: "new_order",
          title: "New Order Placed #SHP-2026-500",
          message: "Salman Faris placed an order for ₹350.00 (Hostel Delivery - Ganga B-204)",
          order_id: testOrderId,
          order_number: testOrderNumber,
          metadata: { amount: 350, payment_method: "payu" },
          is_read: false,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const res = await createAdminNotification({
        order_id: testOrderId,
        order_number: testOrderNumber,
        event_type: "new_order",
        title: "New Order Placed #SHP-2026-500",
        message: "Salman Faris placed an order for ₹350.00 (Hostel Delivery - Ganga B-204)",
        metadata: { amount: 350, payment_method: "payu" },
        dedup_key: `new_order_${testOrderId}`,
      });

      expect(res.success).toBe(true);
      expect(res.notification?.event_type).toBe("new_order");
      expect(res.notification?.order_number).toBe(testOrderNumber);
    });

    it("emits payment_success event when PayU payment is verified server-side", async () => {
      mockSingle.mockResolvedValueOnce({
        data: {
          id: "admin-notif-pay-success",
          event_type: "payment_success",
          title: "PayU Payment Verified: #SHP-2026-500",
          message: "Payment of ₹350.00 verified via UPI (txnid: TXN_500). Order ready for fulfillment.",
          order_id: testOrderId,
          order_number: testOrderNumber,
          metadata: { amount: 350, txnid: "TXN_500", mode: "UPI" },
          is_read: false,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const res = await createAdminNotification({
        order_id: testOrderId,
        order_number: testOrderNumber,
        event_type: "payment_success",
        title: "PayU Payment Verified: #SHP-2026-500",
        message: "Payment of ₹350.00 verified via UPI (txnid: TXN_500). Order ready for fulfillment.",
        metadata: { amount: 350, txnid: "TXN_500", mode: "UPI" },
        dedup_key: `payu_success_${testOrderId}`,
      });

      expect(res.success).toBe(true);
      expect(res.notification?.event_type).toBe("payment_success");
    });

    it("emits payment_suspicious_callback when hash tampering or amount mismatch occurs", async () => {
      mockSingle.mockResolvedValueOnce({
        data: {
          id: "admin-notif-tamper",
          event_type: "payment_suspicious_callback",
          title: "⚠️ Tamper Warning: PayU Hash or Amount Mismatch",
          message: "Suspect callback received for order #SHP-2026-500. Expected ₹350.00, received ₹1.00.",
          order_id: testOrderId,
          order_number: testOrderNumber,
          metadata: { expected: 350, received: 1 },
          is_read: false,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const res = await createAdminNotification({
        order_id: testOrderId,
        order_number: testOrderNumber,
        event_type: "payment_suspicious_callback",
        title: "⚠️ Tamper Warning: PayU Hash or Amount Mismatch",
        message: "Suspect callback received for order #SHP-2026-500. Expected ₹350.00, received ₹1.00.",
        metadata: { expected: 350, received: 1 },
        dedup_key: `tamper_${testOrderId}`,
      });

      expect(res.success).toBe(true);
      expect(res.notification?.event_type).toBe("payment_suspicious_callback");
    });

    it("emits refund_requested event when verified paid order is cancelled", async () => {
      mockSingle.mockResolvedValueOnce({
        data: {
          id: "admin-notif-refund-req",
          event_type: "refund_requested",
          title: "Refund Review Required: #SHP-2026-500",
          message: "Customer cancelled paid order #SHP-2026-500. Action required: Review and process refund of ₹350.00.",
          order_id: testOrderId,
          order_number: testOrderNumber,
          metadata: { amount: 350, reason: "Customer cancelled" },
          is_read: false,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const res = await createAdminNotification({
        order_id: testOrderId,
        order_number: testOrderNumber,
        event_type: "refund_requested",
        title: "Refund Review Required: #SHP-2026-500",
        message: "Customer cancelled paid order #SHP-2026-500. Action required: Review and process refund of ₹350.00.",
        metadata: { amount: 350, reason: "Customer cancelled" },
        dedup_key: `refund_req_${testOrderId}`,
      });

      expect(res.success).toBe(true);
      expect(res.notification?.event_type).toBe("refund_requested");
    });
  });

  describe("3. Deduplication & Idempotency", () => {
    it("handles deduplication gracefully when duplicate notification dedup_key is encountered", async () => {
      // Supabase handles duplicate dedup_key gracefully via upsert or fallback without throwing unhandled error
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      });

      const res = await createAdminNotification({
        order_id: testOrderId,
        order_number: testOrderNumber,
        event_type: "new_order",
        title: "Duplicate Order Alert",
        message: "Duplicate callback message",
        dedup_key: `new_order_${testOrderId}`,
      });

      // Does not throw unhandled exception; returns gracefully with cached notification
      expect(res.success).toBe(true);
      expect(res.notification).toBeDefined();
    });
  });
});
