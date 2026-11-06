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
  Clock,
  QrCode,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { useCustomerAuth } from "@/lib/auth";
import { formatINR } from "@/data/products";
import type { CheckoutFormData, PlacedOrderResult, DeliveryBlock, StorePaymentSettings } from "@/lib/types";
import { placeOrder, loadActiveDeliveryBlocks } from "@/lib/catalogApi";
import {
  loadStorePaymentSettings,
  DEFAULT_STORE_PAYMENT_SETTINGS,
  submitOrderPaymentProof,
} from "@/lib/studentPaymentApi";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PICKUP_LOCATIONS = [
  "Shipt Mart Hub — Central Dispatch Point",
  "North Wing Pickup Kiosk",
  "Main Express Counter",
];

type Errors = Partial<Record<keyof CheckoutFormData, string | undefined>>;

function validate(
  f: CheckoutFormData,
  cashAllowed = true,
  onlineAllowed = true,
  settings?: StorePaymentSettings,
  totalAmount?: number
): Errors {
  const e: Errors = {};
  if (f.name.trim().length < 2) e.name = "Please enter your full name (at least 2 characters).";
  if (!/^[6-9]\d{9}$/.test(f.phone.replace(/\s/g, "")))
    e.phone = "Enter a valid 10-digit mobile number.";

  if (f.deliveryMethod === "hostel_delivery") {
    if (!f.deliveryBlockId && !f.block) e.deliveryBlockId = "Please select your delivery block.";
    if (!f.room?.trim()) e.room = "Enter your room or unit number.";
  } else {
    if (!f.pickupLocation) e.pickupLocation = "Select a pickup location.";
  }

  if (f.payment === "cod") {
    if (!cashAllowed) {
      e.payment = "Cash on Delivery is unavailable for your account or disabled by store policy.";
    } else if (settings?.max_cod_order_amount && totalAmount && totalAmount > settings.max_cod_order_amount) {
      e.payment = `Cash on Delivery is limited to orders up to ₹${settings.max_cod_order_amount}. Please select Direct UPI.`;
    }
  }

  if (f.payment === "upi" && !onlineAllowed) {
    e.payment = "Direct UPI payment is unavailable for your account or disabled by store policy.";
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
  const { cart, subtotal, itemCount, clear, getProduct, remove } = useStore();
  const { user, profile } = useCustomerAuth();
  const unavailableItems = cart.filter((c) => !getProduct(c.productId));

  const [deliveryBlocks, setDeliveryBlocks] = useState<DeliveryBlock[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(true);
  const [storePaymentSettings, setStorePaymentSettings] = useState<StorePaymentSettings>(DEFAULT_STORE_PAYMENT_SETTINGS);

  useEffect(() => {
    let active = true;
    loadActiveDeliveryBlocks().then((blocks) => {
      if (active) {
        setDeliveryBlocks(blocks);
        setLoadingBlocks(false);
      }
    });
    loadStorePaymentSettings().then((settings) => {
      if (active) {
        setStorePaymentSettings(settings);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const studentPolicy = profile?.payment_policy || "default";
  const isCashRestricted = !!profile?.cash_restricted;
  const isBlocked = !!profile?.is_blocked;

  const isCashAllowed = !isBlocked && storePaymentSettings.cash_payment_enabled && (
    !user
      ? storePaymentSettings.guest_cash_allowed
      : studentPolicy === "cash_only"
        ? true
        : studentPolicy === "cash_and_online"
          ? true
          : studentPolicy === "online_only"
            ? false
            : !isCashRestricted
  );

  const isOnlineAllowed = !isBlocked && storePaymentSettings.online_payment_enabled && (
    !user || studentPolicy !== "cash_only"
  );

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
      setF((prev) => {
        const nextName = prev.name || profile.full_name || "";
        const nextPhone = prev.phone || profile.phone || "";
        const nextDeliveryBlockId = prev.deliveryBlockId || profile.default_block || "";
        const nextHostel = prev.hostel || profile.default_hostel || profile.default_block || "";
        const nextBlock = prev.block || profile.default_block || "";
        const nextRoom = prev.room || profile.default_room || "";

        if (
          prev.name === nextName &&
          prev.phone === nextPhone &&
          prev.deliveryBlockId === nextDeliveryBlockId &&
          prev.hostel === nextHostel &&
          prev.block === nextBlock &&
          prev.room === nextRoom
        ) {
          return prev;
        }

        return {
          ...prev,
          name: nextName,
          phone: nextPhone,
          deliveryBlockId: nextDeliveryBlockId,
          hostel: nextHostel,
          block: nextBlock,
          room: nextRoom,
        };
      });
    }
  }, [profile]);

  // Enforce payment option selection based on active policy
  useEffect(() => {
    if (!isCashAllowed && f.payment === "cod" && isOnlineAllowed) {
      setF((p) => ({ ...p, payment: "upi" }));
    } else if (!isOnlineAllowed && f.payment === "upi" && isCashAllowed) {
      setF((p) => ({ ...p, payment: "cod" }));
    }
  }, [isCashAllowed, isOnlineAllowed, f.payment]);

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
  const [copiedUpiId, setCopiedUpiId] = useState(false);

  // Direct UPI Interactive State
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [upiReference, setUpiReference] = useState("");
  const [postOrderScreenshotFile, setPostOrderScreenshotFile] = useState<File | null>(null);
  const [postOrderScreenshotPreview, setPostOrderScreenshotPreview] = useState<string | null>(null);
  const [postOrderUpiRef, setPostOrderUpiRef] = useState("");
  const [isSubmittingPostProof, setIsSubmittingPostProof] = useState(false);

  const deliveryFee = f.deliveryMethod === "hostel_delivery" ? (subtotal > 300 ? 0 : 0) : 0;
  const total = subtotal + deliveryFee;

  const upiId = storePaymentSettings.upi_id || "9605174298@upi";
  const payeeName = storePaymentSettings.upi_payee_name || "Shipt Mart";
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Shipt Mart Order")}`;
  const qrCodeUrl = storePaymentSettings.upi_qr_code_url || `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(upiUri)}`;

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

  const copyUpiId = () => {
    navigator.clipboard.writeText(upiId);
    setCopiedUpiId(true);
    toast.success("UPI ID copied to clipboard!");
    setTimeout(() => setCopiedUpiId(false), 2000);
  };

  const handleScreenshotChange = (file: File | null) => {
    if (!file) {
      setScreenshotFile(null);
      if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
      setScreenshotPreview(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Please upload a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Screenshot file size must be less than 5 MB.");
      return;
    }
    setScreenshotFile(file);
    const previewUrl = URL.createObjectURL(file);
    setScreenshotPreview(previewUrl);
  };

  const handlePostOrderScreenshotChange = (file: File | null) => {
    if (!file) {
      setPostOrderScreenshotFile(null);
      if (postOrderScreenshotPreview) URL.revokeObjectURL(postOrderScreenshotPreview);
      setPostOrderScreenshotPreview(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Please upload a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Screenshot file size must be less than 5 MB.");
      return;
    }
    setPostOrderScreenshotFile(file);
    const previewUrl = URL.createObjectURL(file);
    setPostOrderScreenshotPreview(previewUrl);
  };

  const handlePostOrderProofSubmit = async () => {
    if (!done || !postOrderScreenshotFile) return;
    setIsSubmittingPostProof(true);
    try {
      const fileExt = postOrderScreenshotFile.name.split(".").pop()?.toLowerCase() || "jpg";
      const storagePath = `${user?.id || "anonymous"}/${done.order_id}_${Date.now()}.${fileExt}`;

      if (isSupabaseConfigured) {
        const { error: uploadErr } = await supabase.storage
          .from("payment-screenshots")
          .upload(storagePath, postOrderScreenshotFile, { upsert: false });

        if (uploadErr) {
          toast.error("Screenshot upload failed: " + uploadErr.message);
          return;
        }

        const proofRes = await submitOrderPaymentProof(done.order_id, storagePath, postOrderUpiRef);
        if (!proofRes.success) {
          toast.error("Proof submission failed: " + proofRes.error);
          return;
        }
      }

      const updatedDone: PlacedOrderResult = {
        ...done,
        payment_status: "verification_pending",
      };
      setDone(updatedDone);
      try {
        sessionStorage.setItem(SESSION_ORDER_KEY, JSON.stringify(updatedDone));
      } catch { }
      toast.success("Payment proof submitted! Staff will verify your transaction against our bank ledger.");
    } catch (err: any) {
      toast.error(err?.message || "Could not submit payment proof.");
    } finally {
      setIsSubmittingPostProof(false);
    }
  };

  const handleClearOrderSession = () => {
    try {
      sessionStorage.removeItem(SESSION_ORDER_KEY);
    } catch { }
    setDone(null);
  };

  if (done) {
    const isUpiOrder = done.payment_method === "upi" || done.payment_method === "payu";
    const isCodOrder = done.payment_method === "cod";
    const isAwaitingVerification = done.payment_status === "verification_pending";
    const isAwaitingApproval = done.status === "awaiting_approval";

    return (
      <div className="mx-auto mt-8 max-w-xl rounded-3xl border border-border bg-card p-6 text-center shadow-soft sm:p-10">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="size-10" />
        </div>

        <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {isAwaitingApproval
            ? "Order Received — Awaiting Approval"
            : isAwaitingVerification
              ? "Payment Proof Submitted!"
              : "Order Placed Successfully!"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAwaitingApproval
            ? "Your first-time Cash on Delivery order is pending quick review by staff before fulfillment."
            : isAwaitingVerification
              ? "We received your payment receipt. Store staff will verify it against our ledger shortly."
              : "Your order has been recorded and will be prepared shortly for delivery."}
        </p>

        {/* Order Details Card */}
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

          {/* Payment Status Notice */}
          {isUpiOrder && (
            <div className="border-b border-border/60 pb-3">
              {isAwaitingVerification ? (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs space-y-1">
                  <p className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    <Clock className="size-4" /> Verification Pending
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    Your payment screenshot is under manual review. Once confirmed against our bank records, your order status will update to Confirmed.
                  </p>
                </div>
              ) : done.payment_status === "paid" ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs space-y-1">
                  <p className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="size-4" /> Payment Confirmed
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    Your payment has been verified by staff.
                  </p>
                </div>
              ) : (
                /* Customer chose UPI but didn't upload screenshot during checkout */
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-foreground">Upload Payment Proof</span>
                    <span className="text-[11px] font-mono text-primary font-bold">UPI: {upiId}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Pay ₹{formatINR(done.total_amount || total)} via UPI and upload your transaction screenshot below to complete verification:
                  </p>

                  {postOrderScreenshotPreview ? (
                    <div className="flex items-center gap-2 p-2 rounded-xl bg-card border border-border">
                      <img src={postOrderScreenshotPreview} alt="Proof" className="size-12 rounded object-cover" />
                      <span className="text-xs truncate flex-1 font-medium">{postOrderScreenshotFile?.name}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handlePostOrderScreenshotChange(null)}
                        className="text-xs h-7 px-2"
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <label className="block border-2 border-dashed border-border rounded-xl p-3 text-center cursor-pointer hover:border-primary/50 transition">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => handlePostOrderScreenshotChange(e.target.files?.[0] || null)}
                        className="sr-only"
                      />
                      <span className="text-xs text-primary font-semibold">Select Screenshot Image</span>
                    </label>
                  )}

                  <input
                    type="text"
                    placeholder="Optional 12-digit UPI / UTR Reference"
                    value={postOrderUpiRef}
                    onChange={(e) => setPostOrderUpiRef(e.target.value)}
                    className={cn(inputCls, "h-9 text-xs")}
                  />

                  <Button
                    type="button"
                    variant="hero"
                    size="sm"
                    disabled={!postOrderScreenshotFile || isSubmittingPostProof}
                    onClick={handlePostOrderProofSubmit}
                    className="w-full text-xs font-bold h-9"
                  >
                    {isSubmittingPostProof ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin mr-1.5" />
                        Uploading Proof...
                      </>
                    ) : (
                      "Submit Screenshot for Verification"
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {isCodOrder && (
            <div className="border-b border-border/60 pb-3">
              {isAwaitingApproval ? (
                <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-3.5 text-xs space-y-1">
                  <p className="font-bold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                    <Info className="size-4" /> First-Time Customer Review
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    Our staff will review and approve your first COD order shortly. Payment will be collected in cash upon delivery.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-card p-3 text-xs space-y-1">
                  <p className="font-semibold text-foreground">Cash on Delivery</p>
                  <p className="text-muted-foreground text-[11px]">
                    Please keep exact cash ready upon parcel delivery or collection.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1 text-xs sm:text-sm">
            <div>
              <span className="text-muted-foreground">Payment Method:</span>
              <p className="font-semibold uppercase text-foreground">
                {done.payment_method === "upi" ? "Direct UPI" : "Cash on Delivery"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Order Total:</span>
              <p className="font-bold text-foreground">{formatINR(done.total_amount || total)}</p>
            </div>
          </div>
        </div>

        {/* Account Dashboard Quick Link */}
        <div className="mt-6 rounded-2xl border border-border bg-secondary/30 p-4 text-left flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Track Live Status</p>
            <p className="text-sm font-bold text-foreground">View and manage this order in your account.</p>
          </div>
          <Button asChild variant="outline" size="sm" className="ml-3 shrink-0 text-xs">
            <Link to="/account">My Orders</Link>
          </Button>
        </div>

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

    if (!user) {
      setSubmitError("Sign-in required: Guest checkout is disabled. Please log in to your account.");
      return;
    }

    if (unavailableItems.length > 0) {
      setSubmitError("Your cart contains archived or unavailable products. Please return to your cart and remove them before placing an order.");
      return;
    }

    const errs = validate(f, isCashAllowed, isOnlineAllowed, storePaymentSettings, total);
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

      const placedOrder = res.data;

      // If Direct UPI and screenshot is attached, upload to private bucket
      if (f.payment === "upi" && screenshotFile) {
        try {
          const fileExt = screenshotFile.name.split(".").pop()?.toLowerCase() || "jpg";
          const storagePath = `${user.id}/${placedOrder.order_id}_${Date.now()}.${fileExt}`;

          if (isSupabaseConfigured) {
            const { error: uploadErr } = await supabase.storage
              .from("payment-screenshots")
              .upload(storagePath, screenshotFile, { upsert: false });

            if (!uploadErr) {
              await submitOrderPaymentProof(placedOrder.order_id, storagePath, upiReference);
              placedOrder.payment_status = "verification_pending";
            } else {
              console.warn("Screenshot upload warning:", uploadErr);
            }
          } else {
            placedOrder.payment_status = "verification_pending";
          }
        } catch (uploadErr) {
          console.warn("Payment proof submission error", uploadErr);
        }
      }

      setDone(placedOrder);
      try {
        sessionStorage.setItem(SESSION_ORDER_KEY, JSON.stringify(placedOrder));
      } catch { }
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

        {/* Customer Account State Status Banner / Sign-In Guard */}
        {user ? (
          <div className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 p-3.5 text-xs sm:text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <CheckCircle2 className="size-4 text-primary shrink-0" />
              <span>
                Signed in as <strong>{profile?.full_name || user.email}</strong>. Delivery details auto-applied.
              </span>
            </div>
            <Link to="/account" className="font-semibold text-primary hover:underline text-xs shrink-0 ml-2">
              Edit in Account
            </Link>
          </div>
        ) : (
          <div className="rounded-3xl border border-primary/30 bg-primary/5 p-6 text-center space-y-4">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <User className="size-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-lg font-bold text-foreground">
                Student Account Required
              </h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                To prevent uncollected orders and maintain campus delivery reliability, guest checkout is disabled. Please sign in or register to place your order.
              </p>
            </div>
            <div className="max-w-xs mx-auto space-y-2.5 pt-2">
              <GoogleSignInButton returnTo="/checkout" text="Sign in with Google" />
              <Button asChild variant="outline" size="sm" className="w-full text-xs font-semibold h-10">
                <Link to="/account" search={{ returnTo: "/checkout" }}>
                  Sign In or Register with Email
                </Link>
              </Button>
            </div>
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
                disabled={!user}
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
                disabled={!user}
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
                "flex items-center gap-3 rounded-2xl border-2 p-4 cursor-pointer transition",
                f.deliveryMethod === "hostel_delivery" ? "border-primary bg-primary/5" : "border-border"
              )}
            >
              <input
                type="radio"
                name="deliveryMethod"
                value="hostel_delivery"
                checked={f.deliveryMethod === "hostel_delivery"}
                onChange={() => set("deliveryMethod", "hostel_delivery")}
                className="sr-only"
                disabled={!user}
              />
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Building className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block font-semibold">Hostel Delivery</span>
                <span className="block text-xs text-muted-foreground">
                  Delivered directly to your hostel block & room
                </span>
              </div>
            </label>

            <label
              className={cn(
                "flex items-center gap-3 rounded-2xl border-2 p-4 cursor-pointer transition",
                f.deliveryMethod === "campus_pickup" ? "border-primary bg-primary/5" : "border-border"
              )}
            >
              <input
                type="radio"
                name="deliveryMethod"
                value="campus_pickup"
                checked={f.deliveryMethod === "campus_pickup"}
                onChange={() => set("deliveryMethod", "campus_pickup")}
                className="sr-only"
                disabled={!user}
              />
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <MapPin className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block font-semibold">Campus Pickup</span>
                <span className="block text-xs text-muted-foreground">
                  Pick up at central store hub or kiosk
                </span>
              </div>
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
                  disabled={loadingBlocks || !user}
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
                  disabled={!user}
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
                    disabled={!user}
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
                  disabled={!user}
                >
                  {PICKUP_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </fieldset>

        {/* Payment Method Selection */}
        <fieldset className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <legend className="px-2 font-display text-lg font-bold">Payment method</legend>
            {user && profile?.payment_policy && profile.payment_policy !== "default" && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary border border-primary/20">
                Policy: {profile.payment_policy.replace(/_/g, " ").toUpperCase()}
              </span>
            )}
            {user && isCashRestricted && (
              <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-[11px] font-bold text-destructive border border-destructive/20">
                Cash Restricted
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
            {/* Direct UPI Option */}
            <label
              className={cn(
                "flex items-center gap-3 rounded-2xl border-2 p-4 transition",
                isOnlineAllowed && user
                  ? "cursor-pointer hover:border-primary/40"
                  : "cursor-not-allowed opacity-50 bg-muted/40",
                f.payment === "upi" ? "border-primary bg-primary/5" : "border-border"
              )}
            >
              <input
                type="radio"
                name="payment"
                value="upi"
                disabled={!isOnlineAllowed || !user}
                checked={f.payment === "upi"}
                onChange={() => isOnlineAllowed && set("payment", "upi")}
                className="sr-only"
              />
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Smartphone className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block font-semibold">Direct UPI Payment</span>
                <span className="block text-xs text-muted-foreground">
                  GPay, PhonePe, Paytm QR & Screenshot
                </span>
                {!isOnlineAllowed && (
                  <span className="mt-1 block text-[10px] font-bold text-destructive">
                    UPI payment disabled by policy
                  </span>
                )}
              </div>
            </label>

            {/* Cash on Delivery Option */}
            <label
              className={cn(
                "flex items-center gap-3 rounded-2xl border-2 p-4 transition",
                isCashAllowed && user
                  ? "cursor-pointer hover:border-primary/40"
                  : "cursor-not-allowed opacity-50 bg-muted/40",
                f.payment === "cod" ? "border-primary bg-primary/5" : "border-border"
              )}
            >
              <input
                type="radio"
                name="payment"
                value="cod"
                disabled={!isCashAllowed || !user}
                checked={f.payment === "cod"}
                onChange={() => isCashAllowed && set("payment", "cod")}
                className="sr-only"
              />
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Wallet className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block font-semibold">Cash on Delivery</span>
                <span className="block text-xs text-muted-foreground">
                  Pay cash upon receipt (Max ₹{storePaymentSettings.max_cod_order_amount || 500})
                </span>
                {!isCashAllowed && (
                  <span className="mt-1 block text-[10px] font-bold text-destructive">
                    {studentPolicy === "online_only"
                      ? "Online Only policy active"
                      : isCashRestricted
                        ? "Restricted due to uncollected orders"
                        : !storePaymentSettings.cash_payment_enabled
                          ? "Cash orders disabled store-wide"
                          : "Cash unavailable"}
                  </span>
                )}
              </div>
            </label>
          </div>

          {/* Interactive Direct UPI Payment Guide & Screenshot Uploader */}
          {f.payment === "upi" && (
            <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-primary/10 pb-4">
                <div className="space-y-1 text-center sm:text-left">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                    Payable Amount
                  </span>
                  <p className="font-display text-2xl font-black text-foreground">
                    {formatINR(total)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Payee: <strong>{payeeName}</strong>
                  </p>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 rounded-xl bg-card border border-border px-3 py-2 text-xs font-mono">
                    <span>{upiId}</span>
                    <button
                      type="button"
                      onClick={copyUpiId}
                      className="text-primary hover:text-primary/80 transition"
                      title="Copy UPI ID"
                    >
                      {copiedUpiId ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                    </button>
                  </div>
                  <a
                    href={upiUri}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <Smartphone className="size-3.5" />
                    Open in UPI App (Mobile)
                  </a>
                </div>
              </div>

              {/* QR Code and Instructions */}
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="shrink-0 p-2 bg-white rounded-2xl border border-border shadow-xs">
                  <img
                    src={qrCodeUrl}
                    alt="Shipt Mart UPI QR Code"
                    className="size-36 sm:size-40 object-contain rounded-xl"
                  />
                </div>
                <div className="space-y-2 text-xs text-muted-foreground leading-relaxed text-center sm:text-left">
                  <p className="font-semibold text-foreground">How to complete your payment:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Scan the QR code with Google Pay, PhonePe, Paytm, or BHIM.</li>
                    <li>Verify the exact amount (<strong>{formatINR(total)}</strong>).</li>
                    <li>Capture a screenshot of your successful transaction.</li>
                    <li>Attach the screenshot below for admin verification.</li>
                  </ol>
                </div>
              </div>

              {/* Screenshot File Upload */}
              <div className="pt-2 border-t border-primary/10 space-y-3">
                <label className="block text-xs font-bold text-foreground">
                  Upload Payment Screenshot (JPG, PNG, WEBP · Max 5MB)
                </label>

                {screenshotPreview ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
                    <img
                      src={screenshotPreview}
                      alt="Screenshot preview"
                      className="size-16 rounded-lg object-cover border border-border shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {screenshotFile?.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {screenshotFile ? `${(screenshotFile.size / 1024).toFixed(0)} KB` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleScreenshotChange(null)}
                      className="text-xs text-destructive hover:text-destructive h-8 px-2.5"
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="relative border-2 border-dashed border-border/80 hover:border-primary/50 rounded-2xl p-4 text-center cursor-pointer transition bg-card/60">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        handleScreenshotChange(file);
                      }}
                      className="absolute inset-0 size-full opacity-0 cursor-pointer"
                    />
                    <div className="flex flex-col items-center gap-1.5 py-1">
                      <Upload className="size-5 text-primary" />
                      <span className="text-primary font-semibold text-xs">
                        Click or drag & drop payment screenshot here
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Proof will be verified by staff before order confirmation
                      </span>
                    </div>
                  </div>
                )}

                {/* Optional UPI Ref Input */}
                <div>
                  <label htmlFor="upiRef" className="block text-[11px] font-semibold text-foreground mb-1">
                    UPI Transaction ID / UTR Reference (Optional)
                  </label>
                  <input
                    id="upiRef"
                    type="text"
                    className={cn(inputCls, "h-10 text-xs font-mono")}
                    placeholder="e.g. 12-digit UTR: 428172918291"
                    value={upiReference}
                    onChange={(e) => setUpiReference(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* COD Notice */}
          {f.payment === "cod" && (
            <div className="mt-5 rounded-2xl border border-border bg-secondary/30 p-4 text-xs space-y-1.5 text-muted-foreground">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Info className="size-4 text-primary" />
                <span>Cash on Delivery Guidelines</span>
              </div>
              <p>
                Please keep the exact amount (<strong>{formatINR(total)}</strong>) ready in cash upon arrival. Our delivery coordinator will mark your payment verified upon receiving the cash.
              </p>
              {storePaymentSettings.require_first_order_approval && (
                <p className="text-[11px] text-primary font-medium pt-1">
                  Note: If this is your first purchase, your order will undergo quick staff review before dispatch.
                </p>
              )}
            </div>
          )}

          {errors.payment && (
            <p className="mt-2 text-xs font-semibold text-destructive">
              {errors.payment}
            </p>
          )}
        </fieldset>
      </div>

      {/* Order Summary Column */}
      <aside className="h-fit rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6 lg:sticky lg:top-24">
        <h2 className="font-display text-lg font-bold">Order summary</h2>

        <ul className="mt-4 space-y-3">
          {cart.map((c) => {
            const p = getProduct(c.productId);
            if (!p) {
              return (
                <li key={c.productId} className="flex items-center gap-2 text-xs text-destructive bg-destructive/5 rounded-lg p-2.5 border border-destructive/20">
                  <AlertCircle className="size-4 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-semibold">Unavailable product</span>
                    <span className="text-[11px] text-destructive/80">Archived from catalog</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(c.productId)}
                    className="text-xs font-bold hover:underline"
                  >
                    Remove
                  </button>
                </li>
              );
            }
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

        {unavailableItems.length > 0 && (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            Please remove unavailable or archived items from your cart before placing an order.
          </div>
        )}

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
          disabled={isSubmitting || unavailableItems.length > 0 || !user}
          className="mt-6 h-12 w-full text-base font-bold"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              <span>Verifying & Placing Order...</span>
            </>
          ) : unavailableItems.length > 0 ? (
            "Remove Unavailable Items"
          ) : !user ? (
            "Sign In to Place Order"
          ) : (
            `Place order · ${formatINR(subtotal)}`
          )}
        </Button>
      </aside>
    </form>
  );
}
