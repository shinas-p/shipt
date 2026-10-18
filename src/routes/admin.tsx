import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ShieldCheck,
  Package,
  Layers,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Upload,
  Eye,
  Trash2,
  Lock,
  Loader2,
  Search,
  Filter,
  LayoutGrid,
  List,
  Edit3,
  Users,
  UserPlus,
  UserX,
  ExternalLink,
  Tag,
  AlertTriangle,
  X,
  Clock,
  Copy,
  MapPin,
  Phone,
  User,
  CreditCard,
  ArrowRight,
  ChevronRight,
  KeyRound,
  Mail,
  Info,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase, isSupabaseConfigured, validateSupabaseConfig } from "@/lib/supabase";
import { formatINR, categories as defaultCategories } from "@/data/products";
import { BRAND_FALLBACK_IMAGE, resolveOrderItemImage } from "@/lib/catalogApi";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Staff & Admin Portal — Shipt" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

interface AdminOrderItem {
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

interface AdminOrderStatusHistory {
  id: string;
  order_id?: string;
  previous_status?: string | null;
  new_status: string;
  notes?: string | null;
  created_at: string;
}

interface AdminOrder {
  id: string;
  order_number: string;
  user_id?: string | null;
  // NOTE: guest_tracking_token is intentionally excluded to prevent accidental exposure in admin logs/views
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

interface AdminBanner {
  id: string;
  title: string;
  description: string;
  image_url: string;
  button_text?: string | null;
  button_url?: string | null;
  destination_type?: string | null;
  is_active: boolean;
  display_order: number;
  start_at?: string | null;
  end_at?: string | null;
}

interface DBProduct {
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

interface AdminRoleUser {
  user_id: string;
  email: string;
  full_name?: string;
  role: string;
  created_at: string;
}

export function AdminPage() {
  const { refreshCatalog } = useStore();
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminRole, setAdminRole] = useState<"super_admin" | "store_manager" | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Active dashboard tab: 'orders' | 'products' | 'banners' | 'roles'
  const [activeTab, setActiveTab] = useState<"orders" | "products" | "banners" | "roles">("orders");

  // Orders state
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderFilter, setOrderFilter] = useState("all");
  const [selectedAdminOrder, setSelectedAdminOrder] = useState<AdminOrder | null>(null);
  const [statusUpdateNotes, setStatusUpdateNotes] = useState("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string>("");
  const [copiedRef, setCopiedRef] = useState(false);

  // Products & Stock state
  const [dbProducts, setDbProducts] = useState<DBProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productViewMode, setProductViewMode] = useState<"grid" | "list">("grid");
  const [productSearch, setProductSearch] = useState("");
  const [productCategoryFilter, setProductCategoryFilter] = useState("all");
  const [productStockFilter, setProductStockFilter] = useState<"all" | "in_stock" | "low_stock" | "out_of_stock">("all");

  // Product Add / Edit modal state
  const [editingProduct, setEditingProduct] = useState<DBProduct | null>(null);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [productForm, setProductForm] = useState({
    name: "",
    size: "",
    description: "",
    category_id: "snacks",
    price: "",
    original_price: "",
    stock: "10",
    image_url: "",
    is_active: true,
  });
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);

  // Banners state
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [bannersLoading, setBannersLoading] = useState(false);
  const [editingBanner, setEditingBanner] = useState<AdminBanner | null>(null);
  const [newBanner, setNewBanner] = useState({
    title: "",
    description: "",
    image_url: "",
    button_text: "Shop Now",
    destination_type: "category",
    button_url: "#category-snacks",
    display_order: 1,
    is_active: true,
  });
  const [uploadingBannerImage, setUploadingBannerImage] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // Staff Roles state (Super Admin only)
  const [rolesList, setRolesList] = useState<AdminRoleUser[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesRpcPending, setRolesRpcPending] = useState(false);
  const [sendingPasswordResetEmail, setSendingPasswordResetEmail] = useState<string | null>(null);
  const [newRoleEmail, setNewRoleEmail] = useState("");
  const [newRoleType, setNewRoleType] = useState<"store_manager" | "super_admin">("store_manager");
  const [assigningRole, setAssigningRole] = useState(false);

  // Direct Staff Account Creation (Edge Function)
  const [createStaffName, setCreateStaffName] = useState("");
  const [createStaffEmail, setCreateStaffEmail] = useState("");
  const [createStaffRole, setCreateStaffRole] = useState<"store_manager" | "super_admin">("store_manager");
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [createStaffSuccess, setCreateStaffSuccess] = useState<string | null>(null);
  const [createStaffError, setCreateStaffError] = useState<string | null>(null);
  const [existingAccountConflict, setExistingAccountConflict] = useState<{
    email: string;
    role: "store_manager" | "super_admin";
  } | null>(null);

