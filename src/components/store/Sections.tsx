import { BookOpen, Check, Cookie, Cpu, Home, LayoutGrid, PencilLine, RotateCcw, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { CategoryId } from "@/lib/types";
import { useStore } from "@/lib/store";
import { ProductCard } from "./ProductCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const catIcons: Record<string, typeof Cookie> = {
  snacks: Cookie,
  stationery: PencilLine,
  "personal-care": Sparkles,
  hostel: Home,
  electronics: Cpu,
  exam: BookOpen,
};

type SortOption = "popular" | "price-asc" | "price-desc" | "name";
type FilterOption = "all" | "in-stock" | "bestseller" | "new";

export function CategoryGrid() {
  const { category, setCategory, categories } = useStore();

  return (
    <section id="categories" className="container-page py-3 sm:py-4">
      <div className="flex items-center justify-between pb-2.5">
        <h2 className="font-display text-lg font-bold sm:text-xl">Shop by category</h2>
        {category !== "all" && (
          <button
            type="button"
            onClick={() => setCategory("all")}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Show all
          </button>
        )}
      </div>

      <div
        className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-6 sm:gap-3 sm:px-0"
        role="tablist"
        aria-label="Shop by category"
      >
        {categories.map((c) => {
          const Icon = catIcons[c.id] || Cookie;
          const active = category === c.id;

          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategory(active ? "all" : c.id)}
              className={cn(
                "group flex shrink-0 items-center gap-2.5 rounded-xl border p-2.5 text-left transition sm:flex-col sm:items-center sm:gap-2 sm:rounded-2xl sm:p-3 sm:text-center",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border/70 bg-[#F0F1E7] text-foreground hover:border-primary/40 hover:bg-[#EAECE0]"
              )}
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg transition sm:size-11 sm:rounded-xl",
                  active
                    ? "bg-lime text-lime-foreground"
                    : "bg-card text-primary shadow-2xs group-hover:scale-105"
                )}
              >
                <Icon className="size-4 sm:size-5" />
              </span>
              <div className="min-w-0">
                <span className="block truncate text-xs font-semibold leading-tight sm:text-sm">
                  {c.name}
                </span>
                <span
                  className={cn(
                    "hidden text-[11px] sm:block",
                    active ? "text-primary-foreground/80" : "text-muted-foreground"
                  )}
                >
                  {c.blurb}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ProductGrid() {
  const { search, category, setCategory, setSearch, products, categories, isLoadingCatalog } = useStore();
  const [sortBy, setSortBy] = useState<SortOption>("popular");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return products
      .filter((p) => {
        const matchesCategory = category === "all" || p.category === category;
        const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
        const matchesFilter =
          filterBy === "all" ||
          (filterBy === "in-stock" && p.stock > 0) ||
          (filterBy === "bestseller" && p.bestseller) ||
          (filterBy === "new" && p.isNew);

        return matchesCategory && matchesSearch && matchesFilter;
      })
      .sort((a, b) => {
        if (sortBy === "price-asc") return a.price - b.price;
        if (sortBy === "price-desc") return b.price - a.price;
        if (sortBy === "name") return a.name.localeCompare(b.name);
        // "popular": bestsellers first, then available stock
        if (a.bestseller && !b.bestseller) return -1;
        if (!a.bestseller && b.bestseller) return 1;
        return b.stock - a.stock;
      });
  }, [products, search, category, filterBy, sortBy]);

  const activeCategoryObj = categories.find((c) => c.id === category);

  const headingText = search
    ? `Results for “${search}”`
    : category !== "all"
      ? activeCategoryObj?.name ?? "Products"
      : "All products";

  return (
    <section id="shop" className="container-page scroll-mt-24 py-4 sm:py-6">
      {/* Category Pills & Filters Bar */}
      <div className="flex flex-col gap-3 border-b border-border/80 pb-4">
        {/* Category quick-toggle pills */}
        <div
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0"
          role="tablist"
          aria-label="Filter products by category"
        >
          <button
            type="button"
            role="tab"
            aria-selected={category === "all"}
            onClick={() => setCategory("all")}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition",
              category === "all"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            )}
          >
            <LayoutGrid className="size-3.5" /> All items
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold transition",
                category === c.id
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              )}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Section title and Sort/Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
                {headingText}
              </h2>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {filteredProducts.length}
              </span>
            </div>
            {category !== "all" && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Showing items in {activeCategoryObj?.name}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Filter: In Stock Only */}
            <button
              type="button"
              onClick={() => setFilterBy(filterBy === "in-stock" ? "all" : "in-stock")}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition",
                filterBy === "in-stock"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {filterBy === "in-stock" && <Check className="size-3" />} In stock
            </button>

            {/* Quick Filter: Bestsellers */}
            <button
              type="button"
              onClick={() => setFilterBy(filterBy === "bestseller" ? "all" : "bestseller")}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition",
                filterBy === "bestseller"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {filterBy === "bestseller" && <Check className="size-3" />} Bestsellers
            </button>

            {/* Sort Selector */}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="hidden sm:inline">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="h-8 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-foreground outline-none transition focus:border-primary"
                aria-label="Sort products"
              >
                <option value="popular">Popular</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="name">Name: A to Z</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Product List or Empty State */}
      {filteredProducts.length === 0 ? (
        <div className="my-8 flex flex-col items-center rounded-2xl border border-dashed border-border bg-card p-8 text-center sm:p-12">
          <span className="grid size-12 place-items-center rounded-full bg-secondary text-primary">
            <Search className="size-5" />
          </span>
          <h3 className="mt-3 text-base font-bold sm:text-lg">No matching products found</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground sm:text-sm">
            Try adjusting your search terms, changing the category, or clearing active filters.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch("");
                setCategory("all");
                setFilterBy("all");
              }}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" /> Reset all filters
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filteredProducts.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </section>
  );
}

export function RecentlyAdded() {
  const { setCategory, setSearch, products } = useStore();
  const list = products.filter((p) => p.isNew);

  if (list.length === 0) return null;

  return (
    <section className="container-page border-t border-border/80 py-6 sm:py-8">
      <div className="flex items-center justify-between pb-3">
        <div>
          <h2 className="font-display text-lg font-bold sm:text-xl">Recently added</h2>
          <p className="text-xs text-muted-foreground">Fresh hostel essentials just restocked</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCategory("all");
            setSearch("");
            document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" });
          }}
          className="text-xs font-semibold text-primary hover:underline"
        >
          View all
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {list.slice(0, 4).map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
