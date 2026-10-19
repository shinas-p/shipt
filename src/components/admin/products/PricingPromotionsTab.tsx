import { useState } from "react";
import {
  Tag,
  Percent,
  TrendingDown,
  DollarSign,
  ArrowRight,
  Sparkles,
  Edit3,
  Check,
  Loader2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/data/products";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBProduct, DBCategory } from "./types";

interface PricingPromotionsTabProps {
  products: DBProduct[];
  categories: DBCategory[];
  onRefreshProducts: () => Promise<void>;
  onOpenQuickEdit: (p: DBProduct) => void;
}

export function PricingPromotionsTab({
  products,
  categories,
  onRefreshProducts,
  onOpenQuickEdit,
}: PricingPromotionsTabProps) {
  // Bulk discount tool state
  const [selectedCat, setSelectedCat] = useState<string>("all");
  const [discountPercent, setDiscountPercent] = useState<string>("10");
  const [applyingBulkDiscount, setApplyingBulkDiscount] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // Products currently on discount
  const discountedProducts = products.filter(
    (p) => p.original_price != null && p.original_price > p.price
  );

  // Products without discount
  const nonDiscountedProducts = products.filter(
    (p) => p.original_price == null || p.original_price <= p.price
  );

  // Calculate potential target products for the bulk discount tool
  const targetProducts = products.filter((p) => {
    if (selectedCat !== "all" && p.category_id !== selectedCat) return false;
    return true;
  });

  const discVal = parseFloat(discountPercent);

  const handleApplyBulkDiscount = async () => {
    if (isNaN(discVal) || discVal <= 0 || discVal >= 100) {
      toast.error("Please enter a valid discount percentage between 1% and 99%.");
      return;
    }

    setApplyingBulkDiscount(true);
    try {
      let updatedCount = 0;
      for (const p of targetProducts) {
        // Set original price to either current original_price or existing price
        const baseOriginal = p.original_price && p.original_price > p.price ? p.original_price : p.price;
        const newSalePrice = Math.max(1, Math.round((baseOriginal * (1 - discVal / 100)) * 2) / 2);

        const { error } = await supabase
          .from("products")
          .update({
            original_price: baseOriginal,
            price: newSalePrice,
          })
          .eq("id", p.id);

        if (!error) updatedCount++;
      }

      toast.success(`Applied ${discVal}% promotional discount across ${updatedCount} products!`);
      setConfirmModalOpen(false);
      await onRefreshProducts();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    } finally {
      setApplyingBulkDiscount(false);
    }
  };

  const handleClearDiscount = async (p: DBProduct) => {
    if (!p.original_price) return;
    try {
      const { error } = await supabase
        .from("products")
        .update({
          price: p.original_price,
          original_price: null,
        })
        .eq("id", p.id);

      if (error) {
        toast.error(`Failed to clear discount: ${error.message}`);
        return;
      }

      toast.success(`Cleared promotion for "${p.name}". Restored price to ${formatINR(p.original_price)}.`);
      await onRefreshProducts();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              On Sale / Discounted
            </span>
            <Tag className="size-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold text-emerald-600">
            {discountedProducts.length}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {Math.round((discountedProducts.length / (products.length || 1)) * 100)}% of total catalogue
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Standard Pricing
            </span>
            <DollarSign className="size-4 text-primary" />
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold text-foreground">
            {nonDiscountedProducts.length}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Selling at regular price</p>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Average Discount
            </span>
            <Percent className="size-4 text-lime-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold text-foreground">
            {discountedProducts.length > 0
              ? `${Math.round(
                  discountedProducts.reduce(
                    (sum, p) => sum + (1 - p.price / (p.original_price || p.price)) * 100,
                    0
                  ) / discountedProducts.length
                )}%`
              : "0%"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">On promotional items</p>
        </div>
      </div>

      {/* Bulk Promotion Campaign Tool */}
      <div className="rounded-3xl border border-primary/20 bg-primary/5 p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="flex items-center gap-2 text-primary font-bold">
          <Sparkles className="size-5" />
          <h3 className="font-display text-base text-foreground">
            Launch Category Promotion Campaign
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Apply a promotional discount percentage across an entire department. Original prices are safely preserved as compare-at prices.
        </p>

        <div className="grid gap-3 sm:grid-cols-3 pt-1">
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">
              Target Category
            </label>
            <select
              value={selectedCat}
              onChange={(e) => setSelectedCat(e.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary capitalize"
            >
              <option value="all">All Store Departments ({products.length} products)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">
              Discount Percentage (%)
            </label>
            <input
              type="number"
              min="1"
              max="90"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              placeholder="15"
              className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono outline-none focus:border-primary"
            />
          </div>

          <div className="flex items-end">
            <Button
              type="button"
              variant="hero"
              onClick={() => setConfirmModalOpen(true)}
              className="h-10 w-full text-xs font-bold gap-1.5"
            >
              <span>Preview & Apply ({targetProducts.length} items)</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Discounted Products Management Table */}
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-foreground">
              Active Storefront Promotions ({discountedProducts.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Items with compare-at pricing showing savings badges to campus shoppers.
            </p>
          </div>
        </div>

        {discountedProducts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
            No products are currently discounted. Use the promotional tool above or quick edit to add compare-at prices.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="p-3 font-semibold">Product</th>
                  <th className="p-3 font-semibold">Category</th>
                  <th className="p-3 font-semibold">Original Price</th>
                  <th className="p-3 font-semibold">Sale Price</th>
                  <th className="p-3 font-semibold">Discount</th>
                  <th className="p-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {discountedProducts.map((p) => {
                  const discountPct = Math.round((1 - p.price / (p.original_price || p.price)) * 100);
                  const savings = (p.original_price || p.price) - p.price;

                  return (
                    <tr key={p.id} className="hover:bg-secondary/30 transition">
                      <td className="p-3 font-semibold text-foreground">
                        <div>{p.name}</div>
                        <div className="text-[11px] text-muted-foreground font-normal">{p.size}</div>
                      </td>
                      <td className="p-3 capitalize text-muted-foreground">{p.category_id}</td>
                      <td className="p-3 font-mono text-muted-foreground line-through">
                        {formatINR(p.original_price || 0)}
                      </td>
                      <td className="p-3 font-mono font-bold text-sm text-primary">
                        {formatINR(p.price)}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold"
                        >
                          {discountPct}% OFF (Saves {formatINR(savings)})
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenQuickEdit(p)}
                            className="h-7 text-xs font-semibold px-2"
                          >
                            <Edit3 className="size-3 mr-1" />
                            <span>Edit</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleClearDiscount(p)}
                            className="h-7 text-xs text-destructive hover:bg-destructive/10 px-2"
                          >
                            <span>End Promotion</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CONFIRMATION MODAL */}
      <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-foreground">
              Confirm Category Promotion
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              This will update selling prices and set original compare-at prices for {targetProducts.length} products.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2 text-xs">
            <div className="rounded-2xl border border-border bg-secondary/40 p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Target:</span>
                <span className="font-semibold text-foreground capitalize">{selectedCat}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount:</span>
                <span className="font-bold text-emerald-600">{discVal}% OFF</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Affected Products:</span>
                <span className="font-mono font-bold text-foreground">{targetProducts.length}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmModalOpen(false)}
                className="h-9 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="hero"
                size="sm"
                disabled={applyingBulkDiscount}
                onClick={handleApplyBulkDiscount}
                className="h-9 px-4 text-xs font-bold"
              >
                {applyingBulkDiscount ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  "Confirm Promotion"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
