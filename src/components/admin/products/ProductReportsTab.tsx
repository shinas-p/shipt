import { useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  Package,
  Layers,
  Tag,
  AlertTriangle,
  CheckCircle2,
  Download,
  IndianRupee,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/data/products";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBProduct, DBCategory } from "./types";

interface AdminOrderSummaryItem {
  product_id?: string | null;
  product_name: string;
  quantity: number;
  total_price: number;
}

interface ProductReportsTabProps {
  products: DBProduct[];
  categories: DBCategory[];
  orders: Array<{
    id: string;
    status: string;
    order_items?: AdminOrderSummaryItem[];
  }>;
}

export function ProductReportsTab({
  products,
  categories,
  orders,
}: ProductReportsTabProps) {
  // Aggregate real order sales by product
  const salesByProduct = useMemo(() => {
    const map: Record<
      string,
      {
        product_name: string;
        units_sold: number;
        revenue: number;
      }
    > = {};

    for (const order of orders) {
      // Exclude cancelled orders
      if (order.status === "cancelled") continue;

      for (const item of order.order_items || []) {
        const key = item.product_id || item.product_name;
        if (!map[key]) {
          map[key] = {
            product_name: item.product_name,
            units_sold: 0,
            revenue: 0,
          };
        }
        map[key].units_sold += item.quantity || 0;
        map[key].revenue += Number(item.total_price) || 0;
      }
    }

    return Object.values(map).sort((a, b) => b.units_sold - a.units_sold);
  }, [orders]);

  // Overall Catalog Statistics
  const totalProducts = products.length;
  const activeProducts = products.filter((p) => p.is_active).length;
  const archivedProducts = products.filter((p) => !p.is_active).length;
  const outOfStockProducts = products.filter((p) => p.stock === 0).length;
  const lowStockProducts = products.filter((p) => p.stock > 0 && p.stock <= 5).length;
  const discountedProducts = products.filter(
    (p) => p.original_price != null && p.original_price > p.price
  ).length;

  const totalInventoryUnits = products.reduce((sum, p) => sum + p.stock, 0);
  const totalRetailInventoryValue = products.reduce(
    (sum, p) => sum + p.stock * p.price,
    0
  );

  // Category Breakdown
  const categoryStats = useMemo(() => {
    return categories.map((cat) => {
      const catProducts = products.filter((p) => p.category_id === cat.id);
      const units = catProducts.reduce((sum, p) => sum + p.stock, 0);
      const value = catProducts.reduce((sum, p) => sum + p.stock * p.price, 0);

      return {
        id: cat.id,
        name: cat.name,
        count: catProducts.length,
        units,
        value,
      };
    });
  }, [products, categories]);

  // Export report to Excel
  const handleExportReport = () => {
    const summaryData = [
      { Metric: "Total Products", Value: totalProducts },
      { Metric: "Active / Published", Value: activeProducts },
      { Metric: "Archived / Draft", Value: archivedProducts },
      { Metric: "Out of Stock Items", Value: outOfStockProducts },
      { Metric: "Low Stock Items (1-5 units)", Value: lowStockProducts },
      { Metric: "Discounted Items", Value: discountedProducts },
      { Metric: "Total Warehouse Units", Value: totalInventoryUnits },
      { Metric: "Estimated Retail Inventory Value (INR)", Value: totalRetailInventoryValue },
    ];

    const categoryData = categoryStats.map((c) => ({
      Category: c.name,
      Category_ID: c.id,
      Product_Count: c.count,
      Total_Stock_Units: c.units,
      Retail_Inventory_Value: c.value,
    }));

    const salesData = salesByProduct.map((s) => ({
      Product_Name: s.product_name,
      Units_Sold: s.units_sold,
      Gross_Revenue: s.revenue,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), "Catalog_Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoryData), "Category_Breakdown");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesData), "Sales_By_Product");

    XLSX.writeFile(wb, `shipt-catalogue-analytics-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Exported comprehensive catalog report!");
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-card p-5 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" />
            <h3 className="font-display text-base font-bold text-foreground">
              Product & Inventory Analytics
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Real data metrics calculated from live product inventory and non-cancelled customer orders.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportReport}
          className="h-9 gap-1.5 text-xs font-semibold"
        >
          <Download className="size-3.5" />
          <span>Export Analytics Report (.xlsx)</span>
        </Button>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Total Inventory Units
          </p>
          <p className="mt-2 font-display text-3xl font-extrabold text-foreground">
            {totalInventoryUnits.toLocaleString()}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Across {totalProducts} registered products
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Retail Inventory Value
          </p>
          <p className="mt-2 font-display text-3xl font-extrabold text-primary">
            {formatINR(totalRetailInventoryValue)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Based on active warehouse selling prices
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Storefront Status
            </p>
            <CheckCircle2 className="size-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold text-foreground">
            {activeProducts}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Active ({archivedProducts} archived or in draft)
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Stock Warnings
            </p>
            <AlertTriangle className="size-4 text-amber-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold text-amber-700 dark:text-amber-400">
            {outOfStockProducts + lowStockProducts}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {outOfStockProducts} out of stock, {lowStockProducts} low stock
          </p>
        </div>
      </div>

      {/* Category Breakdown & Best Selling Products */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Department / Category Breakdown */}
        <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-primary" />
            <h4 className="font-display text-sm font-bold text-foreground">
              Department Inventory Value
            </h4>
          </div>

          <div className="divide-y divide-border/60 rounded-2xl border border-border bg-card text-xs">
            {categoryStats.map((c) => (
              <div key={c.id} className="p-3.5 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground text-sm">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.count} products · {c.units} total stock units
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-sm text-foreground">
                    {formatINR(c.value)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {totalRetailInventoryValue > 0
                      ? `${Math.round((c.value / totalRetailInventoryValue) * 100)}% of stock value`
                      : "0%"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Best Selling Products */}
        <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" />
            <h4 className="font-display text-sm font-bold text-foreground">
              Best-Selling Items (Verified Student Orders)
            </h4>
          </div>

          {salesByProduct.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              No sales data recorded yet. Rankings will update automatically as customer orders are completed.
            </div>
          ) : (
            <div className="divide-y divide-border/60 rounded-2xl border border-border bg-card text-xs">
              {salesByProduct.slice(0, 5).map((s, idx) => (
                <div key={s.product_name} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-6 place-items-center rounded-full bg-secondary font-mono font-bold text-[11px] text-primary shrink-0">
                      #{idx + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-foreground text-sm truncate max-w-[200px]">
                        {s.product_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.units_sold} units delivered
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-mono font-bold text-sm text-foreground">
                      {formatINR(s.revenue)}
                    </p>
                    <span className="text-[10px] text-emerald-600 font-semibold">
                      Gross Revenue
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
