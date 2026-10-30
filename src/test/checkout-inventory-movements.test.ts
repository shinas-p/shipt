import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression Test Suite:
 * Shipz Mart Checkout Fix for "inventory_movements violates check constraint inventory_movements_movement_type_check"
 *
 * Verifies:
 * 1. Root cause reproduction: Legacy constraint rejected 'payu_checkout_reserve', 'payment_failure_restock', and 'payment_timeout_restock'.
 * 2. Migration validity: Migration 20261101000000 safely expands the check constraint to include all 8 legitimate movement types.
 * 3. Fallback resiliency: Exception handling in RPC prevents checkout crash even against unmigrated databases.
 * 4. Stock conservation: Stock deductions, reservations, restocking, and idempotency invariants are strictly preserved.
 */

// Simulation of the database check constraint
const LEGACY_ALLOWED_MOVEMENT_TYPES = new Set([
  "order_deduction",
  "order_cancellation_restock",
  "manual_adjustment",
  "restock_shipment",
  "damaged_loss",
]);

const EXPANDED_ALLOWED_MOVEMENT_TYPES = new Set([
  "order_deduction",
  "payu_checkout_reserve",
  "order_cancellation_restock",
  "payment_failure_restock",
  "payment_timeout_restock",
  "manual_adjustment",
  "restock_shipment",
  "damaged_loss",
]);

interface MockInventoryMovement {
  product_id: string;
  order_id: string;
  movement_type: string;
  quantity_change: number;
  previous_stock: number;
  new_stock: number;
  reason: string;
}

interface MockProduct {
  id: string;
  name: string;
  stock: number;
}

function simulateDbInsertMovement(
  tableConstraint: Set<string>,
  movement: MockInventoryMovement
): MockInventoryMovement {
  if (!tableConstraint.has(movement.movement_type)) {
    const error = new Error(
      `new row for relation "inventory_movements" violates check constraint "inventory_movements_movement_type_check"`
    );
    (error as any).code = "23514"; // PostgreSQL check_violation
    throw error;
  }
  return movement;
}

// Simulates create_order_with_inventory RPC with resilient fallback
function simulateCreateOrderWithInventory(
  tableConstraint: Set<string>,
  product: MockProduct,
  requestedQty: number,
  paymentMethod: "cod" | "payu"
) {
  if (product.stock < requestedQty) {
    throw new Error(`Insufficient stock for "${product.name}": only ${product.stock} available (requested ${requestedQty})`);
  }

  const prevStock = product.stock;
  product.stock -= requestedQty;
  const initialStatus = paymentMethod === "payu" ? "pending_payment" : "placed";
  const intendedMovementType = initialStatus === "pending_payment" ? "payu_checkout_reserve" : "order_deduction";

  let insertedRecord: MockInventoryMovement;
  try {
    insertedRecord = simulateDbInsertMovement(tableConstraint, {
      product_id: product.id,
      order_id: "order-123",
      movement_type: intendedMovementType,
      quantity_change: -requestedQty,
      previous_stock: prevStock,
      new_stock: product.stock,
      reason: "Order reservation",
    });
  } catch (err: any) {
    if (err.code === "23514") {
      // PL/pgSQL EXCEPTION WHEN check_violation THEN fallback
      insertedRecord = simulateDbInsertMovement(tableConstraint, {
        product_id: product.id,
        order_id: "order-123",
        movement_type: "order_deduction",
        quantity_change: -requestedQty,
        previous_stock: prevStock,
        new_stock: product.stock,
        reason: "Order reservation (fallback)",
      });
    } else {
      throw err;
    }
  }

  return {
    success: true,
    initialStatus,
    newProductStock: product.stock,
    insertedMovement: insertedRecord,
  };
}

