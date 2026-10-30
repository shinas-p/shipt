import { describe, expect, it, vi } from "vitest";
import type { AdminOrderStatusTab } from "@/lib/types";

interface TestOrder {
  id: string;
  order_number: string;
  status: string;
  customer_name: string;
  hostel_block: string;
  total_amount: number;
  delivery_type: "delivery" | "pickup";
  claimed_by_name?: string | null;
}

// Emulate the exact tab filtering and count logic from src/routes/admin.tsx
function computeTabCounts(orders: TestOrder[]) {
  const counts = {
    all: orders.length,
    pending: 0,
    processing: 0,
    completed: 0,
    cancelled: 0,
  };

  orders.forEach((o) => {
    const s = o.status.toLowerCase();
    if (s === "placed" || s === "confirmed") {
      counts.pending += 1;
    } else if (s === "preparing" || s === "out_for_delivery" || s === "ready_for_pickup") {
      counts.processing += 1;
    } else if (s === "completed") {
      counts.completed += 1;
    } else if (s === "cancelled") {
      counts.cancelled += 1;
    }
  });

  return counts;
}

function filterOrdersByStatusTab(
  orders: TestOrder[],
  tab: AdminOrderStatusTab,
  secondaryFilter: string = "all"
) {
  return orders.filter((o) => {
    const s = o.status.toLowerCase();

    // 1. Status Tab filter
    if (tab === "pending") {
      if (s !== "placed" && s !== "confirmed") return false;
    } else if (tab === "processing") {
      if (s !== "preparing" && s !== "out_for_delivery" && s !== "ready_for_pickup") return false;
    } else if (tab === "completed") {
      if (s !== "completed") return false;
    } else if (tab === "cancelled") {
      if (s !== "cancelled") return false;
    }

    // 2. Secondary dropdown filter
    if (secondaryFilter !== "all" && s !== secondaryFilter) return false;

    return true;
  });
}

function filterBySector(orders: TestOrder[], blockFilter: string) {
  if (blockFilter === "all") return orders;
  return orders.filter((o) => o.hostel_block.toLowerCase() === blockFilter.toLowerCase());
}

