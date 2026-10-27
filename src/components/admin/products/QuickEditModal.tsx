import { useState, useEffect } from "react";
import { Loader2, Check, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/data/products";
import { calculateProfitMetrics, fetchProductCost, saveProductCost } from "@/lib/profitability";
import { canManageCosts, type AdminRole } from "@/lib/permissions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBProduct } from "./types";

interface QuickEditModalProps {
  product: DBProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminRole?: AdminRole | null;
  onSuccess: () => Promise<void>;
}

export function QuickEditModal({
  product,
  open,
  onOpenChange,
  adminRole,
  onSuccess,
}: QuickEditModalProps) {
  const canSeeCosts = adminRole === undefined ? true : canManageCosts(adminRole);
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [stock, setStock] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Private Supplier Cost state
  const [supplierCost, setSupplierCost] = useState("");
  const [otherCosts, setOtherCosts] = useState("");
  const [loadingCost, setLoadingCost] = useState(false);

  useEffect(() => {
    if (product) {
      setName(product.name);
      setSize(product.size);
      setPrice(String(product.price));
      setOriginalPrice(product.original_price != null ? String(product.original_price) : "");
      setStock(String(product.stock));
      setIsActive(product.is_active);
      setReason("");

      // Fetch private supplier cost (Super Admin & Owner only)
      if (canSeeCosts) {
        setLoadingCost(true);
        fetchProductCost(product.id)
          .then((c) => {
            if (c) {
              setSupplierCost(c.supplier_cost > 0 ? String(c.supplier_cost) : "");
              setOtherCosts(c.other_costs > 0 ? String(c.other_costs) : "");
            } else {
              setSupplierCost("");
              setOtherCosts("");
            }
          })
          .catch(() => {
            setSupplierCost("");
            setOtherCosts("");
          })
          .finally(() => setLoadingCost(false));
      }
    }
  }, [product]);

  const profitMetrics = calculateProfitMetrics(price, supplierCost, otherCosts);

  if (!product) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const priceNum = parseFloat(price);
    const stockNum = parseInt(stock, 10);
    const origPriceNum = originalPrice.trim() ? parseFloat(originalPrice) : null;

    if (isNaN(priceNum) || priceNum < 0) {
      toast.error("Price must be a non-negative number.");
      return;
    }

    if (isNaN(stockNum) || stockNum < 0) {
      toast.error("Stock must be a non-negative integer.");
      return;
    }

    if (origPriceNum !== null && (isNaN(origPriceNum) || origPriceNum < priceNum)) {
      toast.error("Original price must be greater than or equal to selling price.");
      return;
    }

    const supplierCostNum = supplierCost.trim() ? parseFloat(supplierCost) : 0;
    if (supplierCost.trim() && (isNaN(supplierCostNum) || supplierCostNum < 0)) {
      toast.error("Supplier cost must be a non-negative number.");
      return;
    }

    const otherCostsNum = otherCosts.trim() ? parseFloat(otherCosts) : 0;
    if (otherCosts.trim() && (isNaN(otherCostsNum) || otherCostsNum < 0)) {
      toast.error("Other costs must be a non-negative number.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("products")
        .update({
          name: name.trim(),
          size: size.trim(),
          price: priceNum,
          original_price: origPriceNum,
          stock: stockNum,
          is_active: isActive,
        })
        .eq("id", product.id);

      if (error) {
        toast.error(`Update failed: ${error.message}`);
        setSaving(false);
        return;
      }

      // If stock changed, record movement in ledger
      if (stockNum !== product.stock) {
        const diff = stockNum - product.stock;
        const { data: { session } } = await supabase.auth.getSession();
        await supabase.from("inventory_movements").insert([
          {
            product_id: product.id,
            movement_type: "manual_adjustment",
            quantity_change: diff,
            previous_stock: product.stock,
            new_stock: stockNum,
            reason: reason.trim() || `Quick edit stock update (${diff > 0 ? "+" : ""}${diff})`,
            performed_by: session?.user?.id ?? null,
          },
        ]);
      }

      // Save supplier cost (Super Admin & Owner only)
      if (canSeeCosts && (supplierCost.trim() || otherCosts.trim())) {
        const cleanSupplier = Math.max(0, supplierCostNum);
        const cleanOther = Math.max(0, otherCostsNum);
        await saveProductCost(product.id, cleanSupplier, cleanOther);
      }

      toast.success(`Quick update saved for "${name}"!`);
      await onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Error: ${err?.message || "Failed to save changes"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold text-foreground">
            Quick Edit: {product.name}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Quickly adjust core pricing, stock level, or availability without leaving the table.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-3 space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">Product Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">Size / Unit</label>
            <input
              type="text"
              required
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="h-9 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Price (₹)</label>
              <input
                type="number"
                min="0"
                step="0.5"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="h-9 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono font-bold outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Original Price (₹)
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={originalPrice}
                onChange={(e) => setOriginalPrice(e.target.value)}
                placeholder="Optional"
                className="h-9 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">Stock Units</label>
            <input
              type="number"
              min="0"
              required
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className="h-9 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono outline-none focus:border-primary"
            />
          </div>

          {parseInt(stock, 10) !== product.stock && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                Adjustment Reason (Required for Stock Changes)
              </label>
              <input
                type="text"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Warehouse count reconciliation / shipment received"
                className="h-9 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
              />
            </div>
          )}

          {/* PRIVATE SUPPLIER COST (SUPER ADMIN & OWNER ONLY) */}
          {canSeeCosts && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                  <Lock className="size-3.5 text-emerald-600" />
                  <span>Supplier Cost (Private)</span>
                </div>
                {loadingCost && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                    Supplier Cost (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={supplierCost}
                    onChange={(e) => setSupplierCost(e.target.value)}
                    placeholder="e.g. 40"
                    className="h-8 w-full rounded-xl border border-input bg-card px-2.5 text-xs font-mono font-bold outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                    Other Costs (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={otherCosts}
                    onChange={(e) => setOtherCosts(e.target.value)}
                    placeholder="Optional"
                    className="h-8 w-full rounded-xl border border-input bg-card px-2.5 text-xs font-mono outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="space-y-1.5 rounded-lg bg-background/80 p-2 text-[11px] font-mono border border-border/60">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Cost per piece:</span>
                  <span className="font-bold text-foreground">
                    {formatINR(parseFloat(profitMetrics.supplierCost.toFixed(2)))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Revenue if all stock sells:</span>
                  <span className="font-bold text-foreground">
                    {formatINR((parseFloat(price) || 0) * (parseInt(stock, 10) || 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Expected gross profit:</span>
                  <span className={cn("font-bold", profitMetrics.isLoss ? "text-rose-600" : "text-emerald-600")}>
                    {formatINR(profitMetrics.estimatedProfit * (parseInt(stock, 10) || 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border/40 pt-1">
                  <span className="text-muted-foreground">Est. Profit / Margin:</span>
                  <span className={cn("font-bold", profitMetrics.isLoss ? "text-rose-600" : "text-emerald-600")}>
                    {formatINR(profitMetrics.estimatedProfit)} ({profitMetrics.profitMarginPct.toFixed(1)}% margin)
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="quick-active"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-4 rounded text-primary"
            />
            <label htmlFor="quick-active" className="text-xs font-semibold text-foreground">
              Active on Storefront
            </label>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              size="sm"
              disabled={saving}
              className="h-8 gap-1.5 text-xs font-bold px-4"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              <span>Save</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
