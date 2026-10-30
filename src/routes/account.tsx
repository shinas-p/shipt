import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  User,
  Package,
  MapPin,
  LogOut,
  Mail,
  Lock,
  Phone,
  Building,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Truck,
  ShoppingBag,
  Eye,
  Copy,
  Check,
  Calendar,
  CreditCard,
  ShieldCheck,
  ChevronRight,
  X,
  FileText,
  Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCustomerAuth, type CustomerOrderSummary } from "@/lib/auth";
import { useCustomerNotifications } from "@/lib/customerNotificationsApi";
import { useBranding } from "@/lib/branding";
import { customerCancelOrder } from "@/lib/studentPaymentApi";
import { formatINR, BRAND_NAME } from "@/data/products";
import { resolveOrderItemImage, BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { isSupabaseConfigured, validateSupabaseConfig } from "@/lib/supabase";
import { GoogleSignInButton, AuthDivider } from "@/components/auth/GoogleSignInButton";
import { getSafeRedirectUrl } from "@/lib/auth-helpers";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: `My Account — ${BRAND_NAME}` },
      {
        name: "description",
        content: `Manage your ${BRAND_NAME} profile, saved delivery address, and track order history.`,
      },
      { property: "og:title", content: `My Account — ${BRAND_NAME}` },
      {
        property: "og:description",
        content: `Manage your ${BRAND_NAME} profile, saved delivery address, and track order history.`,
      },
    ],
  }),
  component: AccountPage,
});

const HOSTELS = [
  "Ganga Hostel",
  "Yamuna Hostel",
  "Kaveri Hostel",
  "Narmada Hostel",
  "International House",
];

function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case "completed":
    case "delivered":
      return <Badge className="bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/25 border-emerald-600/20">Delivered</Badge>;
    case "out_for_delivery":
      return <Badge className="bg-indigo-600/15 text-indigo-700 hover:bg-indigo-600/25 border-indigo-600/20">Out for Delivery</Badge>;
    case "ready_for_pickup":
      return <Badge className="bg-cyan-600/15 text-cyan-700 hover:bg-cyan-600/25 border-cyan-600/20">Ready for Pickup</Badge>;
    case "preparing":
      return <Badge className="bg-purple-600/15 text-purple-700 hover:bg-purple-600/25 border-purple-600/20">Preparing</Badge>;
    case "confirmed":
      return <Badge className="bg-blue-600/15 text-blue-700 hover:bg-blue-600/25 border-blue-600/20">Confirmed</Badge>;
    case "pending_payment":
      return <Badge variant="outline" className="text-amber-700 border-amber-600/40 bg-amber-500/10">Pending Payment</Badge>;
    case "cancelled":
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="outline" className="text-amber-700 border-amber-600/30 bg-amber-500/10">Order Placed</Badge>;
  }
}

