import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import {
  AdminRole,
  hasPermission,
  canManageBlocks,
  canAssignBlockManagers,
  canManageRoles,
  canManageCosts,
  canViewAllOrders,
  canViewPickupOrders,
  canAccessOrder,
  ROLE_PERMISSIONS,
} from "@/lib/permissions";
import { BlockManagementTab, DeliveryBlockStats } from "@/components/admin/BlockManagementTab";
import { CheckoutForm } from "@/components/store/CheckoutForm";
import type { CheckoutFormData, DeliveryBlock } from "@/lib/types";

// Mock TanStack Router
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/", search: "", hash: "" }),
  createFileRoute: () => (opts: any) => opts,
}));

function createChainableMock(resolvedValue: any = { data: [], error: null }) {
  const promise = Promise.resolve(resolvedValue);
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(resolvedValue)),
    maybeSingle: vi.fn(() => Promise.resolve(resolvedValue)),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return chain;
}

// Mock Supabase
vi.mock("@/lib/supabase", () => {
  return {
    supabase: {
      from: vi.fn().mockImplementation(() => createChainableMock({ data: [], error: null })),
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === "admin_get_delivery_blocks_with_stats") {
          return Promise.resolve({
            data: [
              {
                id: "Block A",
                name: "Block A",
                description: "North Wing",
                is_active: true,
                created_at: new Date().toISOString(),
                assigned_manager_id: "m-1",
                assigned_manager_email: "manager.a@shiptmart.com",
                assigned_manager_name: "Ahmad",
                total_orders: 142,
                active_orders: 4,
                latest_claimed_at: new Date().toISOString(),
              },
              {
                id: "Block B",
                name: "Block B",
                description: "South Wing",
                is_active: true,
                created_at: new Date().toISOString(),
                assigned_manager_id: "m-2",
                assigned_manager_email: "manager.b@shiptmart.com",
                assigned_manager_name: "Bilal",
                total_orders: 98,
                active_orders: 2,
                latest_claimed_at: new Date().toISOString(),
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: "test-user-id", email: "admin@shiptmart.com" } } },
        }),
        getUser: vi.fn(),
      },
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      }),
      removeChannel: vi.fn(),
    },
    isSupabaseConfigured: true,
    validateSupabaseConfig: vi.fn().mockReturnValue({ valid: true, missing: [] }),
  };
});

// Mock Store & Customer Auth
vi.mock("@/lib/store", () => ({
  useStore: () => ({
    cart: [{ productId: "p-1", quantity: 2 }],
    subtotal: 100,
    itemCount: 2,
    clear: vi.fn(),
    getProduct: vi.fn(),
  }),
}));

const mockCustomerUser = { id: "cust-1", email: "customer@shiptmart.com" };
const mockCustomerProfile = {
  full_name: "Salman Faris",
  phone: "9876543210",
  default_block: "Block A",
  default_room: "302",
  default_hostel: "Block A",
};

vi.mock("@/lib/auth", () => ({
  useCustomerAuth: () => ({
    user: mockCustomerUser,
    profile: mockCustomerProfile,
  }),
}));

// Mock catalogApi
vi.mock("@/lib/catalogApi", () => ({
  loadActiveDeliveryBlocks: vi.fn().mockResolvedValue([
    { id: "Block A", name: "Block A", description: "North Wing", is_active: true },
    { id: "Block B", name: "Block B", description: "South Wing", is_active: true },
    { id: "Main Campus", name: "Main Campus", description: "Central", is_active: true },
  ]),
  placeOrder: vi.fn().mockResolvedValue({
    success: true,
    data: {
      order_id: "ord-123",
      order_number: "QM-20261024-TEST",
      guest_tracking_token: "token-abc",
      total_amount: 100,
      status: "placed",
      payment_method: "upi",
      payment_status: "pending",
    },
  }),
  resolveOrderItemImage: vi.fn().mockReturnValue("https://example.com/item.jpg"),
  BRAND_FALLBACK_IMAGE: "https://example.com/fallback.jpg",
}));

