import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ShoppingBag,
  Trash2,
  Heart,
  ArrowRight,
  ShieldCheck,
  Truck,
  MapPin,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { formatINR, BRAND_NAME, CAMPUS_NAME } from "@/data/products";
import { BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { QuantitySelector } from "@/components/store/QuantitySelector";
import { toast } from "sonner";

export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: `Shopping Cart — ${BRAND_NAME}` },
      {
        name: "description",
        content: `Review your campus essentials cart, adjust quantities, and proceed to checkout at ${CAMPUS_NAME}.`,
      },
      { property: "og:title", content: `Shopping Cart — ${BRAND_NAME}` },
      {
        property: "og:description",
        content: `Review your campus essentials cart, adjust quantities, and proceed to checkout at ${CAMPUS_NAME}.`,
      },
    ],
  }),
  component: CartPage,
});

function CartPage() {
  const { cart, itemCount, subtotal, setQty, remove, clear, wishlist, toggleWish, add, getProduct } =
    useStore();
  const navigate = useNavigate();

  const handleSaveForLater = (productId: string) => {
    const p = getProduct(productId);
    if (!p) return;
    if (!wishlist.includes(p.id)) {
      toggleWish(p);
    }
    remove(p.id);
    toast.success(`Saved ${p.name} for later`);
  };

  const handleMoveToCart = (productId: string) => {
    const p = getProduct(productId);
    if (!p) return;
    if (p.stock === 0) {
      toast.error(`${p.name} is currently out of stock`);
      return;
    }
    add(p, 1);
    toggleWish(p);
  };

  const savedProducts = wishlist
    .map((id) => getProduct(id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  return (
    <div className="container-page py-6 md:py-10">
      {/* Breadcrumb / Back Link */}
      <div className="flex items-center justify-between">
        <Link to="/" className="text-sm font-semibold text-primary hover:underline">
          ← Continue shopping
        </Link>
        <span className="text-xs text-muted-foreground">{itemCount} item(s) in cart</span>
      </div>

      <div className="mt-3 flex items-center justify-between border-b border-border/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold sm:text-3xl text-foreground">
            Shopping Cart
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            Deliverable directly to your hostel room across {CAMPUS_NAME}.
          </p>
        </div>

        {cart.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Are you sure you want to clear your cart?")) clear();
            }}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            <RotateCcw className="size-3.5 mr-1" />
            <span>Clear Cart</span>
          </Button>
        )}
      </div>

      {/* Cart Content */}
      {cart.length === 0 ? (
        <div className="mx-auto my-12 max-w-md rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-soft">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ShoppingBag className="size-8" />
          </div>
          <h2 className="mt-4 font-display text-xl font-bold text-foreground">Your cart is empty</h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            You haven't added any campus essentials yet. Explore our snacks, stationery, and hostel supplies.
          </p>
          <Button asChild variant="hero" className="mt-6 h-11 px-6 font-bold text-xs">
            <Link to="/">Start Shopping</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* Cart Items List */}
          <div className="space-y-4">
            <div className="rounded-3xl border border-border bg-card p-4 sm:p-6 shadow-xs divide-y divide-border/60">
              {cart.map((item) => {
                const product = getProduct(item.productId);
                if (!product) return null;

                const isOutOfStock = product.stock === 0;
                const isLowStock = product.stock > 0 && product.stock <= 5;
                const lineTotal = product.price * item.quantity;

                return (
                  <div key={item.productId} className="flex flex-col gap-4 py-5 first:pt-1 last:pb-1 sm:flex-row sm:items-center">
                    {/* Product Image */}
                    <img
                      src={product.image}
                      alt={product.name}
                      className="size-20 shrink-0 rounded-2xl bg-muted object-cover sm:size-24 border border-border/60"
                      onError={(e) => {
                        e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                      }}
                    />

                    {/* Product Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            {product.category}
                          </span>
                          <h3 className="font-display text-base font-bold text-foreground leading-snug">
                            {product.name}
                          </h3>
                          <p className="text-xs text-muted-foreground">{product.size}</p>
                        </div>

                        <span className="font-mono text-base font-bold text-foreground sm:text-lg">
                          {formatINR(lineTotal)}
                        </span>
                      </div>

                      {/* Stock Alerts */}
                      {isOutOfStock ? (
                        <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-destructive">
                          <AlertTriangle className="size-3.5" />
                          <span>Currently out of stock</span>
                        </div>
                      ) : isLowStock ? (
                        <p className="mt-1 text-[11px] font-semibold text-amber-600">
                          Only {product.stock} left in stock
                        </p>
                      ) : null}

                      {/* Controls and Secondary Actions */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Qty:</span>
                          <QuantitySelector
                            size="sm"
                            value={item.quantity}
                            max={product.stock}
                            onChange={(q) => setQty(product, q)}
                            label={product.name}
                          />
                          <span className="text-xs text-muted-foreground ml-1">
                            @ {formatINR(product.price)} each
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => handleSaveForLater(product.id)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary transition"
                          >
                            <Heart className="size-3.5" />
                            <span>Save for later</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => remove(product.id)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-destructive transition"
                            aria-label={`Remove ${product.name}`}
                          >
                            <Trash2 className="size-3.5" />
                            <span>Remove</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Campus Delivery Guarantee Note */}
            <div className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-xs text-foreground">
              <Truck className="size-5 shrink-0 text-primary" />
              <div>
                <p className="font-bold">Fast Campus Delivery</p>
                <p className="text-muted-foreground">
                  Delivering to all residential hostels (Ganga, Yamuna, Kaveri, Narmada, International House) and campus pickup points.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Order Summary */}
          <div className="space-y-4">
            <div className="sticky top-20 rounded-3xl border border-border bg-card p-6 shadow-soft">
              <h2 className="font-display text-lg font-bold text-foreground">Order Summary</h2>

              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal ({itemCount} {itemCount === 1 ? "item" : "items"})</span>
                  <span className="font-mono font-semibold text-foreground">{formatINR(subtotal)}</span>
                </div>

                <div className="flex justify-between text-muted-foreground">
                  <span>Campus Delivery</span>
                  <span className="font-semibold text-primary">Free on Campus</span>
                </div>

                <div className="border-t border-border pt-3 flex justify-between text-base font-bold text-foreground">
                  <span>Estimated Total</span>
                  <span className="font-display font-extrabold text-xl text-primary">{formatINR(subtotal)}</span>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <Button asChild variant="hero" className="w-full h-12 text-sm font-bold shadow-md">
                  <Link to="/checkout">
                    <span>Proceed to Checkout</span>
                    <ArrowRight className="ml-1.5 size-4" />
                  </Link>
                </Button>

                <Button asChild variant="outline" className="w-full h-10 text-xs">
                  <Link to="/">Continue Shopping</Link>
                </Button>
              </div>

              {/* Guarantees */}
              <div className="mt-6 border-t border-border/60 pt-4 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary shrink-0" />
                  <span>Verified stock and price at checkout</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 text-primary shrink-0" />
                  <span>Hostel room delivery or central pickup</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Saved For Later Section */}
      {savedProducts.length > 0 && (
        <section className="mt-14 border-t border-border pt-8">
          <div className="flex items-center gap-2">
            <Heart className="size-5 text-destructive" />
            <h2 className="font-display text-xl font-bold text-foreground">
              Saved for Later ({savedProducts.length})
            </h2>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {savedProducts.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-xs flex flex-col justify-between"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={p.image}
                    alt={p.name}
                    className="size-16 rounded-xl bg-muted object-cover border border-border/60"
                    onError={(e) => {
                      e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-sm text-foreground">{p.name}</h3>
                    <p className="text-xs text-muted-foreground">{p.size}</p>
                    <p className="font-mono text-sm font-bold text-foreground mt-0.5">
                      {formatINR(p.price)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleMoveToCart(p.id)}
                    disabled={p.stock === 0}
                    className="h-8 text-xs font-semibold"
                  >
                    Move to Cart
                  </Button>

                  <button
                    type="button"
                    onClick={() => toggleWish(p)}
                    className="text-xs font-semibold text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