function getPaymentStatusBadge(paymentStatus?: string, paymentMethod?: string) {
  const ps = (paymentStatus || "pending").toLowerCase();
  switch (ps) {
    case "paid":
    case "completed":
      return (
        <Badge className="bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/25 border-emerald-600/20 text-[10px]">
          Paid
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive" className="text-[10px]">Payment Failed</Badge>;
    case "expired":
      return <Badge variant="outline" className="border-amber-500/40 text-amber-700 bg-amber-500/10 text-[10px]">Expired</Badge>;
    case "refund_pending":
      return <Badge className="bg-orange-500/15 text-orange-700 border-orange-500/30 text-[10px]">Refund Pending</Badge>;
    case "refunded":
      return <Badge className="bg-purple-500/15 text-purple-700 border-purple-500/30 text-[10px]">Refunded</Badge>;
    case "processing":
      return <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 text-[10px]">Processing</Badge>;
    case "pending":
    default:
      return (
        <Badge variant="outline" className="text-amber-700 border-amber-600/30 bg-amber-500/10 text-[10px]">
          {paymentMethod === "cash" ? "Cash on Delivery" : "Payment Pending"}
        </Badge>
      );
  }
}

function isOrderEligibleForCustomerCancellation(status: string): boolean {
  const s = status.toLowerCase();
  return s === "placed" || s === "confirmed" || s === "preparing";
}

function AccountPage() {
  const { branding } = useBranding();
  const { user, profile, isLoading, signIn, signUp, signOut, resetPassword, updatePassword, updateProfile, fetchCustomerOrders } =
    useCustomerAuth();

  const location = useLocation();
  const navigate = useNavigate();

  // Search parameters for returnTo and OAuth errors
  const searchParams = new URLSearchParams(location.search);
  const rawReturnTo = searchParams.get("returnTo");
  const returnTo = rawReturnTo ? getSafeRedirectUrl(rawReturnTo, "/account") : undefined;
  const oauthError = searchParams.get("error");

  // Auth tab: "signin" | "signup" | "forgot"
  const [authTab, setAuthTab] = useState<"signin" | "signup" | "forgot">("signin");
  // Customer dashboard active tab: "orders" | "notifications" | "profile"
  const [activeTab, setActiveTab] = useState<string>("orders");
  const [signUpConfirmationEmail, setSignUpConfirmationEmail] = useState<string | null>(null);
  const [isStaffInviteWelcome, setIsStaffInviteWelcome] = useState(false);

  // Customer In-App Notification Center
  const {
    notifications: customerNotifications,
    unreadCount: customerUnreadCount,
    markRead: markCustomerNotifRead,
    markAllRead: markAllCustomerNotifsRead,
  } = useCustomerNotifications(user?.id);

  // Sync active tab with URL search parameter reactively and detect staff invitation / recovery links
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      const hash = window.location.hash || "";
      const search = window.location.search || "";

      const isInviteOrRecovery =
        hash.includes("type=invite") ||
        hash.includes("type=recovery") ||
        search.includes("type=invite") ||
        search.includes("type=recovery") ||
        search.includes("setup_password=true");

      if (isInviteOrRecovery) {
        setActiveTab("profile");
        setIsStaffInviteWelcome(true);
        setTimeout(() => {
          const el = document.getElementById("password-security-section");
          if (el) {
            el.scrollIntoView({ behavior: "smooth" });
          }
        }, 500);
      } else if (tabParam === "orders" || tabParam === "profile" || tabParam === "notifications") {
        setActiveTab(tabParam);
      }
    }
  }, [location.search]);

  // If user is already authenticated and a validated returnTo target exists, navigate there
  useEffect(() => {
    if (user && returnTo && returnTo !== "/account") {
      navigate({ to: returnTo as any, replace: true });
    }
  }, [user, returnTo, navigate]);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", val);
      window.history.replaceState({}, "", url.toString());
    }
  };

  // Sign In state
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInLoading, setSignInLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  // Sign Up state
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpPhone, setSignUpPhone] = useState("");
  const [signUpHostel, setSignUpHostel] = useState(HOSTELS[0]);
  const [signUpBlock, setSignUpBlock] = useState("");
  const [signUpRoom, setSignUpRoom] = useState("");
  const [signUpLoading, setSignUpLoading] = useState(false);
  const [signUpError, setSignUpError] = useState<string | null>(null);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  // Profile Edit state
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editHostel, setEditHostel] = useState("");
  const [editBlock, setEditBlock] = useState("");
  const [editRoom, setEditRoom] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Change password state
  const [changePasswordVal, setChangePasswordVal] = useState("");
  const [changeConfirmPasswordVal, setChangeConfirmPasswordVal] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [passwordChangeMsg, setPasswordChangeMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Orders state
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrderSummary | null>(null);
  const [trackOrderModal, setTrackOrderModal] = useState<CustomerOrderSummary | null>(null);
  const [copiedOrderNumber, setCopiedOrderNumber] = useState<string | null>(null);

  // Customer Order Cancellation state
  const [orderToCancel, setOrderToCancel] = useState<CustomerOrderSummary | null>(null);
  const [cancelReason, setCancelReason] = useState("Ordered by mistake");
  const [cancelCustomReason, setCancelCustomReason] = useState("");
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);

  const handleConfirmCancelOrder = async () => {
    if (!orderToCancel) return;
    setIsCancellingOrder(true);
    const finalReason = cancelReason === "Other" && cancelCustomReason.trim()
      ? cancelCustomReason.trim()
      : cancelReason;

    try {
      const res = await customerCancelOrder(orderToCancel.id, { reason: finalReason });
      if (!res.success) {
        toast.error(res.error || "Failed to cancel order.");
        setIsCancellingOrder(false);
        return;
      }

      toast.success(`Order #${orderToCancel.order_number} has been cancelled successfully.`);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderToCancel.id ? { ...o, status: "cancelled" } : o))
      );
      if (selectedOrder?.id === orderToCancel.id) {
        setSelectedOrder((prev) => (prev ? { ...prev, status: "cancelled" } : null));
      }
      setOrderToCancel(null);
      setCancelCustomReason("");
      fetchCustomerOrders().then((updated) => setOrders(updated));
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel order.");
    } finally {
      setIsCancellingOrder(false);
    }
  };

  const handleCopyOrderNumber = (num: string) => {
    navigator.clipboard.writeText(num);
    setCopiedOrderNumber(num);
    toast.success("Order number copied to clipboard");
    setTimeout(() => setCopiedOrderNumber(null), 2000);
  };

  const handleOpenOrderDetails = (ord: CustomerOrderSummary) => {
    setSelectedOrder(ord);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("orderId", ord.order_number);
      url.searchParams.delete("trackId");
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handleCloseOrderDetails = () => {
    setSelectedOrder(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("orderId");
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handleOpenTrackModal = (ord: CustomerOrderSummary) => {
    setTrackOrderModal(ord);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("trackId", ord.order_number);
      url.searchParams.delete("orderId");
      window.history.replaceState({}, "", url.toString());
    }
  };

  const handleCloseTrackModal = () => {
    setTrackOrderModal(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("trackId");
      window.history.replaceState({}, "", url.toString());
    }
  };

  // Sync profile data to edit inputs
  useEffect(() => {
    if (profile) {
      setEditName(profile.full_name || "");
      setEditPhone(profile.phone || "");
      setEditHostel(profile.default_hostel || HOSTELS[0] || "");
      setEditBlock(profile.default_block || "");
      setEditRoom(profile.default_room || "");
    }
  }, [profile]);

  // Load customer orders when user is present
  useEffect(() => {
    if (user) {
      setOrdersLoading(true);
      fetchCustomerOrders()
        .then((res) => setOrders(res))
        .finally(() => setOrdersLoading(false));
    }
  }, [user]);

  // Deep-linking: auto-open order details or tracking if present in URL
  useEffect(() => {
    if (orders.length > 0 && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const targetOrderId = params.get("orderId");
      const targetTrackId = params.get("trackId");

      if (targetOrderId) {
        const match = orders.find(
          (o) => o.id === targetOrderId || o.order_number.toLowerCase() === targetOrderId.toLowerCase()
        );
        if (match) {
          setSelectedOrder(match);
        }
      } else if (targetTrackId) {
        const match = orders.find(
          (o) => o.id === targetTrackId || o.order_number.toLowerCase() === targetTrackId.toLowerCase()
        );
        if (match) {
          setTrackOrderModal(match);
        }
      }
    }
  }, [orders]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignInError(null);
    if (!signInEmail.trim() || !signInPassword) {
      setSignInError("Please provide both email and password.");
      return;
    }
    setSignInLoading(true);
    const res = await signIn(signInEmail, signInPassword);
    setSignInLoading(false);
    if (!res.success) {
      setSignInError(res.error || "Unable to sign in.");
    } else {
      setSignUpConfirmationEmail(null);
      if (returnTo && returnTo !== "/account") {
        navigate({ to: returnTo as any, replace: true });
      }
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignUpError(null);
    if (signUpName.trim().length < 2) {
      setSignUpError("Please enter your full name.");
      return;
    }
    if (!signUpEmail.trim() || !signUpEmail.includes("@")) {
      setSignUpError("Please enter a valid email address.");
      return;
    }
    if (signUpPassword.length < 6) {
      setSignUpError("Password must be at least 6 characters long.");
      return;
    }
    if (signUpPhone.trim() && !/^[6-9]\d{9}$/.test(signUpPhone.replace(/\s/g, ""))) {
      setSignUpError("Please enter a valid 10-digit mobile number.");
      return;
    }

    setSignUpLoading(true);
    const profilePayload: {
      full_name?: string;
      phone?: string;
      default_hostel?: string;
      default_block?: string;
      default_room?: string;
    } = {
      full_name: signUpName.trim(),
    };
    if (signUpPhone.trim()) profilePayload.phone = signUpPhone.trim();
    if (signUpHostel) profilePayload.default_hostel = signUpHostel;
    if (signUpBlock.trim()) profilePayload.default_block = signUpBlock.trim();
    if (signUpRoom.trim()) profilePayload.default_room = signUpRoom.trim();

    const res = await signUp(signUpEmail, signUpPassword, profilePayload);
    setSignUpLoading(false);
    if (!res.success) {
      setSignUpError(res.error || "Unable to create account.");
    } else if (res.requiresEmailConfirmation) {
      setSignUpConfirmationEmail(signUpEmail);
      setSignInEmail(signUpEmail);
      setAuthTab("signin");
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    if (!forgotEmail.trim() || !forgotEmail.includes("@")) {
      setForgotError("Please enter a valid email address.");
      return;
    }
    setForgotLoading(true);
    const res = await resetPassword(forgotEmail);
    setForgotLoading(false);
    if (!res.success) {
      setForgotError(res.error || "Failed to send reset link.");
    } else {
      setForgotSuccess(true);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    const res = await updateProfile({
      full_name: editName.trim(),
      phone: editPhone.trim(),
      default_hostel: editHostel,
      default_block: editBlock.trim(),
      default_room: editRoom.trim(),
    });
    setSavingProfile(false);
    if (!res.success) {
      toast.error(res.error || "Could not save details.");
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordChangeMsg(null);
    if (!changePasswordVal || changePasswordVal.length < 6) {
      setPasswordChangeMsg({ type: "error", text: "New password must be at least 6 characters." });
      return;
    }
    if (changePasswordVal !== changeConfirmPasswordVal) {
      setPasswordChangeMsg({ type: "error", text: "Passwords do not match." });
      return;
    }

    setUpdatingPassword(true);
    const res = await updatePassword(changePasswordVal);
    setUpdatingPassword(false);
    if (res.success) {
      setPasswordChangeMsg({ type: "success", text: "Your password has been securely updated." });
      setChangePasswordVal("");
      setChangeConfirmPasswordVal("");
    } else {
      setPasswordChangeMsg({ type: "error", text: res.error || "Failed to update password." });
    }
  };

  if (isLoading) {
    return (
      <div className="container-page flex min-h-[50vh] flex-col items-center justify-center py-20 text-center">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">Loading account...</p>
      </div>
    );
  }

  // ==========================================
  // UNREGISTERED / SIGN IN / SIGN UP VIEW
  // ==========================================
  if (!user) {
    return (
      <div className="container-page py-8 md:py-12">
        <Link to="/" className="text-sm font-semibold text-primary hover:underline">
          ← Back to store
        </Link>

        <div className="mx-auto mt-6 max-w-md">
          <div className="text-center">
            <span className="inline-grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <User className="size-6" />
            </span>
            <h1 className="mt-3 font-display text-2xl font-extrabold sm:text-3xl text-foreground">
              {branding.store_name} Account
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in or create an account for fast 1-click checkout and complete order history.
            </p>
          </div>

          <div className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
            {!isSupabaseConfigured && (
              <div className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>Database Authentication Not Configured</span>
                </div>
                <p>
                  Missing environment variable(s):{" "}
                  <strong>{validateSupabaseConfig().missing.join(", ")}</strong>. Please configure them in your Vercel Project Settings.
                </p>
              </div>
            )}

            {authTab === "forgot" ? (
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">Reset Password</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Enter your registered email address and we'll send you recovery instructions.
                </p>

                {forgotSuccess ? (
                  <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-center">
                    <CheckCircle2 className="mx-auto size-8 text-primary" />
                    <p className="mt-2 text-sm font-bold text-foreground">Email Sent</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      If an account exists for {forgotEmail}, check your inbox for password reset instructions.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setForgotSuccess(false);
                        setAuthTab("signin");
                      }}
                      className="mt-4"
                    >
                      Return to Sign In
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="mt-5 space-y-4">
                    {forgotError && (
                      <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                        <AlertCircle className="size-4 shrink-0" />
                        <span>{forgotError}</span>
                      </div>
                    )}
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">Email Address</label>
                      <input
                        type="email"
                        required
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                      />
                    </div>
                    <Button type="submit" variant="hero" className="w-full h-11" disabled={forgotLoading}>
                      {forgotLoading ? <Loader2 className="size-4 animate-spin" /> : "Send Password Reset Link"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setAuthTab("signin")}
                      className="block w-full text-center text-xs font-semibold text-muted-foreground hover:text-foreground pt-1"
                    >
                      Cancel and back to sign in
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <Tabs value={authTab} onValueChange={(v) => setAuthTab(v as any)} className="w-full">
                <TabsList className="grid w-full grid-cols-2 rounded-2xl">
                  <TabsTrigger value="signin" className="rounded-xl font-semibold">
                    Sign In
                  </TabsTrigger>
                  <TabsTrigger value="signup" className="rounded-xl font-semibold">
                    Register
                  </TabsTrigger>
                </TabsList>

                {/* SIGN IN TAB */}
                <TabsContent value="signin" className="mt-5 space-y-4">
                  {oauthError && (
                    <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                      <AlertCircle className="size-4 shrink-0" />
                      <span>{oauthError}</span>
                    </div>
                  )}

                  {signUpConfirmationEmail && (
                    <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-600/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-800 dark:text-emerald-200">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-600 mt-0.5" />
                      <div>
                        <p className="font-bold">Account created! Check your email</p>
                        <p className="mt-0.5">
                          A confirmation link was sent to <strong>{signUpConfirmationEmail}</strong>. Please verify your email before signing in.
                        </p>
                      </div>
                    </div>
                  )}

                  {signInError && (
                    <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                      <AlertCircle className="size-4 shrink-0" />
                      <span>{signInError}</span>
                    </div>
                  )}

                  {/* Google OAuth Sign-In Option */}
                  <GoogleSignInButton returnTo={returnTo} />

                  <AuthDivider text="or continue with email" />

                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">Email Address</label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="email"
                          required
                          value={signInEmail}
                          onChange={(e) => setSignInEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-foreground">Password</label>
                        <button
                          type="button"
                          onClick={() => setAuthTab("forgot")}
                          className="text-xs text-primary hover:underline font-medium"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="password"
                          required
                          value={signInPassword}
                          onChange={(e) => setSignInPassword(e.target.value)}
                          placeholder="••••••••"
                          className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                        />
                      </div>
                    </div>

                    <Button type="submit" variant="hero" className="w-full h-11" disabled={signInLoading}>
                      {signInLoading ? <Loader2 className="size-4 animate-spin" /> : "Sign In"}
                    </Button>
                  </form>
                </TabsContent>

                {/* SIGN UP TAB */}
                <TabsContent value="signup" className="mt-5 space-y-4">
                  {oauthError && (
                    <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                      <AlertCircle className="size-4 shrink-0" />
                      <span>{oauthError}</span>
                    </div>
                  )}

                  {signUpError && (
                    <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                      <AlertCircle className="size-4 shrink-0" />
                      <span>{signUpError}</span>
                    </div>
                  )}

                  {/* Google OAuth Registration Option */}
                  <GoogleSignInButton returnTo={returnTo} text="Sign up with Google" />

                  <AuthDivider text="or register with email" />

                  <form onSubmit={handleSignUp} className="space-y-4">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">Full Name *</label>
                      <input
                        type="text"
                        required
                        value={signUpName}
                        onChange={(e) => setSignUpName(e.target.value)}
                        placeholder="e.g. Salman Faris"
                        className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">Email Address *</label>
                      <input
                        type="email"
                        required
                        value={signUpEmail}
                        onChange={(e) => setSignUpEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">Password (min 6 characters) *</label>
                      <input
                        type="password"
                        required
                        value={signUpPassword}
                        onChange={(e) => setSignUpPassword(e.target.value)}
                        placeholder="••••••••"
                        className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">Mobile Number (Optional)</label>
                      <input
                        type="tel"
                        value={signUpPhone}
                        onChange={(e) => setSignUpPhone(e.target.value)}
                        placeholder="10-digit phone for delivery calls"
                        className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                      />
                    </div>

                    <div className="rounded-2xl border border-border/80 bg-secondary/30 p-3.5 space-y-3">
                      <p className="text-xs font-bold text-foreground">Delivery Address Details (Optional)</p>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Hostel / Area</label>
                        <select
                          value={signUpHostel}
                          onChange={(e) => setSignUpHostel(e.target.value)}
                          className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none"
                        >
                          {HOSTELS.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Block/Wing</label>
                          <input
                            type="text"
                            value={signUpBlock}
                            onChange={(e) => setSignUpBlock(e.target.value)}
                            placeholder="Block B"
                            className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Room No</label>
                          <input
                            type="text"
                            value={signUpRoom}
                            onChange={(e) => setSignUpRoom(e.target.value)}
                            placeholder="Room 204"
                            className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <Button type="submit" variant="hero" className="w-full h-11" disabled={signUpLoading}>
                      {signUpLoading ? <Loader2 className="size-4 animate-spin" /> : "Create Account"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // AUTHENTICATED CUSTOMER DASHBOARD
  // ==========================================
  const userInitial = (profile?.full_name?.[0] || user.email?.[0] || "U").toUpperCase();

  return (
    <div className="container-page py-6 md:py-10">
      <Link to="/" className="text-sm font-semibold text-primary hover:underline">
        ← Back to store
      </Link>

      {/* Account Profile Header Card */}
      <div className="mt-4 flex flex-col gap-4 rounded-3xl border border-border bg-card p-6 shadow-soft sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile?.full_name || "Account avatar"}
              className="size-14 rounded-2xl object-cover ring-2 ring-primary/20 shadow-xs"
            />
          ) : (
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary font-display text-xl font-black">
              {userInitial}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-bold text-foreground sm:text-2xl">
                {profile?.full_name || "Customer"}
              </h1>
              <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 text-xs">
                Customer
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{user.email}</p>
            {profile?.default_hostel && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-foreground/80 font-medium">
                <MapPin className="size-3.5 text-primary" />
                {profile.default_hostel}
                {profile.default_block ? `, ${profile.default_block}` : ""}
                {profile.default_room ? ` (${profile.default_room})` : ""}
              </p>
            )}
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => signOut()}
          className="gap-2 self-start sm:self-center border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
        >
          <LogOut className="size-4" />
          <span>Sign Out</span>
        </Button>
      </div>

      {/* Account Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="mt-8">
        <TabsList className="grid w-full max-w-lg grid-cols-3 rounded-2xl">
          <TabsTrigger value="orders" className="rounded-xl font-semibold gap-1.5 text-xs sm:text-sm">
            <Package className="size-4" />
            <span>Orders ({orders.length})</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="rounded-xl font-semibold gap-1.5 text-xs sm:text-sm relative">
            <Bell className="size-4" />
            <span>Alerts</span>
            {customerUnreadCount > 0 && (
              <span
                id="customer-tab-unread-badge"
                className="ml-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow-xs"
              >
                {customerUnreadCount > 99 ? "99+" : customerUnreadCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="profile" className="rounded-xl font-semibold gap-1.5 text-xs sm:text-sm">
            <MapPin className="size-4" />
            <span>Delivery</span>
          </TabsTrigger>
        </TabsList>

        {/* ORDER HISTORY TAB */}
        <TabsContent value="orders" className="mt-6">
          {ordersLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
              <ShoppingBag className="mx-auto size-12 text-primary/40" />
              <h3 className="mt-3 font-display text-lg font-bold">No orders placed yet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Browse our snacks, stationery, and everyday essentials to place your first delivery!
              </p>
              <Button asChild variant="hero" className="mt-5 h-10 px-6 text-xs">
                <Link to="/">Browse Catalogue</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              {orders.map((order) => {
                const itemCount = order.order_items?.reduce((sum, i) => sum + i.quantity, 0) || 0;

                return (
                  <div
                    key={order.id}
                    className="group rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs transition hover:border-primary/40 hover:shadow-soft"
                  >
                    {/* Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3.5">
                      <div className="flex items-center gap-2">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Order Reference
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-base font-extrabold text-foreground">{order.order_number}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyOrderNumber(order.order_number);
                              }}
                              className="text-muted-foreground hover:text-foreground p-1 transition"
                              title="Copy order number"
                              aria-label="Copy order number"
                            >
                              {copiedOrderNumber === order.order_number ? (
                                <Check className="size-3.5 text-primary" />
                              ) : (
                                <Copy className="size-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {new Date(order.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {getStatusBadge(order.status)}
                      </div>
                    </div>

                    {/* Order Items with real product thumbnails */}
                    <div className="mt-4 space-y-3">
                      {order.order_items?.map((item) => {
                        const imgSrc = resolveOrderItemImage(item);
                        return (
                          <div
                            key={item.id}
                            className="flex items-center gap-3.5 rounded-2xl bg-secondary/25 p-2.5 sm:p-3 border border-border/40"
                          >
                            <img
                              src={imgSrc}
                              alt={item.product_name}
                              className="size-14 rounded-xl object-cover bg-muted border border-border/60 shrink-0"
                              onError={(e) => {
                                e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                              }}
                            />

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <h4 className="font-semibold text-sm text-foreground truncate">{item.product_name}</h4>
                                  {item.product_size && (
                                    <span className="inline-block rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground mt-0.5">
                                      {item.product_size}
                                    </span>
                                  )}
                                </div>
                                <span className="font-mono text-sm font-bold text-foreground shrink-0">
                                  {formatINR(item.total_price)}
                                </span>
                              </div>

                              <p className="mt-1 text-xs text-muted-foreground">
                                Qty: <strong className="text-foreground">{item.quantity}</strong> × {formatINR(item.unit_price)} each
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Order Details Summary Footer */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-3.5">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="size-3.5 text-primary shrink-0" />
                          <span>
                            {order.delivery_method === "hostel_delivery"
                              ? `Delivery: ${order.hostel || "Doorstep"}${order.block ? ` - ${order.block}` : ""}${order.room ? `, ${order.room}` : ""}`
                              : `Pickup: ${order.pickup_location || "Central Hub"}`}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <CreditCard className="size-3.5 text-primary shrink-0" />
                          <span className="font-semibold uppercase text-foreground">{order.payment_method}</span>
                          {getPaymentStatusBadge(order.payment_status, order.payment_method)}
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-[11px] text-muted-foreground">Total ({itemCount} {itemCount === 1 ? "item" : "items"}):</span>
                          <p className="font-display text-base font-extrabold text-foreground">{formatINR(order.total_amount)}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          {isOrderEligibleForCustomerCancellation(order.status) && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setOrderToCancel(order);
                                setCancelReason("Ordered by mistake");
                                setCancelCustomReason("");
                              }}
                              className="h-9 gap-1 text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                            >
                              <X className="size-3.5" />
                              <span>Cancel Order</span>
                            </Button>
                          )}

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setTrackOrderModal(order)}
                            className="h-9 gap-1.5 text-xs font-semibold hover:border-primary hover:text-primary"
                          >
                            <Truck className="size-3.5 text-primary" />
                            <span>Track Order</span>
                          </Button>

                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() => setSelectedOrder(order)}
                            className="h-9 gap-1.5 text-xs font-semibold shadow-xs"
                          >
                            <Eye className="size-3.5" />
                            <span>View Details</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* DEDICATED CUSTOMER ORDER DETAILS DIALOG */}
          <Dialog open={selectedOrder !== null} onOpenChange={(open) => !open && setSelectedOrder(null)}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl p-6 sm:p-8">
              {selectedOrder && (
                <div>
                  <DialogHeader className="border-b border-border/60 pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <DialogTitle className="font-display text-xl font-bold sm:text-2xl">
                          Order Details
                        </DialogTitle>
                        {getStatusBadge(selectedOrder.status)}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const ord = selectedOrder;
                          setSelectedOrder(null);
                          setTrackOrderModal(ord);
                        }}
                        className="gap-1.5 text-xs font-semibold text-primary border-primary/30 hover:bg-primary/5"
                      >
                        <Truck className="size-3.5" />
                        <span>Track Live Progress</span>
                      </Button>
                    </div>

                    <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Order Reference: <strong className="font-mono text-foreground">{selectedOrder.order_number}</strong></span>
                      <span>Placed: {new Date(selectedOrder.created_at).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}</span>
                    </DialogDescription>
                  </DialogHeader>

                  <div className="mt-5 space-y-6">
                    {/* Status Audit Timeline */}
                    <div className="rounded-2xl border border-border bg-secondary/20 p-4 sm:p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <Clock className="size-4 text-primary" />
                        <h4 className="font-display text-sm font-bold text-foreground">Status History & Audit Trail</h4>
                      </div>

                      <div className="relative pl-6 space-y-4 before:absolute before:bottom-2 before:top-2 before:left-2 before:w-0.5 before:bg-border">
                        {/* Event 1: Initial creation */}
                        <div className="relative">
                          <span className="absolute -left-6 top-1 grid size-3.5 place-items-center rounded-full bg-primary ring-4 ring-background" />
                          <div>
                            <p className="text-xs font-bold text-foreground">Order Placed</p>
                            <span className="text-[11px] text-muted-foreground">
                              {new Date(selectedOrder.created_at).toLocaleString("en-IN", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Order submitted and inventory reserved.
                            </p>
                          </div>
                        </div>

                        {/* Subsequent status history events */}
                        {selectedOrder.order_status_history &&
                          selectedOrder.order_status_history.length > 0 &&
                          [...selectedOrder.order_status_history]
                            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                            .filter((h) => h.new_status !== "placed")
                            .map((h) => {
                              const isCurrent = h.new_status === selectedOrder.status;
                              return (
                                <div key={h.id} className="relative">
                                  <span
                                    className={cn(
                                      "absolute -left-6 top-1 size-3.5 rounded-full ring-4 ring-background",
                                      isCurrent ? "bg-primary animate-pulse" : "bg-muted-foreground/60"
                                    )}
                                  />
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className="text-xs font-bold text-foreground capitalize">
                                        {h.new_status.replace(/_/g, " ")}
                                      </p>
                                      {isCurrent && (
                                        <Badge className="h-4 text-[9px] px-1.5 bg-primary/10 text-primary border-primary/30">
                                          Current
                                        </Badge>
                                      )}
                                    </div>
                                    <span className="text-[11px] text-muted-foreground">
                                      {new Date(h.created_at).toLocaleString("en-IN", {
                                        day: "numeric",
                                        month: "short",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                    {h.notes && (
                                      <p className="mt-0.5 text-[11px] text-foreground/80 bg-background/60 rounded-md p-1.5 border border-border/50">
                                        {h.notes}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                      </div>
                    </div>

                    {/* Order Items List */}
                    <div>
                      <h4 className="font-display text-sm font-bold text-foreground mb-3">
                        Ordered Items ({selectedOrder.order_items?.length || 0})
                      </h4>
                      <div className="rounded-2xl border border-border divide-y divide-border/60 overflow-hidden bg-card">
                        {selectedOrder.order_items?.map((item) => {
                          const imgSrc = resolveOrderItemImage(item);
                          return (
                            <div key={item.id} className="flex items-center gap-3.5 p-3 sm:p-4">
                              <img
                                src={imgSrc}
                                alt={item.product_name}
                                className="size-16 rounded-xl object-cover bg-muted border border-border shrink-0"
                                onError={(e) => {
                                  e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                                }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <h5 className="font-semibold text-sm text-foreground">{item.product_name}</h5>
                                    {item.product_size && (
                                      <span className="text-xs text-muted-foreground">{item.product_size}</span>
                                    )}
                                  </div>
                                  <span className="font-mono text-sm font-bold text-foreground">
                                    {formatINR(item.total_price)}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                  <span>{formatINR(item.unit_price)} × {item.quantity}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Delivery & Payment Grid */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-2xl border border-border bg-card p-4">
                        <div className="flex items-center gap-2 mb-2 text-foreground font-semibold text-xs">
                          <MapPin className="size-4 text-primary" />
                          <span>Delivery Destination</span>
                        </div>
                        <p className="text-sm font-bold text-foreground">
                          {selectedOrder.delivery_method === "hostel_delivery"
                            ? "Doorstep Delivery"
                            : "Store Pickup"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selectedOrder.delivery_method === "hostel_delivery" ? (
                            <>
                              {selectedOrder.hostel || "Delivery Address"}
                              {selectedOrder.block ? `, ${selectedOrder.block}` : ""}
                              {selectedOrder.room ? ` (${selectedOrder.room})` : ""}
                            </>
                          ) : (
                            selectedOrder.pickup_location || "Central Dispatch Point"
                          )}
                        </p>
                        {selectedOrder.delivery_instructions && (
                          <div className="mt-2.5 rounded-lg bg-secondary/50 p-2 text-[11px] text-muted-foreground">
                            <strong>Note:</strong> {selectedOrder.delivery_instructions}
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-border bg-card p-4">
                        <div className="flex items-center gap-2 mb-2 text-foreground font-semibold text-xs">
                          <CreditCard className="size-4 text-primary" />
                          <span>Payment & Verification</span>
                        </div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Method:</span>
                            <span className="font-bold uppercase text-foreground">{selectedOrder.payment_method}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Payment Status:</span>
                            <div>{getPaymentStatusBadge(selectedOrder.payment_status, selectedOrder.payment_method)}</div>
                          </div>
                          <div className="flex justify-between pt-2 border-t border-border/60">
                            <span className="text-muted-foreground">Subtotal:</span>
                            <span className="font-mono text-foreground">{formatINR(selectedOrder.subtotal)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Delivery:</span>
                            <span className="font-semibold text-primary">Free</span>
                          </div>
                          <div className="flex justify-between font-bold text-sm pt-1 text-foreground border-t border-border/60">
                            <span>Total Amount:</span>
                            <span className="font-display font-extrabold text-primary">{formatINR(selectedOrder.total_amount)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Customer Cancellation Notice or Cutoff explanation */}
                    {selectedOrder.status === "out_for_delivery" || selectedOrder.status === "ready_for_pickup" ? (
                      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                        <Clock className="size-4 shrink-0" />
                        <span>Fulfillment cutoff passed: Order is already in transit or ready at the counter. Customer self-service cancellation is closed.</span>
                      </div>
                    ) : null}

                    {/* Back to My Orders Action & Track Order Action */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedOrder(null)}
                        className="gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <ArrowLeft className="size-3.5" />
                        <span>Back to My Orders</span>
                      </Button>

                      <div className="flex items-center gap-2">
                        {isOrderEligibleForCustomerCancellation(selectedOrder.status) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const ord = selectedOrder;
                              setOrderToCancel(ord);
                              setCancelReason("Ordered by mistake");
                              setCancelCustomReason("");
                            }}
                            className="gap-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                          >
                            <X className="size-3.5" />
                            <span>Cancel Order</span>
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="hero"
                          size="sm"
                          onClick={() => {
                            const ord = selectedOrder;
                            setSelectedOrder(null);
                            setTrackOrderModal(ord);
                          }}
                          className="gap-1.5 text-xs font-bold"
                        >
                          <Truck className="size-3.5" />
                          <span>Track Live Delivery</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* CONFIRMATION DIALOG FOR CUSTOMER ORDER CANCELLATION */}
          <Dialog
            open={orderToCancel !== null}
            onOpenChange={(open) => {
              if (!open && !isCancellingOrder) {
                setOrderToCancel(null);
              }
            }}
          >
            <DialogContent className="max-w-md rounded-3xl p-6 sm:p-8">
              {orderToCancel && (
                <div className="space-y-4">
                  <DialogHeader>
                    <div className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="size-5 shrink-0" />
                      <DialogTitle className="font-display text-xl font-bold">
                        Cancel Order #{orderToCancel.order_number}?
                      </DialogTitle>
                    </div>
                    <DialogDescription className="text-xs text-muted-foreground pt-1">
                      Are you sure you want to cancel this order? This action cannot be undone by the customer.
                    </DialogDescription>
                  </DialogHeader>

                  {/* Truthful Payment / Stock status banner */}
                  <div className="rounded-2xl border border-border bg-secondary/30 p-3.5 text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Order Total:</span>
                      <span className="font-bold text-foreground">{formatINR(orderToCancel.total_amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payment Method:</span>
                      <span className="font-bold uppercase text-foreground">{orderToCancel.payment_method}</span>
                    </div>
                    {orderToCancel.payment_method === "upi" && orderToCancel.payment_status === "completed" ? (
                      <p className="pt-1.5 border-t border-border/60 text-[11px] text-amber-700 dark:text-amber-400 font-medium leading-relaxed">
                        💡 Verified Payment Notice: Your online payment has been recorded. Our management team will review and process your refund according to bank schedules.
                      </p>
                    ) : (
                      <p className="pt-1.5 border-t border-border/60 text-[11px] text-muted-foreground leading-relaxed">
                        💡 Stock Notice: No charge was settled. Reserved items will be returned to campus inventory automatically.
                      </p>
                    )}
                  </div>

                  {/* Cancellation Reason Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-foreground">
                      Reason for cancellation (optional):
                    </label>
                    <select
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      disabled={isCancellingOrder}
                      className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                    >
                      <option value="Ordered by mistake">Ordered by mistake</option>
                      <option value="Change of delivery room/block">Change of delivery location</option>
                      <option value="Delivery time too long">Delivery time too long</option>
                      <option value="Found alternative on campus">Found alternative on campus</option>
                      <option value="Other">Other reason...</option>
                    </select>

                    {cancelReason === "Other" && (
                      <input
                        type="text"
                        value={cancelCustomReason}
                        onChange={(e) => setCancelCustomReason(e.target.value)}
                        placeholder="Please specify reason..."
                        disabled={isCancellingOrder}
                        className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                      />
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-border/60">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isCancellingOrder}
                      onClick={() => setOrderToCancel(null)}
                      className="text-xs font-semibold"
                    >
                      Keep Order
                    </Button>

                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={isCancellingOrder}
                      onClick={handleConfirmCancelOrder}
                      className="h-9 gap-1.5 text-xs font-bold"
                    >
                      {isCancellingOrder ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Cancelling...</span>
                        </>
                      ) : (
                        <>
                          <X className="size-3.5" />
                          <span>Yes, Cancel Order</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* DEDICATED CUSTOMER ORDER TRACKER MODAL */}
          <Dialog open={trackOrderModal !== null} onOpenChange={(open) => !open && setTrackOrderModal(null)}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-3xl p-6 sm:p-8">
              {trackOrderModal && (
                <div>
                  <DialogHeader className="border-b border-border/60 pb-3">
                    <div className="flex items-center justify-between">
                      <DialogTitle className="font-display text-xl font-bold">
                        Live Order Tracking
                      </DialogTitle>
                      {getStatusBadge(trackOrderModal.status)}
                    </div>
                    <DialogDescription className="text-xs text-muted-foreground">
                      Tracking reference: <strong className="font-mono text-foreground">{trackOrderModal.order_number}</strong>
                    </DialogDescription>
                  </DialogHeader>

                  <div className="mt-5 space-y-6">
                    {/* Destination Banner */}
                    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3.5 flex items-center gap-3 text-xs text-foreground">
                      <Truck className="size-5 shrink-0 text-primary" />
                      <div>
                        <p className="font-bold">
                          {trackOrderModal.delivery_method === "hostel_delivery"
                            ? `Delivering to ${trackOrderModal.hostel || "Doorstep"} ${trackOrderModal.room ? `(${trackOrderModal.room})` : ""}`
                            : `Store Pickup at ${trackOrderModal.pickup_location || "Central Hub"}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">Local delivery team is servicing your request.</p>
                      </div>
                    </div>

                    {/* Timeline */}
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                        Delivery Milestones
                      </h4>
                      <div className="relative pl-6 space-y-4 before:absolute before:bottom-2 before:top-2 before:left-2 before:w-0.5 before:bg-border">
                        <div className="relative">
                          <span className="absolute -left-6 top-1 size-3.5 rounded-full bg-primary ring-4 ring-background" />
                          <div>
                            <p className="text-xs font-bold text-foreground">Order Placed</p>
                            <span className="text-[11px] text-muted-foreground">
                              {new Date(trackOrderModal.created_at).toLocaleString("en-IN", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>

                        {trackOrderModal.order_status_history &&
                          trackOrderModal.order_status_history.length > 0 &&
                          [...trackOrderModal.order_status_history]
                            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                            .filter((h) => h.new_status !== "placed")
                            .map((h) => {
                              const isCurrent = h.new_status === trackOrderModal.status;
                              return (
                                <div key={h.id} className="relative">
                                  <span
                                    className={cn(
                                      "absolute -left-6 top-1 size-3.5 rounded-full ring-4 ring-background",
                                      isCurrent ? "bg-primary animate-pulse" : "bg-muted-foreground/60"
                                    )}
                                  />
                                  <div>
                                    <p className="text-xs font-bold text-foreground capitalize">
                                      {h.new_status.replace(/_/g, " ")}
                                    </p>
                                    <span className="text-[11px] text-muted-foreground">
                                      {new Date(h.created_at).toLocaleString("en-IN", {
                                        day: "numeric",
                                        month: "short",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}
                                    </span>
                                    {h.notes && (
                                      <p className="mt-0.5 text-[11px] text-muted-foreground">{h.notes}</p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border/60">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setTrackOrderModal(null)}
                        className="gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <ArrowLeft className="size-3.5" />
                        <span>Back to My Orders</span>
                      </Button>

                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => {
                          const ord = trackOrderModal;
                          setTrackOrderModal(null);
                          setSelectedOrder(ord);
                        }}
                        className="text-xs font-semibold gap-1.5"
                      >
                        <FileText className="size-3.5" />
                        <span>View Order Details</span>
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* CUSTOMER IN-APP NOTIFICATIONS TAB */}
        <TabsContent value="notifications" className="mt-6">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">Order Alerts & Updates</h2>
                <p className="text-xs text-muted-foreground">
                  Stay updated on your PayU payment confirmations, campus prep, and delivery milestones.
                </p>
              </div>

              {customerUnreadCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={markAllCustomerNotifsRead}
                  className="h-8 text-xs font-semibold gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
                  id="customer-mark-all-read-btn"
                >
                  <Check className="size-3.5" />
                  <span>Mark All Read</span>
                </Button>
              )}
            </div>

            {customerNotifications.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
                <Bell className="mx-auto size-12 text-primary/40" />
                <h3 className="mt-3 font-display text-base font-bold text-foreground">No alerts yet</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                  When you place an order or complete payment, real-time alerts and delivery notifications will appear right here.
                </p>
              </div>
            ) : (
              <div className="space-y-3" id="customer-notifications-list">
                {customerNotifications.map((notif) => {
                  const isUnread = !notif.is_read;
                  return (
                    <div
                      key={notif.id}
                      className={cn(
                        "group rounded-2xl border p-4 sm:p-5 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5",
                        isUnread
                          ? "border-primary/40 bg-primary/5 shadow-2xs"
                          : "border-border bg-card hover:border-border/80"
                      )}
                    >
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <span
                          className={cn(
                            "mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl text-xs",
                            isUnread ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                          )}
                        >
                          <Bell className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-sm text-foreground truncate">{notif.title}</h4>
                            {notif.order_number && (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                #{notif.order_number}
                              </Badge>
                            )}
                            {isUnread && (
                              <span className="size-2 rounded-full bg-primary animate-pulse" />
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{notif.message}</p>
                          <span className="mt-2 block text-[11px] text-muted-foreground/75">
                            {new Date(notif.created_at).toLocaleString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        {notif.order_number && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (isUnread) markCustomerNotifRead(notif.id);
                              const matching = orders.find(
                                (o) => o.order_number === notif.order_number || o.id === notif.order_id
                              );
                              if (matching) {
                                setTrackOrderModal(matching);
                              } else {
                                toast.info(`Order #${notif.order_number}`);
                              }
                            }}
                            className="h-8 px-3 text-xs font-semibold gap-1.5"
                          >
                            <Truck className="size-3.5" />
                            <span>Track</span>
                          </Button>
                        )}

                        {isUnread && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => markCustomerNotifRead(notif.id)}
                            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                            title="Mark as read"
                          >
                            <Check className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="profile" className="mt-6">
          <div className="max-w-xl rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
            <h2 className="font-display text-lg font-bold text-foreground">Saved Delivery Address</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              These details will automatically fill your checkout form for rapid delivery to your door.
            </p>

            <form onSubmit={handleSaveProfile} className="mt-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">Full Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Your full name"
                  className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">Mobile Number</label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="10-digit mobile number"
                  className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">Hostel / Area</label>
                <select
                  value={editHostel}
                  onChange={(e) => setEditHostel(e.target.value)}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                >
                  {HOSTELS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">Block / Wing</label>
                  <input
                    type="text"
                    value={editBlock}
                    onChange={(e) => setEditBlock(e.target.value)}
                    placeholder="e.g. Block A"
                    className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">Room Number</label>
                  <input
                    type="text"
                    value={editRoom}
                    onChange={(e) => setEditRoom(e.target.value)}
                    placeholder="e.g. 204"
                    className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                </div>
              </div>

              <div className="pt-2">
                <Button type="submit" variant="hero" className="h-11 px-6" disabled={savingProfile}>
                  {savingProfile ? <Loader2 className="size-4 animate-spin" /> : "Save Delivery Address"}
                </Button>
              </div>
            </form>
          </div>

          {/* SECURITY & PASSWORD SETUP */}
          <div id="password-security-section" className="mt-8 max-w-xl rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
            <div className="flex items-center gap-2">
              <KeyRound className="size-5 text-primary" />
              <h2 className="font-display text-lg font-bold text-foreground">Password & Account Security</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Update your account password. If you were invited as staff, set your private password here.
            </p>

            {isStaffInviteWelcome && (
              <div className="mt-4 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-xs text-foreground space-y-1">
                <div className="flex items-center gap-2 font-bold text-primary">
                  <ShieldCheck className="size-4 shrink-0" />
                  <span>Welcome to Shipt Staff Onboarding!</span>
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  Your invitation has been verified. Please choose and confirm your new password below. Once set, you can sign in directly to the Staff & Admin Portal at <Link to="/admin" className="font-bold text-primary hover:underline">/admin</Link>.
                </p>
              </div>
            )}

            {passwordChangeMsg && (
              <div
                className={cn(
                  "mt-4 rounded-xl p-3 text-xs flex flex-col gap-2",
                  passwordChangeMsg.type === "success"
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-destructive/10 text-destructive border border-destructive/20"
                )}
              >
                <div className="flex items-center gap-2">
                  {passwordChangeMsg.type === "success" ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : (
                    <AlertCircle className="size-4 shrink-0" />
                  )}
                  <span>{passwordChangeMsg.text}</span>
                </div>
                {passwordChangeMsg.type === "success" && (
                  <div className="pt-1">
                    <Button asChild size="sm" variant="hero" className="h-8 text-xs font-bold gap-1.5">
                      <Link to="/admin">
                        <span>Go to Staff & Admin Portal</span>
                        <ArrowRight className="size-3" />
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleUpdatePassword} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">New Password *</label>
                <input
                  type="password"
                  required
                  value={changePasswordVal}
                  onChange={(e) => setChangePasswordVal(e.target.value)}
                  placeholder="At least 6 characters"
                  className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">Confirm New Password *</label>
                <input
                  type="password"
                  required
                  value={changeConfirmPasswordVal}
                  onChange={(e) => setChangeConfirmPasswordVal(e.target.value)}
                  placeholder="Re-enter new password"
                  className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              </div>

              <Button type="submit" variant="hero" className="h-11 px-6 font-bold text-xs" disabled={updatingPassword}>
                {updatingPassword ? <Loader2 className="size-4 animate-spin" /> : "Update Password"}
              </Button>
            </form>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
