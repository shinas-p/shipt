import { useState, useCallback, useEffect } from "react";
import {
  Layers,
  Package,
  Tag,
  FileSpreadsheet,
  BarChart3,
  Boxes,
  Plus,
  RefreshCw,
  Coins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/data/products";
import { cn } from "@/lib/utils";
import type { DBProduct, DBCategory, BulkActionType } from "./types";
import { ProductTable } from "./ProductTable";
import { ProductFormModal } from "./ProductFormModal";
import { BulkActionsBar } from "./BulkActionsBar";
import { BulkOperationModal } from "./BulkOperationModal";
import { CategoriesTab } from "./CategoriesTab";
import { InventoryLedgerTab } from "./InventoryLedgerTab";
import { PricingPromotionsTab } from "./PricingPromotionsTab";
import { ProfitabilityTab } from "./ProfitabilityTab";
import { ImportExportTab } from "./ImportExportTab";
import { ProductReportsTab } from "./ProductReportsTab";
import { canManageCosts, type AdminRole } from "@/lib/permissions";

interface ProductManagementCenterProps {
  products: DBProduct[];
  categories: DBCategory[];
  orders: any[];
  adminRole: AdminRole | null;
  productsLoading: boolean;
  onRefreshProducts: () => Promise<void>;
  onRefreshCategories: () => Promise<void>;
  initialTab?: "catalog" | "categories" | "inventory" | "pricing" | "profitability" | "import_export" | "reports";
  onAddNewProduct?: () => void;
}

export function ProductManagementCenter({
  products,
  categories,
  orders,
  adminRole,
  productsLoading,
  onRefreshProducts,
  onRefreshCategories,
  initialTab = "catalog",
}: ProductManagementCenterProps) {
  const canSeeProfitability = canManageCosts(adminRole);
  // Center Sub-tabs: 'catalog' | 'categories' | 'inventory' | 'pricing' | 'profitability' | 'import_export' | 'reports'
  const [activeCenterTab, setActiveCenterTab] = useState<
    "catalog" | "categories" | "inventory" | "pricing" | "profitability" | "import_export" | "reports"
  >(initialTab === "profitability" && !canSeeProfitability ? "catalog" : initialTab);

  // Sync initialTab when changed from outside (e.g. quick dashboard links)
  useEffect(() => {
    if (initialTab) {
      if (initialTab === "profitability" && !canSeeProfitability) {
        setActiveCenterTab("catalog");
      } else {
        setActiveCenterTab(initialTab);
      }
    }
  }, [initialTab, canSeeProfitability]);

  // Selected Products for Bulk Actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkActionType, setBulkActionType] = useState<BulkActionType | null>(null);

  // Add / Edit Modal State
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<DBProduct | null>(null);

  const selectedProducts = products.filter((p) => selectedIds.includes(p.id));

  // Selection handlers
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = (ids: string[]) => {
    setSelectedIds(ids);
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
  };

  const openCreateModal = () => {
    setEditingProduct(null);
    setFormModalOpen(true);
  };

  const openEditModal = (p: DBProduct) => {
    setEditingProduct(p);
    setFormModalOpen(true);
  };

  const handleRefreshAll = async () => {
    await Promise.all([onRefreshProducts(), onRefreshCategories()]);
  };

  // Top metric counters
  const totalUnits = products.reduce((sum, p) => sum + p.stock, 0);
  const outOfStockCount = products.filter((p) => p.stock === 0).length;
  const lowStockCount = products.filter((p) => p.stock > 0 && p.stock <= 5).length;
  const discountedCount = products.filter(
    (p) => p.original_price != null && p.original_price > p.price
  ).length;

  return (
    <div className="space-y-6">
      {/* Product Management Sub-Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          <button
            type="button"
            onClick={() => setActiveCenterTab("catalog")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition shrink-0",
              activeCenterTab === "catalog"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <Boxes className="size-4" />
            <span>Products ({products.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCenterTab("categories")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition shrink-0",
              activeCenterTab === "categories"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <Layers className="size-4" />
            <span>Categories ({categories.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCenterTab("inventory")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition shrink-0",
              activeCenterTab === "inventory"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <Package className="size-4" />
            <span>Inventory</span>
            {(outOfStockCount > 0 || lowStockCount > 0) && (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                {outOfStockCount + lowStockCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveCenterTab("pricing")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition shrink-0",
              activeCenterTab === "pricing"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <Tag className="size-4" />
            <span>Pricing & Promotions</span>
            {discountedCount > 0 && (
              <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                {discountedCount}
              </span>
            )}
          </button>

          {canSeeProfitability && (
            <button
              type="button"
              onClick={() => setActiveCenterTab("profitability")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition shrink-0",
                activeCenterTab === "profitability"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Coins className="size-4" />
              <span>Profitability & Costs</span>
              <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">
                Private
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveCenterTab("import_export")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition shrink-0",
              activeCenterTab === "import_export"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <FileSpreadsheet className="size-4" />
            <span>Import / Export</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCenterTab("reports")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition shrink-0",
              activeCenterTab === "reports"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <BarChart3 className="size-4" />
            <span>Reports</span>
          </button>
        </div>
      </div>

      {/* TAB 1: PRODUCT CATALOG */}
      {activeCenterTab === "catalog" && (
        <ProductTable
          products={products}
          categories={categories}
          loading={productsLoading}
          onRefresh={handleRefreshAll}
          onOpenCreate={openCreateModal}
          onOpenEdit={openEditModal}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
        />
      )}

      {/* TAB 2: CATEGORIES */}
      {activeCenterTab === "categories" && (
        <CategoriesTab
          categories={categories}
          products={products}
          adminRole={adminRole}
          onRefresh={handleRefreshAll}
        />
      )}

      {/* TAB 3: INVENTORY */}
      {activeCenterTab === "inventory" && (
        <InventoryLedgerTab
          products={products}
          onRefreshProducts={handleRefreshAll}
          onOpenQuickEdit={openEditModal}
        />
      )}

      {/* TAB 4: PRICING */}
      {activeCenterTab === "pricing" && (
        <PricingPromotionsTab
          products={products}
          categories={categories}
          onRefreshProducts={handleRefreshAll}
          onOpenQuickEdit={openEditModal}
        />
      )}

      {/* TAB 5: PROFITABILITY & COSTS (SUPER ADMIN & OWNER ONLY) */}
      {activeCenterTab === "profitability" && canSeeProfitability && (
        <ProfitabilityTab
          products={products}
          categories={categories}
          onOpenEdit={openEditModal}
          onRefreshProducts={handleRefreshAll}
        />
      )}

      {/* TAB 5: IMPORT / EXPORT */}
      {activeCenterTab === "import_export" && (
        <ImportExportTab
          products={products}
          categories={categories}
          selectedIds={selectedIds}
          onRefreshProducts={handleRefreshAll}
        />
      )}

      {/* TAB 6: REPORTS */}
      {activeCenterTab === "reports" && (
        <ProductReportsTab
          products={products}
          categories={categories}
          orders={orders}
        />
      )}

      {/* Bulk Action Bar (Docked when items are checked) */}
      <BulkActionsBar
        selectedCount={selectedIds.length}
        onClearSelection={handleClearSelection}
        onTriggerAction={(type) => setBulkActionType(type)}
      />

      {/* Bulk Operation Execution & Confirmation Dialog */}
      <BulkOperationModal
        open={bulkActionType !== null}
        onOpenChange={(open) => !open && setBulkActionType(null)}
        operationType={bulkActionType}
        selectedProducts={selectedProducts}
        categories={categories}
        onSuccess={handleRefreshAll}
        onClearSelection={handleClearSelection}
      />

      {/* Create / Edit Product Modal */}
      <ProductFormModal
        open={formModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFormModalOpen(false);
            setEditingProduct(null);
          }
        }}
        product={editingProduct}
        categories={categories}
        adminRole={adminRole}
        onSaveSuccess={handleRefreshAll}
      />
    </div>
  );
}
