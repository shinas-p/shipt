import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

/**
 * Shipt Mart — Floating Product Suggestion Action Button (FAB)
 *
 * Persistently floats in the lower-right corner of the customer storefront,
 * inviting campus customers to suggest products they wish to see stocked.
 */
export function SuggestProductFab() {
  return (
    <div className="fixed bottom-6 right-6 z-40 print:hidden pointer-events-none">
      <Link
        to="/suggest-product"
        className="pointer-events-auto group inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-lift transition duration-200 hover:scale-105 hover:bg-primary/95 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4.5 sm:py-3 sm:text-sm"
        aria-label="Suggest a Product to Shipt Mart"
        id="floating-suggest-product-btn"
      >
        <span className="grid size-6 place-items-center rounded-full bg-white/20 transition group-hover:rotate-12">
          <Sparkles className="size-3.5 sm:size-4" />
        </span>
        <span className="tracking-tight">Suggest a Product</span>
      </Link>
    </div>
  );
}
