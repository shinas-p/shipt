import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { Search, X, Loader2, ArrowRight, PackageSearch } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import type { Product } from "@/lib/types";
import { formatINR } from "@/data/products";
import { BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { cn } from "@/lib/utils";

export interface SearchBarProps {
  className?: string;
  placeholder?: string;
}

export function SearchBar({
  className = "",
  placeholder = "Search snacks, stationery, electronics…",
}: SearchBarProps) {
  const navigate = useNavigate();
  const idPrefix = useId();
  const {
    search,
    setSearch,
    products,
    categories,
    isLoadingCatalog,
    setDetail,
  } = useStore();

  const [inputValue, setInputValue] = useState(search);
  const [debouncedQuery, setDebouncedQuery] = useState(search);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Sync internal input value if global store search changes externally (e.g. filter cleared)
  useEffect(() => {
    setInputValue(search);
    setDebouncedQuery(search);
  }, [search]);

  // Debounce input updates to avoid lagging keystrokes while typing
  useEffect(() => {
    if (inputValue === debouncedQuery) {
      setIsDebouncing(false);
      return;
    }

    setIsDebouncing(true);
    const timer = setTimeout(() => {
      setDebouncedQuery(inputValue);
      setIsDebouncing(false);
    }, 160);

    return () => clearTimeout(timer);
  }, [inputValue, debouncedQuery]);

  // Compute matched products ranked by relevance
  const { suggestions, totalMatches } = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (q.length < 2) {
      return { suggestions: [], totalMatches: 0 };
    }

    const tokens = q.split(/\s+/).filter(Boolean);

    // Calculate score for each real catalogue product
    const scored: { product: Product; score: number }[] = [];

    for (const p of products) {
      const nameLower = (p.name || "").toLowerCase();
      const catObj = categories.find((c) => c.id === p.category);
      const catNameLower = catObj ? catObj.name.toLowerCase() : p.category.toLowerCase();
      const sizeLower = (p.size || "").toLowerCase();
      const slugLower = (p.slug || "").toLowerCase();
      const descLower = (p.description || "").toLowerCase();

      let score = 0;

      // 1. Direct name matching
      if (nameLower === q) {
        score += 150;
      } else if (nameLower.startsWith(q)) {
        score += 100;
      } else if (nameLower.includes(q)) {
        score += 70;
      } else if (tokens.every((t) => nameLower.includes(t))) {
        score += 45;
      } else if (tokens.some((t) => nameLower.includes(t))) {
        score += 25;
      }

      // 2. Category matching
      if (catNameLower === q || p.category === q) {
        score += 40;
      } else if (catNameLower.startsWith(q)) {
        score += 30;
      } else if (catNameLower.includes(q)) {
        score += 20;
      }

      // 3. Secondary attributes (slug, size, description)
      if (slugLower.includes(q)) score += 20;
      if (sizeLower.includes(q)) score += 15;
      if (descLower.includes(q)) score += 8;

      // Only retain products with positive relevance
      if (score > 0) {
        // Boost in-stock products and bestsellers
        if (p.stock > 0) score += 12;
        if (p.bestseller) score += 6;
        if (p.isNew) score += 3;

        scored.push({ product: p, score });
      }
    }

    // Sort descending by score, then in-stock first, then alphabetically
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aInStock = a.product.stock > 0 ? 1 : 0;
      const bInStock = b.product.stock > 0 ? 1 : 0;
      if (bInStock !== aInStock) return bInStock - aInStock;
      return a.product.name.localeCompare(b.product.name);
    });

    return {
      suggestions: scored.slice(0, 5).map((s) => s.product),
      totalMatches: scored.length,
    };
  }, [debouncedQuery, products, categories]);

  // Total selectable items: suggestions + 1 (the "View all results" action if results exist)
  const totalSelectable = suggestions.length + (totalMatches > 0 ? 1 : 0);

  // Close dropdown on click outside
  useEffect(() => {
    function handlePointerDown(e: PointerEvent | MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  // Handle typing in search input
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setActiveIndex(-1);
    if (val.trim().length >= 2) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  // Clear query handler
  const handleClear = useCallback(() => {
    setInputValue("");
    setDebouncedQuery("");
    setSearch("");
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }, [setSearch]);

  // Handle native search clear if triggered by browser
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handleNativeSearch = () => {
      if (el.value === "") {
        handleClear();
      }
    };
    el.addEventListener("search", handleNativeSearch);
    return () => {
      el.removeEventListener("search", handleNativeSearch);
    };
  }, [handleClear]);

  // Navigate to product detail page
  const handleSelectProduct = useCallback(
    (product: Product) => {
      setIsOpen(false);
      setActiveIndex(-1);
      setDetail(product);
      navigate({
        to: "/product/$productId",
        params: { productId: product.id },
      });
    },
    [navigate, setDetail]
  );

  // Execute full search and navigate to catalog view
  const handleViewAllResults = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
    const q = inputValue.trim();
    setSearch(q);

    // Navigate to storefront home where the product catalog filters live
    navigate({ to: "/" });

    // Smoothly scroll to product section if on home view
    if (typeof window !== "undefined") {
      setTimeout(() => {
        const el =
          document.getElementById("catalog") ||
          document.getElementById("products") ||
          document.querySelector("main");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    }
  }, [inputValue, setSearch, navigate]);

  // Keyboard navigation support: Arrow Up/Down, Enter, Escape
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // If closed and user presses ArrowDown when query length >= 2, open it
    if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      if (inputValue.trim().length >= 2) {
        setIsOpen(true);
        setActiveIndex(0);
        e.preventDefault();
        return;
      }
    }

    if (e.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
      e.preventDefault();
      return;
    }

    if (!isOpen) {
      if (e.key === "Enter") {
        e.preventDefault();
        handleViewAllResults();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (totalSelectable === 0) return;
      setActiveIndex((prev) => (prev + 1 >= totalSelectable ? 0 : prev + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (totalSelectable === 0) return;
      setActiveIndex((prev) => (prev <= 0 ? totalSelectable - 1 : prev - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        const selected = suggestions[activeIndex];
        if (selected) {
          handleSelectProduct(selected);
        }
      } else {
        // activeIndex is on "View all results" or no active item selected
        handleViewAllResults();
      }
    }
  };

  const showDropdown =
    isOpen &&
    inputValue.trim().length >= 2;

  const showLoading = isDebouncing || isLoadingCatalog;
  const showEmpty =
    showDropdown &&
    !showLoading &&
    debouncedQuery.trim().length >= 2 &&
    totalMatches === 0;

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      role="search"
      aria-label="Sitewide product search"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors peer-focus:text-primary" />
        <input
          ref={inputRef}
          type="search"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (inputValue.trim().length >= 2) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="peer h-10 w-full rounded-full border border-input bg-card pl-9.5 pr-14 text-sm outline-none transition duration-150 focus:border-primary focus:ring-2 focus:ring-ring/30 shadow-2xs [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:appearance-none [&::-ms-clear]:hidden"
          aria-label="Search products"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls={showDropdown ? `${idPrefix}-search-results` : undefined}
          aria-activedescendant={
            activeIndex >= 0 && activeIndex < suggestions.length
              ? `${idPrefix}-suggestion-${activeIndex}`
              : activeIndex === suggestions.length
              ? `${idPrefix}-view-all`
              : undefined
          }
        />

        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {showLoading && (
            <Loader2
              className="size-3.5 animate-spin text-muted-foreground"
              aria-label="Searching catalog"
            />
          )}

          {inputValue && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              aria-label="Clear search"
              title="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Autocomplete Dropdown */}
      {showDropdown && (
        <div
          id={`${idPrefix}-search-results`}
          className="absolute left-0 right-0 top-full mt-1.5 z-50 overflow-hidden rounded-2xl border border-border/80 bg-card/98 text-card-foreground shadow-2xl backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-150"
          style={{ minWidth: "100%" }}
        >
          {showLoading && suggestions.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>Searching real catalog…</span>
            </div>
          ) : showEmpty ? (
            <div className="p-6 text-center" role="status">
              <div className="mx-auto mb-2.5 grid size-10 place-items-center rounded-full bg-muted/80 text-muted-foreground">
                <PackageSearch className="size-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                No matching products found
              </p>
              <p className="mx-auto mt-1 max-w-[260px] text-xs text-muted-foreground">
                We couldn&apos;t find anything for &ldquo;{debouncedQuery}&rdquo;.
                Try checking spelling or exploring other categories.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Products ({totalMatches})</span>
                <span className="text-[10px] lowercase text-muted-foreground/80 hidden sm:inline">
                  Use ↑↓ to navigate, Enter to select
                </span>
              </div>

              <ul
                ref={listRef}
                role="listbox"
                aria-label="Product suggestions"
                className="max-h-[min(65vh,380px)] overflow-y-auto overscroll-contain p-1.5 space-y-1"
              >
                {suggestions.map((p, idx) => {
                  const isSelected = activeIndex === idx;
                  const cat = categories.find((c) => c.id === p.category);
                  const catName = cat?.name || p.category;
                  const isOutOfStock = p.stock === 0;
                  const isLowStock = p.stock > 0 && p.stock <= 5;

                  return (
                    <li
                      key={p.id}
                      id={`${idPrefix}-suggestion-${idx}`}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => handleSelectProduct(p)}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl p-2 cursor-pointer transition-all duration-150 select-none",
                        isSelected
                          ? "bg-accent/80 text-accent-foreground shadow-2xs ring-1 ring-primary/20"
                          : "hover:bg-secondary/70"
                      )}
                    >
                      {/* Product Thumbnail */}
                      <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted border border-border/60">
                        <img
                          src={p.image}
                          alt={p.name}
                          loading="lazy"
                          className={cn(
                            "size-full object-cover transition-transform duration-200 group-hover:scale-105",
                            isOutOfStock && "opacity-50 grayscale"
                          )}
                          onError={(e) => {
                            e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                          }}
                        />
                      </div>

                      {/* Details: Name, Category, Stock Indicator */}
                      <div className="flex-1 min-w-0 pr-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "font-semibold text-sm truncate transition-colors",
                              isSelected
                                ? "text-primary"
                                : "text-foreground group-hover:text-primary"
                            )}
                          >
                            {p.name}
                          </span>
                        </div>

                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {catName && (
                            <span className="rounded-md bg-secondary/80 px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                              {catName}
                            </span>
                          )}

                          {p.size && (
                            <span className="text-[11px] text-muted-foreground/90">
                              • {p.size}
                            </span>
                          )}

                          {isOutOfStock ? (
                            <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                              Out of stock
                            </span>
                          ) : isLowStock ? (
                            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                              Only {p.stock} left
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              <span className="size-1.5 rounded-full bg-emerald-500" />
                              In stock
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Selling Price */}
                      <div className="shrink-0 text-right pl-2">
                        <div className="font-display text-sm font-bold text-primary">
                          {formatINR(p.price)}
                        </div>
                        {p.originalPrice && p.originalPrice > p.price && (
                          <div className="text-[11px] text-muted-foreground line-through">
                            {formatINR(p.originalPrice)}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* View all results footer */}
              {totalMatches > 0 && (
                <div className="p-1.5 border-t border-border/60 bg-muted/30">
                  <button
                    type="button"
                    role="option"
                    id={`${idPrefix}-view-all`}
                    aria-selected={activeIndex === suggestions.length}
                    onMouseEnter={() => setActiveIndex(suggestions.length)}
                    onClick={handleViewAllResults}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150",
                      activeIndex === suggestions.length
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-primary hover:bg-secondary"
                    )}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <Search className="size-3.5 shrink-0" />
                      <span>
                        View all {totalMatches} result{totalMatches > 1 ? "s" : ""}{" "}
                        for &ldquo;{debouncedQuery}&rdquo;
                      </span>
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 ml-2" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