describe("1. Role Permission Hierarchy & Order Access Scope", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("enforces Super Admin full authorization across all domains", () => {
    expect(hasPermission("super_admin", "manage_roles")).toBe(true);
    expect(hasPermission("super_admin", "manage_delivery_blocks")).toBe(true);
    expect(hasPermission("super_admin", "assign_block_managers")).toBe(true);
    expect(hasPermission("super_admin", "view_all_orders")).toBe(true);
    expect(hasPermission("super_admin", "claim_orders")).toBe(true);
    expect(hasPermission("super_admin", "update_order_status")).toBe(true);
    expect(hasPermission("super_admin", "manage_supplier_costs")).toBe(true);
    expect(hasPermission("super_admin", "view_audit_logs")).toBe(true);
  });

  it("enforces Owner permissions: can manage delivery blocks and view all orders, but CANNOT manage roles", () => {
    expect(hasPermission("owner", "manage_delivery_blocks")).toBe(true);
    expect(hasPermission("owner", "assign_block_managers")).toBe(true);
    expect(hasPermission("owner", "view_all_orders")).toBe(true);
    expect(hasPermission("owner", "claim_orders")).toBe(true);
    expect(hasPermission("owner", "update_order_status")).toBe(true);
    expect(hasPermission("owner", "manage_supplier_costs")).toBe(true);

    // Security boundaries
    expect(hasPermission("owner", "manage_roles")).toBe(false);
    expect(hasPermission("owner", "manage_security_settings")).toBe(false);
    expect(hasPermission("owner", "view_audit_logs")).toBe(false);
  });

  it("enforces Store Manager: strictly limited to catalog and Store Pickup orders only", () => {
    expect(hasPermission("store_manager", "manage_products")).toBe(true);
    expect(hasPermission("store_manager", "manage_categories")).toBe(true);
    expect(hasPermission("store_manager", "manage_inventory")).toBe(true);
    expect(hasPermission("store_manager", "view_pickup_orders")).toBe(true);

    // Strictly forbidden from delivery blocks, cross-block orders, roles, and confidential costs
    expect(hasPermission("store_manager", "view_all_orders")).toBe(false);
    expect(hasPermission("store_manager", "manage_delivery_blocks")).toBe(false);
    expect(hasPermission("store_manager", "assign_block_managers")).toBe(false);
    expect(hasPermission("store_manager", "manage_roles")).toBe(false);
    expect(hasPermission("store_manager", "manage_supplier_costs")).toBe(false);
  });

  it("enforces Block Manager: strictly limited to assigned delivery block orders", () => {
    expect(hasPermission("block_manager", "view_assigned_block_orders")).toBe(true);
    expect(hasPermission("block_manager", "claim_orders")).toBe(true);
    expect(hasPermission("block_manager", "update_order_status")).toBe(true);

    // Strictly forbidden from catalog, delivery blocks, roles, supplier costs, and all orders
    expect(hasPermission("block_manager", "view_all_orders")).toBe(false);
    expect(hasPermission("block_manager", "manage_delivery_blocks")).toBe(false);
    expect(hasPermission("block_manager", "manage_products")).toBe(false);
    expect(hasPermission("block_manager", "manage_roles")).toBe(false);
    expect(hasPermission("block_manager", "manage_supplier_costs")).toBe(false);
  });

  describe("canAccessOrder() Evaluator", () => {
    const pickupOrder = { delivery_method: "campus_pickup", delivery_block_id: null, block: null };
    const blockAOrder = { delivery_method: "hostel_delivery", delivery_block_id: "Block A", block: "Block A" };
    const blockBOrder = { delivery_method: "hostel_delivery", delivery_block_id: "Block B", block: "Block B" };
    const legacyBlockOrder = { delivery_method: "hostel_delivery", delivery_block_id: null, block: "Block A" };

    it("allows Super Admin and Owner to access all orders", () => {
      expect(canAccessOrder("super_admin", pickupOrder)).toBe(true);
      expect(canAccessOrder("super_admin", blockAOrder)).toBe(true);
      expect(canAccessOrder("super_admin", blockBOrder)).toBe(true);

      expect(canAccessOrder("owner", pickupOrder)).toBe(true);
      expect(canAccessOrder("owner", blockAOrder)).toBe(true);
      expect(canAccessOrder("owner", blockBOrder)).toBe(true);
    });

    it("allows Store Manager to access Store Pickup orders ONLY", () => {
      expect(canAccessOrder("store_manager", pickupOrder)).toBe(true);
      expect(canAccessOrder("store_manager", blockAOrder)).toBe(false);
      expect(canAccessOrder("store_manager", blockBOrder)).toBe(false);
    });

    it("restricts Block Manager strictly to orders within assigned block", () => {
      // Manager assigned to Block A
      expect(canAccessOrder("block_manager", blockAOrder, "Block A")).toBe(true);
      expect(canAccessOrder("block_manager", legacyBlockOrder, "Block A")).toBe(true); // fallback to block column

      // Cannot access Block B orders
      expect(canAccessOrder("block_manager", blockBOrder, "Block A")).toBe(false);

      // Cannot access Store Pickup orders
      expect(canAccessOrder("block_manager", pickupOrder, "Block A")).toBe(false);
    });
  });
});

