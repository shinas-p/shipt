import { useState, useRef, useEffect } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  ShoppingBag,
  XCircle,
  AlertCircle,
  Lightbulb,
  AlertTriangle,
  Volume2,
  VolumeX,
  ExternalLink,
  Clock,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useAdminNotifications,
  requestDesktopNotificationPermission,
  type AdminNotification,
  type NotificationEventType,
} from "@/lib/notifications";
import { formatINR } from "@/data/products";
import { cn } from "@/lib/utils";

interface AdminNotificationBellProps {
  onSelectOrder?: (orderId: string, orderNumber?: string | null) => void;
}

export function AdminNotificationBell({ onSelectOrder }: AdminNotificationBellProps) {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    soundEnabled,
    toggleSound,
  } = useAdminNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>("default");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Sync browser notification permission status
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setBrowserPermission(Notification.permission);
    }
  }, []);

  // Close popover when clicking outside
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

  const handleEnableDesktop = async () => {
    const permission = await requestDesktopNotificationPermission();
    setBrowserPermission(permission);
  };

  const handleNotificationClick = (notif: AdminNotification) => {
    if (!notif.is_read) {
      markAsRead(notif.id);
    }

    if (notif.order_id && onSelectOrder) {
      onSelectOrder(notif.order_id, notif.order_number);
      setIsOpen(false);
    }
  };

  const getEventBadge = (type: NotificationEventType) => {
    switch (type) {
      case "new_order":
        return {
          icon: ShoppingBag,
          label: "New Order",
          className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
        };
      case "order_cancelled":
        return {
          icon: XCircle,
          label: "Cancelled",
          className: "bg-destructive/15 text-destructive border-destructive/30",
        };
      case "payment_attention":
        return {
          icon: AlertCircle,
          label: "Payment Attention",
          className: "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-400",
        };
      case "new_suggestion":
        return {
          icon: Lightbulb,
          label: "Suggestion",
          className: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
        };
      case "low_stock":
        return {
          icon: AlertTriangle,
          label: "Low Stock",
          className: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
        };
      default:
        return {
          icon: Sparkles,
          label: "System",
          className: "bg-primary/15 text-primary border-primary/30",
        };
    }
  };

  const formatRelativeTime = (isoString: string) => {
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 45) return "Just now";
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}h ago`;
      const diffDay = Math.floor(diffHour / 24);
      return `${diffDay}d ago`;
    } catch {
      return "Recently";
    }
  };

  return (
    <div className="relative inline-block" ref={popoverRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        id="admin-notification-bell-btn"
        aria-label={`Admin Notifications (${unreadCount} unread)`}
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "relative grid size-9 place-items-center rounded-xl border transition focus:outline-none focus:ring-2 focus:ring-primary/40",
          isOpen
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-card text-foreground hover:bg-secondary"
        )}
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span
            id="admin-unread-badge"
            className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow-xs animate-in zoom-in-75"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Notification Panel */}
      {isOpen && (
        <div
          id="admin-notification-panel"
          className="absolute right-0 top-11 z-50 w-80 sm:w-96 rounded-2xl border border-border bg-card p-0 shadow-xl duration-200 animate-in fade-in-0 zoom-out-95 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-display text-xs font-bold text-foreground">
                Admin Notifications
              </span>
              {unreadCount > 0 ? (
                <Badge variant="outline" className="bg-rose-500/10 text-rose-700 border-rose-500/30 text-[10px] font-bold">
                  {unreadCount} unread
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  Up to date
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={markAllAsRead}
                  className="h-7 px-2 text-[11px] font-semibold text-primary hover:text-primary gap-1"
                  id="admin-mark-all-read-btn"
                >
                  <CheckCheck className="size-3.5" />
                  <span>Mark All Read</span>
                </Button>
              )}

              {/* Sound Toggle */}
              <button
                type="button"
                onClick={() => toggleSound(!soundEnabled)}
                title={soundEnabled ? "Mute notification sound" : "Enable notification sound"}
                className={cn(
                  "grid size-7 place-items-center rounded-lg border transition",
                  soundEnabled
                    ? "border-primary/30 text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {soundEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
              </button>
            </div>
          </div>

          {/* Desktop Notification Banner */}
          {browserPermission !== "granted" && (
            <div className="flex items-center justify-between border-b border-border/60 bg-primary/5 px-4 py-2 text-[11px]">
              <span className="text-muted-foreground">
                {browserPermission === "denied"
                  ? "Desktop alerts blocked in browser"
                  : "Enable desktop alerts for new orders"}
              </span>
              {browserPermission !== "denied" && (
                <button
                  type="button"
                  onClick={handleEnableDesktop}
                  className="font-bold text-primary hover:underline"
                  id="admin-enable-browser-notif-btn"
                >
                  Enable
                </button>
              )}
            </div>
          )}

          {/* Notifications List */}
          <div className="max-h-[360px] overflow-y-auto divide-y divide-border/40 [scrollbar-width:thin]">
            {notifications.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <div className="mx-auto grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground">
                  <Bell className="size-5" />
                </div>
                <p className="text-xs font-semibold text-foreground">No notifications yet</p>
                <p className="text-[11px] text-muted-foreground max-w-[200px] mx-auto">
                  New orders and store alerts will appear here in real time.
                </p>
              </div>
            ) : (
              notifications.map((notif) => {
                const badge = getEventBadge(notif.event_type);
                const Icon = badge.icon;

                return (
                  <div
                    key={notif.id}
                    className={cn(
                      "p-3.5 transition flex items-start gap-3 hover:bg-secondary/40 cursor-pointer text-left relative",
                      !notif.is_read ? "bg-primary/[0.03]" : ""
                    )}
                    onClick={() => handleNotificationClick(notif)}
                  >
                    {/* Unread dot */}
                    {!notif.is_read && (
                      <span className="absolute top-4 left-1.5 size-1.5 rounded-full bg-primary" />
                    )}

                    <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-secondary text-foreground">
                      <Icon className="size-4 text-primary" />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className={cn("text-[9px] font-bold uppercase py-0", badge.className)}>
                          {badge.label}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                          <Clock className="size-2.5" />
                          <span>{formatRelativeTime(notif.created_at)}</span>
                        </span>
                      </div>

                      <p className="text-xs font-bold text-foreground leading-snug">
                        {notif.title}
                      </p>

                      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                        {notif.message}
                      </p>

                      {/* Order Details Preview */}
                      {notif.metadata && typeof notif.metadata === "object" && notif.metadata["total_amount"] !== undefined && (
                        <div className="flex items-center gap-2 pt-0.5 text-[10px] font-mono text-foreground font-semibold">
                          <span>Total: {formatINR(Number(notif.metadata["total_amount"]) || 0)}</span>
                          {notif.metadata["delivery_method"] && (
                            <>
                              <span>•</span>
                              <span className="capitalize">{String(notif.metadata["delivery_method"]).replace("_", " ")}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Mark as read individual button */}
                    {!notif.is_read && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          markAsRead(notif.id);
                        }}
                        title="Mark as read"
                        className="mt-1 size-6 shrink-0 grid place-items-center rounded-lg border border-border/60 hover:bg-secondary text-muted-foreground hover:text-foreground"
                      >
                        <Check className="size-3" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer note */}
          <div className="border-t border-border bg-secondary/20 px-4 py-2 text-center text-[10px] text-muted-foreground">
            Clicking an order alert navigates directly to order details.
          </div>
        </div>
      )}
    </div>
  );
}
