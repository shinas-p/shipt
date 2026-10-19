import { useState } from "react";
import {
  AlertTriangle,
  Loader2,
  CheckCircle2,
  X,
  Layers,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/data/products";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBProduct, DBCategory, BulkActionType } from "./types";

interface BulkOperationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operationType: BulkActionType | null;
  selectedProducts: DBProduct[];
  categories: DBCategory[];
  onSuccess: () => Promise<void>;
  onClearSelection: () => void;
}

export function BulkOperationModal({
  open,
  onOpenChange,
  operationType,
  selectedProducts,
  categories,
  onSuccess,
  onClearSelection,
}: BulkOperationModalProps) {
  const [paramValue, setParamValue] = useState<string>("");
  const [targetCategory, setTargetCategory] = useState<string>(
    categories[0]?.id ?? "snacks"
  );
  const [stockReason, setStockReason] = useState<string>("");
  const [executing, setExecuting] = useState(false);

  if (!operationType || selectedProducts.length === 0) return null;

  const count = selectedProducts.length;

  // Determine title and description
  const getOpMeta = () => {
    switch (operationType) {
      case "price_adjust_percent":
        return {
          title: "Bulk Price Adjustment (%)",
          desc: "Adjust selling prices of all selected products by a percentage (+ for markup, - for discount).",
          isDangerous: false,
        };
      case "price_adjust_fixed":
        return {
          title: "Bulk Price Adjustment (₹)",
          desc: "Add or subtract a fixed rupee amount across all selected product prices.",
          isDangerous: false,
        };
      case "price_set_fixed":
        return {
          title: "Set Fixed Price (₹)",
          desc: "Set the exact selling price for all selected products.",
          isDangerous: false,
        };
      case "stock_adjust_add":
        return {
          title: "Bulk Stock Increase (+)",
          desc: "Add stock units to all selected products and log movements in the warehouse ledger.",
          isDangerous: false,
        };
      case "stock_adjust_sub":
        return {
          title: "Bulk Stock Decrease (-)",
          desc: "Deduct stock units from selected products. Negative stock is strictly prevented.",
          isDangerous: false,
        };
      case "stock_set_fixed":
        return {
          title: "Set Absolute Stock Quantity",
          desc: "Set the exact stock level for all selected items and log previous vs new values.",
          isDangerous: false,
        };
      case "category_move":
        return {
          title: "Move Products to Category",
          desc: "Reassign all selected products to a different campus product category.",
          isDangerous: false,
        };
      case "publish":
        return {
          title: "Publish Selected Products",
          desc: "Make all selected products active and visible on the customer storefront.",
          isDangerous: false,
        };
      case "unpublish":
        return {
          title: "Unpublish Selected Products",
          desc: "Hide all selected products from customer browsing and checkout.",
          isDangerous: false,
        };
      case "bestseller_enable":
        return {
          title: "Mark as Bestseller",
          desc: "Add the prominent Bestseller badge to all selected products.",
          isDangerous: false,
        };
      case "bestseller_disable":
        return {
          title: "Remove Bestseller Badge",
          desc: "Remove the Bestseller badge from all selected products.",
          isDangerous: false,
        };
      case "archive":
        return {
          title: "Archive Selected Products",
          desc: "Soft-delete selected items by deactivating them. Safe and preserves all historical order records.",
          isDangerous: true,
        };
      case "restore":
        return {
          title: "Restore Archived Products",
          desc: "Reactivate selected products and restore storefront visibility.",
          isDangerous: false,
        };
      case "delete":
        return {
          title: "Permanently Delete Products",
          desc: "Permanently delete products that have no customer orders. Referenced products will be safely archived instead.",
          isDangerous: true,
        };
    }
  };

  const meta = getOpMeta();

  // Calculate preview and check validation errors
  const previewData = selectedProducts.map((p) => {
    let newPrice = p.price;
    let newStock = p.stock;
    let newCategory = p.category_id;
    let newActive = p.is_active;
    let newBestseller = p.bestseller;
    let error: string | null = null;

    const val = parseFloat(paramValue);

    if (operationType === "price_adjust_percent" && !isNaN(val)) {
      newPrice = Math.max(0, Math.round((p.price * (1 + val / 100)) * 2) / 2);
    } else if (operationType === "price_adjust_fixed" && !isNaN(val)) {
      newPrice = Math.max(0, Math.round((p.price + val) * 2) / 2);
      if (p.price + val < 0) {
        error = "Price cannot drop below ₹0";
      }
    } else if (operationType === "price_set_fixed" && !isNaN(val)) {
      newPrice = Math.max(0, val);
    } else if (operationType === "stock_adjust_add" && !isNaN(val)) {
      const addQty = Math.floor(val);
      if (addQty < 0) error = "Addition quantity must be positive";
      newStock = p.stock + Math.max(0, addQty);
    } else if (operationType === "stock_adjust_sub" && !isNaN(val)) {
      const subQty = Math.floor(val);
      if (subQty < 0) error = "Deduction quantity must be positive";
      if (p.stock - subQty < 0) {
        error = `Insufficient stock: only ${p.stock} available`;
      }
      newStock = Math.max(0, p.stock - subQty);
    } else if (operationType === "stock_set_fixed" && !isNaN(val)) {
      newStock = Math.max(0, Math.floor(val));
    } else if (operationType === "category_move") {
      newCategory = targetCategory;
    } else if (operationType === "publish") {
      newActive = true;
    } else if (operationType === "unpublish" || operationType === "archive") {
      newActive = false;
    } else if (operationType === "restore") {
      newActive = true;
    } else if (operationType === "bestseller_enable") {
      newBestseller = true;
    } else if (operationType === "bestseller_disable") {
      newBestseller = false;
    }

    return {
      product: p,
      newPrice,
      newStock,
      newCategory,
      newActive,
      newBestseller,
      error,
    };
  });

  const hasErrors = previewData.some((d) => d.error !== null);

  const handleExecute = async () => {
    if (hasErrors) {
      toast.error("Please fix the validation errors before executing the bulk operation.");
      return;
    }

    if (
      (operationType === "stock_adjust_add" ||
        operationType === "stock_adjust_sub" ||
        operationType === "stock_set_fixed") &&
      !stockReason.trim()
    ) {
      toast.error("Please provide an adjustment reason for inventory tracking.");
      return;
    }

    setExecuting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const currentUserId = session?.user?.id ?? null;

      if (operationType === "delete") {
        // Safe deletion logic:
        // Check which products are referenced in order_items or inventory_movements
        const productIds = selectedProducts.map((p) => p.id);
        const { data: orderItemRefs } = await supabase
          .from("order_items")
          .select("product_id")
          .in("product_id", productIds);

        const referencedIds = new Set(
          (orderItemRefs || []).map((r: any) => r.product_id).filter(Boolean)
        );

        let deletedCount = 0;
        let archivedCount = 0;

        for (const p of selectedProducts) {
          if (referencedIds.has(p.id)) {
            // Cannot safely hard delete: archive instead to preserve order records
            await supabase
              .from("products")
              .update({ is_active: false })
              .eq("id", p.id);
            archivedCount++;
          } else {
            // Safe to hard delete
            const { error: delErr } = await supabase
              .from("products")
              .delete()
              .eq("id", p.id);
            if (!delErr) deletedCount++;
            else {
              // Fallback to archive if DB restricts
              await supabase
                .from("products")
                .update({ is_active: false })
                .eq("id", p.id);
              archivedCount++;
            }
          }
        }

        if (archivedCount > 0 && deletedCount > 0) {
          toast.success(
            `Safely completed: ${deletedCount} unreferenced products deleted, ${archivedCount} products with order history archived.`
          );
        } else if (archivedCount > 0) {
          toast.info(
            `Selected products are referenced in past orders. Archived ${archivedCount} products to safeguard historical order data.`
          );
        } else {
          toast.success(`Successfully deleted ${deletedCount} products.`);
        }
      } else {
        // Other bulk operations
        for (const row of previewData) {
          const p = row.product;

          if (
            operationType === "price_adjust_percent" ||
            operationType === "price_adjust_fixed" ||
            operationType === "price_set_fixed"
          ) {
            await supabase
              .from("products")
              .update({ price: row.newPrice })
              .eq("id", p.id);
          } else if (
            operationType === "stock_adjust_add" ||
            operationType === "stock_adjust_sub" ||
            operationType === "stock_set_fixed"
          ) {
            const diff = row.newStock - p.stock;
            if (diff !== 0) {
              await supabase
                .from("products")
                .update({ stock: row.newStock })
                .eq("id", p.id);

              await supabase.from("inventory_movements").insert([
                {
                  product_id: p.id,
                  movement_type: "manual_adjustment",
                  quantity_change: diff,
                  previous_stock: p.stock,
                  new_stock: row.newStock,
                  reason:
                    stockReason.trim() ||
                    `Bulk stock adjustment (${diff > 0 ? "+" : ""}${diff})`,
                  performed_by: currentUserId,
                },
              ]);
            }
          } else if (operationType === "category_move") {
            await supabase
              .from("products")
              .update({ category_id: row.newCategory })
              .eq("id", p.id);
          } else if (operationType === "publish" || operationType === "restore") {
            await supabase
              .from("products")
              .update({ is_active: true })
              .eq("id", p.id);
          } else if (operationType === "unpublish" || operationType === "archive") {
            await supabase
              .from("products")
              .update({ is_active: false })
              .eq("id", p.id);
          } else if (
            operationType === "bestseller_enable" ||
            operationType === "bestseller_disable"
          ) {
            await supabase
              .from("products")
              .update({ bestseller: row.newBestseller })
              .eq("id", p.id);
          }
        }

        toast.success(`Bulk operation "${meta.title}" applied to ${count} products.`);
      }

      await onSuccess();
      onClearSelection();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Bulk operation failed: ${err?.message || "Unknown error"}`);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto rounded-3xl p-6 sm:p-8">
        <DialogHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-2">
            {meta.isDangerous ? (
              <ShieldAlert className="size-5 text-destructive" />
            ) : (
              <Layers className="size-5 text-primary" />
            )}
            <DialogTitle className="font-display text-lg font-bold text-foreground">
              {meta.title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            {meta.desc}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Affected items badge */}
          <div className="flex items-center justify-between rounded-2xl border border-border bg-secondary/30 p-3">
            <span className="text-xs font-semibold text-foreground">Affected Products:</span>
            <Badge variant="outline" className="font-mono text-xs font-bold text-primary">
              {count} selected
            </Badge>
          </div>

          {/* Operation Inputs */}
          {(operationType === "price_adjust_percent" ||
            operationType === "price_adjust_fixed" ||
            operationType === "price_set_fixed") && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                {operationType === "price_adjust_percent"
                  ? "Percentage Adjustment (%)"
                  : operationType === "price_adjust_fixed"
                  ? "Rupee Adjustment Amount (₹)"
                  : "Target Selling Price (₹)"}
              </label>
              <input
                type="number"
                step="0.5"
                required
                value={paramValue}
                onChange={(e) => setParamValue(e.target.value)}
                placeholder={
                  operationType === "price_adjust_percent"
                    ? "e.g. 10 for +10% or -15 for 15% discount"
                    : "e.g. 20"
                }
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono outline-none focus:border-primary"
              />
            </div>
          )}

          {(operationType === "stock_adjust_add" ||
            operationType === "stock_adjust_sub" ||
            operationType === "stock_set_fixed") && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  {operationType === "stock_adjust_add"
                    ? "Quantity to Add (Units)"
                    : operationType === "stock_adjust_sub"
                    ? "Quantity to Deduct (Units)"
                    : "New Absolute Stock Quantity"}
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={paramValue}
                  onChange={(e) => setParamValue(e.target.value)}
                  placeholder="e.g. 15"
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Adjustment Reason <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={stockReason}
                  onChange={(e) => setStockReason(e.target.value)}
                  placeholder="e.g. New semester delivery stock check"
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                />
              </div>
            </div>
          )}

          {operationType === "category_move" && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Target Category
              </label>
              <select
                value={targetCategory}
                onChange={(e) => setTargetCategory(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary capitalize"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Real-time Preview Table of Changes */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-foreground">
              Preview of Changes (Showing first 5 items):
            </span>
            <div className="divide-y divide-border/60 rounded-2xl border border-border bg-card overflow-hidden text-xs">
              {previewData.slice(0, 5).map(({ product: p, newPrice, newStock, newCategory, error }) => (
                <div key={p.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">{p.size}</p>
                    {error && <p className="text-[11px] text-destructive font-medium">{error}</p>}
                  </div>

                  <div className="text-right shrink-0">
                    {operationType.startsWith("price") ? (
                      <div className="flex items-center gap-1.5 font-mono">
                        <span className="text-muted-foreground line-through">
                          {formatINR(p.price)}
                        </span>
                        <ArrowRight className="size-3 text-muted-foreground" />
                        <span className="font-bold text-primary">{formatINR(newPrice)}</span>
                      </div>
                    ) : operationType.startsWith("stock") ? (
                      <div className="flex items-center gap-1.5 font-mono">
                        <span className="text-muted-foreground">{p.stock} units</span>
                        <ArrowRight className="size-3 text-muted-foreground" />
                        <span className="font-bold text-primary">{newStock} units</span>
                      </div>
                    ) : operationType === "category_move" ? (
                      <span className="text-primary font-medium">{newCategory}</span>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        {operationType.replace("_", " ")}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {selectedProducts.length > 5 && (
              <p className="text-[11px] text-muted-foreground text-center">
                ...and {selectedProducts.length - 5} more products will be updated.
              </p>
            )}
          </div>

          {meta.isDangerous && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" />
              <span>
                <strong>Data Safety Notice:</strong> Any product linked to existing student orders or checkout records cannot be permanently purged from the database and will be archived instead to maintain order accounting integrity.
              </span>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-9 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={meta.isDangerous ? "destructive" : "hero"}
              size="sm"
              disabled={executing || hasErrors}
              onClick={handleExecute}
              className="h-9 px-4 text-xs font-bold"
            >
              {executing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                `Confirm & Apply to ${count} Products`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
