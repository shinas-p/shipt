import { Link, useNavigate } from "@tanstack/react-router";
import { MapPin, Menu, Search, ShoppingBag, User, X, Heart, Package } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { useCustomerAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { BRAND_NAME, BRAND_TAGLINE, CAMPUS_NAME, categories } from "@/data/products";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OrderTrackerModal } from "./OrderTrackerModal";

export function Logo() {
  const { branding } = useBranding();
  return (
    <Link to="/" className="flex items-center gap-2" aria-label={`${branding.store_name} home`}>
      {branding.logo_url ? (
        <img
          src={branding.logo_url}
          alt={branding.store_name}
          className="size-9 object-contain rounded-xl"
        />
      ) : (
        <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
          <ShoppingBag className="size-5" />
        </span>
      )}
      <span className="font-display text-lg font-extrabold tracking-tight">{branding.store_name}</span>
    </Link>
  );
}

export function SearchBar({ className = "" }: { className?: string }) {
  const { search, setSearch } = useStore();
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search snacks, stationery, electronics…"
        className="h-10 w-full rounded-full border border-input bg-card pl-9.5 pr-8 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
        aria-label="Search products"
      />
      {search && (
        <button
          type="button"
          onClick={() => setSearch("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Clear search query"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Header() {
  const navigate = useNavigate();
  const { itemCount, setCartOpen, setCategory, wishlist = [], wishlistCount } = useStore();
  const displayWishlistCount = wishlistCount ?? (Array.isArray(wishlist) ? wishlist.length : 0);
  const { user, profile, isLoading } = useCustomerAuth();
  const { branding } = useBranding();
  const [menu, setMenu] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);

  const handleOrdersClick = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setMenu(false);

    // If customer is already authenticated: navigate directly to My Orders
    if (user) {
      navigate({ to: "/account", search: { tab: "orders" } });
      return;
    }

    // If auth session is still hydrating, check Supabase directly to prevent
    // incorrectly routing signed-in customers into the guest tracker
    if (isLoading && isSupabaseConfigured) {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          navigate({ to: "/account", search: { tab: "orders" } });
          return;
        }
      } catch {
        // Fall back to guest tracker
      }
    }

    // Unauthenticated guest customer: open guest order tracking modal
    setTrackerOpen(true);
  };

  const userInitial = (profile?.full_name?.[0] || user?.email?.[0] || "U").toUpperCase();

  return (
    <>
      <div className="bg-forest text-forest-foreground">
        <p className="container-page py-1.5 text-center text-xs font-medium sm:text-sm">
          <span className="mr-1.5 inline-block size-1.5 rounded-full bg-lime align-middle" />
          {branding.store_name} — {branding.tagline} Fast delivery across {CAMPUS_NAME}.
        </p>
      </div>
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="container-page flex h-16 items-center gap-3">
          <button
            type="button"
            className="grid size-10 place-items-center rounded-full hover:bg-secondary md:hidden"
            onClick={() => setMenu(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <Logo />
          <button
            type="button"
            onClick={() => toast("Hostel delivery is available at checkout!")}
            className="ml-4 hidden items-center gap-2 rounded-full px-3 py-1.5 text-left hover:bg-secondary lg:flex"
          >
            <MapPin className="size-4 text-primary" />
            <span className="leading-tight">
              <span className="block text-[11px] text-muted-foreground">Delivering to</span>
              <span className="block text-sm font-semibold">Campus Hostels</span>
            </span>
          </button>
          <SearchBar className="mx-auto hidden max-w-md flex-1 md:block" />
          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <button
              type="button"
              onClick={handleOrdersClick}
              className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold hover:bg-secondary sm:inline-flex"
              aria-label="Orders"
              title={user ? "My Orders" : "Orders"}
            >
              <Package className="size-4 text-primary" />
              <span>Orders</span>
            </button>

            <Link
              to="/wishlist"
              className="relative grid size-10 place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition"
              aria-label="Wishlist"
              title="Saved Wishlist"
            >
              <Heart className="size-5" />
              {displayWishlistCount > 0 && (
                <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                  {displayWishlistCount}
                </span>
              )}
            </Link>

            <Link
              to="/account"
              className="grid size-10 place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition"
              aria-label={user ? "My Account" : "Sign In"}
              title={user ? `Account (${profile?.full_name || user.email})` : "Sign In / Register"}
            >
              {user ? (
                <div className="grid size-7 place-items-center rounded-full bg-primary/15 text-primary text-xs font-bold">
                  {userInitial}
                </div>
              ) : (
                <User className="size-5" />
              )}
            </Link>

            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative ml-1 inline-flex h-10 items-center gap-2 rounded-full bg-primary px-3 text-primary-foreground transition hover:bg-primary/90 sm:px-4"
              aria-label={`Open cart, ${itemCount} items`}
            >
              <ShoppingBag className="size-5" />
              <span className="hidden text-sm font-semibold sm:inline">Cart</span>
              <span
                key={itemCount}
                className="grid min-w-5 place-items-center rounded-full bg-lime px-1.5 text-xs font-bold text-lime-foreground animate-in zoom-in"
              >
                {itemCount}
              </span>
            </button>
          </div>
        </div>
        <div className="container-page pb-3 md:hidden flex items-center gap-2">
          <SearchBar className="flex-1" />
          <button
            type="button"
            onClick={handleOrdersClick}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-input bg-card px-3 text-xs font-semibold shadow-2xs"
            aria-label="Orders"
            title={user ? "My Orders" : "Orders"}
          >
            <Package className="size-4 text-primary" />
            <span>Orders</span>
          </button>
        </div>
      </header>

      <OrderTrackerModal open={trackerOpen} onOpenChange={setTrackerOpen} />

      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="w-[85vw] max-w-sm">
          <SheetHeader>
            <SheetTitle className="text-left">Menu</SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-secondary p-3 text-sm">
            <MapPin className="size-4 text-primary" /> Delivering to your hostel room
          </div>

          <div className="mt-4 border-b border-border pb-3 space-y-2">
            <Link
              to="/account"
              onClick={() => setMenu(false)}
              className="flex items-center gap-2.5 rounded-xl bg-card border border-border/70 p-3 font-semibold text-sm hover:bg-secondary transition"
            >
              <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
                <User className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-muted-foreground">{user ? "Signed In" : `Welcome to ${branding.store_name}`}</p>
                <p className="truncate text-sm font-bold text-foreground">
                  {user ? (profile?.full_name || user.email) : "Sign In / Register"}
                </p>
              </div>
            </Link>

            <button
              type="button"
              onClick={handleOrdersClick}
              className="w-full flex items-center justify-between rounded-xl bg-card border border-border/70 p-3 font-semibold text-sm hover:bg-secondary transition text-left"
              aria-label={user ? "My Orders" : "Orders"}
            >
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
                  <Package className="size-4" />
                </div>
                <span>{user ? "My Orders" : "Orders"}</span>
              </div>
              <span className="text-xs text-primary font-bold">{user ? "View →" : "Track →"}</span>
            </button>

            <Link
              to="/cart"
              onClick={() => setMenu(false)}
              className="flex items-center justify-between rounded-xl bg-card border border-border/70 p-3 font-semibold text-sm hover:bg-secondary transition"
            >
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
                  <ShoppingBag className="size-4" />
                </div>
                <span>Full Shopping Cart</span>
              </div>
              <span className="grid min-w-5 place-items-center rounded-full bg-lime px-2 py-0.5 text-xs font-bold text-lime-foreground">
                {itemCount}
              </span>
            </Link>

            <Link
              to="/wishlist"
              onClick={() => setMenu(false)}
              className="flex items-center justify-between rounded-xl bg-card border border-border/70 p-3 font-semibold text-sm hover:bg-secondary transition"
            >
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
                  <Heart className="size-4" />
                </div>
                <span>Saved Wishlist</span>
              </div>
              <span className="grid min-w-5 place-items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                {displayWishlistCount}
              </span>
            </Link>
          </div>

          <nav className="mt-4 flex flex-col gap-1" aria-label="Categories">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shop Categories</p>
            {[{ id: "all" as const, name: "All products" }, ...categories].map((c) => (
              <a
                key={c.id}
                href="#shop"
                onClick={() => {
                  setCategory(c.id);
                  setMenu(false);
                }}
                className="rounded-lg px-3 py-2.5 font-medium hover:bg-secondary text-sm"
              >
                {c.name}
              </a>
            ))}
          </nav>
          <button type="button" onClick={() => setMenu(false)} className="absolute right-4 top-4 hidden">
            <X />
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}