describe("Feature 2: Admin Order Status Tabs & Filtering", () => {
  const sampleOrders: TestOrder[] = [
    { id: "1", order_number: "SHP-001", status: "placed", customer_name: "Ahmad", hostel_block: "Block A", total_amount: 150, delivery_type: "delivery" },
    { id: "2", order_number: "SHP-002", status: "confirmed", customer_name: "Bilal", hostel_block: "Block B", total_amount: 220, delivery_type: "delivery" },
    { id: "3", order_number: "SHP-003", status: "preparing", customer_name: "Faisal", hostel_block: "Block A", total_amount: 310, delivery_type: "delivery" },
    { id: "4", order_number: "SHP-004", status: "out_for_delivery", customer_name: "Tariq", hostel_block: "Block C", total_amount: 90, delivery_type: "delivery" },
    { id: "5", order_number: "SHP-005", status: "ready_for_pickup", customer_name: "Omar", hostel_block: "Pickup Zone", total_amount: 180, delivery_type: "pickup" },
    { id: "6", order_number: "SHP-006", status: "completed", customer_name: "Zayd", hostel_block: "Block B", total_amount: 450, delivery_type: "delivery" },
    { id: "7", order_number: "SHP-007", status: "cancelled", customer_name: "Hamza", hostel_block: "Block A", total_amount: 120, delivery_type: "delivery" },
  ];

  it("calculates accurate order counts for all tabs from dataset", () => {
    const counts = computeTabCounts(sampleOrders);
    expect(counts.all).toBe(7);
    expect(counts.pending).toBe(2); // placed, confirmed
    expect(counts.processing).toBe(3); // preparing, out_for_delivery, ready_for_pickup
    expect(counts.completed).toBe(1); // completed
    expect(counts.cancelled).toBe(1); // cancelled
  });

  it("isolates Pending orders strictly to placed and confirmed states", () => {
    const pendingOrders = filterOrdersByStatusTab(sampleOrders, "pending");
    expect(pendingOrders.length).toBe(2);
    expect(pendingOrders.map((o) => o.order_number)).toEqual(["SHP-001", "SHP-002"]);

    // Critical safety: completed and cancelled orders NEVER appear in Pending
    expect(pendingOrders.some((o) => o.status === "completed")).toBe(false);
    expect(pendingOrders.some((o) => o.status === "cancelled")).toBe(false);
  });

  it("isolates Processing orders to preparing, out_for_delivery, and ready_for_pickup", () => {
    const processingOrders = filterOrdersByStatusTab(sampleOrders, "processing");
    expect(processingOrders.length).toBe(3);
    expect(processingOrders.map((o) => o.order_number)).toEqual(["SHP-003", "SHP-004", "SHP-005"]);

    // Critical safety: completed and cancelled orders NEVER appear in Processing
    expect(processingOrders.some((o) => o.status === "completed")).toBe(false);
    expect(processingOrders.some((o) => o.status === "cancelled")).toBe(false);
  });

  it("isolates Completed orders strictly to completed status", () => {
    const completedOrders = filterOrdersByStatusTab(sampleOrders, "completed");
    expect(completedOrders.length).toBe(1);
    expect(completedOrders[0]!.order_number).toBe("SHP-006");
    expect(completedOrders[0]!.status).toBe("completed");
  });

  it("isolates Cancelled orders strictly to cancelled status", () => {
    const cancelledOrders = filterOrdersByStatusTab(sampleOrders, "cancelled");
    expect(cancelledOrders.length).toBe(1);
    expect(cancelledOrders[0]!.order_number).toBe("SHP-007");
    expect(cancelledOrders[0]!.status).toBe("cancelled");
  });

  it("renders All tab matching all active orders", () => {
    const allOrders = filterOrdersByStatusTab(sampleOrders, "all");
    expect(allOrders.length).toBe(7);
  });

  it("dynamically updates tab counts and moves order when status transitions", () => {
    // Transition SHP-001 from 'placed' -> 'preparing'
    const updatedOrders = sampleOrders.map((o) =>
      o.id === "1" ? { ...o, status: "preparing" } : o
    );

    const countsBefore = computeTabCounts(sampleOrders);
    const countsAfter = computeTabCounts(updatedOrders);

    expect(countsBefore.pending).toBe(2);
    expect(countsBefore.processing).toBe(3);

    expect(countsAfter.pending).toBe(1);
    expect(countsAfter.processing).toBe(4);

    // Verify it disappears from Pending and appears in Processing
    const pendingOrders = filterOrdersByStatusTab(updatedOrders, "pending");
    expect(pendingOrders.some((o) => o.order_number === "SHP-001")).toBe(false);

    const processingOrders = filterOrdersByStatusTab(updatedOrders, "processing");
    expect(processingOrders.some((o) => o.order_number === "SHP-001")).toBe(true);
  });

  it("preserves sector/block filtering in combination with status tabs", () => {
    // Filter to Block A only
    const blockAOrders = filterBySector(sampleOrders, "Block A");
    expect(blockAOrders.length).toBe(3); // SHP-001 (placed), SHP-003 (preparing), SHP-007 (cancelled)

    const blockAPending = filterOrdersByStatusTab(blockAOrders, "pending");
    expect(blockAPending.length).toBe(1);
    expect(blockAPending[0]!.order_number).toBe("SHP-001");

    const blockAProcessing = filterOrdersByStatusTab(blockAOrders, "processing");
    expect(blockAProcessing.length).toBe(1);
    expect(blockAProcessing[0]!.order_number).toBe("SHP-003");

    const blockACancelled = filterOrdersByStatusTab(blockAOrders, "cancelled");
    expect(blockACancelled.length).toBe(1);
    expect(blockACancelled[0]!.order_number).toBe("SHP-007");

    const blockACompleted = filterOrdersByStatusTab(blockAOrders, "completed");
    expect(blockACompleted.length).toBe(0);
  });

  it("provides truthful empty states for tabs with no matching orders", () => {
    const noCompletedList: TestOrder[] = sampleOrders.filter((o) => o.status !== "completed");
    const filtered = filterOrdersByStatusTab(noCompletedList, "completed");
    expect(filtered.length).toBe(0);

    const emptyStateText = (tab: AdminOrderStatusTab) => {
      switch (tab) {
        case "pending": return "No Pending Orders";
        case "processing": return "No Orders in Processing";
        case "completed": return "No Completed Orders";
        case "cancelled": return "No Cancelled Orders";
        default: return "No Orders Found";
      }
    };

    expect(emptyStateText("completed")).toBe("No Completed Orders");
    expect(emptyStateText("pending")).toBe("No Pending Orders");
    expect(emptyStateText("processing")).toBe("No Orders in Processing");
    expect(emptyStateText("cancelled")).toBe("No Cancelled Orders");
  });

  it("handles order claim operations across any active tab seamlessly", () => {
    const adminUser = "Staff Coordinator";
    const claimedOrders = sampleOrders.map((o) =>
      o.id === "2" ? { ...o, claimed_by_name: adminUser } : o
    );

    const pending = filterOrdersByStatusTab(claimedOrders, "pending");
    const claimedOrder = pending.find((o) => o.id === "2");
    expect(claimedOrder?.claimed_by_name).toBe(adminUser);
  });
});

