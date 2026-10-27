import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { DBProduct } from "@/components/admin/products/types";

export interface WholesaleBatchParams {
  costMode?: "batch" | "unit" | undefined;
  batchCost?: number | string | null | undefined;       // Total batch purchase cost (e.g. ₹50)
  packCount?: number | string | null | undefined;       // Number of packs (e.g. 6)
  piecesPerPack?: number | string | null | undefined;   // Pieces per pack (e.g. 10)
  totalPieces?: number | string | null | undefined;     // Total selling pieces (e.g. 60)
  batchOtherCosts?: number | string | null | undefined; // Batch-level additional costs (e.g. freight ₹0)
  unitOtherCosts?: number | string | null | undefined;  // Per-piece additional costs (e.g. pouch ₹0)
}

export interface WholesaleMetrics {
  costMode: "batch" | "unit";
  sellingPrice: number;        // e.g. ₹1.00
  batchCost: number;           // e.g. ₹50.00
  packCount: number;           // e.g. 6 packs
  piecesPerPack: number;       // e.g. 10 pieces per pack
  totalPieces: number;         // e.g. 60 pieces
  batchOtherCosts: number;     // Batch-level additional costs
  unitOtherCosts: number;      // Per-piece additional costs
  totalAdditionalCosts: number;// batchOtherCosts + (unitOtherCosts * totalPieces)
  
  // Per-piece costs & profit (unrounded internally)
  baseUnitCost: number;        // batchCost / totalPieces = 0.8333333333333334
  allocatedBatchOtherPerPiece: number; // batchOtherCosts / totalPieces
  effectiveUnitCost: number;   // baseUnitCost + allocatedBatchOtherPerPiece + unitOtherCosts
  perPieceProfit: number;      // sellingPrice - baseUnitCost (before additional costs)
  perPieceNetProfit: number;   // sellingPrice - effectiveUnitCost (after additional costs)
  
  // Full sell-through metrics
  totalRevenue: number;        // sellingPrice * totalPieces = ₹60.00
  totalGrossProfit: number;    // totalRevenue - batchCost = ₹10.00 (before additional costs)
  totalNetProfit: number;      // totalGrossProfit - totalAdditionalCosts
  
  // Margins
  grossProfitMarginPct: number;// (totalGrossProfit / totalRevenue) * 100 = 16.67%
  netProfitMarginPct: number;  // (totalNetProfit / totalRevenue) * 100
  markupPct: number;           // batchCost > 0 ? (totalGrossProfit / batchCost) * 100 : 0
  
  isLoss: boolean;
  isBreakeven: boolean;
}

export interface PartialSaleMetrics {
  quantitySold: number;
  revenue: number;
  cogs: number; // cost of goods sold based on baseUnitCost
  realizedProfit: number;
  realizedMarginPct: number;
  remainingStock: number;
  remainingCostValue: number;
  unrealizedProfitPotential: number;
}

export interface ProductCostRecord {
  product_id: string;
  supplier_cost: number;
  other_costs: number;
  notes?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;

  // Wholesale batch tracking fields
  cost_mode?: "batch" | "unit" | undefined;
  batch_cost?: number | undefined;
  pack_count?: number | undefined;
  pieces_per_pack?: number | undefined;
  total_pieces?: number | undefined;
  batch_other_costs?: number | undefined;
  unit_other_costs?: number | undefined;
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

  // Extended wholesale batch metrics
  costPerPiece?: number | undefined;
  revenueIfAllStockSells?: number | undefined;
  expectedGrossProfit?: number | undefined;
  wholesale?: WholesaleMetrics | undefined;
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

  // Wholesale details
  costMode?: "batch" | "unit" | undefined;
  batchCost?: number | undefined;
  packCount?: number | undefined;
  piecesPerPack?: number | undefined;
  totalPieces?: number | undefined;
  batchOtherCosts?: number | undefined;
  unitOtherCosts?: number | undefined;
}

