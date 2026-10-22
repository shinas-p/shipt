import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { DBProduct } from "@/components/admin/products/types";

export interface ProductCostRecord {
  product_id: string;
  supplier_cost: number;
  other_costs: number;
  notes?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface ProfitMetrics {
  sellingPrice: number;
  supplierCost: number;
  otherCosts: number;
  totalCost: number;
  estimatedProfit: number;
  profitMarginPct: number;
  markupPct: number;
  isLoss: boolean;
  isBreakeven: boolean;
}

export interface ProductProfitabilityItem {
  productId: string;
  productName: string;
  size: string;
  categoryId: string;
  price: number;
  stock: number;
  isActive: boolean;
  supplierCost: number;
  otherCosts: number;
  totalCost: number;
  estimatedProfit: number;
  profitMarginPct: number;
  markupPct: number;
  inventoryCostValue: number;
  inventoryProfitPotential: number;
  notes: string;
  costUpdatedAt?: string | undefined;
  hasCostData: boolean;
}

/**
 * Calculates profit, profit margin (%), and markup (%) according to financial standards:
 * - Estimated Profit = Selling Price - Supplier Cost - Other Costs
 * - Profit Margin (%) = (Estimated Profit / Selling Price) * 100 [when Selling Price > 0]
 * - Markup (%) = (Estimated Profit / Supplier Cost) * 100 [when Supplier Cost > 0]
 */
export function calculateProfitMetrics(
  sellingPriceInput: number | string | undefined | null,
  supplierCostInput: number | string | undefined | null,
  otherCostsInput: number | string | undefined | null = 0
): ProfitMetrics {
  const sellingPrice = Math.max(0, parseFloat(String(sellingPriceInput ?? 0)) || 0);
  const supplierCost = Math.max(0, parseFloat(String(supplierCostInput ?? 0)) || 0);
  const otherCosts = Math.max(0, parseFloat(String(otherCostsInput ?? 0)) || 0);

  const totalCost = Math.round((supplierCost + otherCosts) * 100) / 100;
  const estimatedProfit = Math.round((sellingPrice - totalCost) * 100) / 100;

  // Profit Margin (%) = profit / selling price
  const profitMarginPct =
    sellingPrice > 0
      ? Math.round((estimatedProfit / sellingPrice) * 10000) / 100
      : 0;

  // Markup (%) = profit / supplier cost
  const markupPct =
    supplierCost > 0
      ? Math.round((estimatedProfit / supplierCost) * 10000) / 100
      : 0;

  const isLoss = estimatedProfit < -0.001;
  const isBreakeven = Math.abs(estimatedProfit) <= 0.001 && totalCost > 0;

  return {
    sellingPrice,
    supplierCost,
    otherCosts,
    totalCost,
    estimatedProfit,
    profitMarginPct,
    markupPct,
    isLoss,
    isBreakeven,
  };
}

/**
 * Validates non-negative numeric cost values.
 */
export function validateCostInput(value: string | number): { valid: boolean; error?: string; value: number } {
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(parsed)) {
    return { valid: false, error: "Cost must be a valid number.", value: 0 };
  }
  if (parsed < 0) {
    return { valid: false, error: "Cost cannot be negative.", value: 0 };
  }
  return { valid: true, value: Math.round(parsed * 100) / 100 };
}

/**
 * Retrieves the private supplier cost for a specific product.
 * Returns null if no cost has been entered or if user lacks admin authorization.
 */
