import { useState } from "react";
import { Search, PackageCheck, Clock, CheckCircle2, AlertCircle, Loader2, ArrowRight, User, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trackGuestOrder, resolveOrderItemImage, BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { customerCancelOrder } from "@/lib/studentPaymentApi";
import { useCustomerAuth } from "@/lib/auth";
import { formatINR } from "@/data/products";
import type { TrackedOrder } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS_STEPS = [
  { key: "placed", label: "Placed" },
  { key: "confirmed", label: "Confirmed" },
  { key: "preparing", label: "Preparing" },
  { key: "out_for_delivery", label: "Out for Delivery" },
  { key: "completed", label: "Completed" },
];

export function OrderTrackerModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, profile } = useCustomerAuth();
  const [orderNumber, setOrderNumber] = useState("");
  const [trackingToken, setTrackingToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("Ordered by mistake");
  const [isCancelling, setIsCancelling] = useState(false);

  const isEligibleToCancel = order
    ? ["placed", "confirmed", "preparing"].includes(order.status.toLowerCase())
    : false;

  const handleGuestCancelOrder = async () => {
    if (!order) return;
    setIsCancelling(true);
    try {
      const res = await customerCancelOrder(order.order_number, {
        guestToken: trackingToken.trim(),
        reason: cancelReason,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to cancel order.");
        setIsCancelling(false);
        return;
      }

      toast.success(`Order #${order.order_number} cancelled successfully.`);
      setOrder((prev) => (prev ? { ...prev, status: "cancelled" } : null));
      setShowCancelConfirm(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel order.");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderNumber.trim()) {
      setError("Please enter your Order Number.");
      return;
    }
    if (!trackingToken.trim()) {
      setError("Please enter your Guest Tracking Token.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const res = await trackGuestOrder(orderNumber.trim(), trackingToken.trim());
      if (!res.success || !res.data) {
        setError(res.error || "Order not found. Both the exact Order Number and matching 64-character Tracking Token are required.");
        setOrder(null);
      } else {
        setOrder(res.data);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to find order.");
      setOrder(null);
    } finally {
      setIsLoading(false);
    }
  };

  const currentStepIdx = order
    ? STATUS_STEPS.findIndex((s) => s.key === order.status)
    : -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-3xl p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">Track Your Order</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Enter your order number and secret guest tracking token provided at checkout.
          </DialogDescription>
        </DialogHeader>

        {/* Authenticated user shortcut */}
        {user && (
          <div className="mt-3 flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs">
            <div className="flex items-center gap-2">
              <User className="size-4 text-primary shrink-0" />
              <span>
                Signed in as <strong>{profile?.full_name || user.email}</strong>
              </span>
            </div>
            <Link
              to="/account"
              onClick={() => onOpenChange(false)}
              className="font-bold text-primary hover:underline ml-2 shrink-0"
            >
              View My Orders →
            </Link>
          </div>
        )}

        {/* Input Form */}
        <form onSubmit={handleTrack} className="mt-4 space-y-4">
          <div>
            <div className="flex justify-between items-center mb-1">
              <label htmlFor="track-order-no" className="block text-xs font-semibold text-foreground">
                Order Number
              </label>
              <span className="text-[10px] text-muted-foreground">e.g. QM-20261014-DEFA2FFD</span>
            </div>
            <input
              id="track-order-no"
              type="text"
              required
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="QM-YYYYMMDD-XXXXXXXX"
              className="h-11 w-full rounded-xl border border-input bg-card px-3.5 font-mono text-xs sm:text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30 uppercase"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label htmlFor="track-token" className="block text-xs font-semibold text-foreground">
                Guest Tracking Token
              </label>
              <span className="text-[10px] text-muted-foreground font-mono">64 hex characters</span>
            </div>
            <input
              id="track-token"
              type="text"
              required
              value={trackingToken}
              onChange={(e) => setTrackingToken(e.target.value)}
              placeholder="Paste your 64-character secret token here"
              className="h-11 w-full rounded-xl border border-input bg-card px-3.5 font-mono text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              To protect student privacy, orders can only be viewed with this private token.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" disabled={isLoading} variant="hero" className="h-11 w-full font-bold text-xs sm:text-sm">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                <span>Locating order...</span>
              </>
            ) : (
              <>
                <Search className="mr-2 size-4" />
                <span>Track Order</span>
              </>
            )}
          </Button>
        </form>

        {/* Order Details Result */}
        {order && (
          <div className="mt-6 border-t border-border pt-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
                <p className="font-display text-lg font-bold capitalize text-primary">
                  {order.status.replace(/_/g, " ")}
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 font-mono text-xs font-bold text-primary">
                {order.order_number}
              </span>
            </div>

            {/* Stepper visualization */}
            {order.status !== "cancelled" ? (
              <div className="mt-4 flex items-center justify-between">
                {STATUS_STEPS.map((s, idx) => {
                  const done = idx <= currentStepIdx;
                  const active = idx === currentStepIdx;
                  return (
                    <div key={s.key} className="flex flex-col items-center text-center">
                      <div
                        className={cn(
                          "grid size-7 place-items-center rounded-full text-xs font-bold transition",
                          active
                            ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                            : done
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {done ? <CheckCircle2 className="size-4" /> : idx + 1}
                      </div>
                      <span className="mt-1 text-[10px] font-medium text-muted-foreground">
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-center text-xs font-semibold text-destructive">
                This order was cancelled.
              </div>
            )}

            {/* Destination summary */}
            <div className="mt-5 rounded-2xl border border-border/80 bg-secondary/30 p-4 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recipient:</span>
                <span className="font-semibold text-foreground">{order.customer_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fulfillment:</span>
                <span className="font-semibold text-foreground">
                  {order.delivery_method === "hostel_delivery"
                    ? `${order.hostel || "Hostel"}, ${order.block || ""} ${order.room ? "Room " + order.room : ""}`
                    : order.pickup_location || "Campus Pickup"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment:</span>
                <span className="font-semibold uppercase text-foreground">
                  {order.payment_method} ({order.payment_status})
                </span>
              </div>
            </div>

            {/* Items list */}
            {order.items && order.items.length > 0 && (
              <div className="mt-4">
                <span className="text-xs font-semibold text-muted-foreground">Items Ordered</span>
                <div className="mt-2 divide-y divide-border/60 rounded-2xl border border-border bg-card overflow-hidden">
                  {order.items.map((item, i) => {
                    const imgSrc = resolveOrderItemImage({ product_name: item.product_name });
                    return (
                      <div key={i} className="flex items-center gap-3 p-3">
                        <img
                          src={imgSrc}
                          alt={item.product_name}
                          className="size-11 rounded-lg object-cover bg-muted border border-border shrink-0"
                          onError={(e) => {
                            e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs text-foreground truncate">{item.product_name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {item.product_size && <span>{item.product_size} · </span>}
                            <span>Qty: {item.quantity}</span>
                          </p>
                        </div>
                        <span className="font-mono text-xs font-bold text-foreground shrink-0">
                          {formatINR(item.total_price)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-bold">
                  <span>Total Amount</span>
                  <span className="font-display font-extrabold text-primary">{formatINR(order.total_amount)}</span>
                </div>
              </div>
            )}

            {/* Guest Order Cancellation Action */}
            {isEligibleToCancel && (
              <div className="mt-5 border-t border-border/60 pt-4 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Need to cancel this order?</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCancelConfirm(true)}
                  className="h-8 gap-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                >
                  <X className="size-3.5" />
                  <span>Cancel Order</span>
                </Button>
              </div>
            )}

            {["out_for_delivery", "ready_for_pickup"].includes(order.status.toLowerCase()) && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <Clock className="size-4 shrink-0" />
                <span>Order has passed customer cancellation cutoff (already dispatched or ready at counter).</span>
              </div>
            )}
          </div>
        )}

        {/* Confirmation Modal for Guest Order Cancellation */}
        <Dialog open={showCancelConfirm} onOpenChange={(open) => !isCancelling && setShowCancelConfirm(open)}>
          <DialogContent className="max-w-md rounded-3xl p-6">
            <DialogHeader>
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="size-5 shrink-0" />
                <DialogTitle className="font-display text-lg font-bold">
                  Cancel Order #{order?.order_number}?
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-muted-foreground pt-1">
                Are you sure you want to cancel this order? This action cannot be undone by the customer.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs space-y-1">
                <p className="font-semibold text-foreground">Verified Guest Authorization</p>
                <p className="text-muted-foreground text-[11px]">
                  Cancellation is authenticated using your secret guest tracking token.
                </p>
                {(order?.payment_status === "paid" || order?.payment_status === "completed") ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 pt-1 font-medium border-t border-border/60">
                    💡 Verified Payment: Your {order?.payment_method?.toUpperCase()} payment will be reviewed by campus management for refund.
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/60">
                    💡 Stock Notice: Unpaid items will be released back into catalogue stock immediately.
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">Reason for cancellation:</label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  disabled={isCancelling}
                  className="h-9 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                >
                  <option value="Ordered by mistake">Ordered by mistake</option>
                  <option value="Change of delivery details">Change of delivery location</option>
                  <option value="Delivery time too long">Delivery time too long</option>
                  <option value="Found alternative on campus">Found alternative on campus</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isCancelling}
                  onClick={() => setShowCancelConfirm(false)}
                  className="text-xs font-semibold"
                >
                  Keep Order
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isCancelling}
                  onClick={handleGuestCancelOrder}
                  className="h-8 gap-1.5 text-xs font-bold"
                >
                  {isCancelling ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Cancelling...</span>
                    </>
                  ) : (
                    <>
                      <X className="size-3.5" />
                      <span>Confirm Cancellation</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