const BATCH_TAG_REGEX = /<!--SHIPT_BATCH:(.*?)-->/;

/**
 * Encodes wholesale batch metadata into the notes field so it persists
 * reliably across all Supabase schemas without requiring schema alterations.
 */
export function encodeBatchNotes(notes: string = "", batch?: WholesaleBatchParams | null): string {
  const cleanNotes = (notes || "").replace(BATCH_TAG_REGEX, "").trim();
  if (!batch) return cleanNotes;
  const payload = JSON.stringify({
    costMode: batch.costMode || "batch",
    batchCost: batch.batchCost != null && batch.batchCost !== "" ? Number(batch.batchCost) : undefined,
    packCount: batch.packCount != null && batch.packCount !== "" ? Number(batch.packCount) : undefined,
    piecesPerPack: batch.piecesPerPack != null && batch.piecesPerPack !== "" ? Number(batch.piecesPerPack) : undefined,
    totalPieces: batch.totalPieces != null && batch.totalPieces !== "" ? Number(batch.totalPieces) : undefined,
    batchOtherCosts: batch.batchOtherCosts != null && batch.batchOtherCosts !== "" ? Number(batch.batchOtherCosts) : undefined,
    unitOtherCosts: batch.unitOtherCosts != null && batch.unitOtherCosts !== "" ? Number(batch.unitOtherCosts) : undefined,
  });
  return `<!--SHIPT_BATCH:${payload}-->${cleanNotes ? ` ${cleanNotes}` : ""}`;
}

/**
 * Decodes wholesale batch metadata from the notes field.
 */
export function decodeBatchNotes(notes: string = ""): { cleanNotes: string; batch?: WholesaleBatchParams } {
  if (!notes) return { cleanNotes: "" };
  const match = notes.match(BATCH_TAG_REGEX);
  if (!match || !match[1]) {
    return { cleanNotes: notes.trim() };
  }
  try {
    const parsed = JSON.parse(match[1]);
    const cleanNotes = notes.replace(BATCH_TAG_REGEX, "").trim();
    return { cleanNotes, batch: parsed };
  } catch {
    return { cleanNotes: notes.trim() };
  }
}

/**
 * Calculates wholesale batch procurement, per-piece unit costs, revenue, gross profit,
 * and margin according to real-world wholesale requirements:
 * - Total pieces = number of packs × pieces per pack (or explicit total pieces)
 * - Unit cost = total batch purchase cost ÷ total pieces (unrounded internally)
 * - Total revenue at full stock sell-through = selling price per piece × total pieces
 * - Total gross profit = total revenue − total purchase cost
 * - Per-piece profit = selling price per piece − unit cost
 * - Profit margin = (total gross profit ÷ total revenue) × 100 [when revenue > 0]
 * - Additional expenses correctly segregated between batch-level and per-piece costs.
 */
