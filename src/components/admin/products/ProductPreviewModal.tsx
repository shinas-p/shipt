import { useState } from "react";
import { Eye, Heart, ShoppingBag, Star, Package, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatINR, BRAND_NAME } from "@/data/products";
import { BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { cn } from "@/lib/utils";
import type { DBProduct, DBCategory } from "./types";

interface ProductPreviewModalProps {
  product: DBProduct | null;
  categories: DBCategory[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductPreviewModal({
  product,
  categories,
  open,
  onOpenChange,
}: ProductPreviewModalProps) {
  const [viewMode, setViewMode] = useState<"card" | "detail">("card");
  const [simulatedWishlist, setSimulatedWishlist] = useState(false);

  if (!product) return null;

  const categoryName =
    categories.find((c) => c.id === product.category_id)?.name || product.category_id;
  const isOutOfStock = product.stock === 0;
  const isLowStock = product.stock > 0 && product.stock <= 5;
  const discount =
    product.original_price && product.original_price > product.price
      ? Math.round((1 - product.price / product.original_price) * 100)
      : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl p-6 sm:p-8">
        <DialogHeader className="border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="font-display text-xl font-bold text-foreground">
                  Storefront Live Preview
                </DialogTitle>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-bold uppercase",
                    product.is_active
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  )}
                >
                  {product.is_active ? "Published" : "Draft / Inactive"}
                </Badge>
              </div>
              <DialogDescription className="mt-1 text-xs text-muted-foreground">
                Verify exactly how customers will see this product on both desktop and mobile storefronts.
              </DialogDescription>
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-border bg-secondary/50 p-1">
              <button
                type="button"
                onClick={() => setViewMode("card")}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                  viewMode === "card"
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Card View
              </button>
              <button
                type="button"
                onClick={() => setViewMode("detail")}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                  viewMode === "detail"
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Detail View
              </button>
            </div>
          </div>
        </DialogHeader>

        {viewMode === "card" ? (
          <div className="flex flex-col items-center justify-center py-6">
            <p className="mb-4 text-xs font-medium text-muted-foreground">
              Storefront Grid Card Preview (as rendered on homepage & category feeds):
            </p>

            <div className="w-full max-w-xs">
              <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition hover:-translate-y-1 hover:shadow-lift">
                <div className="relative block aspect-square overflow-hidden bg-muted">
                  <img
                    src={product.image_url || BRAND_FALLBACK_IMAGE}
                    alt={product.name}
                    className={cn(
                      "size-full object-cover transition duration-500",
                      isOutOfStock && "opacity-50 grayscale"
                    )}
                    onError={(e) => {
                      e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                    }}
                  />
                  <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
                    {product.bestseller && (
                      <span className="rounded-full bg-forest px-2 py-0.5 text-[11px] font-semibold text-forest-foreground">
                        Bestseller
                      </span>
                    )}
                    {discount > 0 && (
                      <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-bold text-lime-foreground">
                        {discount}% off*
                      </span>
                    )}
                  </div>
                  {isOutOfStock && (
                    <span className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-foreground/85 px-3 py-1 text-xs font-semibold text-background">
                      Out of stock
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSimulatedWishlist(!simulatedWishlist)}
                  className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-card/90 shadow-soft backdrop-blur transition hover:scale-110"
                >
                  <Heart
                    className={cn(
                      "size-4",
                      simulatedWishlist ? "fill-destructive text-destructive" : "text-foreground"
                    )}
                  />
                </button>

                <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
                  <p className="text-xs text-muted-foreground">{product.size}</p>
                  <h3 className="line-clamp-2 font-sans text-sm font-semibold leading-snug sm:text-base text-foreground">
                    {product.name}
                  </h3>
                  <p
                    className={cn(
                      "text-xs font-medium",
                      isOutOfStock
                        ? "text-destructive"
                        : isLowStock
                        ? "text-warn"
                        : "text-primary"
                    )}
                  >
                    {isOutOfStock
                      ? "Currently unavailable"
                      : isLowStock
                      ? `Only ${product.stock} left`
                      : "In stock"}
                  </p>

                  <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <div className="leading-tight">
                      <span className="text-base font-bold sm:text-lg">
                        {formatINR(product.price)}
                      </span>
                      {product.original_price != null && product.original_price > product.price && (
                        <span className="ml-1 text-xs text-muted-foreground line-through">
                          {formatINR(product.original_price)}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={isOutOfStock}
                      className={cn(
                        "inline-flex h-9 items-center justify-center rounded-full px-3.5 text-xs font-bold transition sm:px-4 sm:text-sm",
                        isOutOfStock
                          ? "cursor-not-allowed border border-border bg-muted text-muted-foreground"
                          : "bg-primary text-primary-foreground shadow-2xs hover:bg-primary/90"
                      )}
                    >
                      {isOutOfStock ? "Out of stock" : "Buy Now"}
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="aspect-square overflow-hidden rounded-2xl bg-muted border border-border">
                <img
                  src={product.image_url || BRAND_FALLBACK_IMAGE}
                  alt={product.name}
                  className="size-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                  }}
                />
              </div>

              <div className="space-y-4">
                <div>
                  <Badge variant="outline" className="text-xs capitalize text-muted-foreground mb-2">
                    {categoryName}
                  </Badge>
                  <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                    {product.name}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">{product.size}</p>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-extrabold text-foreground">
                    {formatINR(product.price)}
                  </span>
                  {product.original_price != null && product.original_price > product.price && (
                    <>
                      <span className="text-sm text-muted-foreground line-through">
                        {formatINR(product.original_price)}
                      </span>
                      <span className="rounded-full bg-lime/20 px-2.5 py-0.5 text-xs font-bold text-lime-800 dark:text-lime-300">
                        {discount}% OFF
                      </span>
                    </>
                  )}
                </div>

                <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-foreground">
                    <Package className="size-4 text-primary" />
                    <span>
                      {isOutOfStock
                        ? "Out of Stock"
                        : isLowStock
                        ? `Low Stock: Only ${product.stock} units remaining`
                        : `${product.stock} units in warehouse`}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Estimated delivery within 15–30 minutes after order placement.
                  </p>
                </div>

                {product.description && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
                      Product Overview
                    </h4>
                    <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                      {product.description}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end border-t border-border pt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-9 text-xs">
            Close Preview
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