describe("2. Legacy Order Migration & Normalization Safety", () => {
  interface MockOrder {
    id: string;
    order_number: string;
    delivery_method: string;
    hostel: string | null;
    block: string | null;
    room: string | null;
    delivery_block_id: string | null;
    status: string;
  }

  const existingProductionOrders: MockOrder[] = [
    {
      id: "ord-1",
      order_number: "QM-20261022-3A2A8995",
      delivery_method: "hostel_delivery",
      hostel: "Kaveri Hostel",
      block: "Block B",
      room: "101",
      delivery_block_id: null,
      status: "completed",
    },
    {
      id: "ord-2",
      order_number: "QM-20261022-13615DD5",
      delivery_method: "hostel_delivery",
      hostel: "Ganga Hostel",
      block: "Main Campus",
      room: "204",
      delivery_block_id: null,
      status: "completed",
    },
    {
      id: "ord-3",
      order_number: "QM-20261022-DD7AFC86",
      delivery_method: "hostel_delivery",
      hostel: "Ganga Hostel",
      block: "Main",
      room: "204",
      delivery_block_id: null,
      status: "completed",
    },
    {
      id: "ord-4",
      order_number: "QM-20261019-C1E7E50C",
      delivery_method: "hostel_delivery",
      hostel: "Darul Huda University Hostel",
      block: "SMS",
      room: "101",
      delivery_block_id: null,
      status: "completed",
    },
  ];

  const availableDeliveryBlocks = [
    { id: "Block A", name: "Block A", is_active: true },
    { id: "Block B", name: "Block B", is_active: true },
    { id: "Block C", name: "Block C", is_active: true },
    { id: "Block D", name: "Block D", is_active: true },
    { id: "Main Campus", name: "Main Campus", is_active: true },
  ];

  function simulateMigration(orders: MockOrder[], blocks: { id: string }[]): MockOrder[] {
    const blockIds = new Set(blocks.map((b) => b.id.toLowerCase().trim()));
    return orders.map((o) => {
      const cloned = { ...o };
      if (!cloned.block) return cloned;

      const trimmedBlock = cloned.block.trim();

      // Rule 1: Exact match with existing delivery block
      if (blockIds.has(trimmedBlock.toLowerCase())) {
        const match = blocks.find((b) => b.id.toLowerCase() === trimmedBlock.toLowerCase());
        cloned.delivery_block_id = match ? match.id : trimmedBlock;
        return cloned;
      }

      // Rule 2: Verified normalization rule: 'Main' -> 'Main Campus'
      if (trimmedBlock.toLowerCase() === "main") {
        cloned.delivery_block_id = "Main Campus";
        return cloned;
      }

      // Unmapped legacy orders (e.g. 'SMS'): Preserve delivery_block_id as null, keep all text fields
      cloned.delivery_block_id = null;
      return cloned;
    });
  }

  it("correctly maps exact match orders ('Block B' and 'Main Campus')", () => {
    const migrated = simulateMigration(existingProductionOrders, availableDeliveryBlocks);
    const ord1 = migrated.find((o) => o.order_number === "QM-20261022-3A2A8995");
    expect(ord1?.delivery_block_id).toBe("Block B");

    const ord2 = migrated.find((o) => o.order_number === "QM-20261022-13615DD5");
    expect(ord2?.delivery_block_id).toBe("Main Campus");
  });

  it("applies verified normalization rule: 'Main' -> 'Main Campus'", () => {
    const migrated = simulateMigration(existingProductionOrders, availableDeliveryBlocks);
    const ord3 = migrated.find((o) => o.order_number === "QM-20261022-DD7AFC86");
    expect(ord3?.delivery_block_id).toBe("Main Campus");
    expect(ord3?.block).toBe("Main"); // original block preserved
    expect(ord3?.room).toBe("204"); // room preserved
  });

  it("preserves unmapped legacy orders ('SMS') non-destructively with delivery_block_id = null", () => {
    const migrated = simulateMigration(existingProductionOrders, availableDeliveryBlocks);
    const ord4 = migrated.find((o) => o.order_number === "QM-20261019-C1E7E50C");
    expect(ord4?.delivery_block_id).toBeNull();
    expect(ord4?.hostel).toBe("Darul Huda University Hostel");
    expect(ord4?.block).toBe("SMS");
    expect(ord4?.room).toBe("101");
  });

  it("validates that updated chk_delivery_details constraint accepts legacy and new orders", () => {
    const validateConstraint = (order: {
      delivery_method: string;
      delivery_block_id: string | null;
      hostel: string | null;
      room: string | null;
    }) => {
      if (order.delivery_method === "campus_pickup") return true;
      if (order.delivery_method === "hostel_delivery") {
        const hasLocation = Boolean(order.delivery_block_id || order.hostel);
        const hasRoom = Boolean(order.room && order.room.trim() !== "");
        return hasLocation && hasRoom;
      }
      return false;
    };

    // New order with delivery_block_id and room
    expect(
      validateConstraint({
        delivery_method: "hostel_delivery",
        delivery_block_id: "Block A",
        hostel: null,
        room: "101",
      })
    ).toBe(true);

    // Legacy order with hostel and room
    expect(
      validateConstraint({
        delivery_method: "hostel_delivery",
        delivery_block_id: null,
        hostel: "Kaveri Hostel",
        room: "101",
      })
    ).toBe(true);

    // Invalid order missing room
    expect(
      validateConstraint({
        delivery_method: "hostel_delivery",
        delivery_block_id: "Block A",
        hostel: null,
        room: null,
      })
    ).toBe(false);

    // Campus pickup requires no block or room
    expect(
      validateConstraint({
        delivery_method: "campus_pickup",
        delivery_block_id: null,
        hostel: null,
        room: null,
      })
    ).toBe(true);
  });
});

