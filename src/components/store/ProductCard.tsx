import { useState } from "react";
import { Heart } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import type { Product } from "@/lib/types";
import { formatINR } from "@/data/products";
import { useStore } from "@/lib/store";
import { BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { cn } from "@/lib/utils";

export function ProductCard({ product: p }: { product: Product }) {
  const navigate = useNavigate();
  const { qtyOf, add, wishlist, toggleWish, setDetail } = useStore();
  const [isNavigating, setIsNavigating] = useState(false);
  const qty = qtyOf(p.id);
  const wished = wishlist.includes(p.id);
  const out = p.stock === 0;
  const discount = p.originalPrice ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;

  const handleBuyNow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (out || isNavigating) return;

    setIsNavigating(true);
    try {
      if (qty === 0) {
        add(p, 1);
      }
      await navigate({ to: "/checkout" });
    } catch {
      setIsNavigating(false);
    }
  };

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift">
      <button type="button" onClick={() => setDetail(p)} className="relative block aspect-square overflow-hidden bg-muted" aria-label={`View ${p.name}`}>
        <img
          src={p.image}
          alt={p.name}
          loading="lazy"
          width={816}
          height={816}
          className={cn("size-full object-cover transition duration-500 group-hover:scale-105", out && "opacity-50 grayscale")}
          onError={(e) => {
            e.currentTarget.src = BRAND_FALLBACK_IMAGE;
          }}
        />
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {p.bestseller && <span className="rounded-full bg-forest px-2 py-0.5 text-[11px] font-semibold text-forest-foreground">Bestseller</span>}
          {discount > 0 && <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-bold text-lime-foreground">{discount}% off*</span>}
        </div>
        {out && <span className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-foreground/85 px-3 py-1 text-xs font-semibold text-background">Out of stock</span>}
      </button>
      <button type="button" onClick={() => toggleWish(p)} aria-pressed={wished} aria-label={wished ? `Remove ${p.name} from wishlist` : `Add ${p.name} to wishlist`} className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-card/90 shadow-soft backdrop-blur transition hover:scale-110">
        <Heart className={cn("size-4", wished ? "fill-destructive text-destructive" : "text-foreground")} />
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        <p className="text-xs text-muted-foreground">{p.size}</p>
        <h3 className="line-clamp-2 font-sans text-sm font-semibold leading-snug sm:text-base">{p.name}</h3>
        <p className={cn("text-xs font-medium", out ? "text-destructive" : p.stock <= 5 ? "text-warn" : "text-primary")}>
          {out ? "Currently unavailable" : p.stock <= 5 ? `Only ${p.stock} left` : "In stock"}
        </p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="leading-tight">
            <span className="text-base font-bold sm:text-lg">{formatINR(p.price)}</span>
            {p.originalPrice && <span className="ml-1 text-xs text-muted-foreground line-through">{formatINR(p.originalPrice)}</span>}
          </div>
          <button
            type="button"
            disabled={out || isNavigating}
            onClick={handleBuyNow}
            className={cn(
              "inline-flex h-9 items-center justify-center rounded-full px-3.5 text-xs font-bold transition sm:px-4 sm:text-sm",
              out
                ? "cursor-not-allowed border border-border bg-muted text-muted-foreground"
                : "bg-primary text-primary-foreground shadow-2xs hover:bg-primary/90 active:scale-95 disabled:opacity-75"
            )}
            aria-label={out ? `${p.name} is out of stock` : `Buy ${p.name} now`}
          >
            {out ? "Out of stock" : isNavigating ? "Processing..." : "Buy Now"}
          </button>
        </div>
      </div>
    </article>
  );
}
