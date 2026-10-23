import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ShoppingBag,
  Smartphone,
  Wallet,
  Building,
  MapPin,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Info,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { useCustomerAuth } from "@/lib/auth";
import { formatINR } from "@/data/products";
import type { CheckoutFormData, PlacedOrderResult, DeliveryBlock } from "@/lib/types";
import { placeOrder, loadActiveDeliveryBlocks } from "@/lib/catalogApi";
import { cn } from "@/lib/utils";

const PICKUP_LOCATIONS = [
  "Shipt Mart Hub — Central Dispatch Point",
  "North Wing Pickup Kiosk",
  "Main Express Counter",
];

type Errors = Partial<Record<keyof CheckoutFormData, string>>;

function validate(f: CheckoutFormData): Errors {
  const e: Errors = {};
  if (f.name.trim().length < 2) e.name = "Please enter your full name (at least 2 characters).";
  if (!/^[6-9]\d{9}$/.test(f.phone.replace(/\s/g, "")))
    e.phone = "Enter a valid 10-digit mobile number.";

  if (f.deliveryMethod === "hostel_delivery") {
    if (!f.deliveryBlockId && !f.block) e.deliveryBlockId = "Please select your delivery block.";
    if (!f.room.trim()) e.room = "Enter your room or unit number.";
  } else {
    if (!f.pickupLocation) e.pickupLocation = "Select a pickup location.";
  }

  return e;
}