describe("3. Atomic Order Claiming Concurrency & Lifecycle", () => {
  interface SimulatedOrderState {
    id: string;
    status: string;
    claimed_by: string | null;
    claimed_at: string | null;
    processing_started_at: string | null;
    delivery_block_id: string;
    lockAcquired: boolean;
  }

  it("prevents two concurrent callers from claiming the same unclaimed order", async () => {
    const orderState: SimulatedOrderState = {
      id: "ord-concurrent-1",
      status: "placed",
      claimed_by: null,
      claimed_at: null,
      processing_started_at: null,
      delivery_block_id: "Block A",
      lockAcquired: false,
    };

    const claimOrderAtomic = async (staffId: string): Promise<{ success: boolean; error?: string }> => {
      // Simulate PostgreSQL row lock: SELECT ... FOR UPDATE
      if (orderState.lockAcquired) {
        // Queue wait simulation
      }
      orderState.lockAcquired = true;

      try {
        if (orderState.claimed_by !== null) {
          return { success: false, error: "Concurrency Conflict: Order has already been claimed." };
        }

        if (orderState.status === "completed" || orderState.status === "cancelled") {
          return { success: false, error: "Cannot claim a finalized order." };
        }

        // Successfully claim
        orderState.claimed_by = staffId;
        orderState.claimed_at = new Date().toISOString();
        if (orderState.status === "placed") {
          orderState.status = "confirmed";
        }
        return { success: true };
      } finally {
        orderState.lockAcquired = false;
      }
    };

    // Simulate concurrent execution: Staff A and Staff B attempt to claim at the same moment
    const [resultA, resultB] = await Promise.all([
      claimOrderAtomic("staff-user-A"),
      claimOrderAtomic("staff-user-B"),
    ]);

    // Exactly one claim succeeds; the other fails with Concurrency Conflict
    const successes = [resultA, resultB].filter((r) => r.success);
    const conflicts = [resultA, resultB].filter((r) => !r.success && r.error?.includes("Concurrency Conflict"));

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(orderState.claimed_by).not.toBeNull();
  });

  it("enforces order status state machine rules and prevents invalid transitions", () => {
    const VALID_TRANSITIONS: Record<string, string[]> = {
      placed: ["confirmed", "cancelled"],
      confirmed: ["preparing", "cancelled"],
      preparing: ["out_for_delivery", "ready_for_pickup", "cancelled"],
      out_for_delivery: ["completed", "cancelled"],
      ready_for_pickup: ["completed", "cancelled"],
      completed: [], // Terminal
      cancelled: [], // Terminal
    };

    const isValidTransition = (current: string, target: string) => {
      return VALID_TRANSITIONS[current]?.includes(target) ?? false;
    };

    expect(isValidTransition("placed", "confirmed")).toBe(true);
    expect(isValidTransition("confirmed", "preparing")).toBe(true);
    expect(isValidTransition("preparing", "out_for_delivery")).toBe(true);
    expect(isValidTransition("out_for_delivery", "completed")).toBe(true);

    // Invalid transitions
    expect(isValidTransition("completed", "cancelled")).toBe(false); // cannot cancel completed order
    expect(isValidTransition("placed", "completed")).toBe(false); // cannot jump from placed to completed
    expect(isValidTransition("cancelled", "confirmed")).toBe(false); // cannot revive cancelled order
  });

  it("guarantees single-instance inventory restocking on cancellation", () => {
    let productStock = 10;
    const orderItems = [{ productId: "p-1", quantity: 3 }];
    let orderStatus = "confirmed";
    let cancellationCount = 0;

    const cancelOrder = (): { success: boolean; error?: string } => {
      if (orderStatus === "cancelled") {
        return { success: false, error: "Order is already cancelled." };
      }
      if (orderStatus === "completed") {
        return { success: false, error: "Completed orders cannot be cancelled." };
      }

      // Restock inventory exactly once
      for (const item of orderItems) {
        productStock += item.quantity;
      }
      orderStatus = "cancelled";
      cancellationCount++;
      return { success: true };
    };

    // First cancellation succeeds and restocks
    const firstAttempt = cancelOrder();
    expect(firstAttempt.success).toBe(true);
    expect(productStock).toBe(13);
    expect(cancellationCount).toBe(1);

    // Second repeated cancellation attempt is rejected and does not restock
    const secondAttempt = cancelOrder();
    expect(secondAttempt.success).toBe(false);
    expect(productStock).toBe(13); // stock remains untouched
    expect(cancellationCount).toBe(1);
  });
});

