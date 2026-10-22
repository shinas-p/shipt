import React, { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Package,
  Layers,
  Plus,
  RefreshCw,
  ShoppingBag,
  IndianRupee,
  Clock,
  AlertTriangle,
  TrendingUp,
  ExternalLink,
  Users,
  Tag,
  CheckCircle2,
  ChevronRight,
  Eye,
  Copy,
  Check,
  Calendar,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  SlidersHorizontal,
  MapPin,
  Shield,
  Truck,
  Coins,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/data/products";
import { BRAND_FALLBACK_IMAGE, resolveOrderItemImage } from "@/lib/catalogApi";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  type AdminRole,
  canManageCosts,
  canManageRoles,
  canManageBranding,
  getRoleBadge,
  ADMIN_ROLES_METADATA,
} from "@/lib/permissions";

export interface AdminOrderItem {
  id: string;
  product_id?: string | null;
  product_name: string;
  product_size: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  image_url?: string | null;
  products?: { image_url?: string | null } | null;
}

export interface AdminOrderStatusHistory {
  id: string;
  order_id?: string;
  previous_status?: string | null;
  new_status: string;
  notes?: string | null;
  created_at: string;
}

export interface AdminOrder {
  id: string;
  order_number: string;
  user_id?: string | null;
  customer_name: string;
  customer_phone: string;
  delivery_method: string;
  hostel?: string | null;
  block?: string | null;
  room?: string | null;
  pickup_location?: string | null;
  delivery_instructions?: string | null;
  status: string;
  subtotal: number;
  delivery_fee?: number;
  discount_amount?: number;
  total_amount: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
  updated_at?: string;
  order_items?: AdminOrderItem[];
  order_status_history?: AdminOrderStatusHistory[];
}

export interface DBProduct {
  id: string;
  name: string;
  slug?: string | null;
  size: string;
  description: string;
  price: number;
  original_price?: number | null;
  category_id: string;
  image_url: string;
  stock: number;
  bestseller?: boolean;
  is_new?: boolean;
  is_active: boolean;
  display_order?: number;
}

export interface SmartDashboardProps {
  orders: AdminOrder[];
  products: DBProduct[];
  ordersLoading: boolean;
  productsLoading: boolean;
  adminRole: AdminRole | null;
  assignedBlock?: string | null;
  userEmail?: string;
  onRefresh: () => void;
  onNavigateTab: (tab: "orders" | "products" | "banners" | "roles" | "branding") => void;
  onAddNewProduct: () => void;
  onManageInventory: () => void;
  onViewOrder: (order: AdminOrder) => void;
  onEditProduct: (product: DBProduct) => void;
}

