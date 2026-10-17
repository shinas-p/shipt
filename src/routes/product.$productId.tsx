import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft,
  ShoppingBag,
  Heart,
  Truck,
  ShieldCheck,
  Check,
  Star,
  AlertTriangle,
  RotateCcw,
  Clock,
  MapPin,
  Share2,
  ChevronRight,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { formatINR, BRAND_NAME, CAMPUS_NAME } from "@/data/products";
import { BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { QuantitySelector } from "@/components/store/QuantitySelector";
import { ProductReviewsSection } from "@/components/store/ProductReviewsSection";
import { fetchProductReviews, calculateReviewSummary } from "@/lib/reviewsApi";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/product/$productId")({
  head: ({ params }) => ({
    meta: [
      { title: `Product Details — ${BRAND_NAME}` },
      { name: "description", content: `View product specifications, campus hostel delivery options, and customer reviews on ${BRAND_NAME}.` },
    ],
  }),
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { productId } = useParams({ from: "/product/$productId" });
  const navigate = useNavigate();
  const { getProduct, add, wishlist, toggleWish, categories, isLoadingCatalog, setCartOpen } = useStore();

  const [qty, setQty] = useState(1);
  const [isBuyingNow, setIsBuyingNow] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [reviewRating, setReviewRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState<number>(0);

  // Retrieve product from unified store
  const product = useMemo(() => {
    return getProduct(productId);
  }, [productId, getProduct]);

  // Load initial review stats for product
  useEffect(() => {
    let isMounted = true;
    fetchProductReviews(productId).then((revs) => {
      if (isMounted) {
        const sum = calculateReviewSummary(revs);
        setReviewRating(sum.average_rating);
        setReviewCount(sum.total_reviews);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [productId]);

  // Reset states when productId changes
  useEffect(() => {
    setQty(1);
    setImageError(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [productId]);

  // Handle browser back button or fallback to home
  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: "/" });
    }
  };

  const handleShare = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      toast.success("Product link copied to clipboard!");
    }
  };

  // Add to cart action
  const handleAddToCart = () => {
    if (!product || product.stock === 0) return;
    add(product, qty);
    toast.success(`Added ${qty} × ${product.name} to cart!`, {
      action: {
        label: "View Cart",
        onClick: () => setCartOpen(true),
      },
    });
  };

  // Buy now: add and direct to checkout
  const handleBuyNow = async () => {
    if (!product || product.stock === 0 || isBuyingNow) return;
    setIsBuyingNow(true);
    try {
      add(product, qty);
      await navigate({ to: "/checkout" });
    } catch {
      setIsBuyingNow(false);
    }
  };

  // Loading state
  if (isLoadingCatalog && !product) {
    return (
      <div className="container-page py-12 md:py-20">
        <div className="h-8 w-32 animate-pulse rounded-lg bg-muted mb-8" />
        <div className="grid gap-10 md:grid-cols-2">
          <div className="aspect-square animate-pulse rounded-3xl bg-muted" />
          <div className="space-y-4">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-8 w-3/4 animate-pulse rounded-lg bg-muted" />
            <div className="h-6 w-32 animate-pulse rounded-lg bg-muted" />
            <div className="h-24 w-full animate-pulse rounded-2xl bg-muted" />
            <div className="h-12 w-full animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  // Missing product state
  if (!product) {
    return (
      <div className="container-page py-16 md:py-24 text-center">
        <div className="mx-auto grid size-20 place-items-center rounded-3xl bg-primary/10 text-primary">
          <Package className="size-10" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Product Not Found
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          The item with identifier <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{productId}</code> is either no longer available or was moved.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button variant="default" onClick={handleBack} className="gap-2 rounded-full font-semibold">
            <ArrowLeft className="size-4" />
            <span>Go Back</span>
          </Button>
          <Link
            to="/"
            className="inline-flex h-10 items-center justify-center rounded-full border border-border bg-card px-5 text-sm font-semibold hover:bg-secondary transition"
          >
            <span>Browse Full Store</span>
          </Link>
        </div>
      </div>
    );
  }

  const outOfStock = product.stock === 0;
  const isLowStock = product.stock > 0 && product.stock <= 5;
  const isWished = wishlist.includes(product.id);
  const discountPercent = product.originalPrice
    ? Math.round((1 - product.price / product.originalPrice) * 100)
    : 0;
  const categoryObj = categories.find((c) => c.id === product.category);

  return (
    <div className="container-page py-4 md:py-8">
      {/* Top Breadcrumb & Navigation Bar */}
      <nav aria-label="Breadcrumbs" className="mb-6 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleBack}
            className="group inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 py-1.5 font-semibold text-foreground transition hover:border-primary hover:bg-secondary"
            aria-label="Back to previous page"
          >
            <ArrowLeft className="size-3.5 transition group-hover:-translate-x-0.5" />
            <span>Back</span>
          </button>

          <span className="text-muted-foreground hidden sm:inline">/</span>

          <Link to="/" className="text-muted-foreground hover:text-foreground hidden sm:inline">
            Store
          </Link>

          {categoryObj && (
            <>
              <ChevronRight className="size-3 text-muted-foreground hidden sm:inline" />
              <Link
                to="/"
                search={{ category: categoryObj.id }}
                className="text-muted-foreground hover:text-foreground hidden sm:inline font-medium"
              >
                {categoryObj.name}
              </Link>
            </>
          )}

          <ChevronRight className="size-3 text-muted-foreground hidden sm:inline" />
          <span className="font-semibold text-foreground truncate max-w-[180px] sm:max-w-[280px]">
            {product.name}
          </span>
        </div>

        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 font-medium text-muted-foreground hover:text-foreground transition"
          title="Copy link to product"
        >
          <Share2 className="size-3.5" />
          <span className="hidden sm:inline">Share</span>
        </button>
      </nav>

      {/* Main Two-Column Product Section */}
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
        {/* Left Column: Large Product Image Stage */}
        <div className="lg:col-span-6">
          <div className="sticky top-20">
            <div className="relative aspect-square w-full overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-[#F7F8F4] to-[#EAECE4] p-4 shadow-soft sm:p-6 flex items-center justify-center">
              <img
                src={imageError ? BRAND_FALLBACK_IMAGE : product.image}
                alt={product.name}
                className={cn(
                  "size-full max-h-[500px] object-contain transition duration-500 hover:scale-105",
                  outOfStock && "opacity-50 grayscale"
                )}
                onError={() => setImageError(true)}
              />

              {/* Badges on Image */}
              <div className="absolute left-4 top-4 flex flex-col items-start gap-1.5">
                {product.bestseller && (
                  <span className="rounded-full bg-forest px-3 py-1 text-xs font-bold text-forest-foreground shadow-xs">
                    Campus Bestseller
                  </span>
                )}
                {discountPercent > 0 && (
                  <span className="rounded-full bg-lime px-3 py-1 text-xs font-black text-lime-foreground shadow-xs">
                    {discountPercent}% OFF
                  </span>
                )}
                {product.isNew && (
                  <span className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white shadow-xs">
                    New Arrival
                  </span>
                )}
              </div>

              {/* Wishlist Button on Image */}
              <button
                type="button"
                onClick={() => toggleWish(product)}
                aria-pressed={isWished}
                aria-label={isWished ? "Remove from wishlist" : "Add to wishlist"}
                className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-card/95 shadow-soft backdrop-blur transition hover:scale-110 border border-border/80"
              >
                <Heart
                  className={cn(
                    "size-5 transition-colors",
                    isWished ? "fill-destructive text-destructive" : "text-foreground"
                  )}
                />
              </button>

              {outOfStock && (
                <div className="absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-xs">
                  <span className="rounded-2xl border border-destructive/30 bg-destructive px-5 py-2 text-sm font-extrabold text-destructive-foreground shadow-lg">
                    Out of Stock
                  </span>
                </div>
              )}
            </div>

            {/* Quick Trust Highlights below image */}
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-border/80 bg-secondary/30 p-3 text-center text-xs">
              <div className="flex flex-col items-center gap-1">
                <Truck className="size-4 text-primary" />
                <span className="font-semibold text-foreground">Room Delivery</span>
                <span className="text-[10px] text-muted-foreground">Within 20 mins</span>
              </div>
              <div className="flex flex-col items-center gap-1 border-x border-border/60 px-1">
                <ShieldCheck className="size-4 text-primary" />
                <span className="font-semibold text-foreground">100% Genuine</span>
                <span className="text-[10px] text-muted-foreground">Campus verified</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <RotateCcw className="size-4 text-primary" />
                <span className="font-semibold text-foreground">UPI or Cash</span>
                <span className="text-[10px] text-muted-foreground">On delivery</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Information, Pricing, & Action Controls */}
        <div className="flex flex-col lg:col-span-6">
          {/* Category & Rating */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-primary">
              {categoryObj?.name || product.category}
            </span>

            {/* Star Rating Anchor */}
            <a
              href="#reviews"
              className="group flex items-center gap-1.5 text-xs font-semibold hover:text-primary transition"
            >
              <div className="flex items-center gap-0.5 text-amber-500">
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                <span className="font-bold text-foreground">
                  {reviewRating && reviewRating > 0 ? reviewRating.toFixed(1) : "5.0"}
                </span>
              </div>
              <span className="text-muted-foreground group-hover:underline">
                ({reviewCount} {reviewCount === 1 ? "review" : "reviews"})
              </span>
            </a>
          </div>

          {/* Product Title */}
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            {product.name}
          </h1>

          {/* Variant / Size info */}
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            Variant / Size: <strong className="text-foreground">{product.size}</strong>
          </p>

          {/* Price Block */}
          <div className="mt-5 flex items-baseline gap-3 rounded-2xl bg-secondary/50 p-4 border border-border/70">
            <span className="font-display text-3xl font-black text-foreground sm:text-4xl">
              {formatINR(product.price)}
            </span>
            {product.originalPrice && (
              <>
                <span className="text-base text-muted-foreground line-through">
                  {formatINR(product.originalPrice)}
                </span>
                <Badge className="bg-lime text-lime-foreground font-black text-xs">
                  Save {formatINR(product.originalPrice - product.price)}
                </Badge>
              </>
            )}
            <span className="ml-auto text-[11px] font-semibold text-muted-foreground">
              Inclusive of all taxes
            </span>
          </div>

          {/* Stock Status Badge */}
          <div className="mt-4 flex items-center gap-2">
            {outOfStock ? (
              <div className="flex items-center gap-1.5 text-xs font-bold text-destructive">
                <AlertTriangle className="size-4" />
                <span>Currently Unavailable — Restocking Soon</span>
              </div>
            ) : isLowStock ? (
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                <Clock className="size-4" />
                <span>Hurry! Only {product.stock} left in campus store</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <Check className="size-4" />
                <span>In Stock — Ready for instant campus dispatch</span>
              </div>
            )}
          </div>

          {/* Campus Hostel Delivery Banner */}
          <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-3.5 text-xs text-foreground/90">
            <div className="flex items-center gap-2 font-bold text-primary">
              <MapPin className="size-4 shrink-0" />
              <span>Campus Hostel Delivery Guarantee</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              Order now for swift delivery to your room in <strong>Ganga, Yamuna, Kaveri, Narmada</strong>, or <strong>International House</strong>.
            </p>
          </div>

          {/* Full Description */}
          <div className="mt-6 border-t border-border pt-5">
            <h3 className="font-display text-sm font-bold uppercase tracking-wider text-foreground">
              About This Item
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-foreground/85 whitespace-pre-line">
              {product.description || "Essential item curated for Darul Huda students and faculty."}
            </p>
          </div>

          {/* Purchase Actions (Quantity, Add to Cart, Buy Now) */}
          <div className="mt-8 border-t border-border pt-6">
            {!outOfStock && (
              <div className="mb-4 flex items-center gap-3">
                <span className="text-xs font-semibold text-foreground">Select Quantity:</span>
                <QuantitySelector
                  value={qty}
                  max={product.stock}
                  onChange={(val) => setQty(Math.max(1, Math.min(val, product.stock)))}
                  label={product.name}
                />
                <span className="text-xs text-muted-foreground font-medium">
                  Subtotal: <strong>{formatINR(product.price * qty)}</strong>
                </span>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                disabled={outOfStock}
                onClick={handleAddToCart}
                className="h-12 flex-1 rounded-full text-sm font-bold border-primary text-primary hover:bg-primary/10 transition shadow-xs"
              >
                <ShoppingBag className="mr-2 size-4" />
                <span>{outOfStock ? "Out of Stock" : `Add to Cart · ${formatINR(product.price * qty)}`}</span>
              </Button>

              <Button
                type="button"
                variant="hero"
                disabled={outOfStock || isBuyingNow}
                onClick={handleBuyNow}
                className="h-12 flex-1 rounded-full text-sm font-black shadow-soft"
              >
                <span>{outOfStock ? "Unavailable" : isBuyingNow ? "Preparing Order..." : "Buy Now"}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Customer Product Reviews & Ratings Section */}
      <ProductReviewsSection
        productId={product.id}
        productName={product.name}
        onReviewsChange={(avg, total) => {
          setReviewRating(avg);
          setReviewCount(total);
        }}
      />
    </div>
  );
}
