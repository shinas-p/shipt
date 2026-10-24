import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  ArrowLeft,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Package,
  Layers,
  IndianRupee,
  Hash,
  X,
  Clock,
  Check,
  Tag,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCustomerAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import { categories } from "@/data/products";
import {
  submitProductSuggestion,
  fetchCustomerSuggestions,
  type ProductSuggestion,
  type SuggestionStatus,
} from "@/lib/suggestions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/suggest-product")({
  head: () => ({
    meta: [
      { title: "Suggest a Product — Shipt Mart" },
      {
        name: "description",
        content:
          "Can't find an item in the store? Suggest products, brands, or essentials for Shipt Mart to stock on campus.",
      },
      { property: "og:title", content: "Suggest a Product — Shipt Mart" },
      {
        property: "og:description",
        content: "Tell us what products you need delivered to your hostel or campus.",
      },
    ],
  }),
  component: SuggestProductPage,
});

export function SuggestProductPage() {
  const { branding } = useBranding();
  const { user, profile } = useCustomerAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [expectedPrice, setExpectedPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  // Photo state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Submission & status
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Customer previous suggestions
  const [mySuggestions, setMySuggestions] = useState<ProductSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Intentionally start inputs empty and do not auto-prefill from auth profile (as required)

  // Load previous suggestions for authenticated user
  const loadSuggestions = async () => {
    if (!user) return;
    setLoadingSuggestions(true);
    try {
      const data = await fetchCustomerSuggestions(user.id);
      setMySuggestions(data);
    } catch {
      // Ignore
    } finally {
      setLoadingSuggestions(false);
    }
  };

  useEffect(() => {
    loadSuggestions();
  }, [user]);

  // Photo change handler
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setErrorMsg("Please upload a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg("Image size must be less than 5 MB.");
      return;
    }

    setErrorMsg(null);
    setPhotoFile(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!productName.trim()) {
      setErrorMsg("Product name is required.");
      return;
    }
    if (!customerEmail.trim()) {
      setErrorMsg("Your email address is required so we can notify you.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail.trim())) {
      setErrorMsg("Please enter a valid email address (e.g. name@campus.edu).");
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitProductSuggestion(
        {
          user_id: user?.id || null,
          customer_name: customerName.trim() || (user ? "Valued Customer" : "Guest Customer"),
          customer_email: customerEmail.trim(),
          customer_phone: customerPhone.trim() || null,
          product_name: productName.trim(),
          category: category || null,
          brand: brand.trim() || null,
          expected_price: expectedPrice ? parseFloat(expectedPrice) : null,
          quantity: parseInt(quantity, 10) || 1,
          reason: reason.trim() || null,
        },
        photoFile
      );

      if (!res.success) {
        setErrorMsg(res.error || "Failed to submit product suggestion.");
        toast.error(res.error || "Failed to submit product suggestion.");
      } else {
        toast.success("Thank you! Your product suggestion has been submitted.");
        setSuccessMsg(
          "Your suggestion was submitted successfully! Our campus procurement team reviews suggestions weekly."
        );
        // Reset form fields
        setProductName("");
        setCategory("");
        setBrand("");
        setExpectedPrice("");
        setQuantity("1");
        setReason("");
        removePhoto();

        // Refresh list
        if (user) {
          loadSuggestions();
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: SuggestionStatus) => {
    switch (status) {
      case "approved":
        return {
          label: "Approved & Sourcing",
          className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
        };
      case "reviewed":
        return {
          label: "Under Review",
          className: "bg-blue-500/10 text-blue-700 border-blue-500/30",
        };
      case "rejected":
        return {
          label: "Unavailable",
          className: "bg-destructive/10 text-destructive border-destructive/20",
        };
      default:
        return {
          label: "Pending Review",
          className: "bg-amber-500/10 text-amber-700 border-amber-500/30",
        };
    }
  };

  return (
    <div className="min-h-screen bg-background py-8 sm:py-12">
      <div className="container-page max-w-3xl space-y-8">
        {/* Back Link */}
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3 gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Link to="/">
              <ArrowLeft className="size-4" />
              <span>Back to Store</span>
            </Link>
          </Button>
        </div>

        {/* Hero Section */}
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-10">
          <div className="relative z-10 space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
              <Sparkles className="size-3.5" />
              <span>Campus Demand & Suggestions</span>
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              Can't find what you need?
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Tell us what products, snacks, stationery, or essentials you'd like {branding.store_name} to stock on campus. We review suggestions weekly and notify you when items arrive!
            </p>
          </div>
        </div>

        {/* Success Alert */}
        {successMsg && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-emerald-800 dark:text-emerald-300">
            <div className="flex items-center gap-2.5 font-bold">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
              <span>Suggestion Received</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {successMsg}
            </p>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Main Suggestion Form */}
        <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Product Details Section */}
            <div>
              <h2 className="font-display text-base font-bold text-foreground mb-4">
                1. Product Information
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Product Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="e.g. Lays Wafer Style Pepper, Doms Fineliner Pen"
                    className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                    id="suggest-product-name-input"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">
                      Category (Optional)
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                    >
                      <option value="">Select a category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">
                      Preferred Brand (Optional)
                    </label>
                    <input
                      type="text"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder="e.g. Nestlé, Classmate, Nivea"
                      className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">
                      Expected Price in ₹ (Optional)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                        ₹
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={expectedPrice}
                        onChange={(e) => setExpectedPrice(e.target.value)}
                        placeholder="e.g. 50"
                        className="h-11 w-full rounded-xl border border-input bg-background pl-8 pr-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">
                      Quantity Needed (Optional)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="1"
                      className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Description or Reason (Optional)
                  </label>
                  <textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Tell us what size or flavour you need, or why this item would be helpful for students..."
                    className="w-full rounded-xl border border-input bg-background p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 resize-none"
                  />
                </div>

                {/* Optional Photo Upload */}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Product Photo (Optional)
                  </label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoSelect}
                    className="hidden"
                    id="suggest-photo-upload"
                  />

                  {photoPreview ? (
                    <div className="relative inline-block rounded-2xl border border-border p-2 bg-secondary/30">
                      <img
                        src={photoPreview}
                        alt="Product preview"
                        className="h-28 w-28 rounded-xl object-cover"
                      />
                      <button
                        type="button"
                        onClick={removePhoto}
                        className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:scale-110 transition"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex h-20 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-input bg-muted/20 px-4 text-xs font-medium text-muted-foreground transition hover:border-primary hover:bg-muted/40"
                    >
                      <Upload className="size-4 text-muted-foreground" />
                      <span>Upload photo of product package or wrapper (Max 5 MB)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Customer Contact Section */}
            <div className="pt-4 border-t border-border">
              <h2 className="font-display text-base font-bold text-foreground mb-4">
                2. Your Contact Information
              </h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="suggest-customer-name-input" className="mb-1 block text-xs font-semibold text-foreground">
                    Your Name
                  </label>
                  <input
                    type="text"
                    id="suggest-customer-name-input"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g., Andru"
                    className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                </div>

                <div>
                  <label htmlFor="suggest-customer-email-input" className="mb-1 block text-xs font-semibold text-foreground">
                    Contact Email <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="email"
                    id="suggest-customer-email-input"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="e.g., demo@gmail.com"
                    className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                </div>
              </div>

              {!user && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Tip: Have an account?{" "}
                  <Link to="/account" className="font-bold text-primary hover:underline">
                    Sign in here
                  </Link>{" "}
                  to track your suggestion status in real time.
                </p>
              )}
            </div>

            {/* Submit Action */}
            <div className="pt-2">
              <Button
                type="submit"
                variant="hero"
                disabled={submitting}
                className="h-11 w-full sm:w-auto px-8 font-bold text-xs gap-2"
                id="submit-product-suggestion-btn"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Submitting Suggestion...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    <span>Submit Product Suggestion</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>

        {/* My Suggestions Section for Logged-In Customers */}
        {user && (
          <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-foreground">
                  My Previous Suggestions
                </h3>
                <p className="text-xs text-muted-foreground">
                  Track the progress of products you have requested.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadSuggestions}
                disabled={loadingSuggestions}
                className="text-xs h-8"
              >
                {loadingSuggestions ? <Loader2 className="size-3 animate-spin" /> : "Refresh"}
              </Button>
            </div>

            {mySuggestions.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground border border-dashed border-border rounded-2xl">
                You haven't submitted any product suggestions yet.
              </div>
            ) : (
              <div className="space-y-3">
                {mySuggestions.map((item) => {
                  const badge = getStatusBadge(item.status);
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-border/80 bg-background/50 p-4 transition hover:border-primary/30"
                    >
                      <div className="flex items-center gap-3">
                        {item.photo_url ? (
                          <img
                            src={item.photo_url}
                            alt={item.product_name}
                            className="size-12 rounded-xl object-cover shrink-0 border border-border"
                          />
                        ) : (
                          <div className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
                            <Package className="size-5" />
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-sm text-foreground">{item.product_name}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            {item.category && <span>{item.category}</span>}
                            {item.expected_price && <span>• ₹{item.expected_price}</span>}
                            <span>• {new Date(item.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            badge.className
                          )}
                        >
                          {badge.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
