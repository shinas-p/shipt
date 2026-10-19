import { useState, useMemo } from "react";
import {
  Search,
  Filter,
  ArrowUpDown,
  Plus,
  RefreshCw,
  LayoutGrid,
  List,
  Edit3,
  Copy,
  Trash2,
  Archive,
  RotateCcw,
  Eye,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Package,
  Layers,
  CheckSquare,
  Square,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/data/products";
import { BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBProduct, DBCategory, ProductFilters, ProductSortField, SortDirection } from "./types";
import { QuickEditModal } from "./QuickEditModal";
import { ProductPreviewModal } from "./ProductPreviewModal";

interface ProductTableProps {
  products: DBProduct[];
  categories: DBCategory[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenCreate: () => void;
  onOpenEdit: (p: DBProduct) => void;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelection: () => void;
}

export function ProductTable({
  products,
  categories,
  loading,
  onRefresh,
  onOpenCreate,
  onOpenEdit,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
}: ProductTableProps) {
  // View mode
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");

  // Filters State
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [stockStatus, setStockStatus] = useState<"all" | "in_stock" | "low_stock" | "out_of_stock">("all");
  const [activeStatus, setActiveStatus] = useState<"all" | "active" | "archived">("all");
  const [bestsellerFilter, setBestsellerFilter] = useState<"all" | "yes" | "no">("all");

  // Sorting State
  const [sortField, setSortField] = useState<ProductSortField>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Quick Edit and Preview modals
  const [quickEditProduct, setQuickEditProduct] = useState<DBProduct | null>(null);
  const [previewProduct, setPreviewProduct] = useState<DBProduct | null>(null);

  // Filtered & Sorted Products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // 1. Search filter
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesDesc = (p.description || "").toLowerCase().includes(q);
        const matchesSlug = (p.slug || "").toLowerCase().includes(q);
        const matchesId = p.id.toLowerCase().includes(q);
        const matchesSize = (p.size || "").toLowerCase().includes(q);
        if (!matchesName && !matchesDesc && !matchesSlug && !matchesId && !matchesSize) {
          return false;
        }
      }

      // 2. Category filter
      if (selectedCategory !== "all" && p.category_id !== selectedCategory) {
        return false;
      }

      // 3. Stock filter
      if (stockStatus === "out_of_stock" && p.stock !== 0) return false;
      if (stockStatus === "low_stock" && (p.stock === 0 || p.stock > 5)) return false;
      if (stockStatus === "in_stock" && p.stock <= 5) return false;

      // 4. Active status filter
      if (activeStatus === "active" && !p.is_active) return false;
      if (activeStatus === "archived" && p.is_active) return false;

      // 5. Bestseller filter
      if (bestsellerFilter === "yes" && !p.bestseller) return false;
      if (bestsellerFilter === "no" && p.bestseller) return false;

      return true;
    }).sort((a, b) => {
      let comparison = 0;
      if (sortField === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === "price") {
        comparison = a.price - b.price;
      } else if (sortField === "stock") {
        comparison = a.stock - b.stock;
      } else if (sortField === "display_order") {
        comparison = (a.display_order ?? 0) - (b.display_order ?? 0);
      } else if (sortField === "created_at") {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        comparison = timeA - timeB;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [
    products,
    search,
    selectedCategory,
    stockStatus,
    activeStatus,
    bestsellerFilter,
    sortField,
    sortDirection,
  ]);

  // Pagination calculation
  const totalItems = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const startIndex = (effectivePage - 1) * pageSize;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + pageSize);

  // Selection helpers
  const currentPageIds = paginatedProducts.map((p) => p.id);
  const isAllCurrentSelected =
    currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.includes(id));

  const toggleSelectAllCurrent = () => {
    if (isAllCurrentSelected) {
      // Unselect current page
      onSelectAll(selectedIds.filter((id) => !currentPageIds.includes(id)));
    } else {
      // Add current page to selection
      const merged = Array.from(new Set([...selectedIds, ...currentPageIds]));
      onSelectAll(merged);
    }
  };

  // Duplicate Product Action
  const handleDuplicate = async (p: DBProduct) => {
    try {
      const newName = `${p.name} (Copy)`;
      const newSlug = `${(p.slug || p.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-copy-${Date.now().toString().slice(-4)}`;

      const { data, error } = await supabase
        .from("products")
        .insert([
          {
            name: newName,
            slug: newSlug,
            size: p.size,
            description: p.description,
            price: p.price,
            original_price: p.original_price,
            category_id: p.category_id,
            image_url: p.image_url,
            stock: p.stock,
            bestseller: false,
            is_new: true,
            is_active: false, // Save duplicate as draft/inactive initially for review
            display_order: (p.display_order ?? 0) + 1,
          },
        ])
        .select()
        .single();

      if (error) {
        toast.error(`Duplication failed: ${error.message}`);
        return;
      }

      toast.success(`Duplicated "${p.name}" as draft "${newName}".`);
      await onRefresh();
    } catch (err: any) {
      toast.error(`Error: ${err?.message || "Failed to duplicate product"}`);
    }
  };

  // Archive / Restore Product Action
  const handleToggleArchive = async (p: DBProduct) => {
    try {
      const nextActive = !p.is_active;
      const { error } = await supabase
        .from("products")
        .update({ is_active: nextActive })
        .eq("id", p.id);

      if (error) {
        toast.error(`Update failed: ${error.message}`);
        return;
      }

      toast.success(
        nextActive
          ? `Restored "${p.name}" to active storefront.`
          : `Archived "${p.name}" (hidden from storefront, order history safe).`
      );
      await onRefresh();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    }
  };

  // Delete product action with reference check
  const handleDelete = async (p: DBProduct) => {
    if (!confirm(`Are you sure you want to delete "${p.name}"?`)) return;

    try {
      // Check if referenced in order_items
      const { data: orderItemRefs } = await supabase
        .from("order_items")
        .select("id")
        .eq("product_id", p.id)
        .limit(1);

      if (orderItemRefs && orderItemRefs.length > 0) {
        // Safe protection: do not delete, archive instead
        await supabase
          .from("products")
          .update({ is_active: false })
          .eq("id", p.id);

        toast.info(
          `"${p.name}" has been purchased in previous orders. To safeguard customer receipt history, it has been Archived instead of permanently deleted.`
        );
      } else {
        const { error } = await supabase.from("products").delete().eq("id", p.id);
        if (error) {
          toast.error(`Deletion failed: ${error.message}`);
          return;
        }
        toast.success(`Product "${p.name}" deleted.`);
      }
      await onRefresh();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Table Top Controls & Search Bar */}
      <div className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 sm:p-5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-foreground">
              Campus Catalogue ({totalItems} items)
            </h3>
            {selectedIds.length > 0 && (
              <Badge variant="outline" className="text-xs font-bold text-primary border-primary/30">
                {selectedIds.length} selected
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center rounded-xl border border-border bg-secondary/50 p-1">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={cn(
                  "rounded-lg p-1.5 transition",
                  viewMode === "table"
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Dense Table View"
              >
                <List className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={cn(
                  "rounded-lg p-1.5 transition",
                  viewMode === "grid"
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Visual Card Grid"
              >
                <LayoutGrid className="size-4" />
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="h-9 gap-1 text-xs"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>

            <Button
              variant="hero"
              size="sm"
              onClick={onOpenCreate}
              className="h-9 gap-1.5 text-xs font-bold px-3.5"
            >
              <Plus className="size-4" />
              <span>Add Product</span>
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 pt-1">
          {/* Search */}
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by name, slug, size, ID..."
              className="h-9 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>

          {/* Category Filter */}
          <div>
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 w-full rounded-xl border border-input bg-card px-2.5 text-xs outline-none focus:border-primary capitalize"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Stock Filter */}
          <div>
            <select
              value={stockStatus}
              onChange={(e) => {
                setStockStatus(e.target.value as any);
                setCurrentPage(1);
              }}
              className="h-9 w-full rounded-xl border border-input bg-card px-2.5 text-xs outline-none focus:border-primary"
            >
              <option value="all">All Stock Levels</option>
              <option value="in_stock">In Stock (&gt; 5)</option>
              <option value="low_stock">Low Stock (1–5)</option>
              <option value="out_of_stock">Out of Stock (0)</option>
            </select>
          </div>

          {/* Active/Status Filter */}
          <div>
            <select
              value={activeStatus}
              onChange={(e) => {
                setActiveStatus(e.target.value as any);
                setCurrentPage(1);
              }}
              className="h-9 w-full rounded-xl border border-input bg-card px-2.5 text-xs outline-none focus:border-primary"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active / Published</option>
              <option value="archived">Archived / Draft</option>
            </select>
          </div>
        </div>

        {/* Sorting and Page Size Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium">Sort by:</span>
            <select
              value={`${sortField}-${sortDirection}`}
              onChange={(e) => {
                const [f, d] = e.target.value.split("-") as [ProductSortField, SortDirection];
                setSortField(f);
                setSortDirection(d);
              }}
              className="h-7 rounded-lg border border-input bg-card px-2 text-xs font-semibold outline-none"
            >
              <option value="created_at-desc">Newest Added</option>
              <option value="created_at-asc">Oldest Added</option>
              <option value="name-asc">Name (A → Z)</option>
              <option value="name-desc">Name (Z → A)</option>
              <option value="price-asc">Price (Low → High)</option>
              <option value="price-desc">Price (High → Low)</option>
              <option value="stock-asc">Stock (Low → High)</option>
              <option value="stock-desc">Stock (High → Low)</option>
            </select>

            {(search || selectedCategory !== "all" || stockStatus !== "all" || activeStatus !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setSelectedCategory("all");
                  setStockStatus("all");
                  setActiveStatus("all");
                  setCurrentPage(1);
                }}
                className="h-7 text-xs text-primary hover:underline px-2"
              >
                Reset Filters
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-7 rounded-lg border border-input bg-card px-2 text-xs font-semibold outline-none"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>

      {/* RENDER TABLE OR GRID VIEW */}
      {paginatedProducts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground bg-card">
          <Package className="size-10 mx-auto text-muted-foreground mb-3 opacity-60" />
          <p className="font-semibold text-foreground">No products match your filters</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try adjusting your search query, category selection, or stock level filters.
          </p>
        </div>
      ) : viewMode === "table" ? (
        /* DENSE TABLE VIEW */
        <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-2xs">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="p-3.5 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllCurrentSelected}
                    onChange={toggleSelectAllCurrent}
                    className="size-4 rounded text-primary cursor-pointer"
                    title="Select all on this page"
                  />
                </th>
                <th className="p-3.5 font-semibold">Product</th>
                <th className="p-3.5 font-semibold">Category</th>
                <th className="p-3.5 font-semibold">Price</th>
                <th className="p-3.5 font-semibold">Stock</th>
                <th className="p-3.5 font-semibold">Status</th>
                <th className="p-3.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {paginatedProducts.map((p) => {
                const isSelected = selectedIds.includes(p.id);
                const isOutOfStock = p.stock === 0;
                const isLowStock = p.stock > 0 && p.stock <= 5;
                const discount =
                  p.original_price && p.original_price > p.price
                    ? Math.round((1 - p.price / p.original_price) * 100)
                    : 0;

                return (
                  <tr
                    key={p.id}
                    className={cn(
                      "transition hover:bg-secondary/30",
                      isSelected && "bg-primary/5 hover:bg-primary/10",
                      !p.is_active && "opacity-75 bg-muted/20"
                    )}
                  >
                    {/* Checkbox */}
                    <td className="p-3.5 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(p.id)}
                        className="size-4 rounded text-primary cursor-pointer"
                      />
                    </td>

                    {/* Product Name & Thumbnail */}
                    <td className="p-3.5">
                      <div className="flex items-center gap-3">
                        <img
                          src={p.image_url || BRAND_FALLBACK_IMAGE}
                          alt=""
                          className="size-11 rounded-xl object-cover bg-muted border border-border shrink-0"
                          onError={(e) => {
                            e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                          }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-foreground text-sm truncate max-w-[200px] sm:max-w-[280px]">
                              {p.name}
                            </span>
                            {p.bestseller && (
                              <span className="rounded-md bg-forest/15 px-1.5 py-0.5 text-[9px] font-bold text-forest">
                                Bestseller
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {p.size} {p.slug ? `· slug: ${p.slug}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="p-3.5 capitalize text-muted-foreground font-medium">
                      {p.category_id}
                    </td>

                    {/* Price & Discount */}
                    <td className="p-3.5">
                      <div className="font-mono">
                        <span className="font-bold text-foreground text-sm">
                          {formatINR(p.price)}
                        </span>
                        {p.original_price != null && p.original_price > p.price && (
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="line-through">{formatINR(p.original_price)}</span>
                            <span className="text-emerald-600 font-semibold">({discount}% off)</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Stock */}
                    <td className="p-3.5">
                      <span
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-bold font-mono inline-block",
                          isOutOfStock
                            ? "bg-destructive/10 text-destructive"
                            : isLowStock
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        {p.stock} units
                      </span>
                    </td>

                    {/* Status Badge */}
                    <td className="p-3.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-bold uppercase",
                          p.is_active
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "border-muted bg-muted/60 text-muted-foreground"
                        )}
                      >
                        {p.is_active ? "Published" : "Archived"}
                      </Badge>
                    </td>

                    {/* Row Actions */}
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreviewProduct(p)}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                          title="Preview Storefront"
                        >
                          <Eye className="size-3.5" />
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setQuickEditProduct(p)}
                          className="h-8 gap-1 text-xs font-semibold px-2.5"
                          title="Quick Edit"
                        >
                          <Edit3 className="size-3" />
                          <span>Quick</span>
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenEdit(p)}
                          className="h-8 text-xs font-semibold px-2 hover:bg-secondary"
                          title="Full Edit"
                        >
                          Edit
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDuplicate(p)}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                          title="Duplicate Product"
                        >
                          <Copy className="size-3.5" />
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleArchive(p)}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                          title={p.is_active ? "Archive Product" : "Restore Product"}
                        >
                          {p.is_active ? (
                            <Archive className="size-3.5" />
                          ) : (
                            <RotateCcw className="size-3.5 text-emerald-600" />
                          )}
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(p)}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          title="Delete Product"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* VISUAL CARD GRID VIEW */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {paginatedProducts.map((p) => {
            const isSelected = selectedIds.includes(p.id);
            const isOutOfStock = p.stock === 0;
            const isLowStock = p.stock > 0 && p.stock <= 5;
            const discount =
              p.original_price && p.original_price > p.price
                ? Math.round((1 - p.price / p.original_price) * 100)
                : 0;

            return (
              <div
                key={p.id}
                className={cn(
                  "overflow-hidden rounded-3xl border border-border bg-card p-4 shadow-2xs transition hover:border-primary/40 flex flex-col justify-between",
                  isSelected && "border-primary ring-2 ring-primary/20",
                  !p.is_active && "opacity-75"
                )}
              >
                <div>
                  <div className="relative h-44 w-full overflow-hidden rounded-2xl bg-muted border border-border">
                    <img
                      src={p.image_url || BRAND_FALLBACK_IMAGE}
                      alt={p.name}
                      className="size-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                      }}
                    />

                    {/* Selection Checkbox */}
                    <button
                      type="button"
                      onClick={() => onToggleSelect(p.id)}
                      className="absolute left-2.5 top-2.5 rounded-lg bg-card/90 p-1.5 shadow-sm backdrop-blur transition hover:scale-105"
                    >
                      {isSelected ? (
                        <CheckSquare className="size-4 text-primary" />
                      ) : (
                        <Square className="size-4 text-muted-foreground" />
                      )}
                    </button>

                    <div className="absolute right-2 top-2 flex flex-col gap-1 items-end">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase backdrop-blur shadow-2xs",
                          isOutOfStock
                            ? "bg-destructive text-destructive-foreground"
                            : isLowStock
                            ? "bg-amber-500 text-white"
                            : "bg-primary text-primary-foreground"
                        )}
                      >
                        {isOutOfStock ? "Out of Stock" : `${p.stock} in stock`}
                      </span>

                      {!p.is_active && (
                        <span className="rounded-full bg-muted/90 px-2 py-0.5 text-[9px] font-bold uppercase text-foreground">
                          Archived
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {p.category_id}
                    </span>
                    <h4 className="font-display text-sm font-bold text-foreground line-clamp-1">
                      {p.name}
                    </h4>
                    <p className="text-xs text-muted-foreground">{p.size}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                  <div>
                    <span className="font-mono text-sm font-extrabold text-foreground">
                      {formatINR(p.price)}
                    </span>
                    {p.original_price != null && p.original_price > p.price && (
                      <span className="ml-1 text-[11px] text-muted-foreground line-through">
                        {formatINR(p.original_price)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQuickEditProduct(p)}
                      className="h-8 text-xs font-semibold px-2"
                    >
                      Quick
                    </Button>
                    <Button
                      type="button"
                      variant="hero"
                      size="sm"
                      onClick={() => onOpenEdit(p)}
                      className="h-8 text-xs font-semibold px-2.5"
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Footer Controls */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3.5 text-xs text-muted-foreground">
          <p>
            Showing <strong>{startIndex + 1}</strong> to{" "}
            <strong>{Math.min(startIndex + pageSize, totalItems)}</strong> of{" "}
            <strong>{totalItems}</strong> products
          </p>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="h-8 gap-1 px-2.5 text-xs"
            >
              <ChevronLeft className="size-3.5" />
              <span>Previous</span>
            </Button>

            <span className="px-2 font-semibold text-foreground">
              Page {currentPage} of {totalPages}
            </span>

            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 gap-1 px-2.5 text-xs"
            >
              <span>Next</span>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Quick Edit Modal */}
      <QuickEditModal
        product={quickEditProduct}
        open={quickEditProduct !== null}
        onOpenChange={(open) => !open && setQuickEditProduct(null)}
        onSuccess={onRefresh}
      />

      {/* Product Preview Modal */}
      <ProductPreviewModal
        product={previewProduct}
        categories={categories}
        open={previewProduct !== null}
        onOpenChange={(open) => !open && setPreviewProduct(null)}
      />
    </div>
  );
}