export function calculateWholesaleMetrics(
  sellingPriceInput: number | string | undefined | null,
  batchParams?: WholesaleBatchParams | null,
  directSupplierCostInput?: number | string | undefined | null,
  directOtherCostsInput?: number | string | undefined | null,
  currentStockInput?: number | string | undefined | null
): WholesaleMetrics {
  const sellingPrice = Math.max(0, parseFloat(String(sellingPriceInput ?? 0)) || 0);
  const costMode = batchParams?.costMode || "batch";

  const packCount = Math.max(0, parseFloat(String(batchParams?.packCount ?? 0)) || 0);
  const piecesPerPack = Math.max(0, parseFloat(String(batchParams?.piecesPerPack ?? 0)) || 0);
  const calculatedPieces = packCount > 0 && piecesPerPack > 0 ? packCount * piecesPerPack : 0;
  const explicitPieces = Math.max(0, parseInt(String(batchParams?.totalPieces ?? 0), 10) || 0);
  const fallbackStock = Math.max(1, parseInt(String(currentStockInput ?? 1), 10) || 1);
  const totalPieces = explicitPieces > 0 ? explicitPieces : (calculatedPieces > 0 ? calculatedPieces : fallbackStock);

  let batchCost = 0;
  let batchOtherCosts = 0;
  let unitOtherCosts = 0;
  let baseUnitCost = 0;

  if (costMode === "batch") {
    batchCost = Math.max(0, parseFloat(String(batchParams?.batchCost ?? 0)) || 0);
    batchOtherCosts = Math.max(0, parseFloat(String(batchParams?.batchOtherCosts ?? 0)) || 0);
    unitOtherCosts = Math.max(0, parseFloat(String(batchParams?.unitOtherCosts ?? 0)) || 0);
    baseUnitCost = totalPieces > 0 ? batchCost / totalPieces : 0;
  } else {
    // Direct Unit Cost Mode (legacy products / single piece procurement)
    baseUnitCost = Math.max(0, parseFloat(String(directSupplierCostInput ?? batchParams?.batchCost ?? 0)) || 0);
    unitOtherCosts = Math.max(0, parseFloat(String(directOtherCostsInput ?? batchParams?.unitOtherCosts ?? 0)) || 0);
    batchOtherCosts = Math.max(0, parseFloat(String(batchParams?.batchOtherCosts ?? 0)) || 0);
    batchCost = baseUnitCost * totalPieces;
  }

  const allocatedBatchOtherPerPiece = totalPieces > 0 ? batchOtherCosts / totalPieces : 0;
  const effectiveUnitCost = baseUnitCost + allocatedBatchOtherPerPiece + unitOtherCosts;
  const totalAdditionalCosts = batchOtherCosts + (unitOtherCosts * totalPieces);

  const totalRevenue = sellingPrice * totalPieces;
  const totalGrossProfit = totalRevenue - batchCost;
  const totalNetProfit = totalGrossProfit - totalAdditionalCosts;

  const perPieceProfit = sellingPrice - baseUnitCost;
  const perPieceNetProfit = sellingPrice - effectiveUnitCost;

  const grossProfitMarginPct = totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0;
  const netProfitMarginPct = totalRevenue > 0 ? (totalNetProfit / totalRevenue) * 100 : 0;
  const markupPct = batchCost > 0 ? (totalGrossProfit / batchCost) * 100 : 0;

  const isLoss = totalNetProfit < -0.001 || perPieceNetProfit < -0.001;
  const isBreakeven = Math.abs(totalNetProfit) <= 0.001 && effectiveUnitCost > 0;

  return {
    costMode,
    sellingPrice,
    batchCost,
    packCount,
    piecesPerPack,
    totalPieces,
    batchOtherCosts,
    unitOtherCosts,
    totalAdditionalCosts,
    baseUnitCost,
    allocatedBatchOtherPerPiece,
    effectiveUnitCost,
    perPieceProfit,
    perPieceNetProfit,
    totalRevenue,
    totalGrossProfit,
    totalNetProfit,
    grossProfitMarginPct,
    netProfitMarginPct,
    markupPct,
    isLoss,
    isBreakeven,
  };
}

/**
 * Calculates financial metrics for partial sales (e.g. selling 20 pieces out of 60):
 * - Revenue from quantity sold
 * - Cost of goods sold (COGS) without premature rounding
 * - Realized gross profit
 * - Remaining warehouse inventory cost value and unrealized profit potential
 */
export function calculatePartialSaleMetrics(
  wholesale: WholesaleMetrics,
  quantitySold: number,
  currentStock?: number
): PartialSaleMetrics {
  const stock = currentStock !== undefined ? currentStock : wholesale.totalPieces;
  const qty = Math.max(0, Math.min(stock, quantitySold));
  const revenue = Math.round(qty * wholesale.sellingPrice * 100) / 100;
  const cogs = Math.round(qty * wholesale.baseUnitCost * 100) / 100;
  const realizedProfit = Math.round((revenue - cogs) * 100) / 100;
  const realizedMarginPct = revenue > 0 ? Math.round((realizedProfit / revenue) * 10000) / 100 : 0;

  const remainingStock = Math.max(0, stock - qty);
  const remainingCostValue = Math.round(remainingStock * wholesale.baseUnitCost * 100) / 100;
  const unrealizedProfitPotential = Math.round(remainingStock * wholesale.perPieceProfit * 100) / 100;

  return {
    quantitySold: qty,
    revenue,
    cogs,
    realizedProfit,
    realizedMarginPct,
    remainingStock,
    remainingCostValue,
    unrealizedProfitPotential,
  };
}