export function SmartDashboard({
  orders,
  products,
  ordersLoading,
  productsLoading,
  adminRole,
  assignedBlock,
  userEmail,
  onRefresh,
  onNavigateTab,
  onAddNewProduct,
  onManageInventory,
  onViewOrder,
  onEditProduct,
}: SmartDashboardProps) {
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);

  // Local calendar day boundaries
  const { startOfToday, endOfToday, todayDateStr } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const str = now.toLocaleDateString("en-IN", {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    return { startOfToday: start, endOfToday: end, todayDateStr: str };
  }, []);

  // Today's orders
  const todayOrders = useMemo(() => {
    return orders.filter((o) => {
      const d = new Date(o.created_at);
      return d >= startOfToday && d <= endOfToday;
    });
  }, [orders, startOfToday, endOfToday]);

  // Today's Sales calculation: Gross paid or completed sales placed today
  // - Exclude cancelled orders
  // - Require payment_status === 'completed' OR order status === 'completed'
  const { todaySalesAmount, todayPaidOrdersCount, todayCompletedCount } = useMemo(() => {
    let sales = 0;
    let paidCount = 0;
    let completedCount = 0;

    for (const ord of todayOrders) {
      if (ord.status === "cancelled") continue;

      const isPaid = ord.payment_status === "completed" || ord.status === "completed";
      if (isPaid) {
        sales += Number(ord.total_amount) || 0;
        paidCount++;
      }
      if (ord.status === "completed") {
        completedCount++;
      }
    }

    return {
      todaySalesAmount: sales,
      todayPaidOrdersCount: paidCount,
      todayCompletedCount: completedCount,
    };
  }, [todayOrders]);

  // Pending / active orders requiring fulfillment attention
  const pendingOrders = useMemo(() => {
    return orders.filter((o) =>
      ["placed", "confirmed", "preparing", "ready_for_pickup", "out_for_delivery"].includes(o.status)
    );
  }, [orders]);

  const placedOrdersCount = useMemo(
    () => pendingOrders.filter((o) => o.status === "placed").length,
    [pendingOrders]
  );
  const inProgressOrdersCount = useMemo(
    () => pendingOrders.filter((o) => o.status !== "placed").length,
    [pendingOrders]
  );

  // Products stock metrics: Low stock threshold is <= 5 (documented standard from existing product filters)
  const lowStockProducts = useMemo(() => {
    return [...products]
      .filter((p) => (p.is_active ?? true) && p.stock <= 5)
      .sort((a, b) => a.stock - b.stock);
  }, [products]);

  const outOfStockCount = useMemo(
    () => lowStockProducts.filter((p) => p.stock === 0).length,
    [lowStockProducts]
  );
  const lowThresholdCount = useMemo(
    () => lowStockProducts.filter((p) => p.stock > 0 && p.stock <= 5).length,
    [lowStockProducts]
  );

  // 7-Day sales trend from real dated orders
  const salesTrend = useMemo(() => {
    const days: {
      dayLabel: string;
      dateLabel: string;
      sales: number;
      paidCount: number;
      totalCount: number;
    }[] = [];

    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

      const dayOrders = orders.filter((o) => {
        const orderDate = new Date(o.created_at);
        return orderDate >= dayStart && orderDate <= dayEnd;
      });

      const dayPaid = dayOrders.filter(
        (o) => o.status !== "cancelled" && (o.payment_status === "completed" || o.status === "completed")
      );

      const daySales = dayPaid.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

      days.push({
        dayLabel: i === 0 ? "Today" : i === 1 ? "Yest" : d.toLocaleDateString("en-IN", { weekday: "short" }),
        dateLabel: d.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
        sales: daySales,
        paidCount: dayPaid.length,
        totalCount: dayOrders.length,
      });
    }

    const maxSales = Math.max(...days.map((d) => d.sales), 100);
    const total7DaySales = days.reduce((sum, d) => sum + d.sales, 0);
    const total7DayPaidOrders = days.reduce((sum, d) => sum + d.paidCount, 0);

    return { days, maxSales, total7DaySales, total7DayPaidOrders };
  }, [orders]);

  const recentOrders = useMemo(() => orders.slice(0, 6), [orders]);

  const copyOrderNumber = (num: string) => {
    navigator.clipboard.writeText(num);
    setCopiedOrderId(num);
    toast.success(`Copied order #${num}`);
    setTimeout(() => setCopiedOrderId(null), 2000);
  };

  const getOrderStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return {
          label: "Completed",
          className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
        };
      case "cancelled":
        return {
          label: "Cancelled",
          className: "bg-destructive/15 text-destructive border-destructive/30",
        };
      case "placed":
        return {
          label: "New Placed",
          className: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400",
        };
      case "confirmed":
      case "preparing":
        return {
          label: status === "confirmed" ? "Confirmed" : "Preparing",
          className: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
        };
      case "ready_for_pickup":
      case "out_for_delivery":
        return {
          label: status === "ready_for_pickup" ? "Ready for Pickup" : "Out for Delivery",
          className: "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-400",
        };
      default:
        return {
          label: status.replace(/_/g, " "),
          className: "bg-secondary text-secondary-foreground border-border",
        };
    }
  };

  const isLoading = ordersLoading || productsLoading;

  const roleMeta = adminRole ? ADMIN_ROLES_METADATA[adminRole] : null;
  const roleBadge = getRoleBadge(adminRole);
  const canSeeFinancials = canManageCosts(adminRole);

  // If Block Manager, render the dedicated block coordinator dashboard
  if (adminRole === "block_manager") {
    // Unassigned block state
    if (!assignedBlock) {
      return (
        <div className="space-y-6" data-testid="shipt-smart-dashboard">
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-5 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border", roleBadge.className)}>
                    <span className="size-2 rounded-full bg-current animate-pulse" />
                    {roleBadge.label}
                  </span>
                  <span className="text-xs text-muted-foreground">• {todayDateStr}</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                  Welcome, Block Delivery Manager
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Coordinate local deliveries and update order fulfillment for your assigned campus zone.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isLoading}
                className="h-9 gap-1.5 text-xs font-semibold"
              >
                <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
                <span>Refresh Status</span>
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-amber-500/30 bg-card p-8 sm:p-12 shadow-soft text-center space-y-4">
            <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-amber-500/15 text-amber-600">
              <MapPin className="size-8" />
            </div>
            <div>
              <Badge variant="outline" className="border-amber-500/40 text-amber-700 bg-amber-500/10 mb-2 font-bold text-xs">
                Block Assignment Pending
              </Badge>
              <h3 className="font-display text-2xl font-bold text-foreground">No Delivery Block Assigned</h3>
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                Your Block Manager account has been verified, but no specific delivery block has been designated yet.
                Per Shipt Mart data-isolation policies, an unassigned Block Manager cannot view orders from other zones.
                Please contact a Super Administrator to allocate your delivery block.
              </p>
            </div>
            <div className="pt-2">
              <Button variant="outline" onClick={onRefresh} className="h-9 text-xs font-semibold gap-1.5">
                <RefreshCw className="size-3.5" />
                <span>Re-check Assignment Status</span>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Assigned Block Manager Dashboard: Defense-in-depth client filter matching assignedBlock
    const blockOrders = assignedBlock ? orders.filter((o) => o.block === assignedBlock) : [];
    const blockPending = blockOrders.filter(o => o.status === "placed" || o.status === "confirmed" || o.status === "preparing");
    const blockOutForDelivery = blockOrders.filter(o => o.status === "out_for_delivery" || o.status === "ready_for_pickup");
    const blockCompleted = blockOrders.filter(o => o.status === "completed");

    return (
      <div className="space-y-6" data-testid="shipt-smart-dashboard">
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border", roleBadge.className)}>
                  <span className="size-2 rounded-full bg-current animate-pulse" />
                  {roleBadge.label}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary border border-primary/30 px-2.5 py-0.5 text-xs font-bold">
                  <MapPin className="size-3" />
                  Zone: {assignedBlock}
                </span>
                <span className="text-xs text-muted-foreground">• {todayDateStr}</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                Welcome back, {assignedBlock} Coordinator
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Managing local deliveries, fulfillment status, and handoffs exclusively for {assignedBlock}.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isLoading}
                className="h-9 gap-1.5 text-xs font-semibold"
              >
                <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
                <span>Refresh Orders</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
          <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Block Orders</span>
            <div className="mt-2 font-display text-2xl sm:text-3xl font-extrabold text-foreground">{blockOrders.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">{assignedBlock} all-time orders</p>
          </div>

          <div className="rounded-2xl border border-amber-500/30 bg-card p-4 sm:p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">Needs Action</span>
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
            </div>
            <div className="mt-2 font-display text-2xl sm:text-3xl font-extrabold text-foreground">{blockPending.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">Placed or preparing</p>
          </div>

          <div className="rounded-2xl border border-purple-500/30 bg-card p-4 sm:p-5 shadow-xs">
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-700 dark:text-purple-400">In Transit / Pickup</span>
            <div className="mt-2 font-display text-2xl sm:text-3xl font-extrabold text-foreground">{blockOutForDelivery.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">Out for delivery</p>
          </div>

          <div className="rounded-2xl border border-emerald-500/30 bg-card p-4 sm:p-5 shadow-xs">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Delivered / Done</span>
            <div className="mt-2 font-display text-2xl sm:text-3xl font-extrabold text-foreground">{blockCompleted.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">Fulfilled deliveries</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div>
              <h3 className="font-display text-base font-bold text-foreground">{assignedBlock} Deliveries</h3>
              <p className="text-xs text-muted-foreground">Active orders assigned to your block for local verification</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => onNavigateTab("orders")} className="h-8 text-xs font-semibold">
              View All Block Orders ({blockOrders.length})
            </Button>
          </div>

          {blockOrders.length === 0 ? (
            <div className="py-12 text-center rounded-xl border border-dashed border-border bg-muted/10">
              <Package className="size-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-bold text-foreground">No orders in {assignedBlock} yet</p>
              <p className="text-xs text-muted-foreground mt-1">When students place orders to {assignedBlock}, they will appear here in real time.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground">
                    <th className="pb-3 font-semibold">Order #</th>
                    <th className="pb-3 font-semibold">Customer</th>
                    <th className="pb-3 font-semibold">Delivery Info</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 font-semibold">Items</th>
                    <th className="pb-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {blockOrders.slice(0, 8).map((ord) => {
                    const badge = getOrderStatusBadge(ord.status);
                    return (
                      <tr key={ord.id} className="hover:bg-secondary/30 transition">
                        <td className="py-3 font-mono font-bold text-foreground">{ord.order_number}</td>
                        <td className="py-3">
                          <div className="font-semibold text-foreground">{ord.customer_name}</div>
                          <div className="text-[10px] text-muted-foreground">{ord.customer_phone}</div>
                        </td>
                        <td className="py-3">
                          <div className="font-semibold">{ord.room ? `Room ${ord.room}` : "Standard"}</div>
                          <div className="text-[10px] text-muted-foreground">{ord.hostel || assignedBlock}</div>
                        </td>
                        <td className="py-3">
                          <Badge variant="outline" className={cn("text-[10px] font-bold px-2 py-0.5", badge.className)}>
                            {badge.label}
                          </Badge>
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {ord.order_items?.length || 0} items
                        </td>
                        <td className="py-3 text-right">
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => onViewOrder(ord)}
                            className="h-7 text-xs font-semibold gap-1 px-3"
                          >
                            <Eye className="size-3" />
                            <span>Update</span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="shipt-smart-dashboard">
      {/* Welcome Banner & Live Summary Header */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border", roleBadge.className)}>
                <span className="size-2 rounded-full bg-current animate-pulse" />
                {roleBadge.label}
              </span>
              <span className="text-xs text-muted-foreground">• {todayDateStr}</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Welcome back,{" "}
              <span className="text-primary">
                {roleMeta?.badgeLabel || "Administrator"}
              </span>
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {roleMeta?.description || "Here is your live campus store snapshot and quick-action control center."}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isLoading}
              className="h-9 gap-1.5 text-xs font-semibold"
              title="Reload live orders and catalog data from Supabase"
            >
              <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
              <span>{isLoading ? "Refreshing..." : "Refresh Data"}</span>
            </Button>
            <Button
              asChild
              variant="default"
              size="sm"
              className="h-9 gap-1.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Link to="/">
                <ExternalLink className="size-3.5" />
                <span>Storefront</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* 1. Summary Cards Overview (5 Live Business Metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4">
        {/* Card 1: Today's Sales */}
        <div
          data-testid="metric-today-sales"
          className="group relative rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs transition hover:shadow-md hover:border-primary/40"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Today's Sales
            </span>
            <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <IndianRupee className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            {ordersLoading ? (
              <div className="h-8 w-24 rounded bg-muted animate-pulse" />
            ) : (
              <div className="font-display text-2xl sm:text-3xl font-extrabold text-foreground">
                {formatINR(todaySalesAmount)}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
              <span className="font-medium text-foreground">Gross paid:</span>
              {todayPaidOrdersCount === 0 ? (
                <span>0 paid orders today</span>
              ) : (
                <span>
                  {todayPaidOrdersCount} {todayPaidOrdersCount === 1 ? "order" : "orders"} paid
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Card 2: Today's Orders */}
        <div
          data-testid="metric-today-orders"
          className="group relative rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs transition hover:shadow-md hover:border-primary/40 cursor-pointer"
          onClick={() => onNavigateTab("orders")}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Today's Orders
            </span>
            <div className="grid size-9 place-items-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <ShoppingBag className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            {ordersLoading ? (
              <div className="h-8 w-16 rounded bg-muted animate-pulse" />
            ) : (
              <div className="font-display text-2xl sm:text-3xl font-extrabold text-foreground">
                {todayOrders.length}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {todayOrders.length === 0
                ? "No new orders placed today"
                : `${todayCompletedCount} completed · ${todayOrders.length - todayCompletedCount} active`}
            </p>
          </div>
        </div>

        {/* Card 3: Pending Orders */}
        <div
          data-testid="metric-pending-orders"
          className="group relative rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs transition hover:shadow-md hover:border-primary/40 cursor-pointer"
          onClick={() => onNavigateTab("orders")}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pending Orders
            </span>
            <div className="grid size-9 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            {ordersLoading ? (
              <div className="h-8 w-16 rounded bg-muted animate-pulse" />
            ) : (
              <div className="flex items-baseline gap-2">
                <div className="font-display text-2xl sm:text-3xl font-extrabold text-foreground">
                  {pendingOrders.length}
                </div>
                {pendingOrders.length > 0 && (
                  <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 animate-pulse">
                    Needs Action
                  </span>
                )}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {pendingOrders.length === 0
                ? "All orders up to date"
                : `${placedOrdersCount} new placed, ${inProgressOrdersCount} processing`}
            </p>
          </div>
        </div>

        {/* Card 4: Total Products */}
        <div
          data-testid="metric-total-products"
          className="group relative rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs transition hover:shadow-md hover:border-primary/40 cursor-pointer"
          onClick={() => onNavigateTab("products")}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Products
            </span>
            <div className="grid size-9 place-items-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Layers className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            {productsLoading ? (
              <div className="h-8 w-16 rounded bg-muted animate-pulse" />
            ) : (
              <div className="font-display text-2xl sm:text-3xl font-extrabold text-foreground">
                {products.length}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {productsLoading
                ? "Loading catalog..."
                : `${products.filter((p) => p.is_active).length} active in storefront`}
            </p>
          </div>
        </div>

        {/* Card 5: Low Stock */}
        <div
          data-testid="metric-low-stock"
          className={cn(
            "group relative rounded-2xl border bg-card p-4 sm:p-5 shadow-xs transition hover:shadow-md cursor-pointer",
            lowStockProducts.length > 0
              ? "border-amber-500/40 hover:border-amber-500"
              : "border-border hover:border-primary/40"
          )}
          onClick={onManageInventory}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Low Stock (≤ 5)
            </span>
            <div
              className={cn(
                "grid size-9 place-items-center rounded-xl",
                lowStockProducts.length > 0
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              )}
            >
              <AlertTriangle className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            {productsLoading ? (
              <div className="h-8 w-16 rounded bg-muted animate-pulse" />
            ) : (
              <div className="flex items-baseline gap-2">
                <div
                  className={cn(
                    "font-display text-2xl sm:text-3xl font-extrabold",
                    lowStockProducts.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"
                  )}
                >
                  {lowStockProducts.length}
                </div>
                {outOfStockCount > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                    {outOfStockCount} out
                  </Badge>
                )}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {productsLoading
                ? "Checking stock..."
                : lowStockProducts.length === 0
                ? "All items well stocked"
                : `${lowThresholdCount} low stock · ${outOfStockCount} out of stock`}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Quick Action Shortcuts */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <SlidersHorizontal className="size-4" />
            </div>
            <h3 className="font-display text-base font-bold text-foreground">Quick Action Shortcuts</h3>
          </div>
          <span className="text-xs text-muted-foreground">Frequent operations</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2.5 sm:gap-3">
          {/* Action 1: Add New Product */}
          <button
            type="button"
            onClick={onAddNewProduct}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-secondary/30 hover:bg-primary/10 hover:border-primary/50 p-3.5 text-center transition group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs transition group-hover:scale-105">
              <Plus className="size-5" />
            </div>
            <div>
              <span className="block text-xs font-bold text-foreground group-hover:text-primary transition">
                Add Product
              </span>
              <span className="block text-[10px] text-muted-foreground">New item</span>
            </div>
          </button>

          {/* Action 2: Manage Products */}
          <button
            type="button"
            onClick={() => onNavigateTab("products")}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-secondary/30 hover:bg-secondary hover:border-primary/40 p-3.5 text-center transition group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="grid size-10 place-items-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 shadow-xs transition group-hover:scale-105">
              <Layers className="size-5" />
            </div>
            <div>
              <span className="block text-xs font-bold text-foreground group-hover:text-primary transition">
                All Products
              </span>
              <span className="block text-[10px] text-muted-foreground">{products.length} catalog items</span>
            </div>
          </button>

          {/* Action 3: View All Orders */}
          <button
            type="button"
            onClick={() => onNavigateTab("orders")}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-secondary/30 hover:bg-secondary hover:border-primary/40 p-3.5 text-center transition group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="grid size-10 place-items-center rounded-xl bg-blue-600/10 text-blue-700 dark:text-blue-400 shadow-xs transition group-hover:scale-105">
              <Package className="size-5" />
            </div>
            <div>
              <span className="block text-xs font-bold text-foreground group-hover:text-primary transition">
                View Orders
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {orders.length} total ({pendingOrders.length} active)
              </span>
            </div>
          </button>

          {/* Action 4: Manage Inventory */}
          <button
            type="button"
            onClick={onManageInventory}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-secondary/30 hover:bg-secondary hover:border-primary/40 p-3.5 text-center transition group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="grid size-10 place-items-center rounded-xl bg-amber-600/10 text-amber-700 dark:text-amber-400 shadow-xs transition group-hover:scale-105">
              <AlertTriangle className="size-5" />
            </div>
            <div>
              <span className="block text-xs font-bold text-foreground group-hover:text-primary transition">
                Stock & Inventory
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {lowStockProducts.length} needs attention
              </span>
            </div>
          </button>

          {/* Action 5: Categories */}
          <button
            type="button"
            onClick={() => {
              onNavigateTab("products");
              toast.info("Filter catalog by categories in the Products tab.");
            }}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-secondary/30 hover:bg-secondary hover:border-primary/40 p-3.5 text-center transition group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="grid size-10 place-items-center rounded-xl bg-teal-600/10 text-teal-700 dark:text-teal-400 shadow-xs transition group-hover:scale-105">
              <Tag className="size-5" />
            </div>
            <div>
              <span className="block text-xs font-bold text-foreground group-hover:text-primary transition">
                Categories
              </span>
              <span className="block text-[10px] text-muted-foreground">Campus taxonomy</span>
            </div>
          </button>

          {/* Action 6: Staff & Roles (Super Admin Only) */}
          <button
            type="button"
            onClick={() => {
              if (canManageRoles(adminRole)) {
                onNavigateTab("roles");
              } else {
                toast.error("Access restricted: Only Super Administrators can manage staff and roles.");
              }
            }}
            disabled={!canManageRoles(adminRole)}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border p-3.5 text-center transition group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              canManageRoles(adminRole)
                ? "border-border bg-secondary/30 hover:bg-secondary hover:border-primary/40"
                : "border-border/40 bg-secondary/10 opacity-60 cursor-not-allowed"
            )}
          >
            <div className="grid size-10 place-items-center rounded-xl bg-purple-600/10 text-purple-700 dark:text-purple-400 shadow-xs transition group-hover:scale-105">
              <Users className="size-5" />
            </div>
            <div>
              <span className="block text-xs font-bold text-foreground group-hover:text-primary transition">
                Staff & Roles
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {canManageRoles(adminRole) ? "Manage team" : "Super Admin"}
              </span>
            </div>
          </button>

          {/* Action 7: Storefront Preview */}
          <Link
            to="/"
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-secondary/30 hover:bg-secondary hover:border-primary/40 p-3.5 text-center transition group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary shadow-xs transition group-hover:scale-105">
              <ExternalLink className="size-5" />
            </div>
            <div>
              <span className="block text-xs font-bold text-foreground group-hover:text-primary transition">
                Live Storefront
              </span>
              <span className="block text-[10px] text-muted-foreground">Preview shop</span>
            </div>
          </Link>
        </div>
      </div>

      {/* 3. Sales Trend Visualization & Low Stock Attention (2 Columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: 7-Day Sales Trend */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-4">
              <div className="flex items-center gap-2">
                <div className="grid size-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <TrendingUp className="size-4" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-foreground">
                    7-Day Paid Sales Trend
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Aggregated daily from verified paid & completed campus orders
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-xs text-muted-foreground">7-Day Gross Sales</span>
                <div className="font-display text-base sm:text-lg font-extrabold text-foreground">
                  {formatINR(salesTrend.total7DaySales)}
                </div>
              </div>
            </div>

            {/* Sales Chart Visualization */}
            <div className="mt-6">
              {ordersLoading ? (
                <div className="h-44 w-full rounded-xl bg-muted/40 animate-pulse flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">Loading sales history...</span>
                </div>
              ) : salesTrend.total7DaySales === 0 && salesTrend.total7DayPaidOrders === 0 ? (
                <div className="h-44 flex flex-col items-center justify-center text-center p-4 border border-dashed border-border rounded-xl bg-muted/20">
                  <Calendar className="size-8 text-muted-foreground/50 mb-2" />
                  <p className="text-xs font-semibold text-foreground">No paid orders in the last 7 days</p>
                  <p className="text-[11px] text-muted-foreground max-w-sm mt-0.5">
                    As students checkout and pay via UPI or take delivery of COD orders, daily sales trends will display here in real time.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* CSS/SVG Bar Chart */}
                  <div className="grid grid-cols-7 gap-2 sm:gap-3 items-end h-40 pt-4 px-2">
                    {salesTrend.days.map((day, idx) => {
                      const heightPercent =
                        salesTrend.maxSales > 0 ? Math.max((day.sales / salesTrend.maxSales) * 100, 6) : 6;
                      const hasSales = day.sales > 0;

                      return (
                        <div
                          key={idx}
                          className="flex flex-col items-center h-full justify-end group relative"
                        >
                          {/* Tooltip on hover */}
                          <div className="pointer-events-none absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-foreground text-background text-[10px] rounded px-2 py-1 shadow-md whitespace-nowrap z-10">
                            {day.dateLabel}: {formatINR(day.sales)} ({day.paidCount} paid)
                          </div>

                          {/* Value label above bar */}
                          <span className="text-[10px] font-semibold text-muted-foreground mb-1">
                            {hasSales ? formatINR(day.sales) : "₹0"}
                          </span>

                          {/* Bar */}
                          <div className="w-full bg-secondary/50 rounded-t-lg overflow-hidden flex items-end h-28">
                            <div
                              style={{ height: `${heightPercent}%` }}
                              className={cn(
                                "w-full rounded-t-md transition-all duration-500",
                                hasSales
                                  ? "bg-primary group-hover:bg-primary/80"
                                  : "bg-muted-foreground/20"
                              )}
                            />
                          </div>

                          {/* Day & Date Labels */}
                          <span className="mt-2 text-[11px] font-bold text-foreground">
                            {day.dayLabel}
                          </span>
                          <span className="text-[9px] text-muted-foreground">{day.dateLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
            <span>Historical window: Last 7 calendar days</span>
            <span className="font-medium text-foreground">
              Total paid orders: {salesTrend.total7DayPaidOrders}
            </span>
          </div>
        </div>

        {/* Right 1 Col: Low Stock Attention / Alerts */}
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "grid size-8 place-items-center rounded-lg",
                    lowStockProducts.length > 0
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  <AlertTriangle className="size-4" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-foreground">Low Stock Alerts</h3>
                  <p className="text-xs text-muted-foreground">Products with stock ≤ 5</p>
                </div>
              </div>
              <Badge
                variant={lowStockProducts.length > 0 ? "outline" : "secondary"}
                className={cn(
                  "text-xs font-bold",
                  lowStockProducts.length > 0
                    ? "border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-300"
                    : "text-muted-foreground"
                )}
              >
                {lowStockProducts.length} items
              </Badge>
            </div>

            {/* List */}
            <div className="mt-4 space-y-2.5">
              {productsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 rounded-xl bg-muted/40 animate-pulse" />
                  ))}
                </div>
              ) : lowStockProducts.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle2 className="size-9 text-emerald-500 mx-auto mb-2" />
                  <p className="text-xs font-bold text-foreground">Healthy Inventory</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xs mx-auto">
                    All campus catalog products currently have 6 or more units in stock.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {lowStockProducts.slice(0, 6).map((prod) => (
                    <div
                      key={prod.id}
                      className="flex items-center justify-between gap-2.5 rounded-xl border border-border/80 bg-secondary/20 p-2.5 transition hover:bg-secondary/40"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={prod.image_url || BRAND_FALLBACK_IMAGE}
                          alt={prod.name}
                          className="size-9 rounded-lg object-cover bg-card border border-border shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = BRAND_FALLBACK_IMAGE;
                          }}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{prod.name}</p>
                          <p className="text-[10px] text-muted-foreground capitalize">
                            {prod.size} · {prod.category_id}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant={prod.stock === 0 ? "destructive" : "outline"}
                          className={cn(
                            "text-[10px] font-bold px-2 py-0.5",
                            prod.stock > 0 &&
                              "border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-400"
                          )}
                        >
                          {prod.stock === 0 ? "Out of stock" : `${prod.stock} left`}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEditProduct(prod)}
                          className="h-7 px-2 text-xs font-semibold text-primary hover:text-primary hover:bg-primary/10"
                        >
                          Restock
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/40">
            <Button
              variant="outline"
              size="sm"
              onClick={onManageInventory}
              className="w-full text-xs font-semibold justify-between h-8"
            >
              <span>Manage Full Inventory</span>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* 4. Actionable Recent Orders Section */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Package className="size-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-foreground">Recent Customer Orders</h3>
              <p className="text-xs text-muted-foreground">
                Latest orders received from student campus community
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigateTab("orders")}
              className="h-8 text-xs font-semibold gap-1.5"
            >
              <span>View All ({orders.length})</span>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Orders Table / Cards */}
        <div className="mt-4">
          {ordersLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="py-12 text-center rounded-xl border border-dashed border-border bg-muted/10">
              <ShoppingBag className="size-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-bold text-foreground">No orders recorded yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Orders placed through campus checkout will appear here instantly with live tracking, delivery details, and fulfillment controls.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button asChild size="sm" variant="outline" className="text-xs">
                  <Link to="/">Open Storefront</Link>
                </Button>
                <Button size="sm" variant="default" onClick={onRefresh} className="text-xs">
                  Check Again
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground">
                    <th className="pb-3 font-semibold">Order</th>
                    <th className="pb-3 font-semibold">Customer</th>
                    <th className="pb-3 font-semibold">Placed At</th>
                    <th className="pb-3 font-semibold">Total Amount</th>
                    <th className="pb-3 font-semibold">Payment</th>
                    <th className="pb-3 font-semibold">Status</th>
                    <th className="pb-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {recentOrders.map((ord) => {
                    const badge = getOrderStatusBadge(ord.status);
                    const isCopied = copiedOrderId === ord.order_number;

                    return (
                      <tr key={ord.id} className="hover:bg-secondary/30 transition">
                        {/* Order identifier */}
                        <td className="py-3 font-mono font-bold text-foreground">
                          <div className="flex items-center gap-1.5">
                            <span>{ord.order_number}</span>
                            <button
                              type="button"
                              onClick={() => copyOrderNumber(ord.order_number)}
                              className="text-muted-foreground hover:text-foreground p-0.5 rounded transition"
                              title="Copy order number"
                            >
                              {isCopied ? (
                                <Check className="size-3 text-emerald-500" />
                              ) : (
                                <Copy className="size-3" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* Customer */}
                        <td className="py-3">
                          <div className="font-semibold text-foreground">{ord.customer_name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {ord.user_id ? "Registered Student" : "Guest Checkout"}
                          </div>
                        </td>

                        {/* Date & Time */}
                        <td className="py-3 text-muted-foreground">
                          <div>
                            {new Date(ord.created_at).toLocaleDateString("en-IN", {
                              month: "short",
                              day: "numeric",
                            })}
                          </div>
                          <div className="text-[10px]">
                            {new Date(ord.created_at).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </td>

                        {/* Amount */}
                        <td className="py-3 font-display font-extrabold text-foreground">
                          {formatINR(ord.total_amount)}
                        </td>

                        {/* Payment */}
                        <td className="py-3">
                          <span className="uppercase font-semibold text-[11px] text-foreground">
                            {ord.payment_method}
                          </span>
                          <span
                            className={cn(
                              "block text-[10px] font-medium capitalize",
                              ord.payment_status === "completed"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : ord.payment_status === "failed"
                                ? "text-destructive"
                                : "text-amber-600 dark:text-amber-400"
                            )}
                          >
                            {ord.payment_status}
                          </span>
                        </td>

                        {/* Order Status */}
                        <td className="py-3">
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] font-bold px-2 py-0.5", badge.className)}
                          >
                            {badge.label}
                          </Badge>
                        </td>

                        {/* Action */}
                        <td className="py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onViewOrder(ord)}
                            className="h-7 text-xs font-semibold gap-1 px-2.5"
                          >
                            <Eye className="size-3" />
                            <span>View</span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