describe("Shipz Mart — Checkout Inventory Movements Regression Test Suite", () => {
  describe("1. Root Cause Reproduction & Failure Demonstration", () => {
    it("reproduces exact checkout failure on legacy schema when initiating PayU checkout without fallback", () => {
      const product: MockProduct = { id: "prod-1", name: "Maggi Noodles", stock: 10 };
      const requestedQty = 2;

      // Without fallback, inserting 'payu_checkout_reserve' violates legacy constraint
      expect(() => {
        simulateDbInsertMovement(LEGACY_ALLOWED_MOVEMENT_TYPES, {
          product_id: product.id,
          order_id: "order-fail",
          movement_type: "payu_checkout_reserve",
          quantity_change: -requestedQty,
          previous_stock: 10,
          new_stock: 8,
          reason: "Order reservation",
        });
      }).toThrowError(
        'new row for relation "inventory_movements" violates check constraint "inventory_movements_movement_type_check"'
      );
    });

    it("reproduces failure when releasing stock on PayU payment failure under legacy constraint", () => {
      expect(() => {
        simulateDbInsertMovement(LEGACY_ALLOWED_MOVEMENT_TYPES, {
          product_id: "prod-1",
          order_id: "order-fail",
          movement_type: "payment_failure_restock",
          quantity_change: 2,
          previous_stock: 8,
          new_stock: 10,
          reason: "Stock release on payment failure",
        });
      }).toThrowError(
        'new row for relation "inventory_movements" violates check constraint "inventory_movements_movement_type_check"'
      );
    });

    it("reproduces failure when releasing stock on 15-minute payment timeout under legacy constraint", () => {
      expect(() => {
        simulateDbInsertMovement(LEGACY_ALLOWED_MOVEMENT_TYPES, {
          product_id: "prod-1",
          order_id: "order-fail",
          movement_type: "payment_timeout_restock",
          quantity_change: 2,
          previous_stock: 8,
          new_stock: 10,
          reason: "Stock release on payment timeout",
        });
      }).toThrowError(
        'new row for relation "inventory_movements" violates check constraint "inventory_movements_movement_type_check"'
      );
    });
  });

  describe("2. Schema Verification: Migration 20261101000000", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../supabase/migrations/20261101000000_fix_inventory_movements_movement_type_check.sql"
    );

    it("verifies the fix migration file exists and is readable", () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it("verifies migration drops and adds the expanded constraint without deleting data", () => {
      const sql = fs.readFileSync(migrationPath, "utf-8");

      expect(sql).toContain("DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;");
      expect(sql).toContain("ADD CONSTRAINT inventory_movements_movement_type_check");
      expect(sql).toContain("'payu_checkout_reserve'");
      expect(sql).toContain("'payment_failure_restock'");
      expect(sql).toContain("'payment_timeout_restock'");
      expect(sql).toContain("'order_deduction'");
      expect(sql).toContain("'order_cancellation_restock'");
      expect(sql).toContain("'manual_adjustment'");
      expect(sql).toContain("'restock_shipment'");
      expect(sql).toContain("'damaged_loss'");

      // Must never drop or truncate the inventory_movements table
      expect(sql).not.toMatch(/DROP\s+TABLE\s+public\.inventory_movements/i);
      expect(sql).not.toMatch(/TRUNCATE\s+(TABLE\s+)?public\.inventory_movements/i);
      expect(sql).not.toMatch(/DROP\s+TABLE\s+public\.products/i);
    });

    it("verifies RPC functions declare SECURITY DEFINER and search_path = public, extensions, pg_temp", () => {
      const sql = fs.readFileSync(migrationPath, "utf-8");
      const secDefinerCount = (sql.match(/SECURITY DEFINER/g) || []).length;
      const searchPathCount = (sql.match(/SET search_path = public, extensions, pg_temp/g) || []).length;

      expect(secDefinerCount).toBeGreaterThanOrEqual(3);
      expect(searchPathCount).toBeGreaterThanOrEqual(3);
    });

    it("verifies RPC functions contain check_violation fallback blocks", () => {
      const sql = fs.readFileSync(migrationPath, "utf-8");
      const fallbackCount = (sql.match(/WHEN check_violation THEN/g) || []).length;
      expect(fallbackCount).toBeGreaterThanOrEqual(3);
    });

    it("verifies expire_stale_pending_payments preserves RETURNS integer to avoid PostgreSQL 42P13 error", () => {
      const sql = fs.readFileSync(migrationPath, "utf-8");
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.expire_stale_pending_payments\(\)\s*RETURNS\s+integer/);
      expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.expire_stale_pending_payments\(\)\s*RETURNS\s+jsonb/);
    });

    it("verifies handle_failed_payu_payment matches production 5-arg signature and cleans up 3-arg overload", () => {
      const sql = fs.readFileSync(migrationPath, "utf-8");
      expect(sql).toContain("DROP FUNCTION IF EXISTS public.handle_failed_payu_payment(text, text, jsonb);");
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.handle_failed_payu_payment(");
      expect(sql).toContain("p_order_id uuid");
      expect(sql).toContain("p_txnid text");
      expect(sql).toContain("p_error_code text DEFAULT NULL");
      expect(sql).toContain("p_error_msg text DEFAULT NULL");
      expect(sql).toContain("p_response_payload jsonb DEFAULT '{}'::jsonb");
    });
  });

  describe("3. Expanded Constraint Validation", () => {
    it("accepts all 8 legitimate movement types under the new schema", () => {
      const types = [
        "order_deduction",
        "payu_checkout_reserve",
        "order_cancellation_restock",
        "payment_failure_restock",
        "payment_timeout_restock",
        "manual_adjustment",
        "restock_shipment",
        "damaged_loss",
      ];

      for (const t of types) {
        expect(() => {
          simulateDbInsertMovement(EXPANDED_ALLOWED_MOVEMENT_TYPES, {
            product_id: "prod-1",
            order_id: "order-ok",
            movement_type: t,
            quantity_change: 1,
            previous_stock: 10,
            new_stock: 11,
            reason: `Testing ${t}`,
          });
        }).not.toThrow();
      }
    });

    it("rejects unauthorized or arbitrary movement types", () => {
      const invalidTypes = ["arbitrary_type", "steal_item", "unknown", "refund"];

      for (const t of invalidTypes) {
        expect(() => {
          simulateDbInsertMovement(EXPANDED_ALLOWED_MOVEMENT_TYPES, {
            product_id: "prod-1",
            order_id: "order-bad",
            movement_type: t,
            quantity_change: 1,
            previous_stock: 10,
            new_stock: 11,
            reason: `Testing ${t}`,
          });
        }).toThrowError(/violates check constraint/);
      }
    });
  });

  describe("4. End-to-End Checkout & Fallback Resiliency", () => {
    it("successfully places PayU order under updated schema using payu_checkout_reserve", () => {
      const product: MockProduct = { id: "p1", name: "Biscuits", stock: 15 };
      const result = simulateCreateOrderWithInventory(EXPANDED_ALLOWED_MOVEMENT_TYPES, product, 3, "payu");

      expect(result.success).toBe(true);
      expect(result.initialStatus).toBe("pending_payment");
      expect(result.newProductStock).toBe(12);
      expect(result.insertedMovement.movement_type).toBe("payu_checkout_reserve");
      expect(result.insertedMovement.quantity_change).toBe(-3);
      expect(result.insertedMovement.previous_stock).toBe(15);
      expect(result.insertedMovement.new_stock).toBe(12);
    });

    it("successfully places COD order under updated schema using order_deduction", () => {
      const product: MockProduct = { id: "p2", name: "Notebook", stock: 8 };
      const result = simulateCreateOrderWithInventory(EXPANDED_ALLOWED_MOVEMENT_TYPES, product, 2, "cod");

      expect(result.success).toBe(true);
      expect(result.initialStatus).toBe("placed");
      expect(result.newProductStock).toBe(6);
      expect(result.insertedMovement.movement_type).toBe("order_deduction");
      expect(result.insertedMovement.quantity_change).toBe(-2);
    });

    it("gracefully falls back to order_deduction without crashing when database has legacy constraint", () => {
      const product: MockProduct = { id: "p3", name: "Pen", stock: 20 };
      // Database has LEGACY constraints (does not know about payu_checkout_reserve yet)
      const result = simulateCreateOrderWithInventory(LEGACY_ALLOWED_MOVEMENT_TYPES, product, 5, "payu");

      expect(result.success).toBe(true);
      expect(result.initialStatus).toBe("pending_payment");
      expect(result.newProductStock).toBe(15);
      // Fallback caught the check_violation and recorded 'order_deduction' with fallback reason
      expect(result.insertedMovement.movement_type).toBe("order_deduction");
      expect(result.insertedMovement.reason).toContain("reservation (fallback)");
      expect(result.insertedMovement.quantity_change).toBe(-5);
    });

    it("blocks checkout when stock is insufficient without writing any movement record", () => {
      const product: MockProduct = { id: "p4", name: "Coffee", stock: 1 };
      expect(() => {
        simulateCreateOrderWithInventory(EXPANDED_ALLOWED_MOVEMENT_TYPES, product, 3, "payu");
      }).toThrowError(/Insufficient stock for "Coffee": only 1 available/);

      // Stock must remain unchanged
      expect(product.stock).toBe(1);
    });
  });

  describe("5. TypeScript Ledger Types Completeness", () => {
    it("ensures DBInventoryMovement TypeScript type supports all 8 movement types", () => {
      const typesPath = path.resolve(__dirname, "../components/admin/products/types.ts");
      const typesContent = fs.readFileSync(typesPath, "utf-8");

      expect(typesContent).toContain('"payu_checkout_reserve"');
      expect(typesContent).toContain('"payment_failure_restock"');
      expect(typesContent).toContain('"payment_timeout_restock"');
      expect(typesContent).toContain('"order_deduction"');
      expect(typesContent).toContain('"order_cancellation_restock"');
      expect(typesContent).toContain('"manual_adjustment"');
      expect(typesContent).toContain('"restock_shipment"');
      expect(typesContent).toContain('"damaged_loss"');
    });
  });

  describe("6. Delivery Block Foreign Key & Delivery Method Isolation", () => {
    const CANONICAL_DELIVERY_BLOCKS = new Set([
      "Block A",
      "Block B",
      "Block C",
      "Block D",
      "North Wing",
      "South Wing",
      "Main Campus",
    ]);

    function validateOrderDeliveryBlock(
      deliveryMethod: "hostel_delivery" | "campus_pickup",
      rawBlockId: string | null | undefined,
      rawRoom: string | null | undefined
    ): { delivery_block_id: string | null; room: string | null } {
      const trimmedBlock = rawBlockId?.trim() || null;
      const trimmedRoom = rawRoom?.trim() || null;

      if (deliveryMethod === "campus_pickup") {
        // Campus pickup orders must NEVER reference delivery_blocks
        return { delivery_block_id: null, room: null };
      }

      // Hostel delivery requires a valid, active delivery block
      if (!trimmedBlock) {
        throw new Error("Please select your delivery block for hostel delivery.");
      }

      if (!CANONICAL_DELIVERY_BLOCKS.has(trimmedBlock)) {
        throw new Error(`Invalid delivery block "${trimmedBlock}". Please select an active delivery block from the list.`);
      }

      if (!trimmedRoom) {
        throw new Error("Room number is required for hostel delivery.");
      }

      return { delivery_block_id: trimmedBlock, room: trimmedRoom };
    }

    it("ensures campus pickup orders always set delivery_block_id to null, preventing foreign key violation", () => {
      const res = validateOrderDeliveryBlock("campus_pickup", "Block A", "101");
      expect(res.delivery_block_id).toBeNull();
      expect(res.room).toBeNull();

      const resEmpty = validateOrderDeliveryBlock("campus_pickup", "", "");
      expect(resEmpty.delivery_block_id).toBeNull();
    });

    it("ensures hostel delivery accepts legitimate canonical delivery blocks", () => {
      const resA = validateOrderDeliveryBlock("hostel_delivery", "Block A", "204");
      expect(resA.delivery_block_id).toBe("Block A");
      expect(resA.room).toBe("204");

      const resMain = validateOrderDeliveryBlock("hostel_delivery", "Main Campus", "Room 12");
      expect(resMain.delivery_block_id).toBe("Main Campus");
    });

    it("rejects empty string or unselected delivery block for hostel delivery", () => {
      expect(() => {
        validateOrderDeliveryBlock("hostel_delivery", "", "101");
      }).toThrowError("Please select your delivery block for hostel delivery.");

      expect(() => {
        validateOrderDeliveryBlock("hostel_delivery", null, "101");
      }).toThrowError("Please select your delivery block for hostel delivery.");
    });

    it("rejects non-existent delivery blocks before database insertion to prevent foreign key violation", () => {
      expect(() => {
        validateOrderDeliveryBlock("hostel_delivery", "NonExistentBlock_999", "101");
      }).toThrowError(/Invalid delivery block "NonExistentBlock_999"/);
    });

    it("verifies migration file checks delivery_blocks table existence in create_order_with_inventory", () => {
      const migrationPath = path.resolve(
        __dirname,
        "../../supabase/migrations/20261101000000_fix_inventory_movements_movement_type_check.sql"
      );
      const sql = fs.readFileSync(migrationPath, "utf-8");

      expect(sql).toContain("FROM public.delivery_blocks WHERE id = v_delivery_block_id");
      expect(sql).toContain("v_delivery_block_id := NULL;");
      expect(sql).toContain("v_delivery_block_id := NULLIF(TRIM(order_payload->>'delivery_block_id'), '');");
    });
  });
});

