import React, { useState, useRef, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  CheckCircle2,
  Package,
  Truck,
  CheckCheck,
  XCircle,
  ShieldCheck,
  RotateCcw,
  ShoppingBag,
  CreditCard,
  Check,
} from "lucide-react";
import { useCustomerNotifications } from "@/lib/customerNotificationsApi";
import type { CustomerNotification, CustomerNotificationEventType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CustomerNotificationBellProps {
  userId?: string | null;
  onSelectOrder?: (orderId: string, orderNumber?: string | null) => void;
  className?: string;
}

export function CustomerNotificationBell({
  userId,
  onSelectOrder,
  className,
}: CustomerNotificationBellProps) {
  const { notifications, unreadCount, markRead, markAllRead } = useCustomerNotifications(userId);
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isOpen]);

  if (!userId) {
    return null; // Only show for logged in accounts
  }

  const getEventBadge = (type: CustomerNotificationEventType) => {
    switch (type) {
      case "order_placed":
      case "order_confirmed":
        return {
          icon: ShoppingBag,
          label: "Order",
          color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
        };
      case "payment_success":
        return {
          icon: ShieldCheck,
          label: "Paid",
          color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
        };
      case "payment_failed":
        return {
          icon: CreditCard,
          label: "Payment Failed",
          color: "bg-destructive/10 text-destructive border-destructive/20",
        };
      case "order_preparing":
        return {
          icon: Package,
          label: "Preparing",
          color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
        };
      case "order_ready":
      case "order_out_for_delivery":
        return {
          icon: Truck,
          label: "Delivery",
          color: "bg-sky-500/10 text-sky-600 border-sky-500/20",
        };
      case "order_completed":
        return {
          icon: CheckCheck,
          label: "Delivered",
          color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
        };
      case "order_cancelled":
        return {
          icon: XCircle,
          label: "Cancelled",
          color: "bg-destructive/10 text-destructive border-destructive/20",
        };
      case "refund_requested":
      case "refund_processing":
      case "refund_completed":
      case "refund_rejected":
        return {
          icon: RotateCcw,
          label: "Refund",
          color: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
        };
      default:
        return {
          icon: Bell,
          label: "Notification",
          color: "bg-secondary text-muted-foreground border-border",
        };
    }
  };

  const handleItemClick = (notif: CustomerNotification) => {
    if (!notif.is_read) {
      markRead(notif.id);
    }
    if (notif.order_id && onSelectOrder) {
      onSelectOrder(notif.order_id, notif.order_number);
      setIsOpen(false);
    }
  };

  return (
    <div className={cn("relative inline-block", className)} ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative grid size-9 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
        aria-label="Customer Notifications"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 grid min-w-4 h-4 px-1 place-items-center rounded-full bg-primary text-[10px] font-extrabold text-primary-foreground shadow-xs animate-in zoom-in-50">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-3xl border border-border/80 bg-card p-0 shadow-soft z-50 animate-in fade-in-50 slide-in-from-top-2">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 p-4">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-sm text-foreground">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary border border-primary/20">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
              >
                <Check className="size-3" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-border/40">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground space-y-1">
                <Bell className="mx-auto size-7 text-muted-foreground/40 mb-2" />
                <p className="font-semibold text-foreground">No notifications yet</p>
                <p className="text-[11px]">Updates on your orders and payments will appear here.</p>
              </div>
            ) : (
              notifications.map((notif) => {
                const badge = getEventBadge(notif.event_type);
                const Icon = badge.icon;

                return (
                  <div
                    key={notif.id}
                    onClick={() => handleItemClick(notif)}
                    className={cn(
                      "p-3.5 transition flex items-start gap-3 hover:bg-secondary/40 cursor-pointer text-left relative",
                      !notif.is_read ? "bg-primary/[0.03]" : ""
                    )}
                  >
                    <div className={cn("grid size-8 shrink-0 place-items-center rounded-xl border", badge.color)}>
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-bold text-foreground truncate">{notif.title}</p>
                        {!notif.is_read && (
                          <span className="size-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                        {notif.message}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 pt-0.5">
                        {new Date(notif.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {" · "}
                        {new Date(notif.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border/60 p-2.5 text-center bg-secondary/20 rounded-b-3xl">
            <Button asChild variant="ghost" size="sm" className="w-full h-8 text-xs font-bold">
              <Link to="/account" onClick={() => setIsOpen(false)}>
                View Order History & Tracking
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