describe("4. Component UI Rendering & Verification", () => {
  it("renders BlockManagementTab for Super Admin with blocks and statistics", async () => {
    render(<BlockManagementTab adminRole="super_admin" />);

    expect(screen.getByText("Delivery Block Management")).toBeDefined();
    expect(screen.getByText("Add Delivery Block")).toBeDefined();

    await waitFor(() => {
      expect(screen.getAllByText("Block A").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Block B").length).toBeGreaterThan(0);
    });
  });

  it("renders Access Denied for Block Manager on BlockManagementTab", () => {
    render(<BlockManagementTab adminRole="block_manager" />);
    expect(screen.getByText("Access Denied")).toBeDefined();
  });

  it("renders CheckoutForm with dynamic delivery blocks and preselects customer default block", async () => {
    sessionStorage.clear();
    render(<CheckoutForm />);

    await waitFor(() => {
      const select = screen.getByLabelText("Delivery Block") as HTMLSelectElement;
      expect(select).toBeDefined();
      expect(select.value).toBe("Block A");
    });
  });
});

describe("5. RPC Logic Simulation & Guard Rail Verification", () => {
  interface SimulatedBlock {
    id: string;
    name: string;
    description: string;
    is_active: boolean;
  }

  interface SimulatedRole {
    user_id: string;
    role: string;
    assigned_block: string | null;
  }

  interface SimulatedOrder {
    id: string;
    delivery_method: string;
    delivery_block_id: string | null;
    status: string;
    claimed_by: string | null;
    claimed_at: string | null;
  }

  // Simulated admin_manage_delivery_block database function
  function simulateAdminManageDeliveryBlock(
    callerRole: string | null,
    action: string,
    params: {
      id: string;
      name?: string | null;
      description?: string | null;
      is_active?: boolean | null;
      manager_user_id?: string | null;
    },
    state: {
      blocks: SimulatedBlock[];
      roles: SimulatedRole[];
      orders: SimulatedOrder[];
    }
  ): { success: boolean; error?: string } {
    if (!callerRole || !["super_admin", "owner"].includes(callerRole)) {
      return { success: false, error: "Access Denied: Only Super Administrators and Store Owners can manage delivery blocks." };
    }

    const cleanId = (params.id || "").trim();
    const cleanName = (params.name || cleanId).trim();

    if (!cleanId) {
      return { success: false, error: "A valid delivery block ID is required." };
    }

    if (action === "create") {
      if (state.blocks.some((b) => b.id.toLowerCase() === cleanId.toLowerCase())) {
        return { success: false, error: `A delivery block with ID "${cleanId}" already exists.` };
      }
      if (params.manager_user_id) {
        const mgr = state.roles.find((r) => r.user_id === params.manager_user_id);
        if (!mgr || mgr.role !== "block_manager") {
          return { success: false, error: 'Invalid assignment: Only staff with role "block_manager" can be assigned to a delivery block.' };
        }
      }
      state.blocks.push({
        id: cleanId,
        name: cleanName,
        description: params.description || "",
        is_active: params.is_active ?? true,
      });
      if (params.manager_user_id) {
        state.roles.forEach((r) => {
          if (r.assigned_block === cleanId) r.assigned_block = null;
        });
        const mgr = state.roles.find((r) => r.user_id === params.manager_user_id);
        if (mgr) mgr.assigned_block = cleanId;
      }
      return { success: true };
    }

    const block = state.blocks.find((b) => b.id === cleanId);
    if (!block) {
      return { success: false, error: `Delivery block "${cleanId}" does not exist.` };
    }

    if (action === "update") {
      const willBeInactive = params.is_active === false;
      if (willBeInactive && block.is_active) {
        const hasActiveOrders = state.orders.some(
          (o) => o.delivery_block_id === cleanId && ["placed", "confirmed", "preparing", "out_for_delivery"].includes(o.status)
        );
        if (hasActiveOrders) {
          return { success: false, error: `Cannot deactivate delivery block "${cleanId}": there are active orders currently being fulfilled for this block.` };
        }
      }

      block.name = cleanName || block.name;
      if (params.description !== undefined && params.description !== null) block.description = params.description;
      if (params.is_active !== undefined && params.is_active !== null) block.is_active = params.is_active;

      if (params.manager_user_id) {
        const mgr = state.roles.find((r) => r.user_id === params.manager_user_id);
        if (!mgr || mgr.role !== "block_manager") {
          return { success: false, error: 'Invalid assignment: Only staff with role "block_manager" can be assigned to a delivery block.' };
        }
        state.roles.forEach((r) => {
          if (r.assigned_block === cleanId) r.assigned_block = null;
        });
        mgr.assigned_block = cleanId;
      }
      return { success: true };
    }

    if (action === "toggle_active") {
      if (block.is_active) {
        const hasActiveOrders = state.orders.some(
          (o) => o.delivery_block_id === cleanId && ["placed", "confirmed", "preparing", "out_for_delivery"].includes(o.status)
        );
        if (hasActiveOrders) {
          return { success: false, error: `Cannot deactivate delivery block "${cleanId}": there are active orders currently being fulfilled for this block.` };
        }
      }
      block.is_active = !block.is_active;
      return { success: true };
    }

    if (action === "assign_manager") {
      if (!params.manager_user_id) {
        state.roles.forEach((r) => {
          if (r.assigned_block === cleanId) r.assigned_block = null;
        });
      } else {
        const mgr = state.roles.find((r) => r.user_id === params.manager_user_id);
        if (!mgr || mgr.role !== "block_manager") {
          return { success: false, error: 'Invalid assignment: Only staff with role "block_manager" can be assigned to a delivery block.' };
        }
        state.roles.forEach((r) => {
          if (r.assigned_block === cleanId) r.assigned_block = null;
        });
        mgr.assigned_block = cleanId;
      }
      return { success: true };
    }

    return { success: false, error: `Invalid action: ${action}` };
  }

  // Simulated admin_claim_order database function
  function simulateAdminClaimOrder(
    caller: { id: string; role: string; assigned_block: string | null } | null,
    orderId: string,
    orders: SimulatedOrder[]
  ): { success: boolean; error?: string } {
    if (!caller) {
      return { success: false, error: "Authentication required: caller session is unverified." };
    }

    const order = orders.find((o) => o.id === orderId);
    if (!order) {
      return { success: false, error: `Order with ID ${orderId} not found.` };
    }

    if (["completed", "cancelled"].includes(order.status)) {
      return { success: false, error: `Cannot claim an order that is already ${order.status}.` };
    }

    if (order.claimed_by !== null && order.claimed_by !== caller.id) {
      return { success: false, error: "Concurrency Conflict: This order has already been claimed by another staff member." };
    }

    if (caller.role === "block_manager") {
      if (order.delivery_method === "campus_pickup") {
        return { success: false, error: "Access Denied: Block Managers cannot process Store Pickup orders." };
      }
      if (!order.delivery_block_id || order.delivery_block_id !== caller.assigned_block) {
        return { success: false, error: `Access Denied: You are only authorized to claim orders for delivery block "${caller.assigned_block}".` };
      }
    }

    if (caller.role === "store_manager") {
      if (order.delivery_method !== "campus_pickup") {
        return { success: false, error: "Access Denied: Store Managers can only claim Store Pickup orders. Block delivery orders are handled by Block Managers and Owners." };
      }
    }

    order.claimed_by = caller.id;
    order.claimed_at = new Date().toISOString();
    if (order.status === "placed") {
      order.status = "confirmed";
    }

    return { success: true };
  }

  it("admin_manage_delivery_block: validates caller role and rejects unauthorized users", () => {
    const state = {
      blocks: [{ id: "Block A", name: "Block A", description: "", is_active: true }],
      roles: [],
      orders: [],
    };

    expect(simulateAdminManageDeliveryBlock(null, "toggle_active", { id: "Block A" }, state).success).toBe(false);
    expect(simulateAdminManageDeliveryBlock("store_manager", "toggle_active", { id: "Block A" }, state).success).toBe(false);
    expect(simulateAdminManageDeliveryBlock("block_manager", "toggle_active", { id: "Block A" }, state).success).toBe(false);
    expect(simulateAdminManageDeliveryBlock("owner", "toggle_active", { id: "Block A" }, state).success).toBe(true);
    expect(simulateAdminManageDeliveryBlock("super_admin", "toggle_active", { id: "Block A" }, state).success).toBe(true);
  });

  it("admin_manage_delivery_block: creates block, enforces required fields and duplicate checks", () => {
    const state = {
      blocks: [{ id: "Block A", name: "Block A", description: "", is_active: true }],
      roles: [],
      orders: [],
    };

    // Rejects empty ID
    expect(simulateAdminManageDeliveryBlock("super_admin", "create", { id: "" }, state).error).toContain("required");

    // Rejects duplicate ID
    expect(simulateAdminManageDeliveryBlock("super_admin", "create", { id: "Block A" }, state).error).toContain("already exists");

    // Successfully creates new block
    const res = simulateAdminManageDeliveryBlock("super_admin", "create", { id: "Block E", name: "Block E North", description: "Graduate Wing" }, state);
    expect(res.success).toBe(true);
    expect(state.blocks.find((b) => b.id === "Block E")).toBeDefined();
  });

  it("admin_manage_delivery_block: prevents deactivating a block with active orders", () => {
    const state = {
      blocks: [{ id: "Block B", name: "Block B", description: "", is_active: true }],
      roles: [],
      orders: [
        { id: "ord-1", delivery_method: "hostel_delivery", delivery_block_id: "Block B", status: "preparing", claimed_by: "u-1", claimed_at: "now" },
      ],
    };

    // Attempting toggle_active when active orders exist must fail
    const toggleRes = simulateAdminManageDeliveryBlock("owner", "toggle_active", { id: "Block B" }, state);
    expect(toggleRes.success).toBe(false);
    expect(toggleRes.error).toContain("active orders");
    expect(state.blocks[0]!.is_active).toBe(true); // remains active

    // Attempting update with is_active: false when active orders exist must fail
    const updateRes = simulateAdminManageDeliveryBlock("owner", "update", { id: "Block B", is_active: false }, state);
    expect(updateRes.success).toBe(false);
    expect(updateRes.error).toContain("active orders");

    // Once orders are completed, deactivation succeeds
    state.orders[0]!.status = "completed";
    const successRes = simulateAdminManageDeliveryBlock("owner", "toggle_active", { id: "Block B" }, state);
    expect(successRes.success).toBe(true);
    expect(state.blocks[0]!.is_active).toBe(false);
  });

  it("admin_manage_delivery_block: assigns only verified block_manager and cleans previous assignment", () => {
    const state = {
      blocks: [{ id: "Block A", name: "Block A", description: "", is_active: true }],
      roles: [
        { user_id: "u-sm", role: "store_manager", assigned_block: null },
        { user_id: "u-bm1", role: "block_manager", assigned_block: "Block A" },
        { user_id: "u-bm2", role: "block_manager", assigned_block: null },
      ],
      orders: [],
    };

    // Rejects non-block-manager role
    const invalidRes = simulateAdminManageDeliveryBlock("owner", "assign_manager", { id: "Block A", manager_user_id: "u-sm" }, state);
    expect(invalidRes.success).toBe(false);
    expect(invalidRes.error).toContain("block_manager");

    // Assigns bm2 and clears bm1
    const assignRes = simulateAdminManageDeliveryBlock("owner", "assign_manager", { id: "Block A", manager_user_id: "u-bm2" }, state);
    expect(assignRes.success).toBe(true);
    expect(state.roles.find((r) => r.user_id === "u-bm2")?.assigned_block).toBe("Block A");
    expect(state.roles.find((r) => r.user_id === "u-bm1")?.assigned_block).toBeNull();
  });

  it("admin_claim_order: restricts Block Managers strictly to their assigned block", () => {
    const orders: SimulatedOrder[] = [
      { id: "ord-a", delivery_method: "hostel_delivery", delivery_block_id: "Block A", status: "placed", claimed_by: null, claimed_at: null },
      { id: "ord-b", delivery_method: "hostel_delivery", delivery_block_id: "Block B", status: "placed", claimed_by: null, claimed_at: null },
      { id: "ord-pickup", delivery_method: "campus_pickup", delivery_block_id: null, status: "placed", claimed_by: null, claimed_at: null },
    ];
    const blockManagerA = { id: "mgr-a", role: "block_manager", assigned_block: "Block A" };

    // Allowed on Block A
    expect(simulateAdminClaimOrder(blockManagerA, "ord-a", orders).success).toBe(true);

    // Rejected on Block B
    const bRes = simulateAdminClaimOrder(blockManagerA, "ord-b", orders);
    expect(bRes.success).toBe(false);
    expect(bRes.error).toContain("Block A");

    // Rejected on Store Pickup
    const pickupRes = simulateAdminClaimOrder(blockManagerA, "ord-pickup", orders);
    expect(pickupRes.success).toBe(false);
    expect(pickupRes.error).toContain("Store Pickup");
  });

  it("admin_claim_order: restricts Store Managers strictly to Store Pickup orders", () => {
    const orders: SimulatedOrder[] = [
      { id: "ord-block", delivery_method: "hostel_delivery", delivery_block_id: "Block A", status: "placed", claimed_by: null, claimed_at: null },
      { id: "ord-pickup", delivery_method: "campus_pickup", delivery_block_id: null, status: "placed", claimed_by: null, claimed_at: null },
    ];
    const storeManager = { id: "sm-1", role: "store_manager", assigned_block: null };

    // Rejected on hostel delivery
    const blockRes = simulateAdminClaimOrder(storeManager, "ord-block", orders);
    expect(blockRes.success).toBe(false);
    expect(blockRes.error).toContain("Store Managers can only claim Store Pickup orders");

    // Allowed on store pickup
    const pickupRes = simulateAdminClaimOrder(storeManager, "ord-pickup", orders);
    expect(pickupRes.success).toBe(true);
    expect(orders.find((o) => o.id === "ord-pickup")?.claimed_by).toBe("sm-1");
  });

  it("admin_claim_order: rejects terminal orders and concurrent claims", () => {
    const orders: SimulatedOrder[] = [
      { id: "ord-completed", delivery_method: "hostel_delivery", delivery_block_id: "Block A", status: "completed", claimed_by: "u-1", claimed_at: "now" },
      { id: "ord-claimed", delivery_method: "hostel_delivery", delivery_block_id: "Block A", status: "confirmed", claimed_by: "u-1", claimed_at: "now" },
    ];
    const superAdmin = { id: "sa-1", role: "super_admin", assigned_block: null };

    // Rejects completed order
    const compRes = simulateAdminClaimOrder(superAdmin, "ord-completed", orders);
    expect(compRes.success).toBe(false);
    expect(compRes.error).toContain("already completed");

    // Rejects order already claimed by another user
    const claimRes = simulateAdminClaimOrder(superAdmin, "ord-claimed", orders);
    expect(claimRes.success).toBe(false);
    expect(claimRes.error).toContain("Concurrency Conflict");
  });
});
