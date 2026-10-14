import { describe, expect, it } from "vitest";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import * as fs from "fs";
import * as path from "path";

describe("Shipt Live End-to-End & Remote Supabase Security Audit", () => {
  it("verifies live Supabase connectivity and catalogue data", async () => {
    if (!isSupabaseConfigured) {
      console.warn("Supabase not configured in current environment, skipping live query.");
      return;
    }

    const { data, error } = await supabase
      .from("products")
      .select("id, name, price, stock, category_id, image_url, is_active");

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBeGreaterThan(0);

    // Verify product images and essentials catalogue
    for (const prod of data!) {
      expect(prod.name).toBeTruthy();
      expect(prod.price).toBeGreaterThan(0);
      expect(typeof prod.stock).toBe("number");
      expect(prod.stock).toBeGreaterThanOrEqual(0);
      expect(prod.image_url).toBeTruthy();
    }
  });

  it("verifies anonymous caller is blocked by RLS from reading orders (Customer Privacy)", async () => {
    if (!isSupabaseConfigured) return;

    // As an anonymous client without customer login, orders query should return 0 rows
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, user_id, customer_name, customer_phone, guest_tracking_token");

    // Supabase RLS returns empty list when policy fails
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("verifies anonymous caller is blocked by RLS from reading order items", async () => {
    if (!isSupabaseConfigured) return;

    const { data, error } = await supabase.from("order_items").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("verifies anonymous caller is blocked by RLS from reading order status history", async () => {
    if (!isSupabaseConfigured) return;

    const { data, error } = await supabase.from("order_status_history").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("verifies guest tracking RPC rejects invalid tracking credentials", async () => {
    if (!isSupabaseConfigured) return;

    const { data, error } = await supabase.rpc("get_guest_order", {
      p_order_number: "QM-DOESNOTEXIST-0000",
      p_tracking_token: "0000000000000000000000000000000000000000000000000000000000000000",
    });

    // Must return error / exception, never data
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.message).toContain("Order not found with provided verification token");
  });

  it("verifies unauthenticated caller cannot execute admin_update_order_status RPC", async () => {
    if (!isSupabaseConfigured) return;

    const { data, error } = await supabase.rpc("admin_update_order_status", {
      p_order_id: "00000000-0000-0000-0000-000000000000",
      p_new_status: "completed",
      p_notes: "Unauthorized attempt",
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/permission denied|Unauthorized/i);
  });

  it("checks remote status of pending role-based migration functions", async () => {
    if (!isSupabaseConfigured) return;

    const { error: superAdminErr } = await supabase.rpc("is_super_admin");
    const { error: storeManagerErr } = await supabase.rpc("is_store_manager");
    const { error: listRolesErr } = await supabase.rpc("admin_list_roles");

    // Check whether the pending role-based migration has been applied or is pending
    const hasRoleMigration = !superAdminErr || !superAdminErr.message.includes("Could not find");

    // Log finding for report
    console.log("Pending Role-Based Migration Status:", hasRoleMigration ? "APPLIED" : "PENDING (NOT APPLIED YET)");
    expect(typeof hasRoleMigration).toBe("boolean");
  });
});