export async function fetchProductCost(productId: string): Promise<ProductCostRecord | null> {
  if (!isSupabaseConfigured || !productId) return null;

  try {
    const { data, error } = await supabase
      .from("product_costs")
      .select("product_id, supplier_cost, other_costs, notes, created_at, updated_at")
      .eq("product_id", productId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      product_id: data.product_id,
      supplier_cost: Number(data.supplier_cost ?? 0),
      other_costs: Number(data.other_costs ?? 0),
      notes: data.notes || "",
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Retrieves all product costs as a dictionary keyed by product_id.
 * Restricted by Supabase RLS to authorized administrators only.
 */
export async function fetchAllProductCosts(): Promise<Record<string, ProductCostRecord>> {
  if (!isSupabaseConfigured) return {};

  try {
    const { data, error } = await supabase
      .from("product_costs")
      .select("product_id, supplier_cost, other_costs, notes, created_at, updated_at");

    if (error || !data) {
      return {};
    }

    const map: Record<string, ProductCostRecord> = {};
    for (const item of data) {
      map[item.product_id] = {
        product_id: item.product_id,
        supplier_cost: Number(item.supplier_cost ?? 0),
        other_costs: Number(item.other_costs ?? 0),
        notes: item.notes || "",
        created_at: item.created_at,
        updated_at: item.updated_at,
      };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Saves or updates a product's supplier cost record.
 * Uses atomic upsert. Server-side RLS and RPC verify admin roles.
 */
export async function saveProductCost(
  productId: string,
  supplierCost: number,
  otherCosts: number = 0,
  notes: string = ""
): Promise<{ success: boolean; data?: ProductCostRecord; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: false, error: "Supabase is not configured." };
  }

  const cleanSupplierCost = Math.max(0, Math.round(supplierCost * 100) / 100);
  const cleanOtherCosts = Math.max(0, Math.round(otherCosts * 100) / 100);

  try {
    // Attempt RPC first for strict server validation
    const { data: rpcData, error: rpcError } = await supabase.rpc("admin_upsert_product_cost", {
      p_product_id: productId,
      p_supplier_cost: cleanSupplierCost,
      p_other_costs: cleanOtherCosts,
      p_notes: notes.trim(),
    });

    if (!rpcError && rpcData) {
      return {
        success: true,
        data: {
          product_id: rpcData.product_id,
          supplier_cost: Number(rpcData.supplier_cost),
          other_costs: Number(rpcData.other_costs),
          notes: rpcData.notes,
          updated_at: rpcData.updated_at,
        },
      };
    }

    // Direct table upsert fallback via RLS
    const payload = {
      product_id: productId,
      supplier_cost: cleanSupplierCost,
      other_costs: cleanOtherCosts,
      notes: notes.trim(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("product_costs")
      .upsert(payload, { onConflict: "product_id" })
      .select("product_id, supplier_cost, other_costs, notes, updated_at")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        product_id: data.product_id,
        supplier_cost: Number(data.supplier_cost),
        other_costs: Number(data.other_costs),
        notes: data.notes || "",
        updated_at: data.updated_at,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to save supplier cost" };
  }
}

/**
 * Combines DB products with cost records to generate comprehensive profitability metrics.
 */
export function buildProductProfitabilityList(
  products: DBProduct[],
  costMap: Record<string, ProductCostRecord>
): ProductProfitabilityItem[] {
  return products.map((p) => {
    const costRecord = costMap[p.id];
    const hasCostData = Boolean(costRecord && costRecord.supplier_cost > 0);
    const supplierCost = costRecord?.supplier_cost ?? 0;
    const otherCosts = costRecord?.other_costs ?? 0;

    const metrics = calculateProfitMetrics(p.price, supplierCost, otherCosts);

    const inventoryCostValue = Math.round(metrics.totalCost * p.stock * 100) / 100;
    const inventoryProfitPotential = Math.round(metrics.estimatedProfit * p.stock * 100) / 100;

    return {
      productId: p.id,
      productName: p.name,
      size: p.size,
      categoryId: p.category_id,
      price: Number(p.price),
      stock: p.stock ?? 0,
      isActive: Boolean(p.is_active),
      supplierCost: metrics.supplierCost,
      otherCosts: metrics.otherCosts,
      totalCost: metrics.totalCost,
      estimatedProfit: metrics.estimatedProfit,
      profitMarginPct: metrics.profitMarginPct,
      markupPct: metrics.markupPct,
      inventoryCostValue,
      inventoryProfitPotential,
      notes: costRecord?.notes || "",
      costUpdatedAt: costRecord?.updated_at,
      hasCostData,
    };
  });
}
