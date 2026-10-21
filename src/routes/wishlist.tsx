import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  Heart,
  ShoppingBag,
  Trash2,
  ArrowRight,
  Star,
  ExternalLink,
  ShieldCheck,
  PackageOpen,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { formatINR, BRAND_NAME, CAMPUS_NAME } from "@/data/products";
import { BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { fetchProductReviews, calculateReviewSummary } from "@/lib/reviewsApi";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/types";

export const Route = createFileRoute("/wishlist")({
  head: () => ({
    meta: [
      { title: `My Wishlist — ${BRAND_NAME}` },
      {
        name: "description",
        content: `View and manage your saved items on ${BRAND_NAME}. Quick order anytime.`,
      },
      { property: "og:title", content: `My Wishlist — ${BRAND_NAME}` },
      {
        property: "og:description",
        content: `Your saved items on ${BRAND_NAME} — fast and reliable ordering anytime.`,
      },
    ],
  }),
  component: WishlistPage,
});

interface ReviewStats {
  averageRating: number;
  totalReviews: number;
}

export function WishlistPage() {
  const {
    savedWishlistProducts,
    toggleWish,
    clearWishlist,
    add,
    getProduct,
    setCartOpen,
    categories,
    isLoadingCatalog,
  } = useStore();
  const navigate = useNavigate();

  // Ratings cache for items in wishlist
  const [reviewsMap, setReviewsMap] = useState<Record<string, ReviewStats>>({});

  // Authoritative resolved products from store
  const savedProducts = savedWishlistProducts;

  // Load reviews/ratings for saved products
  useEffect(() => {
    let isMounted = true;
    const loadStats = async () => {
      const statsObj: Record<string, ReviewStats> = {};
      for (const p of savedProducts) {
        try {
          const revs = await fetchProductReviews(p.id);
          const sum = calculateReviewSummary(revs);
          statsObj[p.id] = {
            averageRating: sum.average_rating,
            totalReviews: sum.total_reviews,
          };
        } catch {
          // Non-blocking
        }
      }
      if (isMounted) {
        setReviewsMap(statsObj);
      }
    };

    if (savedProducts.length > 0) {
      loadStats();
    }

    return () => {
      isMounted = false;
    };
  }, [savedProducts]);

  const handleAddToCart = (product: Product) => {
    if (product.stock === 0) {
      toast.error(`${product.name} is currently out of stock.`);
      return;
    }
    add(product, 1);
    toast.success(`Added ${product.name} to cart!`, {
      action: {
        label: "View Cart",
        onClick: () => setCartOpen(true),
      },
    });
  };

  const handleAddAllInStock = () => {
    const inStockItems = savedProducts.filter((p) => p.stock > 0);
    if (inStockItems.length === 0) {
      toast.error("None of the items in your wishlist are currently in stock.");
      return;
    }
    for (const p of inStockItems) {
      add(p, 1);
    }
    toast.success(`Added ${inStockItems.length} available items to your cart!`, {
      action: {
        label: "Checkout",
        onClick: () => navigate({ to: "/checkout" }),
      },
    });
  };

  const handleClearAll = () => {
    if (!confirm("Are you sure you want to remove all saved items from your wishlist?")) return;
    clearWishlist();
    toast("Wishlist cleared");
  };

  return (
    <div className="min-h-[75vh] bg-background">
      {/* Top Banner & Breadcrumbs */}
      <div className="border-b border-border/80 bg-secondary/30">
        <div className="container-page py-4">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to="/" className="hover:text-primary transition font-medium">
              Home
            </Link>
            <span>/</span>
            <span className="text-foreground font-semibold">My Wishlist</span>
          </nav>
        </div>
      </div>

      <div className="container-page py-6 sm:py-10">
        {/* Header Title Section */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Heart className="size-5 fill-primary/20 text-primary" />
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  My Saved Wishlist
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                  Your handpicked essentials ready for quick doorstep delivery.
                </p>
              </div>
            </div>
          </div>

          {savedProducts.length > 0 && (
            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" />
                <span>Clear All</span>
              </Button>
              <Button
                variant="hero"
                size="sm"
                onClick={handleAddAllInStock}
                className="h-9 gap-1.5 font-bold text-xs shadow-soft"
              >
                <ShoppingBag className="size-3.5" />
                <span>Add All In-Stock to Cart</span>
              </Button>
            </div>
          )}
        </div>

        {/* Loading Skeleton */}
        {isLoadingCatalog && (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-border bg-card p-4 space-y-3">
                <div className="aspect-square w-full rounded-xl bg-muted" />
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
                <div className="h-8 w-full rounded-xl bg-muted" />
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoadingCatalog && savedProducts.length === 0 && (
          <div className="mt-12 flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/60 p-8 sm:p-14 text-center shadow-xs max-w-xl mx-auto">
            <div className="grid size-20 place-items-center rounded-full bg-primary/10 text-primary mb-4 animate-in zoom-in-95 duration-200">
              <PackageOpen className="size-10 stroke-[1.5]" />
            </div>
            <h2 className="font-display text-xl font-bold text-foreground">Your wishlist is empty</h2>
            <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Explore our catalogue and tap the heart icon on snacks, stationery, toiletries, and daily essentials to save them for quick access later.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="hero" className="font-bold text-xs h-10 px-6 shadow-soft">
                <Link to="/">
                  <span>Continue Shopping</span>
                  <ArrowRight className="ml-1.5 size-3.5" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="text-xs h-10">
                <Link to="/cart">View Shopping Cart</Link>
              </Button>
            </div>
          </div>
        )}

        {/* Saved Products Grid */}
        {!isLoadingCatalog && savedProducts.length > 0 && (
          <div className="mt-8 space-y-6">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing <strong className="text-foreground">{savedProducts.length}</strong> saved product{savedProducts.length !== 1 ? "s" : ""}
              </span>
              <span className="hidden sm:inline">
                Fast local delivery in 15–30 minutes
              </span>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {savedProducts.map((p) => {
                const isOutOfStock = p.stock === 0;
                const isLowStock = p.stock > 0 && p.stock <= 5;
                const stats = reviewsMap[p.id];
                const discount =
                  p.originalPrice && p.originalPrice > p.price
                    ? Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100)
                    : 0;

                const catName = categories.find((c) => c.id === p.category)?.name || p.category;

                return (
                  <article
                    key={p.id}
                    className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-lift"
                  >
                    {/* Top Image Stage */}
                    <div className="relative aspect-square w-full overflow-hidden bg-muted">
                      <Link to="/product/$productId" params={{ productId: p.id }} className="block size-full">
                        <img
                          src={p.image}
                          alt={p.name}
                          loading="lazy"
                          className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                          onError={(e) => {
                            e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                          }}
                        />
                      </Link>

                      {/* Badges Overlay */}
                      <div className="absolute left-2.5 top-2.5 flex flex-col gap-1 z-10 pointer-events-none">
                        {discount > 0 && (
                          <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-lime-foreground shadow-xs">
                            {discount}% OFF
                          </span>
                        )}
                        {p.bestseller && (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground shadow-xs">
                            Popular
                          </span>
                        )}
                      </div>

                      {/* Remove Button */}
                      <button
                        type="button"
                        onClick={() => toggleWish(p)}
                        aria-label={`Remove ${p.name} from wishlist`}
                        title="Remove from wishlist"
                        className="absolute right-2.5 top-2.5 z-10 grid size-8 place-items-center rounded-full bg-card/90 text-destructive shadow-soft backdrop-blur-sm transition-transform hover:scale-110 hover:bg-card"
                      >
                        <Trash2 className="size-4" />
                      </button>

                      {/* Out of Stock Overlay */}
                      {isOutOfStock && (
                        <div className="absolute inset-0 z-10 grid place-items-center bg-black/40 backdrop-blur-[2px]">
                          <span className="rounded-full bg-foreground/90 px-3 py-1 text-xs font-bold text-background shadow-md">
                            Currently Out of Stock
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Product Details Body */}
                    <div className="flex flex-1 flex-col p-4">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                        <span className="capitalize">{catName}</span>
                        <span>{p.size}</span>
                      </div>

                      <Link
                        to="/product/$productId"
                        params={{ productId: p.id }}
                        className="font-sans text-sm font-bold text-foreground hover:text-primary transition line-clamp-1"
                        title={p.name}
                      >
                        {p.name}
                      </Link>

                      {/* Ratings Summary */}
                      <div className="mt-1 flex items-center gap-1.5 text-xs">
                        {stats && stats.totalReviews > 0 ? (
                          <>
                            <div className="flex items-center text-amber-500">
                              <Star className="size-3.5 fill-current" />
                              <span className="ml-1 font-bold text-foreground text-xs">
                                {stats.averageRating.toFixed(1)}
                              </span>
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              ({stats.totalReviews})
                            </span>
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Sparkles className="size-3 text-primary/70" />
                            <span>Campus choice</span>
                          </span>
                        )}
                      </div>

                      {/* Price & Stock info */}
                      <div className="mt-3 flex items-baseline justify-between">
                        <div>
                          <span className="font-mono text-base font-extrabold text-foreground">
                            {formatINR(p.price)}
                          </span>
                          {p.originalPrice && p.originalPrice > p.price && (
                            <span className="ml-1.5 font-mono text-xs text-muted-foreground line-through">
                              {formatINR(p.originalPrice)}
                            </span>
                          )}
                        </div>

                        <div>
                          {isOutOfStock ? (
                            <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20 font-bold">
                              Out of stock
                            </Badge>
                          ) : isLowStock ? (
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/30 font-bold">
                              Only {p.stock} left
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 font-bold">
                              In stock
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/60 pt-3">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs font-semibold hover:bg-secondary"
                        >
                          <Link to="/product/$productId" params={{ productId: p.id }}>
                            <span>Details</span>
                            <ExternalLink className="ml-1 size-3" />
                          </Link>
                        </Button>

                        <Button
                          type="button"
                          variant="hero"
                          size="sm"
                          disabled={isOutOfStock}
                          onClick={() => handleAddToCart(p)}
                          className="h-8 text-xs font-bold shadow-xs disabled:opacity-50"
                        >
                          <ShoppingBag className="mr-1 size-3" />
                          <span>{isOutOfStock ? "Sold Out" : "Add"}</span>
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Browser Persistence Notice */}
            <div className="mt-10 rounded-2xl border border-border/80 bg-secondary/30 p-4 text-center sm:text-left flex flex-col sm:flex-row items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-card border border-border/80 text-primary shadow-xs">
                <ShieldCheck className="size-5" />
              </div>
              <div className="flex-1 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Device-specific Wishlist</p>
                <p className="mt-0.5">
                  Items saved in your wishlist are stored securely in your browser's local storage and are preserved between visits on this device.
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="h-8 text-xs shrink-0 font-medium">
                <Link to="/">Shop More Items</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
