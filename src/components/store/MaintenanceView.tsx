import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  ShoppingBag,
  Package,
  Sparkles,
  Clock,
  Shield,
  ArrowRight,
  RefreshCw,
  Bell,
  CheckCircle2,
} from "lucide-react";
import { useMaintenance } from "@/lib/maintenance";
import { useBranding } from "@/lib/branding";
import { OrderTrackerModal } from "@/components/store/OrderTrackerModal";
import { Button } from "@/components/ui/button";

export interface MaintenanceViewProps {
  previewMessage?: string;
  previewReopenAt?: string | null;
  isPreview?: boolean;
}

export function MaintenanceView({
  previewMessage,
  previewReopenAt,
  isPreview = false,
}: MaintenanceViewProps) {
  const { maintenanceMessage, maintenanceReopenAt, refreshMaintenance } = useMaintenance();
  const { branding } = useBranding();

  const [trackerOpen, setTrackerOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);

  const displayMessage = previewMessage ?? maintenanceMessage;
  const displayReopenAt = previewReopenAt !== undefined ? previewReopenAt : maintenanceReopenAt;

  // Format reopening time and calculate live countdown
  useEffect(() => {
    if (!displayReopenAt) {
      setTimeRemaining(null);
      return;
    }

    const updateCountdown = () => {
      try {
        const target = new Date(displayReopenAt).getTime();
        const now = Date.now();
        const diffMs = target - now;

        if (diffMs <= 0) {
          setTimeRemaining("Reopening momentarily");
          return;
        }

        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

        if (hours > 24) {
          const days = Math.floor(hours / 24);
          setTimeRemaining(`In approximately ${days} day${days > 1 ? "s" : ""}`);
        } else if (hours > 0) {
          setTimeRemaining(`${hours}h ${minutes}m ${seconds}s remaining`);
        } else {
          setTimeRemaining(`${minutes}m ${seconds}s remaining`);
        }
      } catch {
        setTimeRemaining(null);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [displayReopenAt]);

  const handleManualCheck = async () => {
    setIsRefreshing(true);
    try {
      await refreshMaintenance();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  return (
    <div
      className={`relative min-h-[90vh] flex flex-col justify-between overflow-hidden bg-forest text-forest-foreground ${
        isPreview ? "rounded-3xl border border-border shadow-inner" : ""
      }`}
    >
      <style>{`
        @keyframes float-slow {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-12px) rotate(2deg); }
        }
        @keyframes float-reverse {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(10px) rotate(-2deg); }
        }
        @keyframes pulse-subtle {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.28; transform: scale(1.05); }
        }
        @media (prefers-reduced-motion: reduce) {
          .motion-floating-box, .motion-floating-bag, .motion-pulse-glow {
            animation: none !important;
            transform: none !important;
          }
        }
        .motion-floating-bag {
          animation: float-slow 6s ease-in-out infinite;
        }
        .motion-floating-box {
          animation: float-reverse 7s ease-in-out infinite;
        }
        .motion-pulse-glow {
          animation: pulse-subtle 8s ease-in-out infinite;
        }
      `}</style>

      {/* Background Decorative Ambient Spheres */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="motion-pulse-glow absolute -top-40 -left-40 size-96 rounded-full bg-lime/20 blur-3xl" />
        <div className="motion-pulse-glow absolute -bottom-40 -right-40 size-96 rounded-full bg-lime/15 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[600px] rounded-full bg-black/20 blur-2xl pointer-events-none" />
      </div>

      {/* Top Banner Navigation */}
      <header className="relative z-10 container-page py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {branding.logo_url ? (
            <img
              src={branding.logo_url}
              alt={branding.store_name}
              className="size-10 object-contain rounded-xl bg-card/10 p-1 backdrop-blur-xs ring-1 ring-white/20"
            />
          ) : (
            <span className="grid size-10 place-items-center rounded-xl bg-lime text-lime-foreground shadow-sm">
              <ShoppingBag className="size-5" />
            </span>
          )}
          <span className="font-display text-xl font-black tracking-tight text-white">
            {branding.store_name}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!isPreview && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleManualCheck}
              disabled={isRefreshing}
              className="h-8 rounded-full border-white/20 bg-white/10 text-white hover:bg-white/20 text-xs backdrop-blur-xs gap-1.5 transition"
              title="Check if the storefront has reopened"
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-lime" : ""}`} />
              <span className="hidden sm:inline">Check Availability</span>
            </Button>
          )}

          <Link
            to="/admin"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 text-xs font-semibold text-white/80 hover:bg-white/15 hover:text-white transition backdrop-blur-xs"
          >
            <Shield className="size-3 text-lime" />
            <span>Staff Sign-In</span>
          </Link>
        </div>
      </header>

      {/* Central Hero Experience */}
      <main className="relative z-10 container-page my-auto py-12 flex flex-col items-center text-center">
        {/* Animated Brand Stage */}
        <div className="relative mb-8 flex items-center justify-center">
          {/* Outer glow ring */}
          <div className="absolute size-40 rounded-full bg-lime/20 blur-xl animate-pulse" />

          {/* Floating Left Illustration: Shopping Bag */}
          <div className="motion-floating-bag absolute -left-16 sm:-left-20 -top-4 grid size-14 sm:size-16 place-items-center rounded-2xl bg-card/90 text-primary shadow-2xl backdrop-blur-md border border-white/20">
            <ShoppingBag className="size-7 sm:size-8 text-primary" />
          </div>

          {/* Floating Right Illustration: Parcel Box */}
          <div className="motion-floating-box absolute -right-16 sm:-right-20 -bottom-2 grid size-14 sm:size-16 place-items-center rounded-2xl bg-lime text-lime-foreground shadow-2xl backdrop-blur-md border border-white/30">
            <Package className="size-7 sm:size-8" />
          </div>

          {/* Central Shield / Sparkle Hub */}
          <div className="relative grid size-28 sm:size-32 place-items-center rounded-3xl bg-white/10 backdrop-blur-xl border border-white/25 shadow-2xl ring-4 ring-lime/20">
            <Sparkles className="size-12 sm:size-14 text-lime animate-bounce" style={{ animationDuration: "3s" }} />
          </div>
        </div>

        {/* Live Status Pill */}
        <div className="inline-flex items-center gap-2 rounded-full border border-lime/30 bg-lime/15 px-3.5 py-1 text-xs font-semibold text-lime shadow-xs backdrop-blur-sm mb-4">
          <span className="size-2 rounded-full bg-lime animate-ping" />
          <span>Scheduled Maintenance in Progress</span>
        </div>

        {/* Main Headline */}
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl text-white max-w-2xl leading-tight">
          We&apos;re restocking!
        </h1>

        {/* Supporting Explanation */}
        <p className="mt-3 max-w-xl text-sm sm:text-base text-white/80 leading-relaxed font-sans">
          {branding.store_name} is temporarily closed while our warehouse and catalogue team
          performs live inventory restocking, price calibrations, and product additions.
        </p>

        {/* Configurable Customer Announcement Card */}
        {displayMessage && (
          <div className="mt-6 w-full max-w-lg rounded-2xl border border-white/20 bg-white/10 p-4 sm:p-5 text-left shadow-lg backdrop-blur-md">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-lime/20 text-lime">
                <Bell className="size-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-lime">
                  Store Announcement
                </p>
                <p className="mt-1 text-xs sm:text-sm text-white font-medium leading-relaxed whitespace-pre-wrap">
                  {displayMessage}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Expected Reopening Schedule Pill */}
        {displayReopenAt && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/15 bg-black/25 px-4 py-2.5 text-xs text-white/90 backdrop-blur-md">
            <Clock className="size-4 text-lime shrink-0" />
            <span className="font-semibold text-lime">Expected Reopening:</span>
            <span>{new Date(displayReopenAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
            {timeRemaining && (
              <span className="rounded-full bg-lime/20 px-2.5 py-0.5 text-[11px] font-bold text-lime ml-1">
                {timeRemaining}
              </span>
            )}
          </div>
        )}

        {/* Customer Actions & Existing Order Tracking */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            variant="default"
            size="lg"
            onClick={() => setTrackerOpen(true)}
            className="h-11 rounded-full bg-lime text-lime-foreground hover:bg-lime/90 font-bold text-xs gap-2 shadow-lg"
          >
            <Package className="size-4" />
            <span>Track Existing Order</span>
          </Button>

          <Link
            to="/account"
            search={{ tab: "orders" }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 text-xs font-bold text-white hover:bg-white/20 transition backdrop-blur-sm"
          >
            <span>My Account & Orders</span>
            <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {/* Non-Disruptive Guarantee Note */}
        <div className="mt-8 flex items-center gap-2 text-[11px] text-white/60">
          <CheckCircle2 className="size-3.5 text-lime" />
          <span>Existing confirmed orders will be processed and dispatched without interruption.</span>
        </div>
      </main>

      {/* Footer / Copyright */}
      <footer className="relative z-10 container-page py-6 text-center text-xs text-white/50 border-t border-white/10">
        <p>
          &copy; {new Date().getFullYear()} {branding.store_name}. Campus & Everyday Essentials Delivered Fast.
        </p>
      </footer>

      {/* Order Tracking Modal for Active Customers */}
      <OrderTrackerModal open={trackerOpen} onOpenChange={setTrackerOpen} />
    </div>
  );
}
