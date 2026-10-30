import { describe, expect, it, vi, beforeEach } from "vitest";
import { customerCancelOrder } from "@/lib/studentPaymentApi";

const mockRpc = vi.fn();

vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      from: vi.fn(),
      rpc: (...args: any[]) => mockRpc(...args),
      auth: {
        getSession: vi.fn(),
        getUser: vi.fn(),
      },
    },
    isSupabaseConfigured: true,
  };
});

vi.mock("@/lib/notifications", () => ({
  createAdminNotification: vi.fn().mockResolvedValue({ id: "notif-cancelled-1" }),
}));

describe("Feature 3: Secure Customer Order Cancellation", () => {
  const validUuid = "11111111-2222-3333-4444-555555555555";
  const validOrderNumber = "SHP-2026-9901";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully cancels an eligible placed order for authenticated customer", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        order_id: validUuid,
        order_number: validOrderNumber,
        status: "cancelled",
        refund_status: "not_applicable",
      },
      error: null,
    });

    const result = await customerCancelOrder(validUuid, {
      reason: "Placed by mistake",
    });

    expect(result.success).toBe(true);
    expect(result.refundStatus).toBe("not_applicable");
    expect(mockRpc).toHaveBeenCalledWith("customer_cancel_order", {
      p_order_id: validUuid,
      p_guest_token: null,
      p_reason: "Placed by mistake",
      p_order_number: null,
    });
  });

  it("successfully cancels a guest order when valid guest tracking token is provided", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        order_id: validUuid,
        order_number: validOrderNumber,
        status: "cancelled",
        refund_status: "not_applicable",
      },
      error: null,
    });

    const token = "a".repeat(64);
    const result = await customerCancelOrder(validOrderNumber, {
      guestToken: token,
      reason: "Guest requested cancellation",
    });

    expect(result.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("customer_cancel_order", {
      p_order_id: null,
      p_guest_token: token,
      p_reason: "Guest requested cancellation",
      p_order_number: validOrderNumber,
    });
  });

  it("rejects guest cancellation if tracking token is missing or unauthorized", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Access Denied: Valid guest tracking token is required to cancel this order.",
      },
    });

    const result = await customerCancelOrder(validOrderNumber, {
      guestToken: "", // missing
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Access Denied");
  });

  it("rejects customer cancellation if user does not own the order", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Access Denied: You do not have permission to cancel this order.",
      },
    });

    const result = await customerCancelOrder(validUuid, {
      reason: "Attempted cancel on another user's order",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("You do not have permission to cancel this order");
  });

  it("rejects cancellation of already cancelled orders (prevents double restock)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Order is already cancelled.",
      },
    });

    const result = await customerCancelOrder(validUuid);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Order is already cancelled");
  });

  it("rejects cancellation of completed orders", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Completed orders cannot be cancelled. Please contact campus store support.",
      },
    });

    const result = await customerCancelOrder(validUuid);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Completed orders cannot be cancelled");
  });

  it("rejects cancellation when order has passed fulfilment cutoff (in transit or ready for pickup)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Order is already in transit or ready for pickup and can no longer be cancelled by the customer.",
      },
    });

    const result = await customerCancelOrder(validUuid);
    expect(result.success).toBe(false);
    expect(result.error).toContain("already in transit or ready for pickup");
  });

  it("truthfully flags successful UPI payments for refund review without claiming instant false refund", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        order_id: validUuid,
        order_number: validOrderNumber,
        status: "cancelled",
        refund_status: "refund_review_required",
      },
      error: null,
    });

    const result = await customerCancelOrder(validUuid, {
      reason: "Online paid order cancellation",
    });

    expect(result.success).toBe(true);
    // Verifies refund_review_required is accurately conveyed
    expect(result.refundStatus).toBe("refund_review_required");
  });

  it("handles cash orders with refundStatus: not_applicable", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        order_id: validUuid,
        order_number: validOrderNumber,
        status: "cancelled",
        refund_status: "not_applicable",
      },
      error: null,
    });

    const result = await customerCancelOrder(validUuid, {
      reason: "Cash order cancellation",
    });

    expect(result.success).toBe(true);
    expect(result.refundStatus).toBe("not_applicable");
  });
});

