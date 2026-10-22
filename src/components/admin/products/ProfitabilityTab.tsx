import { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  Coins,
  Lock,
  Download,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Edit3,
  RefreshCw,
  Layers,
  ArrowUpDown,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatINR } from "@/data/products";
import {
  fetchAllProductCosts,
  buildProductProfitabilityList,
  saveProductCost,
  calculateProfitMetrics,
  type ProductCostRecord,
  type ProductProfitabilityItem,
} from "@/lib/profitability";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBProduct, DBCategory } from "./types";

interface ProfitabilityTabProps {
  products: DBProduct[];
  categories: DBCategory[];
  onOpenEdit: (p: DBProduct) => void;
  onRefreshProducts: () => Promise<void>;
}

export function ProfitabilityTab({
  products,
  categories,
  onOpenEdit,
  onRefreshProducts,
}: ProfitabilityTabProps) {
  const [costMap, setCostMap] = useState<Record<string, ProductCostRecord>>({});
  const [loadingCosts, setLoadingCosts] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [marginFilter, setMarginFilter] = useState<
    "all" | "high" | "healthy" | "low" | "loss" | "missing"
  >("all");

  // Inline Quick Cost Edit Dialog
  const [editingCostItem, setEditingCostItem] = useState<ProductProfitabilityItem | null>(null);
  const [editSupplierCost, setEditSupplierCost] = useState("");
  const [editOtherCosts, setEditOtherCosts] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingCost, setSavingCost] = useState(false);

  // Load product costs from Supabase (restricted by RLS)
  const loadCosts = async () => {
    setLoadingCosts(true);
    try {
      const data = await fetchAllProductCosts();
      setCostMap(data);
    } catch {
      toast.error("Failed to load private cost records.");
    } finally {
      setLoadingCosts(false);
    }
  };

  useEffect(() => {
    loadCosts();
  }, []);

  // Compute full profitability list
  const profitabilityList = useMemo(() => {
    return buildProductProfitabilityList(products, costMap);
  }, [products, costMap]);

  // Aggregate Top KPIs
  const kpis = useMemo(() => {
    let totalStock = 0;
    let totalRetailValue = 0;
    let totalCostValue = 0;
    let totalPotentialProfit = 0;
    let itemsWithCost = 0;
    let lossCount = 0;
    let totalMarginSum = 0;

    for (const item of profitabilityList) {
      totalStock += item.stock;
      totalRetailValue += item.price * item.stock;

      if (item.hasCostData) {
        itemsWithCost++;
        totalCostValue += item.inventoryCostValue;
        totalPotentialProfit += item.inventoryProfitPotential;
        totalMarginSum += item.profitMarginPct;

        if (item.estimatedProfit < 0) {
          lossCount++;
        }
      }
    }

    const avgMargin = itemsWithCost > 0 ? totalMarginSum / itemsWithCost : 0;
    const coveragePct =
      profitabilityList.length > 0
        ? Math.round((itemsWithCost / profitabilityList.length) * 100)
        : 0;

    return {
      totalStock,
      totalRetailValue,
      totalCostValue,
      totalPotentialProfit,
      itemsWithCost,
      lossCount,
      avgMargin,
      coveragePct,
    };
  }, [profitabilityList]);

  // Filtered List
  const filteredList = useMemo(() => {
    return profitabilityList.filter((item) => {
      // Search by product name
      if (search.trim()) {
        const query = search.toLowerCase();
        if (!item.productName.toLowerCase().includes(query)) {
          return false;
        }
      }

      // Filter by category
      if (selectedCategory !== "all" && item.categoryId !== selectedCategory) {
        return false;
      }

      // Filter by margin status
      if (marginFilter === "missing") {
        return !item.hasCostData;
      }
      if (marginFilter === "loss") {
        return item.hasCostData && item.estimatedProfit < 0;
      }
      if (marginFilter === "low") {
        return item.hasCostData && item.estimatedProfit >= 0 && item.profitMarginPct < 20;
      }
      if (marginFilter === "healthy") {
        return item.hasCostData && item.profitMarginPct >= 20 && item.profitMarginPct < 40;
      }
      if (marginFilter === "high") {
        return item.hasCostData && item.profitMarginPct >= 40;
      }

      return true;
    });
  }, [profitabilityList, search, selectedCategory, marginFilter]);

  // Open inline cost editor
  const handleOpenCostEditor = (item: ProductProfitabilityItem) => {
    setEditingCostItem(item);
    setEditSupplierCost(item.supplierCost > 0 ? String(item.supplierCost) : "");
    setEditOtherCosts(item.otherCosts > 0 ? String(item.otherCosts) : "");
    setEditNotes(item.notes || "");
  };

  // Save inline cost update
  const handleSaveInlineCost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCostItem) return;

    const suppNum = editSupplierCost.trim() ? parseFloat(editSupplierCost) : 0;
    const otherNum = editOtherCosts.trim() ? parseFloat(editOtherCosts) : 0;

    if (isNaN(suppNum) || suppNum < 0) {
      toast.error("Supplier cost must be a non-negative number.");
      return;
    }
    if (isNaN(otherNum) || otherNum < 0) {
      toast.error("Other costs must be a non-negative number.");
      return;
    }

    setSavingCost(true);
    try {
      const res = await saveProductCost(
        editingCostItem.productId,
        suppNum,
        otherNum,
        editNotes
      );
      if (!res.success) {
        toast.error(`Failed to save cost: ${res.error}`);
        return;
      }

      toast.success(`Updated private cost for "${editingCostItem.productName}"!`);
      setCostMap((prev) => ({
        ...prev,
        [editingCostItem.productId]: {
          product_id: editingCostItem.productId,
          supplier_cost: suppNum,
          other_costs: otherNum,
          notes: editNotes.trim(),
          updated_at: new Date().toISOString(),
        },
      }));
      setEditingCostItem(null);
    } catch (err: any) {
      toast.error(`Save error: ${err?.message}`);
    } finally {
      setSavingCost(false);
    }
  };

  // Live preview metrics for inline modal
  const inlinePreviewMetrics = useMemo(() => {
    if (!editingCostItem) return null;
    return calculateProfitMetrics(editingCostItem.price, editSupplierCost, editOtherCosts);
  }, [editingCostItem, editSupplierCost, editOtherCosts]);

  // Export Profitability Report to Excel
  const handleExportExcel = () => {
    const rows = profitabilityList.map((item) => {
      const cat = categories.find((c) => c.id === item.categoryId);
      return {
        Product_ID: item.productId,
        Product_Name: item.productName,
        Size_Packaging: item.size,
        Category: cat?.name || item.categoryId,
        Selling_Price_INR: item.price,
        Supplier_Cost_INR: item.supplierCost,
        Other_Costs_INR: item.otherCosts,
        Total_Unit_Cost_INR: item.totalCost,
        Unit_Profit_INR: item.estimatedProfit,
        Profit_Margin_Percent: item.hasCostData ? item.profitMarginPct : "N/A",
        Markup_Percent: item.hasCostData ? item.markupPct : "N/A",
        Warehouse_Stock: item.stock,
        Total_Inventory_Cost_INR: item.inventoryCostValue,
        Potential_Inventory_Profit_INR: item.inventoryProfitPotential,
        Status: item.isActive ? "Active" : "Archived",
        Cost_Entered: item.hasCostData ? "Yes" : "No",
        Sourcing_Notes: item.notes,
        Last_Cost_Update: item.costUpdatedAt || "Not Set",
      };
    });

    const summary = [
      { Metric: "Total Products", Value: profitabilityList.length },
      { Metric: "Products With Cost Data", Value: kpis.itemsWithCost },
      { Metric: "Cost Entry Coverage", Value: `${kpis.coveragePct}%` },
      { Metric: "Total Warehouse Inventory Cost (INR)", Value: kpis.totalCostValue },
      { Metric: "Projected Gross Inventory Profit (INR)", Value: kpis.totalPotentialProfit },
      { Metric: "Average Profit Margin", Value: `${kpis.avgMargin.toFixed(1)}%` },
      { Metric: "Loss-Making Products", Value: kpis.lossCount },
      { Metric: "Report Generated On", Value: new Date().toLocaleString() },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Profitability_Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Product_Margins");

    XLSX.writeFile(
      wb,
      `shipt-profitability-report-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    toast.success("Downloaded confidential product profitability report (.xlsx)!");
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Privacy Alert */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-5 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
              <Lock className="size-4" />
            </div>
            <h3 className="font-display text-base font-bold text-foreground flex items-center gap-2">
              <span>Private Supplier Cost & Margin Management</span>
              <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                Staff Confidential
              </span>
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Supplier costs and profit calculations are protected by Supabase Row Level Security and are never exposed to storefront visitors, APIs, or customer sessions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadCosts}
            disabled={loadingCosts}
            className="h-9 gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className={cn("size-3.5", loadingCosts && "animate-spin")} />
            <span>Refresh Costs</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            className="h-9 gap-1.5 text-xs font-semibold bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/20"
          >
            <Download className="size-3.5" />
            <span>Export Report (.xlsx)</span>
          </Button>
        </div>
      </div>

      {/* Primary KPI Metrics Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Cost Value in Stock */}
        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Total Inventory Cost Value
          </p>
          <p className="mt-2 font-display text-3xl font-extrabold text-foreground">
            {formatINR(kpis.totalCostValue)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Capital invested across {kpis.itemsWithCost} cost-tracked items
          </p>
        </div>

        {/* Projected Profit Potential */}
        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Gross Profit Potential
          </p>
          <p className="mt-2 font-display text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {formatINR(kpis.totalPotentialProfit)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Projected earnings upon selling all active warehouse units
          </p>
        </div>

        {/* Average Margin */}
        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Average Margin
            </p>
            <TrendingUp className="size-4 text-primary" />
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold text-primary">
            {kpis.avgMargin.toFixed(1)}%
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Cost Coverage: {kpis.coveragePct}% ({kpis.itemsWithCost}/{profitabilityList.length} items configured)
          </p>
        </div>

        {/* Risk / Loss Warning Card */}
        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Margin Health Alerts
            </p>
            {kpis.lossCount > 0 ? (
              <AlertCircle className="size-4 text-rose-600" />
            ) : (
              <CheckCircle2 className="size-4 text-emerald-600" />
            )}
          </div>
          <p
            className={cn(
              "mt-2 font-display text-3xl font-extrabold",
              kpis.lossCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"
            )}
          >
            {kpis.lossCount}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {kpis.lossCount > 0
              ? `${kpis.lossCount} products operating below cost (loss)`
              : "Zero loss-making products identified"}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-2xs">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product by name..."
              className="h-9 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="h-9 rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
          >
            <option value="all">All Categories ({categories.length})</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Margin Status Filter */}
          <select
            value={marginFilter}
            onChange={(e) => setMarginFilter(e.target.value as any)}
            className="h-9 rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
          >
            <option value="all">All Margin Ranges</option>
            <option value="high">High Margin (&ge; 40%)</option>
            <option value="healthy">Healthy Margin (20% – 39%)</option>
            <option value="low">Low Margin (0% – 19%)</option>
            <option value="loss">Loss-Making (&lt; 0%)</option>
            <option value="missing">Cost Not Entered</option>
          </select>
        </div>

        <p className="text-xs text-muted-foreground">
          Showing <strong>{filteredList.length}</strong> of {profitabilityList.length} products
        </p>
      </div>

      {/* Profitability Table */}
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/50 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
              <tr>
                <th className="p-3.5 pl-5">Product</th>
                <th className="p-3.5 text-right">Selling Price</th>
                <th className="p-3.5 text-right">Supplier Cost</th>
                <th className="p-3.5 text-right">Other Costs</th>
                <th className="p-3.5 text-right">Unit Profit</th>
                <th className="p-3.5 text-center">Margin (%)</th>
                <th className="p-3.5 text-center">Markup (%)</th>
                <th className="p-3.5 text-center">Stock</th>
                <th className="p-3.5 text-right">Total Cost</th>
                <th className="p-3.5 text-right">Potential Profit</th>
                <th className="p-3.5 pr-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">
                    No products matched your search or margin filter.
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => {
                  const cat = categories.find((c) => c.id === item.categoryId);
                  return (
                    <tr
                      key={item.productId}
                      className={cn(
                        "transition hover:bg-secondary/30",
                        item.estimatedProfit < 0 && item.hasCostData && "bg-rose-500/5"
                      )}
                    >
                      {/* Product Name & Category */}
                      <td className="p-3.5 pl-5">
                        <p className="font-semibold text-foreground text-sm truncate max-w-[220px]">
                          {item.productName}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {cat?.name || item.categoryId} · {item.size}
                        </p>
                      </td>

                      {/* Selling Price */}
                      <td className="p-3.5 text-right font-mono font-bold text-foreground">
                        {formatINR(item.price)}
                      </td>

                      {/* Supplier Cost */}
                      <td className="p-3.5 text-right font-mono">
                        {item.hasCostData ? (
                          <span className="font-semibold text-foreground">
                            {formatINR(item.supplierCost)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">Not set</span>
                        )}
                      </td>

                      {/* Other Costs */}
                      <td className="p-3.5 text-right font-mono text-muted-foreground">
                        {item.otherCosts > 0 ? formatINR(item.otherCosts) : "—"}
                      </td>

                      {/* Unit Profit */}
                      <td className="p-3.5 text-right font-mono font-bold">
                        {item.hasCostData ? (
                          <span
                            className={
                              item.estimatedProfit < 0
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-emerald-600 dark:text-emerald-400"
                            }
                          >
                            {formatINR(item.estimatedProfit)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Margin % */}
                      <td className="p-3.5 text-center">
                        {item.hasCostData ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "font-mono font-bold text-[11px] px-2 py-0.5",
                              item.profitMarginPct >= 40 &&
                                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
                              item.profitMarginPct >= 20 &&
                                item.profitMarginPct < 40 &&
                                "bg-lime-500/10 text-lime-800 dark:text-lime-300 border-lime-500/30",
                              item.profitMarginPct >= 0 &&
                                item.profitMarginPct < 20 &&
                                "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30",
                              item.profitMarginPct < 0 &&
                                "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30"
                            )}
                          >
                            {item.profitMarginPct.toFixed(1)}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Markup % */}
                      <td className="p-3.5 text-center font-mono text-xs text-muted-foreground">
                        {item.hasCostData ? `${item.markupPct.toFixed(1)}%` : "—"}
                      </td>

                      {/* Stock Units */}
                      <td className="p-3.5 text-center font-mono">
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-xs font-semibold",
                            item.stock === 0
                              ? "bg-rose-500/20 text-rose-700 dark:text-rose-300"
                              : item.stock <= 5
                              ? "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                              : "text-foreground"
                          )}
                        >
                          {item.stock}
                        </span>
                      </td>

                      {/* Total Cost Value in Stock */}
                      <td className="p-3.5 text-right font-mono text-muted-foreground">
                        {item.hasCostData ? formatINR(item.inventoryCostValue) : "—"}
                      </td>

                      {/* Potential Profit in Stock */}
                      <td className="p-3.5 text-right font-mono font-bold">
                        {item.hasCostData ? (
                          <span
                            className={
                              item.inventoryProfitPotential < 0
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-emerald-600 dark:text-emerald-400"
                            }
                          >
                            {formatINR(item.inventoryProfitPotential)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 pr-5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenCostEditor(item)}
                            className="h-8 gap-1 text-xs font-semibold text-primary hover:bg-primary/10"
                          >
                            <Edit3 className="size-3" />
                            <span>{item.hasCostData ? "Edit Cost" : "Enter Cost"}</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inline Quick Cost Edit Dialog */}
      <Dialog
        open={Boolean(editingCostItem)}
        onOpenChange={(open) => !open && setEditingCostItem(null)}
      >
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-foreground flex items-center gap-2">
              <Lock className="size-4 text-emerald-600" />
              <span>Update Private Cost: {editingCostItem?.productName}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Confidential procurement cost. Visible only to authorized store administrators.
            </DialogDescription>
          </DialogHeader>

          {editingCostItem && (
            <form onSubmit={handleSaveInlineCost} className="mt-4 space-y-4">
              <div className="rounded-xl border border-border/70 bg-secondary/30 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Active Storefront Selling Price:</span>
                  <span className="font-mono font-bold text-foreground text-sm">
                    {formatINR(editingCostItem.price)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Warehouse Stock Units:</span>
                  <span className="font-mono font-semibold text-foreground">
                    {editingCostItem.stock} units
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Supplier Cost (Private) (₹) <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={editSupplierCost}
                    onChange={(e) => setEditSupplierCost(e.target.value)}
                    placeholder="e.g. 40"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono font-bold outline-none focus:border-primary"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Base wholesale purchase price.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Other Unit Costs (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={editOtherCosts}
                    onChange={(e) => setEditOtherCosts(e.target.value)}
                    placeholder="e.g. 5"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono outline-none focus:border-primary"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Packaging, handling, freight.
                  </p>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Sourcing / Supplier Notes (Optional)
                </label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="e.g. Vendor: Apex Logistics, MOQ 100 pcs"
                  className="h-9 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                />
              </div>

              {/* Dynamic Live Metric Calculation Preview */}
              {inlinePreviewMetrics && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded-lg bg-card border border-border/60">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase">
                        Unit Profit
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 font-mono font-bold text-xs",
                          inlinePreviewMetrics.isLoss ? "text-rose-600" : "text-emerald-600"
                        )}
                      >
                        {formatINR(inlinePreviewMetrics.estimatedProfit)}
                      </p>
                    </div>

                    <div className="p-2 rounded-lg bg-card border border-border/60">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase">
                        Margin (%)
                      </p>
                      <p className="mt-0.5 font-mono font-bold text-xs text-primary">
                        {inlinePreviewMetrics.profitMarginPct.toFixed(1)}%
                      </p>
                    </div>

                    <div className="p-2 rounded-lg bg-card border border-border/60">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase">
                        Markup (%)
                      </p>
                      <p className="mt-0.5 font-mono font-bold text-xs text-foreground">
                        {inlinePreviewMetrics.markupPct.toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  {inlinePreviewMetrics.isLoss && (
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-600">
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span>Warning: Selling price is below cost (loss item).</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingCostItem(null)}
                  className="h-9 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="hero"
                  size="sm"
                  disabled={savingCost}
                  className="h-9 gap-1.5 text-xs font-bold px-4"
                >
                  {savingCost ? "Saving..." : "Save Cost Record"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