  // Check auth and admin permissions
  const checkAuth = useCallback(async () => {
    setAuthLoading(true);

    if (!isSupabaseConfigured) {
      setIsAdmin(false);
      setAuthLoading(false);
      return;
    }

    try {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();
      setSession(currentSession);

      if (!currentSession) {
        setIsAdmin(false);
        setAdminRole(null);
        setAuthLoading(false);
        return;
      }

      // Check admin status via is_admin RPC
      const { data: adminStatus } = await supabase.rpc("is_admin");
      if (!adminStatus) {
        setIsAdmin(false);
        setAdminRole(null);
        setAuthLoading(false);
        return;
      }

      setIsAdmin(true);

      // Check specific role via get_admin_role RPC or direct table query
      try {
        const { data: roleVal } = await supabase.rpc("get_admin_role");
        if (roleVal === "super_admin" || roleVal === "store_manager") {
          setAdminRole(roleVal);
        } else {
          // Fallback check on admin_roles table
          const { data: roleRows } = await supabase
            .from("admin_roles")
            .select("role")
            .eq("user_id", currentSession.user.id);
          if (roleRows && roleRows.some((r: any) => r.role === "super_admin")) {
            setAdminRole("super_admin");
          } else {
            setAdminRole("store_manager");
          }
        }
      } catch {
        setAdminRole("store_manager");
      }
    } catch {
      setIsAdmin(false);
      setAdminRole(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Load orders
  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id,
          order_number,
          user_id,
          customer_name,
          customer_phone,
          delivery_method,
          hostel,
          block,
          room,
          pickup_location,
          delivery_instructions,
          status,
          subtotal,
          delivery_fee,
          discount_amount,
          total_amount,
          payment_method,
          payment_status,
          created_at,
          updated_at,
          order_items(
            id,
            product_id,
            product_name,
            product_size,
            unit_price,
            quantity,
            total_price,
            products(image_url)
          ),
          order_status_history(
            id,
            previous_status,
            new_status,
            notes,
            created_at
          )
        `)
        .order("created_at", { ascending: false });

      if (!error && data) {
        const typedOrders = data as unknown as AdminOrder[];
        setOrders(typedOrders);
        return typedOrders;
      }
      return null;
    } catch {
      return null;
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  // Load products from Supabase
  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("name", { ascending: true });

      if (!error && data) {
        setDbProducts(data as DBProduct[]);
      }
    } catch {
      // Keep existing
    } finally {
      setProductsLoading(false);
    }
  }, []);

  // Load banners
  const loadBanners = useCallback(async () => {
    setBannersLoading(true);
    try {
      const { data, error } = await supabase
        .from("banners")
        .select("*")
        .order("display_order", { ascending: true });

      if (!error && data) {
        setBanners(data as AdminBanner[]);
      }
    } catch {
      // Keep existing
    } finally {
      setBannersLoading(false);
    }
  }, []);

  // Load staff roles (Super Admin)
  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_list_roles");
      if (!error && data) {
        setRolesList(data as AdminRoleUser[]);
        setRolesRpcPending(false);
      } else {
        if (error && (error.code === "PGRST202" || error.message?.includes("schema cache"))) {
          setRolesRpcPending(true);
        }

        // Fallback: direct table query if RPC not yet applied
        const { data: directData } = await supabase
          .from("admin_roles")
          .select("user_id, role, created_at");
        if (directData) {
          const { data: { session: curSess } } = await supabase.auth.getSession();
          const mapped = directData.map((d: any) => {
            const isMe = curSess?.user?.id === d.user_id;
            return {
              user_id: d.user_id,
              email: isMe && curSess?.user?.email ? curSess.user.email : d.user_id,
              ...(isMe ? { full_name: "Current Super Admin" } : {}),
              role: d.role,
              created_at: d.created_at,
            };
          });
          setRolesList(mapped);
        }
      }
    } catch {
      // Non-blocking
    } finally {
      setRolesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadOrders();
      loadProducts();
      if (adminRole === "super_admin") {
        loadBanners();
        loadRoles();
      }
    }
  }, [isAdmin, adminRole, loadOrders, loadProducts, loadBanners, loadRoles]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    if (!isSupabaseConfigured) {
      const { missing } = validateSupabaseConfig();
      setLoginError(
        `Supabase authentication is not configured in this deployment (missing ${missing.join(
          ", "
        )}). Please configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your Vercel Project Settings.`
      );
      setIsLoggingIn(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: password.trim(),
      });

      if (error) {
        if (error.message?.toLowerCase().includes("invalid login credentials")) {
          setLoginError(
            "Invalid email or password. If you are newly invited staff, please check your inbox for the invitation email to activate your account, or visit /accept-invitation to set your password."
          );
        } else {
          setLoginError(error.message);
        }
        setIsLoggingIn(false);
        return;
      }

      setSession(data.session);

      // Verify admin authorization
      const { data: adminStatus } = await supabase.rpc("is_admin");
      if (!adminStatus) {
        await supabase.auth.signOut();
        setSession(null);
        setIsAdmin(false);
        setAdminRole(null);
        setLoginError(
          "Access Denied: This account is authenticated but does not have administrator or staff privileges. Please sign in with an authorized administrator account."
        );
      } else {
        setIsAdmin(true);
        await checkAuth();
      }
    } catch (err: any) {
      const message = err?.message || "Failed to sign in";
      if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
        setLoginError(
          "Network error: Unable to connect to Supabase auth server. Please check your internet connection or verify the Supabase project URL."
        );
      } else {
        setLoginError(message);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setIsAdmin(false);
    setAdminRole(null);
  };

  const updateOrderStatus = async (orderId: string, newStatus: string, notes?: string) => {
    if (!orderId || !newStatus) return;
    setIsUpdatingStatus(true);
    try {
      const defaultNotes =
        notes?.trim() ||
        `Status changed to ${newStatus.replace(/_/g, " ")} by ${
          adminRole === "super_admin" ? "Super Admin" : "Store Manager"
        }`;

      const { error } = await supabase.rpc("admin_update_order_status", {
        p_order_id: orderId,
        p_new_status: newStatus,
        p_notes: defaultNotes,
      });

      if (error) {
        toast.error(`Failed to update status: ${error.message}`);
        return;
      }

      toast.success(`Order status updated to ${newStatus.replace(/_/g, " ")}`);
      setStatusUpdateNotes("");

      // Reload orders and update the open modal view with fresh DB record
      const freshOrders = await loadOrders();
      if (freshOrders) {
        const fresh = freshOrders.find((o) => o.id === orderId);
        if (fresh) {
          setSelectedAdminOrder(fresh);
          setTargetStatus(fresh.status);
        }
      }
      loadProducts(); // Stock may have restocked on cancellation
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // ==========================================
  // INVENTORY PRODUCT UPLOAD & EDIT ACTIONS
  // ==========================================
  const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validMimes = ["image/jpeg", "image/png", "image/webp"];
    if (!validMimes.includes(file.type)) {
      toast.error("Invalid format: Only JPG, PNG, and WebP images are permitted.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large: Maximum product image size is 5 MB.");
      return;
    }

    setUploadingProductImage(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `products/prod-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("posters")
        .upload(fileName, file, { upsert: true });

      if (uploadError) {
        toast.error(`Storage upload failed: ${uploadError.message}`);
        setUploadingProductImage(false);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("posters").getPublicUrl(fileName);

      setProductForm((prev) => ({ ...prev, image_url: publicUrl }));
      toast.success("Product image uploaded to storage!");
    } catch (err: any) {
      toast.error(`Upload error: ${err?.message}`);
    } finally {
      setUploadingProductImage(false);
    }
  };

  const openCreateProduct = () => {
    setEditingProduct(null);
    setProductForm({
      name: "",
      size: "",
      description: "",
      category_id: "snacks",
      price: "",
      original_price: "",
      stock: "10",
      image_url: "",
      is_active: true,
    });
    setIsCreatingProduct(true);
  };

  const openEditProduct = (prod: DBProduct) => {
    setIsCreatingProduct(false);
    setEditingProduct(prod);
    setProductForm({
      name: prod.name,
      size: prod.size,
      description: prod.description || "",
      category_id: prod.category_id,
      price: String(prod.price),
      original_price: prod.original_price != null ? String(prod.original_price) : "",
      stock: String(prod.stock),
      image_url: prod.image_url || "",
      is_active: prod.is_active,
    });
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productForm.name.trim() || !productForm.size.trim()) {
      toast.error("Product name and size/quantity are required.");
      return;
    }

    const priceNum = Number(productForm.price);
    const stockNum = parseInt(productForm.stock, 10);

    if (isNaN(priceNum) || priceNum < 0) {
      toast.error("Please enter a valid price (>= 0).");
      return;
    }

    if (isNaN(stockNum) || stockNum < 0) {
      toast.error("Please enter a valid stock quantity (>= 0).");
      return;
    }

    const origPriceNum = productForm.original_price.trim() ? Number(productForm.original_price) : null;
    if (origPriceNum != null && (isNaN(origPriceNum) || origPriceNum < priceNum)) {
      toast.error("Original price must be greater than or equal to current price.");
      return;
    }

    setSavingProduct(true);
    try {
      const payload = {
        name: productForm.name.trim(),
        size: productForm.size.trim(),
        description: productForm.description.trim(),
        category_id: productForm.category_id,
        price: priceNum,
        original_price: origPriceNum,
        stock: stockNum,
        image_url: productForm.image_url.trim() || "https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-notebook.jpg",
        is_active: productForm.is_active,
      };

      if (editingProduct) {
        const { error } = await supabase
          .from("products")
          .update(payload)
          .eq("id", editingProduct.id);

        if (error) {
          toast.error(`Failed to update product: ${error.message}`);
          setSavingProduct(false);
          return;
        }

        toast.success(`Updated ${payload.name} successfully!`);
      } else {
        const slug = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        const { error } = await supabase
          .from("products")
          .insert([{ ...payload, slug: `${slug}-${Date.now().toString().slice(-4)}` }]);

        if (error) {
          toast.error(`Failed to create product: ${error.message}`);
          setSavingProduct(false);
          return;
        }

        toast.success(`Product ${payload.name} created!`);
      }

      setEditingProduct(null);
      setIsCreatingProduct(false);
      await loadProducts();
      await refreshCatalog();
    } catch (err: any) {
      toast.error(`Save error: ${err?.message}`);
    } finally {
      setSavingProduct(false);
    }
  };

  // ==========================================
  // BANNER MANAGEMENT ACTIONS (SUPER ADMIN)
  // ==========================================
  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validMimes = ["image/jpeg", "image/png", "image/webp"];
    if (!validMimes.includes(file.type)) {
      toast.error("Only JPG, PNG, and WebP images are permitted.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large: Maximum banner image size is 5 MB.");
      return;
    }

    setUploadingBannerImage(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `banners/banner-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("posters")
        .upload(fileName, file, { upsert: true });

      if (uploadError) {
        toast.error(`Upload failed: ${uploadError.message}`);
        setUploadingBannerImage(false);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("posters").getPublicUrl(fileName);

      setNewBanner((prev) => ({ ...prev, image_url: publicUrl }));
      toast.success("Banner image uploaded successfully!");
    } catch (err: any) {
      toast.error(`Upload error: ${err?.message}`);
    } finally {
      setUploadingBannerImage(false);
    }
  };

  const openEditBanner = (b: AdminBanner) => {
    setEditingBanner(b);
    let inferredType = "internal";
    const url = b.button_url || "";
    if (url.startsWith("http://") || url.startsWith("https://")) inferredType = "external";
    else if (url.startsWith("#category-") || url.startsWith("#categories")) inferredType = "category";
    else if (url.startsWith("#product-") || url.startsWith("/product/")) inferredType = "product";

    setNewBanner({
      title: b.title || "",
      description: b.description || "",
      image_url: b.image_url || "",
      button_text: b.button_text || "Shop Now",
      destination_type: inferredType,
      button_url: b.button_url || "#category-snacks",
      display_order: b.display_order || 1,
      is_active: b.is_active,
    });
    document.getElementById("banner-form-card")?.scrollIntoView({ behavior: "smooth" });
  };

  const handleCancelEditBanner = () => {
    setEditingBanner(null);
    setNewBanner({
      title: "",
      description: "",
      image_url: "",
      button_text: "Shop Now",
      destination_type: "category",
      button_url: "#category-snacks",
      display_order: banners.length + 1,
      is_active: true,
    });
  };

  const handleSaveBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBanner.image_url.trim()) {
      toast.error("A wide promotional image is required.");
      return;
    }

    const payload = {
      title: newBanner.title.trim() || null,
      description: newBanner.description.trim() || null,
      image_url: newBanner.image_url.trim(),
      button_text: newBanner.button_text?.trim() || null,
      button_url: newBanner.button_url?.trim() || null,
      display_order: newBanner.display_order,
      is_active: newBanner.is_active,
    };

    try {
      if (editingBanner) {
        const { error } = await supabase
          .from("banners")
          .update(payload)
          .eq("id", editingBanner.id);

        if (error) {
          toast.error(`Error updating banner: ${error.message}`);
          return;
        }
        toast.success("Promotional banner updated successfully!");
        setEditingBanner(null);
      } else {
        const { error } = await supabase.from("banners").insert([payload]);
        if (error) {
          toast.error(`Error saving banner: ${error.message}`);
          return;
        }
        toast.success("Promotional banner saved and published!");
      }

      setNewBanner({
        title: "",
        description: "",
        image_url: "",
        button_text: "Shop Now",
        destination_type: "category",
        button_url: "#category-snacks",
        display_order: banners.length + 1,
        is_active: true,
      });
      loadBanners();
    } catch (err: any) {
      toast.error(`Failed to save banner: ${err?.message}`);
    }
  };

  const handleDeleteBanner = async (id: string) => {
    if (!confirm("Are you sure you want to delete this promotional banner?")) return;

    try {
      const { error } = await supabase.from("banners").delete().eq("id", id);
      if (error) {
        toast.error(`Failed to delete banner: ${error.message}`);
        return;
      }
      toast.success("Banner deleted.");
      loadBanners();
    } catch (err: any) {
      toast.error(`Error deleting banner: ${err?.message}`);
    }
  };

  const toggleBannerActive = async (id: string, current: boolean) => {
    try {
      const { error } = await supabase
        .from("banners")
        .update({ is_active: !current })
        .eq("id", id);
      if (error) {
        toast.error(`Failed to update banner: ${error.message}`);
        return;
      }
      loadBanners();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    }
  };

  // ==========================================
  // STAFF CREATION & ROLE MANAGEMENT (SUPER ADMIN)
  // ==========================================
  const handleCreateStaffAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = createStaffEmail.trim().toLowerCase();
    const cleanName = createStaffName.trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      toast.error("Please enter a valid staff email address.");
      return;
    }

    setCreatingStaff(true);
    setCreateStaffError(null);
    setCreateStaffSuccess(null);
    setExistingAccountConflict(null);

    try {
      const isLocalhost =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      const redirectOrigin = isLocalhost ? window.location.origin : "https://shiptmart.vercel.app";
      const redirectUrl = `${redirectOrigin}/accept-invitation`;
      const { data, error } = await supabase.functions.invoke("admin-create-staff", {
        body: {
          email: cleanEmail,
          fullName: cleanName,
          name: cleanName,
          full_name: cleanName,
          role: createStaffRole,
          redirectTo: redirectUrl,
        },
      });

      if (error) {
        let errorMsg = error.message;
        let isConflict = false;
        let isRateLimit = false;

        try {
          if ((error as any).context && typeof (error as any).context.json === "function") {
            const errBody = await (error as any).context.json();
            if (errBody?.alreadyExists) {
              isConflict = true;
            }
            if (errBody?.isRateLimit) {
              isRateLimit = true;
            }
            if (errBody?.error) {
              errorMsg = errBody.error;
            }
          }
        } catch {
          // ignore parsing error
        }

        if (
          isConflict ||
          errorMsg.toLowerCase().includes("already registered") ||
          errorMsg.toLowerCase().includes("already exists")
        ) {
          setExistingAccountConflict({ email: cleanEmail, role: createStaffRole });
          setCreateStaffError(
            `Account already exists: "${cleanEmail}" is already registered. You can directly assign them the ${createStaffRole.replace("_", " ")} role below.`
          );
          toast.info(`"${cleanEmail}" already has an account. Click "Assign Role to Existing Account" to grant staff access.`);
        } else if (
          isRateLimit ||
          errorMsg.toLowerCase().includes("rate limit") ||
          errorMsg.toLowerCase().includes("over_email_send_rate_limit")
        ) {
          setCreateStaffError(
            "Supabase email delivery rate limit reached (3-4 emails/hr on default Supabase SMTP). Please wait a short while or configure custom SMTP in your Supabase Dashboard."
          );
          toast.error("Email delivery rate limit reached. Please wait or set up custom SMTP.", {
            duration: 8000,
          });
        } else if (
          errorMsg.includes("Failed to send a request") ||
          errorMsg.includes("FunctionsFetchError") ||
          errorMsg.includes("404")
        ) {
          setCreateStaffError(
            "Edge Function Pending Deployment: 'admin-create-staff' is not yet deployed to your remote Supabase project. Deploy the Edge Function using the Supabase CLI/Dashboard or use 'Assign Staff Role' below for registered users."
          );
          toast.error("Edge Function not yet deployed remotely.");
        } else {
          setCreateStaffError(errorMsg);
          toast.error(`Staff account creation failed: ${errorMsg}`);
        }
      } else if (data?.alreadyExists) {
        setExistingAccountConflict({ email: cleanEmail, role: createStaffRole });
        setCreateStaffError(data.error || "User already exists.");
        toast.info(data.message || "User already registered. Use role assignment.");
      } else {
        toast.success(data?.message || `Staff account created! Invitation sent to ${cleanEmail}.`, {
          duration: 6000,
        });
        setCreateStaffSuccess(
          `Successfully created staff account for ${cleanEmail} (${createStaffRole.replace("_", " ")}). An official invitation email has been sent!`
        );
        setCreateStaffEmail("");
        setCreateStaffName("");
        loadRoles();
      }
    } catch (err: any) {
      setCreateStaffError(err?.message || "Failed to invoke staff creation function.");
      toast.error(`Error: ${err?.message}`);
    } finally {
      setCreatingStaff(false);
    }
  };

  const handleAssignExistingAfterConflict = async (targetEmail: string, targetRole: "store_manager" | "super_admin") => {
    setAssigningRole(true);
    try {
      const { error } = await supabase.rpc("admin_assign_role", {
        p_email: targetEmail,
        p_role: targetRole,
      });

      if (error) {
        toast.error(`Role assignment failed: ${error.message}`);
      } else {
        toast.success(`Assigned ${targetRole.replace("_", " ")} role to existing account ${targetEmail}!`);
        setExistingAccountConflict(null);
        setCreateStaffError(null);
        setCreateStaffSuccess(`Successfully assigned ${targetRole.replace("_", " ")} to ${targetEmail}.`);
        loadRoles();
      }
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    } finally {
      setAssigningRole(false);
    }
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = newRoleEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      toast.error("Please enter a valid user email address.");
      return;
    }

    setAssigningRole(true);
    try {
      const { error } = await supabase.rpc("admin_assign_role", {
        p_email: cleanEmail,
        p_role: newRoleType,
      });

      if (error) {
        if (error.code === "PGRST202" || error.message?.includes("schema cache")) {
          setRolesRpcPending(true);
          toast.error("Database Migration Pending: The admin_assign_role function is not in the schema cache. Please execute migration 20261014010000_role_based_administration.sql in your Supabase SQL Editor.", {
            duration: 8000,
          });
        } else if (error.message?.includes("No user found")) {
          toast.error(`Staff user not found: ${error.message}`, {
            description: "The staff member must first register an account at /account or be invited via the Supabase Dashboard.",
            duration: 8000,
          });
        } else if (error.message?.includes("Access Denied")) {
          toast.error("Permission Denied: Only authorized Super Administrators can assign staff roles.");
        } else {
          toast.error(`Role assignment failed: ${error.message}`);
        }
      } else {
        toast.success(`Assigned ${newRoleType.replace("_", " ")} to ${cleanEmail}`);
        setNewRoleEmail("");
        loadRoles();
      }
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    } finally {
      setAssigningRole(false);
    }
  };

  const handleSendStaffPasswordSetup = async (targetEmail: string) => {
    const clean = targetEmail.trim().toLowerCase();
    if (!clean || !clean.includes("@")) {
      toast.error("Valid staff email address is required.");
      return;
    }
    setSendingPasswordResetEmail(clean);
    try {
      const isLocalhost =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      const redirectOrigin = isLocalhost ? window.location.origin : "https://shiptmart.vercel.app";
      const redirectUrl = `${redirectOrigin}/accept-invitation`;
      const { error } = await supabase.auth.resetPasswordForEmail(clean, {
        redirectTo: redirectUrl,
      });
      if (error) {
        if (error.message?.toLowerCase().includes("rate limit") || (error as any).status === 429) {
          toast.error("Email Rate Limit: Supabase default email limits sending to 3-4 emails/hr. Please wait a short while or configure custom SMTP in your Supabase Dashboard.", {
            duration: 8000,
          });
        } else {
          toast.error(`Failed to send password setup email: ${error.message}`);
        }
      } else {
        toast.success(`Password setup email sent to ${clean}! They can click the link in their inbox to set their private password.`, {
          duration: 6000,
        });
      }
    } catch (err: any) {
      toast.error(`Error: ${err?.message || "Failed to send password setup link."}`);
    } finally {
      setSendingPasswordResetEmail(null);
    }
  };

  const handleRevokeRole = async (userId: string, role: string) => {
    if (!confirm(`Are you sure you want to revoke the ${role} role from this user?`)) return;

    try {
      const { error } = await supabase.rpc("admin_revoke_role", {
        p_user_id: userId,
        p_role: role,
      });

      if (error) {
        toast.error(`Failed to revoke role: ${error.message}`);
      } else {
        toast.success("Role revoked successfully.");
        loadRoles();
      }
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground">Verifying staff credentials...</p>
      </div>
    );
  }

  // Not logged in or not admin: Show Login Form
  if (!isAdmin) {
    return (
      <div className="container-page py-12 md:py-20 flex justify-center">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="size-7" />
          </div>

          <h1 className="mt-4 text-center font-display text-2xl font-bold tracking-tight text-foreground">
            Shipt Staff & Admin Portal
          </h1>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Sign in with authorized credentials to access inventory and store operations.
          </p>

          {loginError && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          {session && !isAdmin && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <div className="min-w-0">
                <p className="font-semibold truncate">Signed in as customer ({session.user?.email})</p>
                <p className="text-[11px] text-muted-foreground">Admin credentials required to view dashboard</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSignOut}
                className="h-8 shrink-0 text-xs font-bold"
              >
                Sign Out
              </Button>
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Staff Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@shipt.campus"
                className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
            </div>

            <Button type="submit" disabled={isLoggingIn} variant="hero" className="h-11 w-full font-bold">
              {isLoggingIn ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  <span>Verifying credentials...</span>
                </>
              ) : (
                <span>Sign In to Admin Portal</span>
              )}
            </Button>
          </form>

          <div className="mt-6 border-t border-border/60 pt-4 text-center">
            <p className="text-xs text-muted-foreground">
              Invited as staff?{" "}
              <Link
                to="/accept-invitation"
                className="font-semibold text-primary hover:underline"
              >
                Activate your staff account here
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Filtered orders
  const filteredOrders =
    orderFilter === "all" ? orders : orders.filter((o) => o.status === orderFilter);

  // Filtered products
  const filteredProducts = dbProducts.filter((p) => {
    if (productCategoryFilter !== "all" && p.category_id !== productCategoryFilter) return false;
    if (productStockFilter === "out_of_stock" && p.stock !== 0) return false;
    if (productStockFilter === "low_stock" && (p.stock === 0 || p.stock > 5)) return false;
    if (productStockFilter === "in_stock" && p.stock === 0) return false;
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      return p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q));
    }
    return true;
  });

  const lowStockCount = dbProducts.filter((p) => p.stock > 0 && p.stock <= 5).length;
  const outOfStockCount = dbProducts.filter((p) => p.stock === 0).length;

  return (
    <div className="container-page py-6 md:py-10">
      {/* Admin Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Shipt Administration
              </h1>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-bold uppercase",
                  adminRole === "super_admin"
                    ? "border-purple-500/40 text-purple-700 bg-purple-500/10"
                    : "border-blue-500/40 text-blue-700 bg-blue-500/10"
                )}
              >
                {adminRole === "super_admin" ? "Super Admin" : "Store Manager"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{session?.user?.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-9">
            <Link to="/">View Storefront</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={handleSignOut} className="h-9 gap-1.5 text-xs text-destructive">
            <LogOut className="size-3.5" />
            <span>Sign Out</span>
          </Button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="mt-6 flex gap-2 border-b border-border pb-2 overflow-x-auto [scrollbar-width:none]">
        <button
          type="button"
          onClick={() => setActiveTab("orders")}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shrink-0",
            activeTab === "orders"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <Package className="size-4" />
          <span>Orders ({orders.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("products")}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shrink-0",
            activeTab === "products"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <Layers className="size-4" />
          <span>Products & Stock ({dbProducts.length})</span>
        </button>

        {/* Super Admin Tabs */}
        {adminRole === "super_admin" && (
          <>
            <button
              type="button"
              onClick={() => setActiveTab("banners")}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shrink-0",
                activeTab === "banners"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <ImageIcon className="size-4" />
              <span>Promotional Banners ({banners.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("roles")}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shrink-0",
                activeTab === "roles"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Users className="size-4" />
              <span>Staff & Roles</span>
            </button>
          </>
        )}
      </div>

      {/* TAB 1: ORDERS MANAGEMENT */}
      {activeTab === "orders" && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Filter status:</span>
              <select
                value={orderFilter}
                onChange={(e) => setOrderFilter(e.target.value)}
                className="h-8 rounded-lg border border-input bg-card px-2.5 text-xs font-medium outline-none"
              >
                <option value="all">All statuses</option>
                <option value="placed">Placed</option>
                <option value="confirmed">Confirmed</option>
                <option value="preparing">Preparing</option>
                <option value="out_for_delivery">Out for delivery</option>
                <option value="ready_for_pickup">Ready for pickup</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <Button variant="outline" size="sm" onClick={loadOrders} className="h-8 gap-1 text-xs">
              <RefreshCw className={cn("size-3.5", ordersLoading && "animate-spin")} />
              <span>Refresh Orders</span>
            </Button>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
              No orders found matching the filter.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs transition hover:border-primary/40 hover:shadow-soft"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base font-extrabold text-foreground">{ord.order_number}</span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
                            ord.status === "completed"
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : ord.status === "cancelled"
                              ? "bg-destructive/10 text-destructive border border-destructive/20"
                              : "bg-warn/15 text-warn-foreground border border-warn/30"
                          )}
                        >
                          {ord.status.replace(/_/g, " ")}
                        </span>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {ord.user_id ? "Registered" : "Guest"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Placed on {new Date(ord.created_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="font-display text-base font-extrabold text-foreground">
                        {formatINR(ord.total_amount)}
                      </span>
                      <p className="text-[11px] uppercase font-semibold text-muted-foreground">
                        {ord.payment_method} · {ord.payment_status}
                      </p>
                    </div>
                  </div>

                  {/* Customer and Delivery Info */}
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div className="flex items-center gap-1.5">
                      <User className="size-3.5 text-primary shrink-0" />
                      <span className="text-muted-foreground">Customer:</span>
                      <strong className="text-foreground">{ord.customer_name}</strong>
                      <span className="text-muted-foreground">({ord.customer_phone})</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 text-primary shrink-0" />
                      <span className="text-muted-foreground">Delivery:</span>
                      <strong className="text-foreground">
                        {ord.delivery_method === "hostel_delivery"
                          ? `${ord.hostel || "Hostel"}${ord.block ? ` - ${ord.block}` : ""}${ord.room ? `, Rm ${ord.room}` : ""}`
                          : ord.pickup_location || "Campus Pickup"}
                      </strong>
                    </div>
                  </div>

                  {/* Line items thumbnail previews */}
                  {ord.order_items && ord.order_items.length > 0 && (
                    <div className="mt-4 space-y-2 border-t border-border/40 pt-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          Items ({ord.order_items.reduce((sum, item) => sum + item.quantity, 0)}):
                        </span>
                        <span className="text-[11px]">{ord.order_items.length} distinct {ord.order_items.length === 1 ? "product" : "products"}</span>
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        {ord.order_items.slice(0, 4).map((i) => {
                          const itemImg = resolveOrderItemImage(i);
                          return (
                            <div
                              key={i.id}
                              className="flex items-center gap-2 rounded-xl bg-secondary/30 p-1.5 pr-3 border border-border/50 text-xs"
                            >
                              <img
                                src={itemImg}
                                alt={i.product_name}
                                className="size-8 rounded-lg object-cover bg-muted shrink-0 border border-border/60"
                                onError={(e) => {
                                  e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                                }}
                              />
                              <div className="min-w-0 max-w-[140px]">
                                <p className="font-medium truncate text-[11px] text-foreground">{i.product_name}</p>
                                <p className="text-[10px] text-muted-foreground">Qty: {i.quantity} × {formatINR(i.unit_price)}</p>
                              </div>
                            </div>
                          );
                        })}
                        {ord.order_items.length > 4 && (
                          <div className="grid place-items-center rounded-xl bg-secondary/40 px-2.5 text-[11px] font-semibold text-muted-foreground border border-border/50">
                            +{ord.order_items.length - 4} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Order Actions Toolbar */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">Quick Status:</span>
                      <select
                        value={ord.status}
                        disabled={isUpdatingStatus}
                        onChange={(e) => updateOrderStatus(ord.id, e.target.value)}
                        className="h-8 rounded-lg border border-input bg-card px-2.5 text-xs font-semibold outline-none focus:border-primary"
                      >
                        <option value="placed">Placed</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="preparing">Preparing</option>
                        <option value="out_for_delivery">Out for delivery</option>
                        <option value="ready_for_pickup">Ready for pickup</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled" disabled={ord.status === "completed"}>
                          Cancelled (Restock)
                        </option>
                      </select>
                    </div>

                    <Button
                      type="button"
                      variant="hero"
                      size="sm"
                      onClick={() => {
                        setSelectedAdminOrder(ord);
                        setTargetStatus(ord.status);
                        setStatusUpdateNotes("");
                      }}
                      className="h-8 gap-1.5 text-xs font-bold"
                    >
                      <Eye className="size-3.5" />
                      <span>View Full Order Details</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* DEDICATED ADMIN ORDER DETAILS DIALOG */}
          <Dialog
            open={selectedAdminOrder !== null}
            onOpenChange={(open) => {
              if (!open) {
                setSelectedAdminOrder(null);
                setStatusUpdateNotes("");
              }
            }}
          >
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl p-6 sm:p-8">
              {selectedAdminOrder && (
                <div className="space-y-6">
                  <DialogHeader className="border-b border-border pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <DialogTitle className="font-mono text-xl font-extrabold text-foreground">
                            {selectedAdminOrder.order_number}
                          </DialogTitle>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(selectedAdminOrder.order_number);
                              setCopiedRef(true);
                              toast.success("Order reference copied");
                              setTimeout(() => setCopiedRef(false), 2000);
                            }}
                            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition"
                            title="Copy Order Reference"
                          >
                            {copiedRef ? <CheckCircle2 className="size-4 text-primary" /> : <Copy className="size-4" />}
                          </button>
                        </div>
                        <DialogDescription className="mt-1 text-xs text-muted-foreground">
                          Placed on {new Date(selectedAdminOrder.created_at).toLocaleString()} ·{" "}
                          <span className="font-semibold text-foreground">
                            {selectedAdminOrder.user_id ? "Registered Customer Account" : "Guest Checkout"}
                          </span>
                        </DialogDescription>
                      </div>

                      <Badge
                        variant="outline"
                        className={cn(
                          "px-3 py-1 text-xs font-bold uppercase",
                          selectedAdminOrder.status === "completed"
                            ? "bg-primary/10 text-primary border-primary/30"
                            : selectedAdminOrder.status === "cancelled"
                            ? "bg-destructive/10 text-destructive border-destructive/30"
                            : "bg-warn/15 text-warn-foreground border-warn/30"
                        )}
                      >
                        {selectedAdminOrder.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </DialogHeader>

                  {/* Customer & Delivery Summary */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-secondary/30 p-4 space-y-1.5 text-xs">
                      <div className="flex items-center gap-2 font-semibold text-foreground">
                        <User className="size-4 text-primary" />
                        <span>Customer Contact</span>
                      </div>
                      <p className="font-bold text-sm text-foreground">{selectedAdminOrder.customer_name}</p>
                      <p className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="size-3.5" />
                        <a href={`tel:${selectedAdminOrder.customer_phone}`} className="underline hover:text-primary font-medium">
                          {selectedAdminOrder.customer_phone}
                        </a>
                      </p>
                    </div>

                    <div className="rounded-2xl border border-border bg-secondary/30 p-4 space-y-1.5 text-xs">
                      <div className="flex items-center gap-2 font-semibold text-foreground">
                        <MapPin className="size-4 text-primary" />
                        <span>
                          {selectedAdminOrder.delivery_method === "hostel_delivery"
                            ? "Hostel Delivery"
                            : "Campus Pickup"}
                        </span>
                      </div>
                      <p className="font-bold text-sm text-foreground">
                        {selectedAdminOrder.delivery_method === "hostel_delivery"
                          ? `${selectedAdminOrder.hostel || "Campus Hostel"}${
                              selectedAdminOrder.block ? `, Block ${selectedAdminOrder.block}` : ""
                            }${selectedAdminOrder.room ? `, Room ${selectedAdminOrder.room}` : ""}`
                          : selectedAdminOrder.pickup_location || "Store Counter"}
                      </p>
                      {selectedAdminOrder.delivery_instructions && (
                        <p className="rounded-lg bg-card/80 p-2 text-[11px] text-muted-foreground italic border border-border/40">
                          "{selectedAdminOrder.delivery_instructions}"
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Ordered Items Breakdown */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Ordered Items ({selectedAdminOrder.order_items?.length || 0})
                    </h4>
                    <div className="divide-y divide-border/60 rounded-2xl border border-border bg-card overflow-hidden">
                      {selectedAdminOrder.order_items?.map((item) => {
                        const itemImg = resolveOrderItemImage(item);
                        return (
                          <div key={item.id} className="flex items-center gap-3.5 p-3.5">
                            <img
                              src={itemImg}
                              alt={item.product_name}
                              className="size-14 rounded-xl object-cover bg-secondary/50 border border-border shrink-0"
                              onError={(e) => {
                                e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-xs text-foreground truncate">{item.product_name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {item.product_size && <span>{item.product_size} · </span>}
                                <span>{formatINR(item.unit_price)} each</span>
                              </p>
                              <p className="text-xs font-semibold text-foreground mt-0.5">Qty: {item.quantity}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-mono text-sm font-bold text-foreground">
                                {formatINR(item.total_price)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Payment & Financial Breakdown */}
                  <div className="rounded-2xl border border-border bg-card p-4 space-y-2 text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span>
                      <span className="font-mono font-medium">{formatINR(selectedAdminOrder.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Delivery Fee</span>
                      <span className="font-mono font-medium">
                        {(selectedAdminOrder.delivery_fee ?? 0) === 0 ? "Free" : formatINR(selectedAdminOrder.delivery_fee ?? 0)}
                      </span>
                    </div>
                    {(selectedAdminOrder.discount_amount ?? 0) > 0 && (
                      <div className="flex justify-between text-emerald-600 font-medium">
                        <span>Discount</span>
                        <span className="font-mono">-{formatINR(selectedAdminOrder.discount_amount ?? 0)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-border pt-2 text-sm font-bold text-foreground">
                      <span>Total Amount</span>
                      <span className="font-display font-extrabold text-base text-primary">
                        {formatINR(selectedAdminOrder.total_amount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                      <span className="capitalize">
                        Payment: <strong className="text-foreground uppercase">{selectedAdminOrder.payment_method}</strong>
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "capitalize text-[10px]",
                          selectedAdminOrder.payment_status === "completed"
                            ? "bg-primary/10 text-primary border-primary/30"
                            : selectedAdminOrder.payment_status === "failed"
                            ? "bg-destructive/10 text-destructive border-destructive/30"
                            : "bg-amber-500/10 text-amber-700 border-amber-500/30"
                        )}
                      >
                        Payment {selectedAdminOrder.payment_status}
                      </Badge>
                    </div>
                  </div>

                  {/* Status History Audit Trail */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Status Audit Trail ({1 + (selectedAdminOrder.order_status_history?.length || 0)} recorded events)
                    </h4>
                    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                      {/* Seed: Order Placed */}
                      <div className="flex items-start gap-3 text-xs">
                        <div className="mt-0.5 grid size-5 place-items-center rounded-full bg-primary/20 text-primary">
                          <CheckCircle2 className="size-3.5" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="font-semibold text-foreground">Order Placed</p>
                            <p className="text-[11px] text-muted-foreground">
                              {new Date(selectedAdminOrder.created_at).toLocaleString()}
                            </p>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Order was placed with payment status: {selectedAdminOrder.payment_status}.
                          </p>
                        </div>
                      </div>

                      {/* Recorded status history transitions */}
                      {selectedAdminOrder.order_status_history &&
                        [...selectedAdminOrder.order_status_history]
                          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                          .map((h) => (
                            <div key={h.id} className="flex items-start gap-3 text-xs border-t border-border/40 pt-2.5">
                              <div className="mt-0.5 grid size-5 place-items-center rounded-full bg-secondary text-primary">
                                <Clock className="size-3" />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <p className="font-semibold text-foreground capitalize">
                                    {h.new_status.replace(/_/g, " ")}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {new Date(h.created_at).toLocaleString()}
                                  </p>
                                </div>
                                {h.notes && <p className="text-[11px] text-muted-foreground mt-0.5">{h.notes}</p>}
                              </div>
                            </div>
                          ))}
                    </div>
                  </div>

                  {/* Safe Status Transition Controls */}
                  <div className="rounded-2xl border border-border bg-secondary/30 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-foreground">Update Order Status</h4>
                      <Badge variant="outline" className="text-[10px] uppercase font-bold text-primary border-primary/30">
                        Role: {adminRole === "super_admin" ? "Super Admin" : "Store Manager"}
                      </Badge>
                    </div>

                    {selectedAdminOrder.status === "cancelled" ? (
                      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                        <strong>Order is Cancelled:</strong> Inventory has already been restored to catalog stock. Status changes are locked.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                              Next Status
                            </label>
                            <select
                              value={targetStatus || selectedAdminOrder.status}
                              onChange={(e) => setTargetStatus(e.target.value)}
                              disabled={isUpdatingStatus}
                              className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-semibold outline-none focus:border-primary"
                            >
                              <option value="placed">Placed</option>
                              <option value="confirmed">Confirmed</option>
                              <option value="preparing">Preparing</option>
                              <option value="out_for_delivery">Out for delivery</option>
                              <option value="ready_for_pickup">Ready for pickup</option>
                              <option value="completed">Completed</option>
                              <option
                                value="cancelled"
                                disabled={selectedAdminOrder.status === "completed"}
                              >
                                Cancelled {selectedAdminOrder.status === "completed" ? "(Forbidden for completed orders)" : "(Restocks stock)"}
                              </option>
                            </select>
                          </div>

                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                              Staff Notes / Remarks
                            </label>
                            <input
                              type="text"
                              value={statusUpdateNotes}
                              onChange={(e) => setStatusUpdateNotes(e.target.value)}
                              placeholder="e.g. Dispatched with rider Salman"
                              className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                            >
                            </input>
                          </div>
                        </div>

                        {selectedAdminOrder.status === "completed" && (
                          <p className="text-[11px] text-amber-700">
                            Note: Completed orders cannot be cancelled directly. If an item was returned, handle via return/refund records.
                          </p>
                        )}

                        <div className="flex justify-end gap-2 pt-1">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setSelectedAdminOrder(null)}
                            className="h-9 text-xs"
                          >
                            Close
                          </Button>
                          <Button
                            type="button"
                            variant="hero"
                            disabled={isUpdatingStatus || targetStatus === selectedAdminOrder.status}
                            onClick={() =>
                              updateOrderStatus(
                                selectedAdminOrder.id,
                                targetStatus,
                                statusUpdateNotes
                              )
                            }
                            className="h-9 text-xs font-bold px-4"
                          >
                            {isUpdatingStatus ? (
                              <>
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                <span>Updating...</span>
                              </>
                            ) : (
                              <span>Apply Status Change</span>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* TAB 2: PRODUCTS & INVENTORY MANAGEMENT (REDESIGNED) */}
      {activeTab === "products" && (
        <div className="mt-6 space-y-6">
          {/* Header & Controls Toolbar */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="hero" onClick={openCreateProduct} className="h-9 gap-1.5 text-xs font-bold">
                <Plus className="size-4" />
                <span>Add New Product</span>
              </Button>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {outOfStockCount > 0 && (
                  <Badge variant="destructive" className="gap-1 text-xs">
                    <AlertTriangle className="size-3" />
                    <span>{outOfStockCount} Out of stock</span>
                  </Badge>
                )}
                {lowStockCount > 0 && (
                  <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/20 text-xs">
                    {lowStockCount} Low stock
                  </Badge>
                )}
              </div>
            </div>

            {/* View Mode & Refresh */}
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-xl border border-input bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => setProductViewMode("grid")}
                  className={cn(
                    "rounded-lg p-1.5 transition",
                    productViewMode === "grid" ? "bg-primary text-primary-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Grid View"
                >
                  <LayoutGrid className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setProductViewMode("list")}
                  className={cn(
                    "rounded-lg p-1.5 transition",
                    productViewMode === "list" ? "bg-primary text-primary-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground"
                  )}
                  title="List View"
                >
                  <List className="size-4" />
                </button>
              </div>

              <Button variant="outline" size="sm" onClick={loadProducts} className="h-9 gap-1 text-xs">
                <RefreshCw className={cn("size-3.5", productsLoading && "animate-spin")} />
                <span>Refresh</span>
              </Button>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search products by name or description..."
                className="h-10 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-xs outline-none focus:border-primary"
              />
            </div>

            <div>
              <select
                value={productCategoryFilter}
                onChange={(e) => setProductCategoryFilter(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
              >
                <option value="all">All Categories</option>
                {defaultCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={productStockFilter}
                onChange={(e) => setProductStockFilter(e.target.value as any)}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
              >
                <option value="all">All Stock Statuses</option>
                <option value="in_stock">In Stock (&gt; 5)</option>
                <option value="low_stock">Low Stock (1 - 5)</option>
                <option value="out_of_stock">Out of Stock (0)</option>
              </select>
            </div>
          </div>

          {/* Products Render: Grid vs List */}
          {filteredProducts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
              No products found matching your search and filter criteria.
            </div>
          ) : productViewMode === "grid" ? (
            /* GRID VIEW */
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {filteredProducts.map((p) => {
                const isOutOfStock = p.stock === 0;
                const isLowStock = p.stock > 0 && p.stock <= 5;

                return (
                  <div
                    key={p.id}
                    className="overflow-hidden rounded-3xl border border-border bg-card p-4 shadow-2xs transition hover:border-primary/40 flex flex-col justify-between"
                  >
                    <div>
                      {/* Product Image */}
                      <div className="relative h-40 w-full overflow-hidden rounded-2xl bg-muted border border-border/60">
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                          }}
                        />
                        <div className="absolute right-2 top-2 flex flex-col gap-1">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase backdrop-blur shadow-2xs",
                              isOutOfStock
                                ? "bg-destructive text-destructive-foreground"
                                : isLowStock
                                ? "bg-amber-500 text-white"
                                : "bg-primary text-primary-foreground"
                            )}
                          >
                            {isOutOfStock ? "Out of Stock" : `${p.stock} in stock`}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {p.category_id}
                        </span>
                        <h4 className="font-display text-sm font-bold text-foreground line-clamp-1">{p.name}</h4>
                        <p className="text-xs text-muted-foreground">{p.size}</p>
                        {p.description && (
                          <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{p.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                      <div>
                        <span className="font-mono text-sm font-extrabold text-foreground">
                          {formatINR(p.price)}
                        </span>
                        {p.original_price != null && p.original_price > p.price && (
                          <span className="ml-1 text-[11px] text-muted-foreground line-through">
                            {formatINR(p.original_price)}
                          </span>
                        )}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditProduct(p)}
                        className="h-8 gap-1.5 text-xs font-semibold"
                      >
                        <Edit3 className="size-3.5" />
                        <span>Edit</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* LIST VIEW */
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="p-3 font-semibold">Product</th>
                    <th className="p-3 font-semibold">Category</th>
                    <th className="p-3 font-semibold">Price</th>
                    <th className="p-3 font-semibold">Stock</th>
                    <th className="p-3 font-semibold">Status</th>
                    <th className="p-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredProducts.map((p) => {
                    const isOutOfStock = p.stock === 0;
                    const isLowStock = p.stock > 0 && p.stock <= 5;

                    return (
                      <tr key={p.id} className="hover:bg-secondary/20">
                        <td className="p-3 flex items-center gap-3">
                          <img
                            src={p.image_url}
                            alt=""
                            className="size-10 rounded-xl object-cover bg-muted border border-border/60"
                            onError={(e) => {
                              e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                            }}
                          />
                          <div>
                            <span className="font-semibold text-foreground block text-sm">{p.name}</span>
                            <span className="text-[11px] text-muted-foreground">{p.size}</span>
                          </div>
                        </td>
                        <td className="p-3 capitalize text-muted-foreground">{p.category_id}</td>
                        <td className="p-3 font-mono font-bold text-foreground">
                          {formatINR(p.price)}
                          {p.original_price != null && p.original_price > p.price && (
                            <span className="ml-1 text-[10px] text-muted-foreground line-through font-normal">
                              {formatINR(p.original_price)}
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <span
                            className={cn(
                              "rounded-md px-2 py-0.5 font-bold",
                              isOutOfStock
                                ? "bg-destructive/10 text-destructive"
                                : isLowStock
                                ? "bg-amber-500/15 text-amber-700"
                                : "bg-primary/10 text-primary"
                            )}
                          >
                            {p.stock} units
                          </span>
                        </td>
                        <td className="p-3">
                          {isOutOfStock ? (
                            <span className="text-destructive font-semibold">Out of stock</span>
                          ) : isLowStock ? (
                            <span className="text-amber-700 font-semibold">Low stock</span>
                          ) : (
                            <span className="text-primary font-semibold">Available</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openEditProduct(p)}
                            className="h-7 gap-1 text-xs"
                          >
                            <Edit3 className="size-3" />
                            <span>Edit</span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* CREATE / EDIT PRODUCT MODAL */}
          <Dialog
            open={isCreatingProduct || editingProduct !== null}
            onOpenChange={(open) => {
              if (!open) {
                setIsCreatingProduct(false);
                setEditingProduct(null);
              }
            }}
          >
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-3xl p-6 sm:p-8">
              <DialogHeader>
                <DialogTitle className="font-display text-xl font-bold">
                  {editingProduct ? `Edit ${editingProduct.name}` : "Create New Product"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Update product information, inventory stock, and upload real images directly to Supabase storage.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSaveProduct} className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={productForm.name}
                    onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                    placeholder="e.g. Spiral Notebook"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Size / Unit *</label>
                    <input
                      type="text"
                      required
                      value={productForm.size}
                      onChange={(e) => setProductForm({ ...productForm, size: e.target.value })}
                      placeholder="e.g. 120 g, Pack of 3"
                      className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Category *</label>
                    <select
                      value={productForm.category_id}
                      onChange={(e) => setProductForm({ ...productForm, category_id: e.target.value })}
                      className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                    >
                      {defaultCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Price (₹) *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      required
                      value={productForm.price}
                      onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                      placeholder="60"
                      className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Original Price (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={productForm.original_price}
                      onChange={(e) => setProductForm({ ...productForm, original_price: e.target.value })}
                      placeholder="Optional"
                      className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Stock *</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={productForm.stock}
                      onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                      placeholder="25"
                      className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">Description</label>
                  <textarea
                    rows={2}
                    value={productForm.description}
                    onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                    placeholder="Short product overview for the student customer..."
                    className="w-full rounded-xl border border-input bg-card p-2.5 text-xs outline-none focus:border-primary"
                  />
                </div>

                {/* Real Image Upload to Supabase Storage */}
                <div className="rounded-2xl border border-border/80 bg-secondary/30 p-3.5 space-y-2">
                  <label className="block text-xs font-semibold text-foreground">Product Image</label>
                  <div className="flex items-center gap-3">
                    <img
                      src={productForm.image_url || BRAND_FALLBACK_IMAGE}
                      alt="Preview"
                      className="size-14 rounded-xl object-cover bg-muted border border-border"
                      onError={(e) => {
                        e.currentTarget.src = BRAND_FALLBACK_IMAGE;
                      }}
                    />
                    <div className="flex-1">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleProductImageUpload}
                        disabled={uploadingProductImage}
                        className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-xl file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground hover:file:bg-primary/90"
                      />
                      {uploadingProductImage && (
                        <p className="text-[11px] text-primary animate-pulse mt-1">Uploading to Supabase Storage...</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="product-active"
                    checked={productForm.is_active}
                    onChange={(e) => setProductForm({ ...productForm, is_active: e.target.checked })}
                    className="size-4 rounded text-primary"
                  />
                  <label htmlFor="product-active" className="text-xs font-semibold text-foreground">
                    Active and visible in customer storefront
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsCreatingProduct(false);
                      setEditingProduct(null);
                    }}
                    className="h-10 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="hero" disabled={savingProduct} className="h-10 text-xs font-bold px-5">
                    {savingProduct ? <Loader2 className="size-4 animate-spin" /> : editingProduct ? "Save Changes" : "Create Product"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* TAB 3: PROMOTIONAL BANNERS MANAGEMENT (SUPER ADMIN ONLY) */}
      {activeTab === "banners" && adminRole === "super_admin" && (
        <div className="mt-6 space-y-8">
          {/* Create or Edit Banner Card */}
          <div id="banner-form-card" className="rounded-3xl border border-border bg-card p-5 sm:p-7 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-bold text-foreground">
                    {editingBanner ? "Edit Promotional Banner" : "Create Promotional Banner"}
                  </h2>
                  {editingBanner && (
                    <Badge variant="outline" className="border-primary/40 text-primary bg-primary/10 text-[10px]">
                      Editing Active
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Configure wide full-image promotional banners with custom destination routing across the campus store.
                </p>
              </div>

              {editingBanner && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancelEditBanner}
                  className="h-8 gap-1.5 text-xs"
                >
                  <X className="size-3.5" />
                  <span>Cancel Edit</span>
                </Button>
              )}
            </div>

            <form onSubmit={handleSaveBanner} className="mt-5 grid gap-5 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">Headline Title</label>
                  <input
                    type="text"
                    value={newBanner.title}
                    onChange={(e) => setNewBanner({ ...newBanner, title: e.target.value })}
                    placeholder="e.g. Exam Season Fuel (Optional if image has text)"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">Description</label>
                  <textarea
                    rows={2}
                    value={newBanner.description}
                    onChange={(e) => setNewBanner({ ...newBanner, description: e.target.value })}
                    placeholder="Crispy snacks and drinks delivered directly to your hostel room..."
                    className="w-full rounded-xl border border-input bg-card p-2.5 text-xs outline-none focus:border-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Button Text</label>
                    <input
                      type="text"
                      value={newBanner.button_text}
                      onChange={(e) => setNewBanner({ ...newBanner, button_text: e.target.value })}
                      placeholder="e.g. Shop Now"
                      className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Destination Type</label>
                    <select
                      value={newBanner.destination_type}
                      onChange={(e) => {
                        const type = e.target.value;
                        let defaultUrl = "#category-snacks";
                        if (type === "internal") defaultUrl = "/cart";
                        if (type === "external") defaultUrl = "https://";
                        if (type === "product") defaultUrl = "#product-";
                        setNewBanner({ ...newBanner, destination_type: type, button_url: defaultUrl });
                      }}
                      className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                    >
                      <option value="category">Category Filter</option>
                      <option value="product">Product Details</option>
                      <option value="internal">Internal Page (/cart, /checkout)</option>
                      <option value="external">External Website</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">Destination Target / Link *</label>
                  <input
                    type="text"
                    required
                    value={newBanner.button_url}
                    onChange={(e) => setNewBanner({ ...newBanner, button_url: e.target.value })}
                    placeholder="e.g. #category-snacks, /cart, or https://example.com"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                  />
                </div>

                {/* Upload or Replace Image Section */}
                <div className="rounded-2xl border border-border/80 bg-secondary/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-foreground">
                      {editingBanner ? "Replace Banner Image" : "Upload Banner Image *"}
                    </label>
                    {newBanner.image_url && (
                      <span className="text-[10px] text-primary font-semibold">Image loaded</span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleBannerUpload}
                    disabled={uploadingBannerImage}
                    className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground hover:file:bg-primary/90"
                  />
                  {uploadingBannerImage && <p className="text-xs text-primary animate-pulse">Uploading to Supabase Storage...</p>}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="banner-is-active"
                    checked={newBanner.is_active}
                    onChange={(e) => setNewBanner({ ...newBanner, is_active: e.target.checked })}
                    className="size-4 rounded text-primary"
                  />
                  <label htmlFor="banner-is-active" className="text-xs font-semibold text-foreground">
                    Active & visible in customer carousel
                  </label>
                </div>

                <div className="flex gap-2 pt-1">
                  {editingBanner && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCancelEditBanner}
                      className="h-10 text-xs"
                    >
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" variant="hero" className="h-10 flex-1 font-bold text-xs">
                    {editingBanner ? "Update Promotional Banner" : "Save & Publish Promotional Banner"}
                  </Button>
                </div>
              </div>

              {/* Real-time Wide Banner Preview */}
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Storefront Banner Preview:</span>
                <div className="relative h-44 w-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  {newBanner.image_url ? (
                    <img src={newBanner.image_url} alt="" className="h-full w-full object-cover object-center" />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-muted-foreground bg-muted">
                      Upload wide promotional image to preview
                    </div>
                  )}

                  {(newBanner.title || newBanner.description || newBanner.button_text) && (
                    <div className="absolute inset-y-0 left-0 z-10 flex items-center p-3 max-w-xs">
                      <div className="rounded-xl border border-white/20 bg-black/45 p-3 backdrop-blur-md text-white shadow-md">
                        <span className="text-[10px] font-bold text-lime">Campus Special</span>
                        {newBanner.title && (
                          <h4 className="font-display text-sm font-bold text-white mt-0.5 line-clamp-1">
                            {newBanner.title}
                          </h4>
                        )}
                        {newBanner.description && (
                          <p className="text-[11px] text-white/90 line-clamp-2 mt-0.5 leading-tight">
                            {newBanner.description}
                          </p>
                        )}
                        {newBanner.button_text && (
                          <span className="mt-2 inline-block rounded-md bg-lime px-2 py-0.5 text-[10px] font-bold text-lime-foreground">
                            {newBanner.button_text}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  The entire banner card will be clickable and link to <span className="font-mono text-foreground font-semibold">{newBanner.button_url || "..."}</span>
                </p>
              </div>
            </form>
          </div>

          {/* Existing Banners */}
          <div className="space-y-4">
            <h3 className="font-display text-base font-bold text-foreground">Existing Banners ({banners.length})</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {banners.map((b) => (
                <div key={b.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="relative h-36 w-full bg-muted">
                      <img src={b.image_url} alt="" className="h-full w-full object-cover object-center" />
                      <span
                        className={cn(
                          "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                          b.is_active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {b.is_active ? "Active" : "Disabled"}
                      </span>
                    </div>

                    <div className="p-4">
                      <h4 className="font-display text-sm font-bold text-foreground">{b.title || "Image Banner"}</h4>
                      {b.description && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{b.description}</p>
                      )}
                      <p className="mt-1 text-[11px] font-mono text-primary truncate">Link: {b.button_url}</p>
                    </div>
                  </div>

                  <div className="p-4 pt-0">
                    <div className="flex items-center justify-between border-t border-border/60 pt-3">
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditBanner(b)}
                          className="h-7 gap-1 text-xs font-semibold"
                        >
                          <Edit3 className="size-3" />
                          <span>Edit</span>
                        </Button>

                        <button
                          type="button"
                          onClick={() => toggleBannerActive(b.id, b.is_active)}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          {b.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteBanner(b.id)}
                        className="h-7 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5 mr-1" />
                        <span>Delete</span>
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: STAFF & ROLES MANAGEMENT (SUPER ADMIN ONLY) */}
      {activeTab === "roles" && adminRole === "super_admin" && (
        <div className="mt-6 space-y-6">
          {/* Migration Pending Notice */}
          {rolesRpcPending && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200 space-y-1.5 shadow-xs">
              <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                <span>Supabase Migration Pending Execution</span>
              </div>
              <p className="leading-relaxed">
                The role administration functions (<code>admin_assign_role</code>, <code>admin_list_roles</code>) have not yet been executed in your remote Supabase database.
                To enable staff email resolution and role assignments, run <code>supabase/migrations/20261014010000_role_based_administration.sql</code> in your Supabase SQL Editor.
              </p>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* 1. Direct Staff Account Creation Form */}
            <div className="rounded-3xl border border-primary/20 bg-card p-6 shadow-xs relative overflow-hidden">
              <div className="flex items-center gap-2">
                <UserPlus className="size-5 text-primary" />
                <h2 className="font-display text-lg font-bold text-foreground">Create Staff Account</h2>
                <Badge variant="outline" className="ml-auto text-[10px] font-bold border-primary/30 text-primary">
                  Direct Onboard
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                Directly onboard a new Store Manager or Super Admin without prior self-registration. An official invitation and secure password setup link will be emailed to them.
              </p>

              {createStaffSuccess && (
                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600 mt-0.5" />
                  <span className="leading-relaxed">{createStaffSuccess}</span>
                </div>
              )}

              {createStaffError && !existingAccountConflict && (
                <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{createStaffError}</span>
                </div>
              )}

              {existingAccountConflict && (
                <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                    <span>Existing User Account Detected</span>
                  </div>
                  <p className="leading-relaxed">
                    <strong>{existingAccountConflict.email}</strong> is already registered in Shipt Auth. To protect their account from being overwritten, assign their administrative role directly:
                  </p>
                  <Button
                    type="button"
                    variant="hero"
                    size="sm"
                    disabled={assigningRole}
                    onClick={() =>
                      handleAssignExistingAfterConflict(
                        existingAccountConflict.email,
                        existingAccountConflict.role
                      )
                    }
                    className="h-8 text-xs font-bold gap-1.5"
                  >
                    {assigningRole ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-3.5" />
                    )}
                    <span>
                      Assign {existingAccountConflict.role.replace("_", " ")} Role Now
                    </span>
                  </Button>
                </div>
              )}

              <form onSubmit={handleCreateStaffAccount} className="mt-5 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Staff Full Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={createStaffName}
                    onChange={(e) => setCreateStaffName(e.target.value)}
                    placeholder="e.g. Rahul Sharma or Priya Patel"
                    className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Personalizes the invitation email greeting (e.g. &quot;Hello Rahul Sharma,&quot;).
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Staff Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={createStaffEmail}
                    onChange={(e) => setCreateStaffEmail(e.target.value)}
                    placeholder="manager@shipt.campus or faculty@university.edu"
                    className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Role Permission Level *
                  </label>
                  <select
                    value={createStaffRole}
                    onChange={(e) => setCreateStaffRole(e.target.value as any)}
                    className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                  >
                    <option value="store_manager">Store Manager (Products, Stock, Orders)</option>
                    <option value="super_admin">Super Administrator (Full System & Role Access)</option>
                  </select>
                </div>

                <Button
                  type="submit"
                  variant="hero"
                  disabled={creatingStaff}
                  className="h-11 px-6 font-bold text-xs gap-1.5 w-full sm:w-auto"
                >
                  {creatingStaff ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      <span>Creating Staff Account...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="size-4" />
                      <span>Create Staff Account</span>
                    </>
                  )}
                </Button>
              </form>
            </div>

            {/* Right Column: Existing User Role Assignment & Setup Guide */}
            <div className="space-y-6">
              {/* 2. Assign Role to Already Registered Account */}
              <div className="rounded-3xl border border-border bg-card p-6 shadow-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-5 text-primary" />
                  <h3 className="font-display text-base font-bold text-foreground">
                    Assign Role to Existing Account
                  </h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Grant Store Manager or Super Administrator permissions to a user who already has a registered Shipt account.
                </p>

                <form onSubmit={handleAssignRole} className="mt-4 space-y-3.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Registered User Email *</label>
                    <input
                      type="email"
                      required
                      value={newRoleEmail}
                      onChange={(e) => setNewRoleEmail(e.target.value)}
                      placeholder="student@dhuniversity.edu"
                      className="h-10 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Role Level *</label>
                    <select
                      value={newRoleType}
                      onChange={(e) => setNewRoleType(e.target.value as any)}
                      className="h-10 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                    >
                      <option value="store_manager">Store Manager (Products, Stock, Orders)</option>
                      <option value="super_admin">Super Administrator (Full System & Role Access)</option>
                    </select>
                  </div>

                  <Button type="submit" variant="outline" disabled={assigningRole} className="h-10 px-5 font-bold text-xs">
                    {assigningRole ? <Loader2 className="size-4 animate-spin" /> : "Assign Staff Role"}
                  </Button>
                </form>
              </div>

              {/* 3. Staff Onboarding & Password Setup Guide */}
              <div className="rounded-3xl border border-border bg-card p-6 shadow-xs space-y-3.5">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-5 text-primary" />
                  <h3 className="font-display text-base font-bold text-foreground">Staff Onboarding & Password Guide</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  How newly created staff set their passwords and access the portal:
                </p>

                <div className="space-y-2.5 text-xs">
                  <div className="rounded-xl border border-border/70 bg-secondary/30 p-2.5 flex items-start gap-2.5">
                    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold mt-0.5">1</span>
                    <p className="text-muted-foreground">
                      <strong className="text-foreground">Official Invitation Email:</strong> The newly created staff member receives a secure invitation link from Supabase Auth.
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-secondary/30 p-2.5 flex items-start gap-2.5">
                    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold mt-0.5">2</span>
                    <p className="text-muted-foreground">
                      <strong className="text-foreground">Private Password Setup:</strong> Clicking the link opens <code className="text-primary font-mono font-semibold">/account</code>, where they choose their secure password.
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-secondary/30 p-2.5 flex items-start gap-2.5">
                    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground font-bold mt-0.5">3</span>
                    <p className="text-muted-foreground">
                      <strong className="text-foreground">Immediate Portal Access:</strong> Once saved, they log in at <code className="text-primary font-mono font-semibold">/admin</code> with their assigned role permissions.
                    </p>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/60">
                  <strong className="text-foreground">Resend Setup Link:</strong> You can resend a password setup email to any staff member using the "Send Password Link" button in the table below.
                </p>
              </div>
            </div>
          </div>

          {/* Current Staff List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-foreground">Current Staff & Administrators</h3>
              <Button variant="outline" size="sm" onClick={loadRoles} className="h-8 gap-1 text-xs">
                <RefreshCw className={cn("size-3", rolesLoading && "animate-spin")} />
                <span>Refresh</span>
              </Button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="p-3 font-semibold">Staff Member</th>
                    <th className="p-3 font-semibold">Assigned Role</th>
                    <th className="p-3 font-semibold">Date Added</th>
                    <th className="p-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rolesList.map((r) => (
                    <tr key={`${r.user_id}-${r.role}`} className="hover:bg-secondary/20">
                      <td className="p-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <div>
                            {r.full_name && (
                              <div className="font-semibold text-foreground">{r.full_name}</div>
                            )}
                            <div className="font-mono text-[11px] text-muted-foreground">{r.email || r.user_id}</div>
                          </div>
                          {r.user_id === session?.user?.id && (
                            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary shrink-0">
                              You
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize font-bold text-[11px]",
                            r.role === "super_admin"
                              ? "bg-purple-500/10 text-purple-700 border-purple-500/30"
                              : "bg-blue-500/10 text-blue-700 border-blue-500/30"
                          )}
                        >
                          {r.role.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString() : "Initial"}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {r.email && r.email.includes("@") && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={sendingPasswordResetEmail === r.email}
                              onClick={() => handleSendStaffPasswordSetup(r.email)}
                              className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                              title={`Send password setup email to ${r.email}`}
                            >
                              {sendingPasswordResetEmail === r.email ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Mail className="size-3" />
                              )}
                              <span>Send Password Link</span>
                            </Button>
                          )}

                          {r.user_id !== session?.user?.id && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevokeRole(r.user_id, r.role)}
                              className="h-7 text-xs text-destructive hover:bg-destructive/10"
                            >
                              <UserX className="size-3.5 mr-1" />
                              <span>Revoke</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
