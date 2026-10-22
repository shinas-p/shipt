import { useState, useEffect } from "react";
import {
  Upload,
  X,
  Image as ImageIcon,
  Check,
  AlertCircle,
  Loader2,
  Package,
  Layers,
  Sparkles,
  Info,
  Eye,
  Star,
  Lock,
  Coins,
  TrendingUp,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/data/products";
import { BRAND_FALLBACK_IMAGE } from "@/lib/catalogApi";
import { calculateProfitMetrics, fetchProductCost, saveProductCost } from "@/lib/profitability";
import { canManageCosts, type AdminRole } from "@/lib/permissions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBProduct, DBCategory } from "./types";

interface ProductFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: DBProduct | null; // null for creation mode
  categories: DBCategory[];
  adminRole?: AdminRole | null;
  onSaveSuccess: () => Promise<void>;
}

export function ProductFormModal({
  open,
  onOpenChange,
  product,
  categories,
  adminRole,
  onSaveSuccess,
}: ProductFormModalProps) {
  const canSeeCosts = adminRole === undefined ? true : canManageCosts(adminRole);
  const [activeTab, setActiveTab] = useState<"info" | "pricing" | "images" | "preview">("info");

  // Form State
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [size, setSize] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [stock, setStock] = useState("10");
  const [displayOrder, setDisplayOrder] = useState("0");
  const [bestseller, setBestseller] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [isActive, setIsActive] = useState(true);

  // Private Cost State (Admin Only)
  const [supplierCost, setSupplierCost] = useState("");
  const [otherCosts, setOtherCosts] = useState("");
  const [costNotes, setCostNotes] = useState("");
  const [loadingCost, setLoadingCost] = useState(false);

  // Images state (array of uploaded URLs, first one is primary)
  const [images, setImages] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

interface FormErrors {
  name?: string | undefined;
  size?: string | undefined;
  category?: string | undefined;
  price?: string | undefined;
  originalPrice?: string | undefined;
  stock?: string | undefined;
  supplierCost?: string | undefined;
  otherCosts?: string | undefined;
}

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (open) {
      setErrors({});
      setActiveTab("info");
      if (product) {
        setName(product.name || "");
        setSlug(product.slug || "");
        setSize(product.size || "");
        setDescription(product.description || "");
        setCategoryId(product.category_id || (categories[0]?.id ?? "snacks"));
        setPrice(product.price != null ? String(product.price) : "");
        setOriginalPrice(
          product.original_price != null ? String(product.original_price) : ""
        );
        setStock(product.stock != null ? String(product.stock) : "0");
        setDisplayOrder(String(product.display_order ?? 0));
        setBestseller(Boolean(product.bestseller));
        setIsNew(Boolean(product.is_new));
        setIsActive(Boolean(product.is_active));
        setImages(product.image_url ? [product.image_url] : []);

        // Fetch private supplier cost for existing product (Super Admin & Owner only)
        if (canSeeCosts) {
          setLoadingCost(true);
          fetchProductCost(product.id)
            .then((costData) => {
              if (costData) {
                setSupplierCost(costData.supplier_cost > 0 ? String(costData.supplier_cost) : "");
                setOtherCosts(costData.other_costs > 0 ? String(costData.other_costs) : "");
                setCostNotes(costData.notes || "");
              } else {
                setSupplierCost("");
                setOtherCosts("");
                setCostNotes("");
              }
            })
            .catch(() => {
              setSupplierCost("");
              setOtherCosts("");
              setCostNotes("");
            })
            .finally(() => {
              setLoadingCost(false);
            });
        }
      } else {
        setName("");
        setSlug("");
        setSize("");
        setDescription("");
        setCategoryId(categories[0]?.id ?? "snacks");
        setPrice("");
        setOriginalPrice("");
        setStock("10");
        setDisplayOrder("0");
        setBestseller(false);
        setIsNew(true);
        setIsActive(true);
        setImages([]);
        setSupplierCost("");
        setOtherCosts("");
        setCostNotes("");
        setLoadingCost(false);
      }
    }
  }, [open, product, categories]);

  // Auto-generate slug from name when adding a new product
  const handleNameChange = (val: string) => {
    setName(val);
    if (!product) {
      const generated = val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      setSlug(generated);
    }
  };

  // Image Upload handler
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validMimes = ["image/jpeg", "image/png", "image/webp"];
    if (!validMimes.includes(file.type)) {
      toast.error("Invalid image format: Only JPG, PNG, and WebP are allowed.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image too large: Maximum file size is 5 MB.");
      return;
    }

    setUploadingImage(true);
    setUploadProgress(10);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `products/prod-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 6)}.${fileExt}`;

      setUploadProgress(40);
      const { error: uploadError } = await supabase.storage
        .from("posters")
        .upload(fileName, file, { upsert: true });

      if (uploadError) {
        toast.error(`Image upload failed: ${uploadError.message}`);
        return;
      }

      setUploadProgress(80);
      const {
        data: { publicUrl },
      } = supabase.storage.from("posters").getPublicUrl(fileName);

      setImages((prev) => [...prev, publicUrl]);
      setUploadProgress(100);
      toast.success("Image uploaded successfully!");
    } catch (err: any) {
      toast.error(`Upload error: ${err?.message || "Failed to upload image."}`);
    } finally {
      setUploadingImage(false);
      setUploadProgress(null);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const setPrimaryImage = (index: number) => {
    if (index === 0) return;
    setImages((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      if (item) next.unshift(item);
      return next;
    });
    toast.info("Primary display image updated.");
  };

  // Calculated discount
  const priceNum = parseFloat(price);
  const origPriceNum = originalPrice.trim() ? parseFloat(originalPrice) : null;
  const calculatedDiscount =
    !isNaN(priceNum) && origPriceNum && origPriceNum > priceNum
      ? Math.round((1 - priceNum / origPriceNum) * 100)
      : 0;

  // Real-time Profit, Margin & Markup Calculation
  const profitMetrics = calculateProfitMetrics(price, supplierCost, otherCosts);

  // Validation
  const validate = (): boolean => {
    const errs: FormErrors = {};
    if (!name.trim()) errs.name = "Product name is required.";
    if (!size.trim()) errs.size = "Size or packaging unit is required.";
    if (!categoryId) errs.category = "Please select a category.";

    if (isNaN(priceNum) || priceNum < 0) {
      errs.price = "Price must be a non-negative number.";
    }

    if (origPriceNum !== null) {
      if (isNaN(origPriceNum) || origPriceNum < priceNum) {
        errs.originalPrice = "Original price must be greater than or equal to selling price.";
      }
    }

    const stockNum = parseInt(stock, 10);
    if (isNaN(stockNum) || stockNum < 0) {
      errs.stock = "Stock must be a non-negative integer.";
    }

    if (supplierCost.trim()) {
      const supplierCostNum = parseFloat(supplierCost);
      if (isNaN(supplierCostNum) || supplierCostNum < 0) {
        errs.supplierCost = "Supplier cost must be a non-negative number.";
      }
    }

    if (otherCosts.trim()) {
      const otherCostsNum = parseFloat(otherCosts);
      if (isNaN(otherCostsNum) || otherCostsNum < 0) {
        errs.otherCosts = "Other costs must be a non-negative number.";
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast.error("Please correct the errors in the form.");
      return;
    }

    setSaving(true);
    try {
      const primaryImageUrl =
        images[0] ||
        product?.image_url ||
        "https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-notebook.jpg";

      const cleanSlug =
        slug.trim() ||
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

      const payload = {
        name: name.trim(),
        slug: product ? cleanSlug : `${cleanSlug}-${Date.now().toString().slice(-4)}`,
        size: size.trim(),
        description: description.trim(),
        category_id: categoryId,
        price: priceNum,
        original_price: origPriceNum,
        stock: parseInt(stock, 10),
        image_url: primaryImageUrl,
        display_order: parseInt(displayOrder, 10) || 0,
        bestseller,
        is_new: isNew,
        is_active: isActive,
      };

      let savedProductId = product?.id || null;

      if (product) {
        // Edit existing product
        const { error } = await supabase
          .from("products")
          .update(payload)
          .eq("id", product.id);

        if (error) {
          toast.error(`Failed to update product: ${error.message}`);
          setSaving(false);
          return;
        }

        // If stock changed manually, record in inventory_movements ledger
        if (product.stock !== payload.stock) {
          const diff = payload.stock - product.stock;
          const { data: { session } } = await supabase.auth.getSession();
          await supabase.from("inventory_movements").insert([
            {
              product_id: product.id,
              movement_type: "manual_adjustment",
              quantity_change: diff,
              previous_stock: product.stock,
              new_stock: payload.stock,
              reason: `Manual stock adjustment during product edit (${diff > 0 ? "+" : ""}${diff})`,
              performed_by: session?.user?.id ?? null,
            },
          ]);
        }

        toast.success(`Updated "${payload.name}" successfully!`);
      } else {
        // Create new product
        const { data: newProd, error } = await supabase
          .from("products")
          .insert([payload])
          .select("id")
          .single();

        if (error) {
          toast.error(`Failed to create product: ${error.message}`);
          setSaving(false);
          return;
        }

        savedProductId = newProd?.id || null;

        // Record initial stock creation in inventory movements ledger
        if (payload.stock > 0 && newProd?.id) {
          const { data: { session } } = await supabase.auth.getSession();
          await supabase.from("inventory_movements").insert([
            {
              product_id: newProd.id,
              movement_type: "restock_shipment",
              quantity_change: payload.stock,
              previous_stock: 0,
              new_stock: payload.stock,
              reason: "Initial catalogue stock on product creation",
              performed_by: session?.user?.id ?? null,
            },
          ]);
        }

        toast.success(`Product "${payload.name}" created successfully!`);
      }

      // Save private supplier cost & other expenses (authorized Super Admin / Owner only)
      const targetProductId = savedProductId;
      if (canSeeCosts && targetProductId) {
        const cleanSupplier = supplierCost.trim() ? Math.max(0, parseFloat(supplierCost) || 0) : 0;
        const cleanOther = otherCosts.trim() ? Math.max(0, parseFloat(otherCosts) || 0) : 0;

        if (cleanSupplier > 0 || cleanOther > 0 || costNotes.trim() || product) {
          const costRes = await saveProductCost(
            targetProductId,
            cleanSupplier,
            cleanOther,
            costNotes
          );
          if (!costRes.success) {
            toast.warning(`Product saved, but cost update failed: ${costRes.error}`);
          }
        }
      }

      await onSaveSuccess();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Save error: ${err?.message || "Failed to save product"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto rounded-3xl p-6 sm:p-8">
        <DialogHeader className="border-b border-border pb-4">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="font-display text-xl font-bold text-foreground">
                {product ? `Edit Product: ${product.name}` : "Add New Product"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Configure catalogue information, pricing, live inventory, and multi-image assets.
              </DialogDescription>
            </div>
          </div>

          {/* Sub-tabs inside modal */}
          <div className="mt-4 flex gap-1.5 border-b border-border/60 pb-1">
            <button
              type="button"
              onClick={() => setActiveTab("info")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                activeTab === "info"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Basic Info
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("pricing")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                activeTab === "pricing"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Pricing & Stock
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("images")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                activeTab === "images"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Images ({images.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition flex items-center gap-1",
                activeTab === "preview"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Eye className="size-3.5" />
              <span>Live Preview</span>
            </button>
          </div>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 pt-2">
          {/* TAB 1: BASIC INFO */}
          {activeTab === "info" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Product Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Spiral Notebook A5"
                  className={cn(
                    "h-10 w-full rounded-xl border bg-card px-3 text-xs outline-none focus:border-primary",
                    errors.name ? "border-destructive ring-1 ring-destructive" : "border-input"
                  )}
                />
                {errors.name && <p className="mt-1 text-[11px] text-destructive">{errors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Size / Variant Attribute <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    placeholder="e.g. 120 g, Pack of 3, A5 · 160 pages"
                    className={cn(
                      "h-10 w-full rounded-xl border bg-card px-3 text-xs outline-none focus:border-primary",
                      errors.size ? "border-destructive ring-1 ring-destructive" : "border-input"
                    )}
                  />
                  {errors.size && <p className="mt-1 text-[11px] text-destructive">{errors.size}</p>}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Category <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary capitalize"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Slug / Identifier
                  </label>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="e.g. spiral-notebook-a5"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono outline-none focus:border-primary"
                  />
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Used for search indexing and URL routing.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Display Order
                  </label>
                  <input
                    type="number"
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(e.target.value)}
                    placeholder="0"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                  />
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Lower numbers sort first in catalog feeds.
                  </p>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detailed campus product overview, specifications, and features..."
                  className="w-full rounded-xl border border-input bg-card p-2.5 text-xs outline-none focus:border-primary leading-relaxed"
                />
              </div>

              <div className="flex flex-wrap gap-4 border-t border-border/60 pt-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="size-4 rounded text-primary"
                  />
                  <span className="text-xs font-semibold text-foreground">
                    Active (Visible on Storefront)
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bestseller}
                    onChange={(e) => setBestseller(e.target.checked)}
                    className="size-4 rounded text-primary"
                  />
                  <span className="text-xs font-semibold text-foreground">
                    Bestseller Badge
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isNew}
                    onChange={(e) => setIsNew(e.target.checked)}
                    className="size-4 rounded text-primary"
                  />
                  <span className="text-xs font-semibold text-foreground">
                    New Arrival Badge
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 2: PRICING & STOCK */}
          {activeTab === "pricing" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Selling Price (₹) <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="60"
                    className={cn(
                      "h-10 w-full rounded-xl border bg-card px-3 text-xs font-mono font-bold outline-none focus:border-primary",
                      errors.price ? "border-destructive ring-1 ring-destructive" : "border-input"
                    )}
                  />
                  {errors.price && <p className="mt-1 text-[11px] text-destructive">{errors.price}</p>}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Original / Compare-At Price (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={originalPrice}
                    onChange={(e) => setOriginalPrice(e.target.value)}
                    placeholder="Optional (e.g. 80)"
                    className={cn(
                      "h-10 w-full rounded-xl border bg-card px-3 text-xs font-mono outline-none focus:border-primary",
                      errors.originalPrice
                        ? "border-destructive ring-1 ring-destructive"
                        : "border-input"
                    )}
                  />
                  {errors.originalPrice && (
                    <p className="mt-1 text-[11px] text-destructive">{errors.originalPrice}</p>
                  )}
                </div>
              </div>

              {calculatedDiscount > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-lime/40 bg-lime/10 p-3 text-xs text-lime-800 dark:text-lime-300">
                  <Sparkles className="size-4 shrink-0 text-lime-600" />
                  <span>
                    Automatic discount applied:{" "}
                    <strong>
                      {calculatedDiscount}% OFF (Saves {formatINR(origPriceNum! - priceNum)})
                    </strong>
                  </span>
                </div>
              )}

              <div className="border-t border-border/60 pt-3">
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Warehouse Stock Quantity <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  placeholder="25"
                  className={cn(
                    "h-10 w-full max-w-xs rounded-xl border bg-card px-3 text-xs font-mono outline-none focus:border-primary",
                    errors.stock ? "border-destructive ring-1 ring-destructive" : "border-input"
                  )}
                />
                {errors.stock && <p className="mt-1 text-[11px] text-destructive">{errors.stock}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Stock updates are saved to the product ledger and checked atomically during customer checkout.
                </p>
              </div>

              {/* PRIVATE SUPPLIER COST & PROFIT CARD (SUPER ADMIN & OWNER ONLY) */}
              {canSeeCosts && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="grid size-7 place-items-center rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                        <Lock className="size-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <span>Supplier Cost & Profit</span>
                          <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                            Private · Admin Only
                          </span>
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                          Wholesale procurement costs are strictly confidential and never exposed to customers.
                        </p>
                      </div>
                    </div>
                    {loadingCost && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">
                        Supplier Cost (Private) (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={supplierCost}
                        onChange={(e) => setSupplierCost(e.target.value)}
                        placeholder="e.g. 40"
                        className={cn(
                          "h-10 w-full rounded-xl border bg-card px-3 text-xs font-mono font-bold outline-none focus:border-primary",
                          errors.supplierCost ? "border-destructive ring-1 ring-destructive" : "border-input"
                        )}
                      />
                      {errors.supplierCost && (
                        <p className="mt-1 text-[11px] text-destructive">{errors.supplierCost}</p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground">Unit price paid to supplier / shop.</p>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">
                        Other Costs (₹) <span className="text-muted-foreground font-normal">(Optional)</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={otherCosts}
                        onChange={(e) => setOtherCosts(e.target.value)}
                        placeholder="e.g. 5"
                        className={cn(
                          "h-10 w-full rounded-xl border bg-card px-3 text-xs font-mono outline-none focus:border-primary",
                          errors.otherCosts ? "border-destructive ring-1 ring-destructive" : "border-input"
                        )}
                      />
                      {errors.otherCosts && (
                        <p className="mt-1 text-[11px] text-destructive">{errors.otherCosts}</p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground">Per-item packaging or transport.</p>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                      Supplier / Sourcing Notes (Optional)
                    </label>
                    <input
                      type="text"
                      value={costNotes}
                      onChange={(e) => setCostNotes(e.target.value)}
                      placeholder="e.g. Sourced from wholesale distributor; invoice ref #482"
                      className="h-8 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                    />
                  </div>

                  {/* Real-time Profit, Margin & Markup Calculation Metrics */}
                  <div className="rounded-xl border border-border/80 bg-background/80 p-3 space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                      <div className="p-2 rounded-lg bg-card border border-border/60">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Unit Cost</p>
                        <p className="mt-0.5 font-mono font-bold text-xs text-foreground">
                          {formatINR(profitMetrics.totalCost)}
                        </p>
                      </div>

                      <div
                        className={cn(
                          "p-2 rounded-lg border",
                          profitMetrics.isLoss
                            ? "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400"
                            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                        )}
                      >
                        <p className="text-[10px] font-medium uppercase">
                          {profitMetrics.isLoss ? "Estimated Loss" : "Estimated Profit"}
                        </p>
                        <p className="mt-0.5 font-mono font-bold text-xs">
                          {formatINR(Math.abs(profitMetrics.estimatedProfit))}
                        </p>
                      </div>

                      <div
                        className={cn(
                          "p-2 rounded-lg border",
                          profitMetrics.isLoss
                            ? "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400"
                            : "bg-primary/10 border-primary/20 text-primary"
                        )}
                      >
                        <p className="text-[10px] font-medium uppercase">Profit Margin</p>
                        <p className="mt-0.5 font-mono font-bold text-xs">
                          {profitMetrics.profitMarginPct.toFixed(1)}%
                        </p>
                      </div>

                      <div className="p-2 rounded-lg bg-card border border-border/60">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase">Markup</p>
                        <p className="mt-0.5 font-mono font-bold text-xs text-foreground">
                          {profitMetrics.markupPct.toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    {profitMetrics.isLoss && (
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                        <AlertCircle className="size-3.5 shrink-0" />
                        <span>Warning: Selling price is lower than unit cost. This item operates at a loss!</span>
                      </div>
                    )}

                    {profitMetrics.totalCost === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center italic">
                        Enter supplier cost above to see live profit margin and markup calculations.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: IMAGES */}
          {activeTab === "images" && (
            <div className="space-y-4">
              <div className="rounded-2xl border-2 border-dashed border-border bg-secondary/30 p-5 text-center">
                <div className="mx-auto grid size-10 place-items-center rounded-xl bg-primary/10 text-primary mb-2">
                  <Upload className="size-5" />
                </div>
                <h4 className="text-xs font-bold text-foreground">Upload Product Images</h4>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Supported formats: JPG, PNG, WebP (Max size 5 MB). Uploads directly to Supabase storage.
                </p>
                <div className="mt-3">
                  <input
                    type="file"
                    id="product-images-input"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageUpload}
                    disabled={uploadingImage}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingImage}
                    onClick={() => document.getElementById("product-images-input")?.click()}
                    className="h-8 gap-1.5 text-xs font-semibold"
                  >
                    {uploadingImage ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        <span>Uploading ({uploadProgress}%)...</span>
                      </>
                    ) : (
                      <>
                        <ImageIcon className="size-3.5" />
                        <span>Select File to Upload</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {images.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-foreground">
                    Uploaded Assets ({images.length})
                  </span>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {images.map((imgUrl, idx) => (
                      <div
                        key={imgUrl}
                        className={cn(
                          "group relative aspect-square rounded-2xl overflow-hidden border bg-muted",
                          idx === 0 ? "border-primary ring-2 ring-primary/30" : "border-border"
                        )}
                      >
                        <img src={imgUrl} alt="" className="size-full object-cover" />

                        {idx === 0 && (
                          <span className="absolute left-1.5 top-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
                            Primary
                          </span>
                        )}

                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1.5">
                          {idx !== 0 && (
                            <button
                              type="button"
                              onClick={() => setPrimaryImage(idx)}
                              title="Set as Primary"
                              className="rounded-lg bg-card/90 p-1.5 text-xs text-foreground hover:bg-card transition"
                            >
                              <Check className="size-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeImage(idx)}
                            title="Remove Image"
                            className="rounded-lg bg-destructive/90 p-1.5 text-xs text-destructive-foreground hover:bg-destructive transition"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: LIVE PREVIEW */}
          {activeTab === "preview" && (
            <div className="flex flex-col items-center justify-center py-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                Live Storefront Card Preview:
              </p>
              <div className="w-full max-w-xs">
                <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
                  <div className="relative aspect-square overflow-hidden bg-muted">
                    <img
                      src={images[0] || product?.image_url || BRAND_FALLBACK_IMAGE}
                      alt={name}
                      className="size-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                      }}
                    />
                    <div className="absolute left-2 top-2 flex flex-col gap-1">
                      {bestseller && (
                        <span className="rounded-full bg-forest px-2 py-0.5 text-[10px] font-semibold text-forest-foreground">
                          Bestseller
                        </span>
                      )}
                      {calculatedDiscount > 0 && (
                        <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-lime-foreground">
                          {calculatedDiscount}% off*
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-[11px] text-muted-foreground">{size || "Size specification"}</p>
                    <h4 className="font-semibold text-sm text-foreground truncate">
                      {name || "Product Name"}
                    </h4>
                    <p className="mt-1 font-mono font-bold text-sm text-foreground">
                      {formatINR(priceNum || 0)}
                      {origPriceNum && origPriceNum > priceNum && (
                        <span className="ml-1 text-xs text-muted-foreground line-through font-normal">
                          {formatINR(origPriceNum)}
                        </span>
                      )}
                    </p>
                  </div>
                </article>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-9 text-xs"
            >
              Cancel
            </Button>

            <div className="flex gap-2">
              {activeTab !== "preview" && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const tabs: Array<"info" | "pricing" | "images" | "preview"> = [
                      "info",
                      "pricing",
                      "images",
                      "preview",
                    ];
                    const nextIndex = tabs.indexOf(activeTab) + 1;
                    if (nextIndex < tabs.length) {
                      setActiveTab(tabs[nextIndex]!);
                    }
                  }}
                  className="h-9 text-xs"
                >
                  Next Tab →
                </Button>
              )}
              <Button
                type="submit"
                variant="hero"
                disabled={saving}
                className="h-9 px-5 text-xs font-bold"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : product ? (
                  "Save Changes"
                ) : (
                  "Create Product"
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
