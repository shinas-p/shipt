import { Link } from "@tanstack/react-router";
import { ShoppingBag, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { formatINR } from "@/data/products";
import { BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { QuantitySelector } from "./QuantitySelector";

export function CartDrawer() {
  const { cart, cartOpen, setCartOpen, itemCount, subtotal, setQty, remove, getProduct } = useStore();
  return (
    <Sheet open={cartOpen} onOpenChange={setCartOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-5">
          <SheetTitle className="text-left font-display text-xl">Your cart</SheetTitle>
          <SheetDescription className="text-left">{itemCount} {itemCount === 1 ? "item" : "items"}</SheetDescription>
        </SheetHeader>
        {cart.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="grid size-20 place-items-center rounded-full bg-accent"><ShoppingBag className="size-9 text-primary" /></div>
            <h3 className="text-lg font-bold">Your cart is empty</h3>
            <p className="max-w-xs text-sm text-muted-foreground">Add a few essentials and they'll show up here.</p>
            <Button variant="hero" onClick={() => setCartOpen(false)} className="mt-2 h-11 px-6">Start shopping</Button>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-border overflow-y-auto px-5">
              {cart.map((c) => {
                const p = getProduct(c.productId);
                if (!p) return null;
                return (
                  <li key={c.productId} className="flex gap-3 py-4">
                    <img
                      src={p.image}
                      alt=""
                      className="size-20 shrink-0 rounded-xl bg-muted object-cover"
                      onError={(e) => {
                        e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                      }}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.size} · {formatINR(p.price)}</p>
                        </div>
                        <button type="button" onClick={() => remove(p.id)} className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-destructive" aria-label={`Remove ${p.name}`}>
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <QuantitySelector size="sm" value={c.quantity} max={p.stock} onChange={(v) => setQty(p, v)} label={p.name} />
                        <span className="font-bold">{formatINR(p.price * c.quantity)}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border bg-secondary/50 p-5 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Items</span><span className="font-semibold">{itemCount}</span></div>
              <div className="mt-1 flex justify-between text-lg font-bold"><span>Subtotal</span><span className="text-primary">{formatINR(subtotal)}</span></div>
              <p className="text-xs text-muted-foreground">Delivered directly to your doorstep.</p>
              <div className="pt-2 space-y-2">
                <Button asChild variant="hero" className="h-11 w-full text-sm font-bold">
                  <Link to="/checkout" onClick={() => setCartOpen(false)}>Proceed to Checkout</Link>
                </Button>
                <Button asChild variant="outline" className="h-10 w-full text-xs font-semibold">
                  <Link to="/cart" onClick={() => setCartOpen(false)}>View Full Cart</Link>
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