const inputCls =
  "h-12 w-full rounded-xl border border-input bg-card px-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30 aria-[invalid=true]:border-destructive";

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-foreground">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-err`} className="mt-1 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function CheckoutForm() {
  const { cart, subtotal, itemCount, clear, getProduct } = useStore();
  const { user, profile } = useCustomerAuth();

  const [deliveryBlocks, setDeliveryBlocks] = useState<DeliveryBlock[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(true);

  useEffect(() => {
    let active = true;
    loadActiveDeliveryBlocks().then((blocks) => {
      if (active) {
        setDeliveryBlocks(blocks);
        setLoadingBlocks(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const [f, setF] = useState<CheckoutFormData>({
    name: "",
    phone: "",
    deliveryMethod: "hostel_delivery",
    deliveryBlockId: "",
    hostel: "",
    block: "",
    room: "",
    pickupLocation: PICKUP_LOCATIONS[0] ?? "",
    instructions: "",
    payment: "upi",
  });

  // Pre-fill fields from customer profile if user is logged in
  useEffect(() => {
    if (profile) {
      setF((prev) => ({
        ...prev,
        name: prev.name || profile.full_name || "",
        phone: prev.phone || profile.phone || "",
        deliveryBlockId: prev.deliveryBlockId || profile.default_block || "",
        hostel: prev.hostel || profile.default_hostel || profile.default_block || "",
        block: prev.block || profile.default_block || "",
        room: prev.room || profile.default_room || "",
      }));
    }
  }, [profile]);

  const [errors, setErrors] = useState<Errors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const SESSION_ORDER_KEY = "shipt_recent_order_confirmation";

  const [done, setDone] = useState<PlacedOrderResult | null>(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_ORDER_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedOrderNo, setCopiedOrderNo] = useState(false);

  const set = <K extends keyof CheckoutFormData>(k: K, v: CheckoutFormData[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const a = (k: keyof CheckoutFormData) => ({
    id: k,
    "aria-invalid": !!errors[k],
    "aria-describedby": errors[k] ? `${k}-err` : undefined,
  });

  const copyToClipboard = (text: string, type: "order" | "token") => {
    navigator.clipboard.writeText(text);
    if (type === "order") {
      setCopiedOrderNo(true);
      setTimeout(() => setCopiedOrderNo(false), 2000);
    } else {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const handleClearOrderSession = () => {
    try {
      sessionStorage.removeItem(SESSION_ORDER_KEY);
    } catch {}
    setDone(null);
  };

  if (done) {
    return (
      <div className="mx-auto mt-8 max-w-xl rounded-3xl border border-border bg-card p-6 text-center shadow-soft sm:p-10">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="size-10" />
        </div>

        <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Order Placed Successfully!
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your order has been recorded and will be prepared shortly for delivery.
        </p>

        {/* Order Details & Secret Token Card */}
        <div className="mt-6 space-y-4 rounded-3xl border border-border/80 bg-secondary/30 p-5 text-left text-sm">
          {/* Order Number */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3 gap-2">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Order Number
              </span>
              <p className="font-mono text-base font-extrabold text-foreground">{done.order_number}</p>
              <p className="text-[11px] text-muted-foreground">Reference identifier for delivery staff.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(done.order_number, "order")}
              className="gap-1.5 text-xs self-start sm:self-center"
            >
              {copiedOrderNo ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
              <span>{copiedOrderNo ? "Copied" : "Copy Order #"}</span>
            </Button>
          </div>

          {/* Guest Tracking Token */}
          {done.guest_tracking_token && (
            <div className="border-b border-border/60 pb-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Guest Tracking Token
                  </span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    Private Secret
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(done.guest_tracking_token || "", "token")}
                  className="gap-1.5 text-xs shrink-0"
                >
                  {copiedToken ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                  <span>{copiedToken ? "Copied" : "Copy Token"}</span>
                </Button>
              </div>

              <div className="rounded-xl border border-border/70 bg-card p-3">
                <p className="break-all font-mono text-xs text-foreground/90 select-all">
                  {done.guest_tracking_token}
                </p>
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Save both your <strong>Order Number</strong> and this <strong>Private Token</strong> to track live delivery progress. Unauthorized users without this token cannot view your order.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1 text-xs sm:text-sm">
            <div>
              <span className="text-muted-foreground">Payment Method:</span>
              <p className="font-semibold uppercase text-foreground">{done.payment_method}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Verified Total:</span>
              <p className="font-bold text-foreground">{formatINR(done.total_amount || subtotal)}</p>
            </div>
          </div>
        </div>

        {/* Phase 3 Guest-to-Account Invitation */}
        {!user && done.guest_tracking_token && (
          <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5 text-left">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                <User className="size-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-foreground">Save your details for future orders</h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Create a free Shipt Mart account to save your delivery address for 1-click checkout, view past orders, and track deliveries.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button asChild variant="default" size="sm" className="gap-1.5 h-9 px-4 text-xs font-semibold">
                    <Link to="/account">Create Free Account</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Authenticated user quick link */}
        {user && (
          <div className="mt-6 rounded-2xl border border-border bg-secondary/30 p-4 text-left flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Saved to your account</p>
              <p className="text-sm font-bold text-foreground">View this order anytime in your account dashboard.</p>
            </div>
            <Button asChild variant="outline" size="sm" className="ml-3 shrink-0 text-xs">
              <Link to="/account">View in My Orders</Link>
            </Button>
          </div>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            type="button"
            variant="hero"
            onClick={handleClearOrderSession}
            className="h-11 px-6 font-bold text-xs"
          >
            Start New Order
          </Button>

          <Button asChild variant="outline" className="h-11 px-6 text-xs">
            <Link to="/">Browse Catalogue</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="mx-auto mt-8 max-w-lg rounded-3xl border border-dashed border-border bg-card p-10 text-center">
        <ShoppingBag className="mx-auto size-12 text-primary" />
        <h2 className="mt-3 font-display text-xl font-bold">Your cart is empty</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a few essentials before proceeding to checkout.
        </p>
        <Button asChild variant="hero" className="mt-5 h-11 px-6">
          <Link to="/">Browse products</Link>
        </Button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const errs = validate(f);
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(Object.keys(errs)[0] ?? "")?.focus();
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await placeOrder(f, cart);
      if (!res.success || !res.data) {
        setSubmitError(res.error || "Failed to place order. Please check stock and try again.");
        setIsSubmitting(false);
        return;
      }

      setDone(res.data);
      try {
        sessionStorage.setItem(SESSION_ORDER_KEY, JSON.stringify(res.data));
      } catch {}
      clear();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setSubmitError(err?.message || "An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        {/* Error notification banner */}
        {submitError && (
          <div className="flex items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="size-5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">Unable to place order</p>
              <p className="text-xs text-destructive/90">{submitError}</p>
            </div>
          </div>
        )}

        {/* Customer Account State Status Banner */}
        {user ? (
          <div className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 p-3.5 text-xs sm:text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <CheckCircle2 className="size-4 text-primary shrink-0" />
              <span>
                Signed in as <strong>{profile?.full_name || user.email}</strong>. Saved delivery details auto-applied.
              </span>
            </div>
            <Link to="/account" className="font-semibold text-primary hover:underline text-xs shrink-0 ml-2">
              Edit in Account
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-2xl border border-border bg-secondary/50 p-3.5 text-xs sm:text-sm">
            <span className="text-muted-foreground">Checking out as Guest. No account required.</span>
            <Link to="/account" className="font-semibold text-primary hover:underline text-xs shrink-0 ml-2">
              Sign In / Register
            </Link>
          </div>
        )}

        {/* Customer Information */}
        <fieldset className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <legend className="px-2 font-display text-lg font-bold">Customer details</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Full name" error={errors.name}>
              <input
                {...a("name")}
                className={inputCls}
                value={f.name}
                onChange={(e) => set("name", e.target.value)}
                autoComplete="name"
                placeholder="e.g. Salman Faris"
              />
            </Field>
            <Field id="phone" label="Mobile number" error={errors.phone}>
              <input
                {...a("phone")}
                className={inputCls}
                inputMode="numeric"
                value={f.phone}
                onChange={(e) => set("phone", e.target.value)}
                autoComplete="tel"
                placeholder="10-digit mobile number"
              />
            </Field>
          </div>
        </fieldset>

        {/* Delivery Method Selection */}
        <fieldset className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <legend className="px-2 font-display text-lg font-bold">Fulfillment method</legend>

          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-4 transition",
                f.deliveryMethod === "hostel_delivery"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              )}
            >
              <input
                type="radio"
                name="deliveryMethod"
                value="hostel_delivery"
                checked={f.deliveryMethod === "hostel_delivery"}
                onChange={() => set("deliveryMethod", "hostel_delivery")}
                className="sr-only"
              />
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Building className="size-5" />
              </span>
              <span>
                <span className="block font-semibold">Doorstep Delivery</span>
                <span className="block text-xs text-muted-foreground">
                  Direct delivery straight to your door
                </span>
              </span>
            </label>

            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-4 transition",
                f.deliveryMethod === "campus_pickup"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              )}
            >
              <input
                type="radio"
                name="deliveryMethod"
                value="campus_pickup"
                checked={f.deliveryMethod === "campus_pickup"}
                onChange={() => set("deliveryMethod", "campus_pickup")}
                className="sr-only"
              />
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <MapPin className="size-5" />
              </span>
              <span>
                <span className="block font-semibold">Store / Counter Pickup</span>
                <span className="block text-xs text-muted-foreground">
                  Pick up at our local central hub or kiosk
                </span>
              </span>
            </label>
          </div>

          {/* Conditional Delivery Inputs */}
          {f.deliveryMethod === "hostel_delivery" ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 border-t border-border/60 pt-4">
              <Field id="deliveryBlockId" label="Delivery Block" error={errors.deliveryBlockId || errors.block}>
                <select
                  {...a("deliveryBlockId")}
                  className={inputCls}
                  value={f.deliveryBlockId || f.block}
                  onChange={(e) => {
                    const val = e.target.value;
                    setF((prev) => ({
                      ...prev,
                      deliveryBlockId: val,
                      block: val,
                      hostel: val,
                    }));
                    setErrors((err) => ({ ...err, deliveryBlockId: undefined, block: undefined }));
                  }}
                  disabled={loadingBlocks}
                >
                  <option value="">
                    {loadingBlocks ? "Loading available delivery blocks..." : "Select your delivery block"}
                  </option>
                  {deliveryBlocks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}{b.description ? ` (${b.description})` : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="room" label="Room / Unit number" error={errors.room}>
                <input
                  {...a("room")}
                  className={inputCls}
                  value={f.room}
                  onChange={(e) => set("room", e.target.value)}
                  placeholder="e.g. 204 or Ground Floor A-1"
                />
              </Field>

              <div className="sm:col-span-2">
                <Field id="instructions" label="Delivery instructions (optional)">
                  <textarea
                    id="instructions"
                    className={cn(inputCls, "h-20 py-2.5")}
                    value={f.instructions}
                    onChange={(e) => set("instructions", e.target.value)}
                    placeholder="e.g. Call upon arrival or leave at front door / reception"
                  />
                </Field>
              </div>
            </div>
          ) : (
            <div className="mt-5 border-t border-border/60 pt-4">
              <Field id="pickupLocation" label="Select pickup hub" error={errors.pickupLocation}>
                <select
                  {...a("pickupLocation")}
                  className={inputCls}
                  value={f.pickupLocation}
                  onChange={(e) => set("pickupLocation", e.target.value)}
                >
                  {PICKUP_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="mt-2 text-xs text-muted-foreground">
                You will receive a notification and order number once your parcel is packed and ready at the counter.
              </p>
            </div>
          )}
        </fieldset>

        {/* Payment Method Selection */}
        <fieldset className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <legend className="px-2 font-display text-lg font-bold">Payment method</legend>

          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-4 transition",
                f.payment === "upi" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              )}
            >
              <input
                type="radio"
                name="payment"
                value="upi"
                checked={f.payment === "upi"}
                onChange={() => set("payment", "upi")}
                className="sr-only"
              />
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Smartphone className="size-5" />
              </span>
              <span>
                <span className="block font-semibold">UPI Payment</span>
                <span className="block text-xs text-muted-foreground">
                  GPay, PhonePe, Paytm QR on arrival
                </span>
              </span>
            </label>

            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-4 transition",
                f.payment === "cod" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              )}
            >
              <input
                type="radio"
                name="payment"
                value="cod"
                checked={f.payment === "cod"}
                onChange={() => set("payment", "cod")}
                className="sr-only"
              />
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Wallet className="size-5" />
              </span>
              <span>
                <span className="block font-semibold">Cash on Delivery</span>
                <span className="block text-xs text-muted-foreground">
                  Pay exact cash upon receipt
                </span>
              </span>
            </label>
          </div>

          {/* Payment Method Transparency Notice */}
          <div className="mt-4 rounded-xl border border-border/80 bg-secondary/30 p-3 text-xs text-muted-foreground">
            <p>
              {f.payment === "upi"
                ? "💡 Payment Collection Note: A QR code will be provided by delivery staff or at the counter upon order arrival."
                : "💡 Cash Notice: Please keep exact change ready for smooth handover at your door."}
            </p>
          </div>
        </fieldset>
      </div>

      {/* Order Summary Column */}
      <aside className="h-fit rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6 lg:sticky lg:top-24">
        <h2 className="font-display text-lg font-bold">Order summary</h2>

        <ul className="mt-4 space-y-3">
          {cart.map((c) => {
            const p = getProduct(c.productId);
            if (!p) return null;
            return (
              <li key={c.productId} className="flex items-center gap-3 text-sm">
                <img src={p.image} alt="" className="size-12 rounded-lg object-cover bg-muted" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium text-foreground">{p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.size} × {c.quantity}
                  </span>
                </span>
                <span className="font-semibold text-foreground">
                  {formatINR(p.price * c.quantity)}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Items ({itemCount})</span>
            <span>{formatINR(subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Delivery fee</span>
            <span className="text-primary font-medium">Free</span>
          </div>
          <div className="flex justify-between border-t border-border/60 pt-2 text-base font-bold text-foreground">
            <span>Total amount</span>
            <span>{formatINR(subtotal)}</span>
          </div>
        </div>

        <Button
          type="submit"
          variant="hero"
          disabled={isSubmitting}
          className="mt-6 h-12 w-full text-base font-bold"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              <span>Verifying & Placing Order...</span>
            </>
          ) : (
            `Place order · ${formatINR(subtotal)}`
          )}
        </Button>

        <p className="mt-2 text-center text-xs text-muted-foreground">
          Stock & totals are securely verified on the database.
        </p>
      </aside>
    </form>
  );
}
