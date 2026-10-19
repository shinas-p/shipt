import { useState, useEffect, useCallback } from "react";
import {
  Package,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  RefreshCw,
  Plus,
  Minus,
  Edit3,
  Download,
  Filter,
  CheckCircle2,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/data/products";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBProduct, DBInventoryMovement } from "./types";

interface InventoryLedgerTabProps {
  products: DBProduct[];
  onRefreshProducts: () => Promise<void>;
  onOpenQuickEdit: (p: DBProduct) => void;
}

export function InventoryLedgerTab({
  products,
  onRefreshProducts,
  onOpenQuickEdit,
}: InventoryLedgerTabProps) {
  const [movements, setMovements] = useState<DBInventoryMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  // Stock Filter
  const [filterType, setFilterType] = useState<"all" | "low_stock" | "out_of_stock">("all");

  // Manual stock adjustment dialog
  const [adjustTarget, setAdjustTarget] = useState<DBProduct | null>(null);
  const [adjustMode, setAdjustMode] = useState<"add" | "sub" | "set">("add");
  const [adjustQuantity, setAdjustQuantity] = useState("5");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustType, setAdjustType] = useState<"manual_adjustment" | "restock_shipment" | "damaged_loss">(
    "manual_adjustment"
  );
  const [savingAdjust, setSavingAdjust] = useState(false);

  // Load actual inventory movements from Supabase
  const loadMovements = useCallback(async () => {
    setMovementsLoading(true);
    try {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select(`
          id,
          product_id,
          order_id,
          movement_type,
          quantity_change,
          previous_stock,
          new_stock,
          reason,
          performed_by,
          created_at,
          products(name, size, image_url)
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!error && data) {
        setMovements(data as unknown as DBInventoryMovement[]);
      }
    } catch {
      // Non-blocking
    } finally {
      setMovementsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMovements();
  }, [loadMovements]);

  // Inventory stats
  const totalUnits = products.reduce((sum, p) => sum + p.stock, 0);
  const outOfStockCount = products.filter((p) => p.stock === 0).length;
  const lowStockCount = products.filter((p) => p.stock > 0 && p.stock <= 5).length;
  const healthyStockCount = products.filter((p) => p.stock > 5).length;

  const filteredProducts = products.filter((p) => {
    if (filterType === "out_of_stock") return p.stock === 0;
    if (filterType === "low_stock") return p.stock > 0 && p.stock <= 5;
    return true;
  });

  const handleOpenAdjust = (p: DBProduct) => {
    setAdjustTarget(p);
    setAdjustMode("add");
    setAdjustQuantity("5");
    setAdjustReason("");
    setAdjustType("manual_adjustment");
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;

    const qty = parseInt(adjustQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Please enter a valid positive quantity.");
      return;
    }

    if (!adjustReason.trim()) {
      toast.error("An adjustment reason is required for warehouse audit compliance.");
      return;
    }

    let nextStock = adjustTarget.stock;
    let delta = 0;

    if (adjustMode === "add") {
      nextStock = adjustTarget.stock + qty;
      delta = qty;
    } else if (adjustMode === "sub") {
      if (adjustTarget.stock - qty < 0) {
        toast.error(`Cannot deduct ${qty} units: current stock is only ${adjustTarget.stock}.`);
        return;
      }
      nextStock = adjustTarget.stock - qty;
      delta = -qty;
    } else if (adjustMode === "set") {
      nextStock = qty;
      delta = qty - adjustTarget.stock;
    }

    setSavingAdjust(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // 1. Update product stock
      const { error: prodErr } = await supabase
        .from("products")
        .update({ stock: nextStock })
        .eq("id", adjustTarget.id);

      if (prodErr) {
        toast.error(`Failed to update stock: ${prodErr.message}`);
        setSavingAdjust(false);
        return;
      }

      // 2. Insert into inventory_movements ledger
      const { error: moveErr } = await supabase.from("inventory_movements").insert([
        {
          product_id: adjustTarget.id,
          movement_type: adjustType,
          quantity_change: delta,
          previous_stock: adjustTarget.stock,
          new_stock: nextStock,
          reason: adjustReason.trim(),
          performed_by: session?.user?.id ?? null,
        },
      ]);

      if (moveErr) {
        toast.warning(`Stock updated to ${nextStock}, but ledger logging failed: ${moveErr.message}`);
      } else {
        toast.success(
          `Stock for "${adjustTarget.name}" adjusted: ${adjustTarget.stock} → ${nextStock} (${delta > 0 ? "+" : ""}${delta} units)`
        );
      }

      setAdjustTarget(null);
      await onRefreshProducts();
      await loadMovements();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    } finally {
      setSavingAdjust(false);
    }
  };

  // Export inventory snapshot to CSV
  const handleExportStockCSV = () => {
    const headers = ["Product ID", "Product Name", "Size", "Category", "Selling Price", "Stock Units", "Status"];
    const rows = products.map((p) => [
      `"${p.id}"`,
      `"${p.name.replace(/"/g, '""')}"`,
      `"${p.size}"`,
      `"${p.category_id}"`,
      p.price,
      p.stock,
      p.stock === 0 ? "Out of Stock" : p.stock <= 5 ? "Low Stock" : "In Stock",
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `shipt-inventory-snapshot-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Inventory stock levels exported to CSV!");
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Total Warehouse Units
          </p>
          <p className="mt-2 font-display text-3xl font-extrabold text-foreground">
            {totalUnits.toLocaleString()}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Across {products.length} products</p>
        </div>

        <div
          onClick={() => setFilterType(filterType === "out_of_stock" ? "all" : "out_of_stock")}
          className={cn(
            "rounded-3xl border p-5 shadow-2xs cursor-pointer transition hover:scale-[1.02]",
            filterType === "out_of_stock"
              ? "border-destructive bg-destructive/10 ring-2 ring-destructive/20"
              : "border-border bg-card"
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-destructive uppercase tracking-wider">
              Out of Stock
            </p>
            <AlertTriangle className="size-4 text-destructive" />
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold text-destructive">
            {outOfStockCount}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Requires immediate restock</p>
        </div>

        <div
          onClick={() => setFilterType(filterType === "low_stock" ? "all" : "low_stock")}
          className={cn(
            "rounded-3xl border p-5 shadow-2xs cursor-pointer transition hover:scale-[1.02]",
            filterType === "low_stock"
              ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/20"
              : "border-border bg-card"
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
              Low Stock Alert (1–5)
            </p>
            <AlertTriangle className="size-4 text-amber-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold text-amber-700 dark:text-amber-400">
            {lowStockCount}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Order replenishment soon</p>
        </div>

        <div
          onClick={() => setFilterType("all")}
          className={cn(
            "rounded-3xl border p-5 shadow-2xs cursor-pointer transition hover:scale-[1.02]",
            filterType === "all"
              ? "border-primary bg-primary/5"
              : "border-border bg-card"
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-primary uppercase tracking-wider">
              Healthy Stock (&gt; 5)
            </p>
            <CheckCircle2 className="size-4 text-primary" />
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold text-primary">
            {healthyStockCount}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Ready for fast campus delivery</p>
        </div>
      </div>

      {/* Stock Level Quick Adjustment Grid */}
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-foreground">
              Inventory Stock Levels & Quick Adjustments
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              One-click stock adjustments with automated audit reason logging.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportStockCSV}
              className="h-8 gap-1.5 text-xs"
            >
              <Download className="size-3.5" />
              <span>Export Stock (CSV)</span>
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="p-3 font-semibold">Product</th>
                <th className="p-3 font-semibold">Category</th>
                <th className="p-3 font-semibold">Current Stock</th>
                <th className="p-3 font-semibold">Stock Status</th>
                <th className="p-3 font-semibold text-right">Quick Restock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredProducts.map((p) => {
                const isOut = p.stock === 0;
                const isLow = p.stock > 0 && p.stock <= 5;

                return (
                  <tr key={p.id} className="hover:bg-secondary/30 transition">
                    <td className="p-3">
                      <div className="font-semibold text-foreground text-sm">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground">{p.size}</div>
                    </td>
                    <td className="p-3 capitalize text-muted-foreground">{p.category_id}</td>
                    <td className="p-3 font-mono font-bold text-sm text-foreground">
                      {p.stock} units
                    </td>
                    <td className="p-3">
                      <span
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase",
                          isOut
                            ? "bg-destructive/10 text-destructive"
                            : isLow
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        {isOut ? "Out of Stock" : isLow ? "Low Stock" : "Sufficient"}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenAdjust(p)}
                          className="h-7 text-xs font-semibold px-2.5"
                        >
                          <Edit3 className="size-3 mr-1" />
                          <span>Adjust</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Movement History Ledger */}
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            <h3 className="font-display text-base font-bold text-foreground">
              Inventory Movement Ledger (Last 50 Events)
            </h3>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={loadMovements}
            className="h-8 gap-1 text-xs"
          >
            <RefreshCw className={cn("size-3.5", movementsLoading && "animate-spin")} />
            <span>Refresh Ledger</span>
          </Button>
        </div>

        {movements.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
            No stock movements recorded yet. Movements are automatically generated on checkout, cancellation restock, and manual adjustments.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="p-3 font-semibold">Timestamp</th>
                  <th className="p-3 font-semibold">Product</th>
                  <th className="p-3 font-semibold">Type</th>
                  <th className="p-3 font-semibold">Change</th>
                  <th className="p-3 font-semibold">Stock (Before → After)</th>
                  <th className="p-3 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {movements.map((m) => {
                  const isPositive = m.quantity_change > 0;
                  return (
                    <tr key={m.id} className="hover:bg-secondary/20 transition">
                      <td className="p-3 text-muted-foreground font-mono text-[11px]">
                        {new Date(m.created_at).toLocaleString()}
                      </td>
                      <td className="p-3 font-semibold text-foreground">
                        {m.products?.name || "Product"}
                        {m.products?.size && (
                          <span className="text-muted-foreground font-normal ml-1">
                            ({m.products.size})
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-[10px] uppercase font-bold">
                          {m.movement_type.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 font-mono font-bold",
                            isPositive ? "text-emerald-600" : "text-destructive"
                          )}
                        >
                          {isPositive ? (
                            <ArrowUpRight className="size-3.5" />
                          ) : (
                            <ArrowDownRight className="size-3.5" />
                          )}
                          {isPositive ? `+${m.quantity_change}` : m.quantity_change}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-muted-foreground">
                        {m.previous_stock} →{" "}
                        <strong className="text-foreground">{m.new_stock}</strong>
                      </td>
                      <td className="p-3 text-muted-foreground max-w-xs truncate">
                        {m.reason || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ADJUSTMENT MODAL */}
      <Dialog open={adjustTarget !== null} onOpenChange={(open) => !open && setAdjustTarget(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-foreground">
              Adjust Stock: {adjustTarget?.name}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Update warehouse quantity with an audit reason logged in the stock ledger.
            </DialogDescription>
          </DialogHeader>

          {adjustTarget && (
            <form onSubmit={handleSaveAdjustment} className="mt-3 space-y-3.5 text-xs">
              <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 p-3">
                <span className="text-muted-foreground">Current Warehouse Stock:</span>
                <span className="font-mono text-sm font-bold text-foreground">
                  {adjustTarget.stock} units
                </span>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-foreground">Operation</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustMode("add")}
                    className={cn(
                      "rounded-xl border p-2 font-bold text-center transition",
                      adjustMode === "add"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    + Add Units
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustMode("sub")}
                    className={cn(
                      "rounded-xl border p-2 font-bold text-center transition",
                      adjustMode === "sub"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    - Deduct Units
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustMode("set")}
                    className={cn(
                      "rounded-xl border p-2 font-bold text-center transition",
                      adjustMode === "set"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Set Fixed
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-foreground">
                  {adjustMode === "add"
                    ? "Quantity to Add"
                    : adjustMode === "sub"
                    ? "Quantity to Deduct"
                    : "New Absolute Stock"}
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={adjustQuantity}
                  onChange={(e) => setAdjustQuantity(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono font-bold outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="mb-1 block font-semibold text-foreground">Movement Classification</label>
                <select
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as any)}
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                >
                  <option value="manual_adjustment">Manual Stock Audit / Reconciliation</option>
                  <option value="restock_shipment">Restock Delivery / Inbound Shipment</option>
                  <option value="damaged_loss">Damaged / Expired / Written-Off Goods</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-foreground">
                  Audit Reason <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Received weekly stationery supplier batch"
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAdjustTarget(null)}
                  className="h-9 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="hero"
                  size="sm"
                  disabled={savingAdjust}
                  className="h-9 px-4 text-xs font-bold"
                >
                  {savingAdjust ? <Loader2 className="size-3.5 animate-spin" /> : "Confirm Stock Adjustment"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
