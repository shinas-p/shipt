import { useEffect, useState } from "react";
import { Heart, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { formatINR } from "@/data/products";
import { QuantitySelector } from "./QuantitySelector";
import { cn } from "@/lib/utils";

import { BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";

export function ProductDetailsModal() {
  const { detail: p, setDetail, add, isWished, toggleWish, categories } = useStore();
  const [qty, setQty] = useState(1);
  useEffect(() => setQty(1), [p?.id]);
  if (!p) return null;
  const out = p.stock === 0;
  const wished = isWished(p);

  return (
    <Dialog open={!!p} onOpenChange={(o) => !o && setDetail(null)}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-3xl p-0 sm:rounded-3xl">
        <div className="grid sm:grid-cols-2">
          <div className="aspect-square bg-muted">
            <img
              src={p.image}
              alt={p.name}
              className={cn("size-full object-cover", out && "grayscale opacity-60")}
              onError={(e) => {
                e.currentTarget.src = BRAND_FALLBACK_IMAGE;
              }}
            />
          </div>
          <div className="flex flex-col gap-3 p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">{categories.find((c) => c.id === p.category)?.name}</p>
            <DialogTitle className="font-display text-2xl font-bold">{p.name}</DialogTitle>
            <p className="text-sm text-muted-foreground">{p.size}</p>
            <DialogDescription className="text-sm leading-relaxed text-foreground/80">{p.description}</DialogDescription>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{formatINR(p.price)}</span>
              {p.originalPrice && <span className="text-sm text-muted-foreground line-through">{formatINR(p.originalPrice)}</span>}
            </div>
            <p className={cn("text-sm font-medium", out ? "text-destructive" : p.stock <= 5 ? "text-warn" : "text-primary")}>
              {out ? "Out of stock" : p.stock <= 5 ? `Only ${p.stock} left` : `In stock`}
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
              {!out && <QuantitySelector value={qty} max={p.stock} onChange={(v) => setQty(Math.max(1, v))} label={p.name} />}
              <Button variant="hero" disabled={out} className="h-11 flex-1 px-6" onClick={() => { add(p, qty); setDetail(null); }}>
                {out ? "Unavailable" : `Add to cart · ${formatINR(p.price * qty)}`}
              </Button>
              <button type="button" onClick={() => toggleWish(p)} aria-pressed={wished} aria-label="Toggle wishlist" className="grid size-11 place-items-center rounded-full border border-border hover:bg-secondary">
                <Heart className={cn("size-5", wished && "fill-destructive text-destructive")} />
              </button>
            </div>
            <div className="flex items-center justify-between pt-1">
              <Link
                to="/product/$productId"
                params={{ productId: p.id }}
                onClick={() => setDetail(null)}
                className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
              >
                <span>View Full Product Page & Reviews</span>
                <ExternalLink className="size-3" />
              </Link>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