/**
 * Calculates profit, profit margin (%), and markup (%) according to financial standards.
 * Fully backward-compatible with legacy unit-cost signatures while supporting extended
 * wholesale batch metrics.
 */
export function calculateProfitMetrics(
  sellingPriceInput: number | string | undefined | null,
  supplierCostInput: number | string | undefined | null,
  otherCostsInput: number | string | undefined | null = 0,
  batchParams?: WholesaleBatchParams | null,
  stockInput?: number | string | undefined | null
): ProfitMetrics {
  if (batchParams && batchParams.batchCost != null && Number(batchParams.batchCost) > 0) {
    const wholesale = calculateWholesaleMetrics(
      sellingPriceInput,
      batchParams,
      supplierCostInput,
      otherCostsInput,
      stockInput
    );

    return {
      sellingPrice: wholesale.sellingPrice,
      supplierCost: Math.round(wholesale.baseUnitCost * 100) / 100,
      otherCosts: Math.round((wholesale.allocatedBatchOtherPerPiece + wholesale.unitOtherCosts) * 100) / 100,
      totalCost: Math.round(wholesale.effectiveUnitCost * 100) / 100,
      estimatedProfit: Math.round(wholesale.perPieceProfit * 100) / 100,
      profitMarginPct: Math.round(wholesale.grossProfitMarginPct * 100) / 100,
      markupPct: Math.round(wholesale.markupPct * 100) / 100,
      isLoss: wholesale.isLoss,
      isBreakeven: wholesale.isBreakeven,
      costPerPiece: wholesale.baseUnitCost,
      revenueIfAllStockSells: wholesale.totalRevenue,
      expectedGrossProfit: wholesale.totalGrossProfit,
      wholesale,
    };
  }

  const sellingPrice = Math.max(0, parseFloat(String(sellingPriceInput ?? 0)) || 0);
  const supplierCost = Math.max(0, parseFloat(String(supplierCostInput ?? 0)) || 0);
  const otherCosts = Math.max(0, parseFloat(String(otherCostsInput ?? 0)) || 0);

  const totalCost = Math.round((supplierCost + otherCosts) * 100) / 100;
  const estimatedProfit = Math.round((sellingPrice - totalCost) * 100) / 100;

  const profitMarginPct =
    sellingPrice > 0
      ? Math.round((estimatedProfit / sellingPrice) * 10000) / 100
      : 0;

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
    costPerPiece: supplierCost,
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
      .select("*")
      .eq("product_id", productId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const { cleanNotes, batch } = decodeBatchNotes(data.notes || "");

    return {
      product_id: data.product_id,
      supplier_cost: Number(data.supplier_cost ?? 0),
      other_costs: Number(data.other_costs ?? 0),
      notes: cleanNotes,
      created_at: data.created_at,
      updated_at: data.updated_at,
      cost_mode: (data as any).cost_mode || batch?.costMode || (batch?.batchCost ? "batch" : "unit"),
      batch_cost: (data as any).batch_cost != null ? Number((data as any).batch_cost) : (batch?.batchCost != null ? Number(batch.batchCost) : undefined),
      pack_count: (data as any).pack_count != null ? Number((data as any).pack_count) : (batch?.packCount != null ? Number(batch.packCount) : undefined),
      pieces_per_pack: (data as any).pieces_per_pack != null ? Number((data as any).pieces_per_pack) : (batch?.piecesPerPack != null ? Number(batch.piecesPerPack) : undefined),
      total_pieces: (data as any).total_pieces != null ? Number((data as any).total_pieces) : (batch?.totalPieces != null ? Number(batch.totalPieces) : undefined),
      batch_other_costs: (data as any).batch_other_costs != null ? Number((data as any).batch_other_costs) : (batch?.batchOtherCosts != null ? Number(batch.batchOtherCosts) : 0),
      unit_other_costs: (data as any).unit_other_costs != null ? Number((data as any).unit_other_costs) : (batch?.unitOtherCosts != null ? Number(batch.unitOtherCosts) : 0),
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
      .select("*");

    if (error || !data) {
      return {};
    }

    const map: Record<string, ProductCostRecord> = {};
    for (const item of data) {
      const { cleanNotes, batch } = decodeBatchNotes(item.notes || "");

      map[item.product_id] = {
        product_id: item.product_id,
        supplier_cost: Number(item.supplier_cost ?? 0),
        other_costs: Number(item.other_costs ?? 0),
        notes: cleanNotes,
        created_at: item.created_at,
        updated_at: item.updated_at,
        cost_mode: (item as any).cost_mode || batch?.costMode || (batch?.batchCost ? "batch" : "unit"),
        batch_cost: (item as any).batch_cost != null ? Number((item as any).batch_cost) : (batch?.batchCost != null ? Number(batch.batchCost) : undefined),
        pack_count: (item as any).pack_count != null ? Number((item as any).pack_count) : (batch?.packCount != null ? Number(batch.packCount) : undefined),
        pieces_per_pack: (item as any).pieces_per_pack != null ? Number((item as any).pieces_per_pack) : (batch?.piecesPerPack != null ? Number(batch.piecesPerPack) : undefined),
        total_pieces: (item as any).total_pieces != null ? Number((item as any).total_pieces) : (batch?.totalPieces != null ? Number(batch.totalPieces) : undefined),
        batch_other_costs: (item as any).batch_other_costs != null ? Number((item as any).batch_other_costs) : (batch?.batchOtherCosts != null ? Number(batch.batchOtherCosts) : 0),
        unit_other_costs: (item as any).unit_other_costs != null ? Number((item as any).unit_other_costs) : (batch?.unitOtherCosts != null ? Number(batch.unitOtherCosts) : 0),
      };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Saves or updates a product's supplier cost record.
 * Calculates per-piece unit cost accurately for database persistence,
 * while preserving wholesale batch metadata.
 */
export async function saveProductCost(
  productId: string,
  supplierCost: number,
  otherCosts: number = 0,
  notes: string = "",
  batchInput?: WholesaleBatchParams | null
): Promise<{ success: boolean; data?: ProductCostRecord; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: false, error: "Supabase is not configured." };
  }

  let cleanSupplierCost = Math.max(0, Math.round(supplierCost * 100) / 100);
  let cleanOtherCosts = Math.max(0, Math.round(otherCosts * 100) / 100);
  let finalNotes = notes.trim();

  // If wholesale batch input is provided, calculate unit cost accurately
  if (batchInput && (batchInput.costMode === "batch" || (batchInput.batchCost != null && Number(batchInput.batchCost) > 0))) {
    const wholesale = calculateWholesaleMetrics(0, batchInput, supplierCost, otherCosts);
    cleanSupplierCost = Math.max(0, Math.round(wholesale.baseUnitCost * 100) / 100);
    cleanOtherCosts = Math.max(0, Math.round((wholesale.allocatedBatchOtherPerPiece + wholesale.unitOtherCosts) * 100) / 100);
    finalNotes = encodeBatchNotes(notes, batchInput);
  }

  try {
    // Attempt standard RPC first
    const { data: rpcData, error: rpcError } = await supabase.rpc("admin_upsert_product_cost", {
      p_product_id: productId,
      p_supplier_cost: cleanSupplierCost,
      p_other_costs: cleanOtherCosts,
      p_notes: finalNotes,
    });

    if (!rpcError && rpcData) {
      const { cleanNotes, batch } = decodeBatchNotes(rpcData.notes || "");
      return {
        success: true,
        data: {
          product_id: rpcData.product_id,
          supplier_cost: Number(rpcData.supplier_cost),
          other_costs: Number(rpcData.other_costs),
          notes: cleanNotes,
          updated_at: rpcData.updated_at,
          cost_mode: (rpcData as any).cost_mode || batch?.costMode || batchInput?.costMode,
          batch_cost: (rpcData as any).batch_cost != null ? Number((rpcData as any).batch_cost) : (batch?.batchCost != null ? Number(batch.batchCost) : undefined),
          pack_count: (rpcData as any).pack_count != null ? Number((rpcData as any).pack_count) : (batch?.packCount != null ? Number(batch.packCount) : undefined),
          pieces_per_pack: (rpcData as any).pieces_per_pack != null ? Number((rpcData as any).pieces_per_pack) : (batch?.piecesPerPack != null ? Number(batch.piecesPerPack) : undefined),
          total_pieces: (rpcData as any).total_pieces != null ? Number((rpcData as any).total_pieces) : (batch?.totalPieces != null ? Number(batch.totalPieces) : undefined),
          batch_other_costs: (rpcData as any).batch_other_costs != null ? Number((rpcData as any).batch_other_costs) : (batch?.batchOtherCosts != null ? Number(batch.batchOtherCosts) : 0),
          unit_other_costs: (rpcData as any).unit_other_costs != null ? Number((rpcData as any).unit_other_costs) : (batch?.unitOtherCosts != null ? Number(batch.unitOtherCosts) : 0),
        },
      };
    }

    // Direct table upsert fallback via RLS
    const payload: any = {
      product_id: productId,
      supplier_cost: cleanSupplierCost,
      other_costs: cleanOtherCosts,
      notes: finalNotes,
      updated_at: new Date().toISOString(),
    };

    if (batchInput) {
      if (batchInput.costMode) payload.cost_mode = batchInput.costMode;
      if (batchInput.batchCost != null) payload.batch_cost = Number(batchInput.batchCost);
      if (batchInput.packCount != null) payload.pack_count = Number(batchInput.packCount);
      if (batchInput.piecesPerPack != null) payload.pieces_per_pack = Number(batchInput.piecesPerPack);
      if (batchInput.totalPieces != null) payload.total_pieces = Number(batchInput.totalPieces);
      if (batchInput.batchOtherCosts != null) payload.batch_other_costs = Number(batchInput.batchOtherCosts);
      if (batchInput.unitOtherCosts != null) payload.unit_other_costs = Number(batchInput.unitOtherCosts);
    }

    let result = await supabase
      .from("product_costs")
      .upsert(payload, { onConflict: "product_id" })
      .select("*")
      .single();

    // If explicit columns failed (e.g. migration not yet run), retry with core columns
    if (result.error && (result.error.code === "42703" || result.error.message?.includes("column"))) {
      const corePayload = {
        product_id: productId,
        supplier_cost: cleanSupplierCost,
        other_costs: cleanOtherCosts,
        notes: finalNotes,
        updated_at: new Date().toISOString(),
      };
      result = await supabase
        .from("product_costs")
        .upsert(corePayload, { onConflict: "product_id" })
        .select("*")
        .single();
    }

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    const { cleanNotes, batch } = decodeBatchNotes(result.data.notes || "");
    return {
      success: true,
      data: {
        product_id: result.data.product_id,
        supplier_cost: Number(result.data.supplier_cost),
        other_costs: Number(result.data.other_costs),
        notes: cleanNotes,
        updated_at: result.data.updated_at,
        cost_mode: (result.data as any).cost_mode || batch?.costMode || batchInput?.costMode,
        batch_cost: (result.data as any).batch_cost != null ? Number((result.data as any).batch_cost) : (batch?.batchCost != null ? Number(batch.batchCost) : undefined),
        pack_count: (result.data as any).pack_count != null ? Number((result.data as any).pack_count) : (batch?.packCount != null ? Number(batch.packCount) : undefined),
        pieces_per_pack: (result.data as any).pieces_per_pack != null ? Number((result.data as any).pieces_per_pack) : (batch?.piecesPerPack != null ? Number(batch.piecesPerPack) : undefined),
        total_pieces: (result.data as any).total_pieces != null ? Number((result.data as any).total_pieces) : (batch?.totalPieces != null ? Number(batch.totalPieces) : undefined),
        batch_other_costs: (result.data as any).batch_other_costs != null ? Number((result.data as any).batch_other_costs) : (batch?.batchOtherCosts != null ? Number(batch.batchOtherCosts) : 0),
        unit_other_costs: (result.data as any).unit_other_costs != null ? Number((result.data as any).unit_other_costs) : (batch?.unitOtherCosts != null ? Number(batch.unitOtherCosts) : 0),
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to save supplier cost" };
  }
}

/**
 * Combines DB products with cost records to generate comprehensive profitability metrics.
 * Accurately supports both wholesale batches and legacy direct unit costs.
 */
export function buildProductProfitabilityList(
  products: DBProduct[],
  costMap: Record<string, ProductCostRecord>
): ProductProfitabilityItem[] {
  return products.map((p) => {
    const costRecord = costMap[p.id];
    const isBatchMode = costRecord?.cost_mode === "batch" || (costRecord?.batch_cost != null && costRecord.batch_cost > 0);
    const hasCostData = Boolean(costRecord && ((costRecord.supplier_cost ?? 0) > 0 || (costRecord.batch_cost ?? 0) > 0));

    if (isBatchMode && (costRecord?.batch_cost ?? 0) > 0) {
      const wholesale = calculateWholesaleMetrics(
        p.price,
        {
          costMode: "batch",
          batchCost: costRecord?.batch_cost,
          packCount: costRecord?.pack_count,
          piecesPerPack: costRecord?.pieces_per_pack,
          totalPieces: costRecord?.total_pieces || p.stock,
          batchOtherCosts: costRecord?.batch_other_costs,
          unitOtherCosts: costRecord?.unit_other_costs,
        },
        costRecord?.supplier_cost,
        costRecord?.other_costs,
        p.stock
      );

      const inventoryCostValue = Math.round(wholesale.baseUnitCost * p.stock * 100) / 100;
      const inventoryProfitPotential = Math.round(wholesale.perPieceProfit * p.stock * 100) / 100;

      return {
        productId: p.id,
        productName: p.name,
        size: p.size,
        categoryId: p.category_id,
        price: Number(p.price),
        stock: p.stock ?? 0,
        isActive: Boolean(p.is_active),
        supplierCost: Math.round(wholesale.baseUnitCost * 100) / 100,
        otherCosts: Math.round((wholesale.allocatedBatchOtherPerPiece + wholesale.unitOtherCosts) * 100) / 100,
        totalCost: Math.round(wholesale.effectiveUnitCost * 100) / 100,
        estimatedProfit: Math.round(wholesale.perPieceProfit * 100) / 100,
        profitMarginPct: Math.round(wholesale.grossProfitMarginPct * 100) / 100,
        markupPct: Math.round(wholesale.markupPct * 100) / 100,
        inventoryCostValue,
        inventoryProfitPotential,
        notes: costRecord?.notes || "",
        costUpdatedAt: costRecord?.updated_at,
        hasCostData,
        costMode: "batch",
        batchCost: costRecord?.batch_cost,
        packCount: costRecord?.pack_count,
        piecesPerPack: costRecord?.pieces_per_pack,
        totalPieces: costRecord?.total_pieces,
        batchOtherCosts: costRecord?.batch_other_costs,
        unitOtherCosts: costRecord?.unit_other_costs,
      };
    }

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
      costMode: "unit",
    };
  });
}

