import { useState, useEffect } from "react";
import { Loader2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBProduct } from "./types";

interface QuickEditModalProps {
  product: DBProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => Promise<void>;
}

export function QuickEditModal({
  product,
  open,
  onOpenChange,
  onSuccess,
}: QuickEditModalProps) {
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [stock, setStock] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product) {
      setName(product.name);
      setSize(product.size);
      setPrice(String(product.price));
      setOriginalPrice(product.original_price != null ? String(product.original_price) : "");
      setStock(String(product.stock));
      setIsActive(product.is_active);
      setReason("");
    }
  }, [product]);

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
