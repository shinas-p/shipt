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
  LayoutDashboard,
  Sparkles,
  Building2,
  ScrollText,
  ShieldAlert,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase, isSupabaseConfigured, validateSupabaseConfig } from "@/lib/supabase";
import { formatINR, categories as defaultCategories } from "@/data/products";
import { BRAND_FALLBACK_IMAGE, resolveOrderItemImage } from "@/lib/catalogApi";
import { useStore } from "@/lib/store";
import { useBranding } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SmartDashboard } from "@/components/admin/SmartDashboard";
import { ProductManagementCenter } from "@/components/admin/products/ProductManagementCenter";
import { StoreBrandingTab } from "@/components/admin/StoreBrandingTab";
import { BlockManagementTab } from "@/components/admin/BlockManagementTab";
import type { DBCategory } from "@/components/admin/products/types";
import {
  AdminRole,
  canManageCatalog,
  canManageBanners,
  canManageRoles,
  canManageBlocks,
  canManageBranding,
  canViewAllOrders,
  canViewAuditLogs,
  canAccessOrder,
  getRoleBadge,
  ADMIN_ROLES_METADATA,
} from "@/lib/permissions";

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
  delivery_block_id?: string | null;
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
  claimed_by?: string | null;
  claimed_at?: string | null;
  processing_started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
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

interface DeliveryBlock {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
}

interface AdminAuditLog {
  id: string;
  actor_id: string | null;
  target_user_id: string | null;
  action: string;
  details: Record<string, any> | null;
  ip_address: string | null;
  created_at: string;
}

interface AdminRoleUser {
  user_id: string;
  email: string;
  full_name?: string;
  role: AdminRole;
  assigned_block?: string | null;
  created_at: string;
}

export function AdminPage() {
  const { refreshCatalog } = useStore();
  const { branding } = useBranding();
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [assignedBlock, setAssignedBlock] = useState<string | null>(null);
  const [availableBlocks, setAvailableBlocks] = useState<DeliveryBlock[]>([
    { id: "Block A", name: "Block A", is_active: true },
    { id: "Block B", name: "Block B", is_active: true },
    { id: "Block C", name: "Block C", is_active: true },
    { id: "Block D", name: "Block D", is_active: true },
    { id: "North Wing", name: "North Wing", is_active: true },
    { id: "South Wing", name: "South Wing", is_active: true },
    { id: "Main Campus", name: "Main Campus", is_active: true },
  ]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Login form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Active dashboard tab: 'dashboard' | 'orders' | 'products' | 'banners' | 'roles' | 'blocks' | 'branding'
  const [activeTab, setActiveTab] = useState<"dashboard" | "orders" | "products" | "banners" | "roles" | "blocks" | "branding">("dashboard");

  // Orders state
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderFilter, setOrderFilter] = useState("all");
  const [orderBlockFilter, setOrderBlockFilter] = useState("all");
  const [isClaimingOrder, setIsClaimingOrder] = useState<string | null>(null);
  const [selectedAdminOrder, setSelectedAdminOrder] = useState<AdminOrder | null>(null);
  const [statusUpdateNotes, setStatusUpdateNotes] = useState("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string>("");
  const [copiedRef, setCopiedRef] = useState(false);

  // Products, Categories & Stock state
  const [dbProducts, setDbProducts] = useState<DBProduct[]>([]);
  const [dbCategories, setDbCategories] = useState<DBCategory[]>(
    defaultCategories.map((c, i) => ({
      id: c.id,
      name: c.name,
      blurb: c.blurb,
      display_order: i + 1,
      is_active: true,
    }))
  );
  const [productCenterSubTab, setProductCenterSubTab] = useState<
    "catalog" | "categories" | "inventory" | "pricing" | "import_export" | "reports"
  >("catalog");
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
  const [newRoleType, setNewRoleType] = useState<AdminRole>("store_manager");
  const [newRoleBlock, setNewRoleBlock] = useState<string>("Block A");
  const [assigningRole, setAssigningRole] = useState(false);

  // Direct Staff Account Creation (Edge Function)
  const [createStaffName, setCreateStaffName] = useState("");
  const [createStaffEmail, setCreateStaffEmail] = useState("");
  const [createStaffRole, setCreateStaffRole] = useState<AdminRole>("store_manager");
  const [createStaffBlock, setCreateStaffBlock] = useState<string>("Block A");
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [createStaffSuccess, setCreateStaffSuccess] = useState<string | null>(null);
  const [createStaffError, setCreateStaffError] = useState<string | null>(null);
  const [existingAccountConflict, setExistingAccountConflict] = useState<{
    email: string;
    role: AdminRole;
    assignedBlock?: string | null;
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
        setAssignedBlock(null);
        setAuthLoading(false);
        return;
      }

      // Check admin status via is_admin RPC
      const { data: adminStatus } = await supabase.rpc("is_admin");
      if (!adminStatus) {
        setIsAdmin(false);
        setAdminRole(null);
        setAssignedBlock(null);
        setAuthLoading(false);
        return;
      }

      setIsAdmin(true);

      // Check specific role via get_admin_role RPC or direct table query
      const validRoles: AdminRole[] = ["super_admin", "owner", "store_manager", "block_manager"];
      let resolvedRole: AdminRole = "store_manager";

      try {
        const { data: roleVal } = await supabase.rpc("get_admin_role");
        if (roleVal && validRoles.includes(roleVal as AdminRole)) {
          resolvedRole = roleVal as AdminRole;
        } else {
          // Fallback check on admin_roles table
          const { data: roleRows } = await supabase
            .from("admin_roles")
            .select("role, assigned_block")
            .eq("user_id", currentSession.user.id);
          if (roleRows && roleRows.length > 0) {
            const priority: AdminRole[] = ["super_admin", "owner", "store_manager", "block_manager"];
            for (const p of priority) {
              const match = roleRows.find((r: any) => r.role === p);
              if (match) {
                resolvedRole = p;
                break;
              }
            }
          }
        }
      } catch {
        resolvedRole = "store_manager";
      }

      setAdminRole(resolvedRole);

      // If Block Manager, fetch assigned delivery block
      if (resolvedRole === "block_manager") {
        try {
          const { data: blockVal } = await supabase.rpc("get_assigned_block");
          if (blockVal) {
            setAssignedBlock(blockVal);
          } else {
            const { data: bRow } = await supabase
              .from("admin_roles")
              .select("assigned_block")
              .eq("user_id", currentSession.user.id)
              .eq("role", "block_manager")
              .maybeSingle();
            setAssignedBlock(bRow?.assigned_block || null);
          }
        } catch {
          setAssignedBlock(null);
        }
      } else {
        setAssignedBlock(null);
      }

      // Enforce route/tab access for resolved role
      setActiveTab((prevTab) => {
        if (resolvedRole === "block_manager" && prevTab !== "dashboard" && prevTab !== "orders") {
          return "dashboard";
        }
        if (!canManageCatalog(resolvedRole) && prevTab === "products") {
          return "dashboard";
        }
        if (!canManageBanners(resolvedRole) && prevTab === "banners") {
          return "dashboard";
        }
        if (!canManageRoles(resolvedRole) && prevTab === "roles") {
          return "dashboard";
        }
        if (!canManageBlocks(resolvedRole) && prevTab === "blocks") {
          return "dashboard";
        }
        if (!canManageBranding(resolvedRole) && prevTab === "branding") {
          return "dashboard";
        }
        return prevTab;
      });
    } catch {
      setIsAdmin(false);
      setAdminRole(null);
      setAssignedBlock(null);
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
          delivery_block_id,
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
          claimed_by,
          claimed_at,
          processing_started_at,
          completed_at,
          cancelled_at,
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

  // Load categories from Supabase
  const loadCategories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("display_order", { ascending: true });

      if (!error && data && data.length > 0) {
        setDbCategories(data as DBCategory[]);
      }
    } catch {
      // Keep existing defaultCategories
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

  // Load staff roles, delivery blocks & audit logs (Super Admin)
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
          .select("user_id, role, assigned_block, created_at");
        if (directData) {
          const { data: { session: curSess } } = await supabase.auth.getSession();
          const mapped = directData.map((d: any) => {
            const isMe = curSess?.user?.id === d.user_id;
            return {
              user_id: d.user_id,
              email: isMe && curSess?.user?.email ? curSess.user.email : d.user_id,
              ...(isMe ? { full_name: "Current Super Admin" } : {}),
              role: d.role as AdminRole,
              assigned_block: d.assigned_block,
              created_at: d.created_at,
            };
          });
          setRolesList(mapped);
        }
      }

      // Load active delivery blocks for block assignment
      const { data: blocksData } = await supabase
        .from("delivery_blocks")
        .select("id, name, description, is_active")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (blocksData && blocksData.length > 0) {
        setAvailableBlocks(blocksData as DeliveryBlock[]);
      }

      // Load audit logs if Super Admin
      setAuditLogsLoading(true);
      try {
        const { data: logsData, error: logsError } = await supabase.rpc("admin_get_audit_logs", { p_limit: 50 });
        if (!logsError && logsData) {
          setAuditLogs(logsData as AdminAuditLog[]);
        } else {
          const { data: directLogs } = await supabase
            .from("admin_audit_logs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(50);
          if (directLogs) {
            setAuditLogs(directLogs as AdminAuditLog[]);
          }
        }
      } catch {
        // Non-blocking for audit logs
      } finally {
        setAuditLogsLoading(false);
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
      if (canManageCatalog(adminRole)) {
        loadProducts();
        loadCategories();
      }
      if (canManageBanners(adminRole)) {
        loadBanners();
      }
      if (canManageRoles(adminRole)) {
        loadRoles();
      }
    }
  }, [isAdmin, adminRole, loadOrders, loadProducts, loadCategories, loadBanners, loadRoles]);

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
          adminRole ? getRoleBadge(adminRole).label : "Staff"
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

  const handleClaimOrder = async (orderId: string) => {
    if (!orderId) return;
    setIsClaimingOrder(orderId);
    try {
      const { data, error } = await supabase.rpc("admin_claim_order", {
        p_order_id: orderId,
      });

      if (error) {
        toast.error(`Unable to claim order: ${error.message}`);
        return;
      }

      toast.success("Order claimed successfully!");
      const freshOrders = await loadOrders();
      if (freshOrders && selectedAdminOrder && selectedAdminOrder.id === orderId) {
        const fresh = freshOrders.find((o) => o.id === orderId);
        if (fresh) setSelectedAdminOrder(fresh);
      }
    } catch (err: any) {
      toast.error(`Claim error: ${err?.message}`);
    } finally {
      setIsClaimingOrder(null);
    }
  };

  // Realtime live update on orders across all staff dashboards
  useEffect(() => {
    if (!isSupabaseConfigured || !isAdmin) return;

    const channel = supabase
      .channel("admin-orders-realtime-sub")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        () => {
          loadOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin, loadOrders]);

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
          assigned_block: createStaffRole === "block_manager" ? createStaffBlock : null,
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
          setExistingAccountConflict({
            email: cleanEmail,
            role: createStaffRole,
            assignedBlock: createStaffRole === "block_manager" ? createStaffBlock : null,
          });
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
        setExistingAccountConflict({
          email: cleanEmail,
          role: createStaffRole,
          assignedBlock: createStaffRole === "block_manager" ? createStaffBlock : null,
        });
        setCreateStaffError(data.error || "User already exists.");
        toast.info(data.message || "User already registered. Use role assignment.");
      } else {
        toast.success(data?.message || `Staff account created! Invitation sent to ${cleanEmail}.`, {
          duration: 6000,
        });
        setCreateStaffSuccess(
          `Successfully created staff account for ${cleanEmail} (${createStaffRole.replace("_", " ")}${
            createStaffRole === "block_manager" ? ` - ${createStaffBlock}` : ""
          }). An official invitation email has been sent!`
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

  const handleAssignExistingAfterConflict = async (
    targetEmail: string,
    targetRole: AdminRole,
    targetBlock?: string
  ) => {
    setAssigningRole(true);
    try {
      const { error } = await supabase.rpc("admin_assign_role", {
        p_email: targetEmail,
        p_role: targetRole,
        p_assigned_block: targetRole === "block_manager" ? (targetBlock || createStaffBlock || "Block A") : null,
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

    if (newRoleType === "block_manager" && !newRoleBlock.trim()) {
      toast.error("Please select an assigned delivery block for the Block Manager.");
      return;
    }

    setAssigningRole(true);
    try {
      const { error } = await supabase.rpc("admin_assign_role", {
        p_email: cleanEmail,
        p_role: newRoleType,
        p_assigned_block: newRoleType === "block_manager" ? newRoleBlock : null,
      });

      if (error) {
        if (error.code === "PGRST202" || error.message?.includes("schema cache")) {
          setRolesRpcPending(true);
          toast.error("Database Migration Pending: The admin_assign_role function is not in the schema cache. Please execute the latest role hierarchy migration in your Supabase SQL Editor.", {
            duration: 8000,
          });
        } else if (error.message?.includes("last remaining Super Administrator")) {
          toast.error("Safety Lockout Prevention: Cannot demote or alter the role of the last remaining Super Administrator.");
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
        toast.success(
          `Assigned ${newRoleType.replace("_", " ")}${
            newRoleType === "block_manager" ? ` (${newRoleBlock})` : ""
          } to ${cleanEmail}`
        );
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
        if (error.message?.includes("last remaining Super Administrator")) {
          toast.error("Safety Lockout Prevention: Cannot revoke or delete the last remaining Super Administrator.");
        } else {
          toast.error(`Failed to revoke role: ${error.message}`);
        }
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
            {branding.store_name} Staff & Admin Portal
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
                placeholder="staff@shiptmart.com"
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

  // Scoped orders enforcing role boundaries
  const scopedOrders = useMemo(() => {
    return orders.filter((o) => {
      // Store Manager: Strictly limited to Store Pickup orders
      if (adminRole === "store_manager") {
        return o.delivery_method === "campus_pickup";
      }
      // Block Manager: Strictly limited to assigned delivery block
      if (adminRole === "block_manager") {
        if (o.delivery_method === "campus_pickup") return false;
        const b = o.delivery_block_id || o.block;
        return Boolean(assignedBlock && b && assignedBlock.toLowerCase() === b.toLowerCase());
      }
      // Super Admin and Owner: View all orders across all blocks
      return true;
    });
  }, [orders, adminRole, assignedBlock]);

  // Filtered orders applying status and block filters
  const filteredOrders = useMemo(() => {
    return scopedOrders.filter((o) => {
      if (orderFilter !== "all" && o.status !== orderFilter) return false;
      if (orderBlockFilter !== "all") {
        if (orderBlockFilter === "campus_pickup") {
          if (o.delivery_method !== "campus_pickup") return false;
        } else {
          const b = o.delivery_block_id || o.block;
          if (b !== orderBlockFilter) return false;
        }
      }
      return true;
    });
  }, [scopedOrders, orderFilter, orderBlockFilter]);

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
          {branding.logo_url ? (
            <img src={branding.logo_url} alt={branding.store_name} className="size-11 rounded-2xl object-contain border border-border/80 bg-card p-1 shadow-xs" />
          ) : (
            <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
              <ShieldCheck className="size-6" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                {branding.store_name} Administration
              </h1>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-bold uppercase",
                  getRoleBadge(adminRole).className
                )}
              >
                {getRoleBadge(adminRole).label}
              </Badge>
              {adminRole === "block_manager" && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs font-semibold",
                    assignedBlock
                      ? "border-purple-500/40 text-purple-700 bg-purple-500/10 dark:text-purple-300"
                      : "border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-300"
                  )}
                >
                  <Building2 className="size-3 mr-1 inline-block" />
                  {assignedBlock ? `Block: ${assignedBlock}` : "No Block Assigned"}
                </Badge>
              )}
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
          onClick={() => setActiveTab("dashboard")}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shrink-0",
            activeTab === "dashboard"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <LayoutDashboard className="size-4" />
          <span>Dashboard</span>
        </button>

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
          <span>
            {adminRole === "block_manager"
              ? `Block Orders (${scopedOrders.length})`
              : adminRole === "store_manager"
              ? `Pickup Orders (${scopedOrders.length})`
              : `Orders (${scopedOrders.length})`}
          </span>
        </button>

        {canManageCatalog(adminRole) && (
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
        )}

        {/* Super Admin & Owner: Delivery Blocks */}
        {canManageBlocks(adminRole) && (
          <button
            type="button"
            onClick={() => setActiveTab("blocks")}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shrink-0",
              activeTab === "blocks"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <Building2 className="size-4" />
            <span>Delivery Blocks</span>
          </button>
        )}

        {/* Super Admin & Owner: Promotional Banners */}
        {canManageBanners(adminRole) && (
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
        )}

        {/* Super Admin: Staff Roles & Security */}
        {canManageRoles(adminRole) && (
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
            <span>Staff & Security</span>
          </button>
        )}

        {/* Super Admin & Owner: Store Branding */}
        {canManageBranding(adminRole) && (
          <button
            type="button"
            onClick={() => setActiveTab("branding")}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shrink-0",
              activeTab === "branding"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <Sparkles className="size-4" />
            <span>Store Branding</span>
          </button>
        )}
      </div>

      {/* TAB 0: SMART DASHBOARD OVERVIEW */}
      {activeTab === "dashboard" && (
        <div className="mt-6">
          <SmartDashboard
            orders={scopedOrders}
            products={dbProducts}
            ordersLoading={ordersLoading}
            productsLoading={productsLoading}
            adminRole={adminRole}
            assignedBlock={assignedBlock}
            userEmail={session?.user?.email}
            onRefresh={() => {
              loadOrders();
              if (canManageCatalog(adminRole)) {
                loadProducts();
              }
            }}
            onNavigateTab={(tab) => {
              if (tab === "products" && !canManageCatalog(adminRole)) return;
              if (tab === "banners" && !canManageBanners(adminRole)) return;
              if (tab === "roles" && !canManageRoles(adminRole)) return;
              if (tab === "branding" && !canManageBranding(adminRole)) return;
              setActiveTab(tab);
            }}
            onAddNewProduct={() => {
              if (!canManageCatalog(adminRole)) return;
              setActiveTab("products");
              setProductCenterSubTab("catalog");
            }}
            onManageInventory={() => {
              if (!canManageCatalog(adminRole)) return;
              setActiveTab("products");
              setProductCenterSubTab("inventory");
            }}
            onViewOrder={(order) => {
              setSelectedAdminOrder(order);
              setTargetStatus(order.status);
            }}
            onEditProduct={(product) => {
              if (!canManageCatalog(adminRole)) return;
              setActiveTab("products");
              openEditProduct(product);
            }}
          />
        </div>
      )}

      {/* TAB 1: ORDERS MANAGEMENT */}
      {activeTab === "orders" && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Status:</span>
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

              {(adminRole === "super_admin" || adminRole === "owner") && (
                <>
                  <span className="text-xs font-semibold text-muted-foreground ml-2">Sector:</span>
                  <select
                    value={orderBlockFilter}
                    onChange={(e) => setOrderBlockFilter(e.target.value)}
                    className="h-8 rounded-lg border border-input bg-card px-2.5 text-xs font-medium outline-none"
                  >
                    <option value="all">All Sectors & Pickup</option>
                    <option value="campus_pickup">Store / Counter Pickup Only</option>
                    {availableBlocks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
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
                      <div className="flex flex-wrap items-center gap-2">
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
                        <Badge variant="outline" className="text-[10px] font-bold bg-primary/5 text-primary border-primary/20">
                          {ord.delivery_method === "campus_pickup"
                            ? "Store Pickup"
                            : `Block: ${ord.delivery_block_id || ord.block || "Unassigned"}`}
                        </Badge>
                        {ord.claimed_by ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] font-bold",
                              ord.claimed_by === session?.user?.id
                                ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                                : "bg-secondary text-secondary-foreground border-border"
                            )}
                          >
                            Claimed by {ord.claimed_by === session?.user?.id ? "You" : ord.claimed_by.slice(0, 8)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] font-bold bg-amber-500/10 text-amber-700 border-amber-500/30">
                            Unclaimed
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Placed on {new Date(ord.created_at).toLocaleString()}
                        {ord.claimed_at && ` · Claimed at ${new Date(ord.claimed_at).toLocaleTimeString()}`}
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
                          : ord.pickup_location || "Store Pickup"}
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
                    <div className="flex flex-wrap items-center gap-2">
                      {!ord.claimed_by && (ord.status === "placed" || ord.status === "confirmed") && (
                        <Button
                          type="button"
                          variant="hero"
                          size="sm"
                          disabled={isClaimingOrder === ord.id}
                          onClick={() => handleClaimOrder(ord.id)}
                          className="h-8 gap-1.5 text-xs font-bold"
                        >
                          <UserCheck className="size-3.5" />
                          <span>{isClaimingOrder === ord.id ? "Claiming..." : "Claim Order"}</span>
                        </Button>
                      )}

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
                            : "Store Pickup"}
                        </span>
                      </div>
                      <p className="font-bold text-sm text-foreground">
                        {selectedAdminOrder.delivery_method === "hostel_delivery"
                          ? `${selectedAdminOrder.hostel || "Hostel / Residence"}${
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

                    {/* Delivery Sector, Claim Status & Milestone Tracking Card */}
                    <div className="rounded-2xl border border-border bg-secondary/30 p-4 space-y-2.5 text-xs sm:col-span-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2">
                        <div className="flex items-center gap-2">
                          <Building2 className="size-4 text-primary" />
                          <span className="font-semibold text-foreground">Delivery Block / Sector:</span>
                          <Badge variant="outline" className="font-bold text-xs bg-primary/10 text-primary border-primary/30">
                            {selectedAdminOrder.delivery_method === "campus_pickup"
                              ? "Store Pickup Hub"
                              : selectedAdminOrder.delivery_block_id || selectedAdminOrder.block || "Unassigned Sector"}
                          </Badge>
                        </div>
                        <div>
                          {selectedAdminOrder.claimed_by ? (
                            <Badge variant="outline" className="font-bold text-xs bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                              Claimed by {selectedAdminOrder.claimed_by === session?.user?.id ? "You" : selectedAdminOrder.claimed_by.slice(0, 8)}
                              {selectedAdminOrder.claimed_at && ` at ${new Date(selectedAdminOrder.claimed_at).toLocaleTimeString()}`}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="font-bold text-xs bg-amber-500/10 text-amber-700 border-amber-500/30">
                              Unclaimed
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Milestones grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                        <div className="rounded-xl bg-card/60 p-2 border border-border/40">
                          <span className="text-muted-foreground block text-[10px]">Claimed:</span>
                          <span className="font-semibold text-foreground">
                            {selectedAdminOrder.claimed_at ? new Date(selectedAdminOrder.claimed_at).toLocaleTimeString() : "Unclaimed"}
                          </span>
                        </div>
                        <div className="rounded-xl bg-card/60 p-2 border border-border/40">
                          <span className="text-muted-foreground block text-[10px]">Processing Started:</span>
                          <span className="font-semibold text-foreground">
                            {selectedAdminOrder.processing_started_at ? new Date(selectedAdminOrder.processing_started_at).toLocaleTimeString() : "Pending"}
                          </span>
                        </div>
                        <div className="rounded-xl bg-card/60 p-2 border border-border/40">
                          <span className="text-muted-foreground block text-[10px]">Completed:</span>
                          <span className="font-semibold text-foreground">
                            {selectedAdminOrder.completed_at ? new Date(selectedAdminOrder.completed_at).toLocaleTimeString() : "—"}
                          </span>
                        </div>
                        <div className="rounded-xl bg-card/60 p-2 border border-border/40">
                          <span className="text-muted-foreground block text-[10px]">Cancelled:</span>
                          <span className="font-semibold text-foreground">
                            {selectedAdminOrder.cancelled_at ? new Date(selectedAdminOrder.cancelled_at).toLocaleTimeString() : "—"}
                          </span>
                        </div>
                      </div>

                      {!selectedAdminOrder.claimed_by && (selectedAdminOrder.status === "placed" || selectedAdminOrder.status === "confirmed") && (
                        <div className="pt-1.5 flex justify-end">
                          <Button
                            type="button"
                            variant="hero"
                            size="sm"
                            disabled={isClaimingOrder === selectedAdminOrder.id}
                            onClick={() => handleClaimOrder(selectedAdminOrder.id)}
                            className="h-8 gap-1.5 text-xs font-bold w-full sm:w-auto"
                          >
                            <UserCheck className="size-3.5" />
                            <span>{isClaimingOrder === selectedAdminOrder.id ? "Claiming Order..." : "Claim & Take Ownership"}</span>
                          </Button>
                        </div>
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
                        Role: {adminRole ? getRoleBadge(adminRole).label : "Staff"}
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

      {/* TAB 2: COMPLETE PRODUCT MANAGEMENT CENTER */}
      {activeTab === "products" && canManageCatalog(adminRole) && (
        <div className="mt-6">
          <ProductManagementCenter
            products={dbProducts}
            categories={dbCategories}
            orders={orders}
            adminRole={adminRole}
            productsLoading={productsLoading}
            onRefreshProducts={loadProducts}
            onRefreshCategories={loadCategories}
            initialTab={productCenterSubTab}
          />
        </div>
      )}

      {/* TAB 3: PROMOTIONAL BANNERS MANAGEMENT (SUPER ADMIN & OWNER) */}
      {activeTab === "banners" && canManageBanners(adminRole) && (
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
                  Configure wide full-image promotional banners with custom destination routing across the store.
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
                        <span className="text-[10px] font-bold text-lime">Special Offer</span>
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
                    placeholder="manager@shiptmart.com or staff@shiptmart.com"
                    className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Role Permission Level *
                  </label>
                  <select
                    value={createStaffRole}
                    onChange={(e) => setCreateStaffRole(e.target.value as AdminRole)}
                    className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                  >
                    <option value="store_manager">Store Manager (Catalog, Stock, Orders)</option>
                    <option value="owner">Store Owner (Business, Analytics, Private Costs)</option>
                    <option value="super_admin">Super Administrator (Full System & Security Access)</option>
                    <option value="block_manager">Block Manager (Assigned Delivery Block Only)</option>
                  </select>
                </div>

                {createStaffRole === "block_manager" && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">
                      Assigned Delivery Block *
                    </label>
                    <select
                      value={createStaffBlock}
                      onChange={(e) => setCreateStaffBlock(e.target.value)}
                      required
                      className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                    >
                      {availableBlocks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.id})
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Block Managers are strictly restricted to orders within this delivery block.
                    </p>
                  </div>
                )}

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
                  Grant an administrative role to a user who already has a registered Shipt account.
                </p>

                <form onSubmit={handleAssignRole} className="mt-4 space-y-3.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Registered User Email *</label>
                    <input
                      type="email"
                      required
                      value={newRoleEmail}
                      onChange={(e) => setNewRoleEmail(e.target.value)}
                      placeholder="user@shiptmart.com or staff@shiptmart.com"
                      className="h-10 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">Role Level *</label>
                    <select
                      value={newRoleType}
                      onChange={(e) => setNewRoleType(e.target.value as AdminRole)}
                      className="h-10 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                    >
                      <option value="store_manager">Store Manager (Catalog, Stock, Orders)</option>
                      <option value="owner">Store Owner (Business, Analytics, Private Costs)</option>
                      <option value="super_admin">Super Administrator (Full System & Security Access)</option>
                      <option value="block_manager">Block Manager (Assigned Delivery Block Only)</option>
                    </select>
                  </div>

                  {newRoleType === "block_manager" && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">
                        Assigned Delivery Block *
                      </label>
                      <select
                        value={newRoleBlock}
                        onChange={(e) => setNewRoleBlock(e.target.value)}
                        required
                        className="h-10 w-full rounded-xl border border-input bg-card px-3.5 text-xs outline-none focus:border-primary"
                      >
                        {availableBlocks.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.id})
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Restricts this administrator's view and operations to this delivery block.
                      </p>
                    </div>
                  )}

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
                      <strong className="text-foreground">Private Password Setup:</strong> Clicking the link opens <code className="text-primary font-mono font-semibold">/accept-invitation</code>, where they choose their secure password.
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
                    <th className="p-3 font-semibold">Scope / Coverage</th>
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
                            getRoleBadge(r.role).className
                          )}
                        >
                          {getRoleBadge(r.role).label}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {r.role === "block_manager" ? (
                          <Badge variant="outline" className="border-purple-500/30 text-purple-700 bg-purple-500/10 text-[11px] font-semibold dark:text-purple-300">
                            <Building2 className="size-3 mr-1 inline-block" />
                            {r.assigned_block || "Unassigned"}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground font-medium">All Blocks / Store-wide</span>
                        )}
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

          {/* Protected Security Audit Trail */}
          <div className="space-y-3 pt-4 border-t border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ScrollText className="size-4 text-primary" />
                <h3 className="font-display text-base font-bold text-foreground">Security Audit Trail</h3>
                <Badge variant="outline" className="text-[10px] font-semibold border-primary/30 text-primary">
                  Protected Log
                </Badge>
              </div>
              <Button variant="outline" size="sm" onClick={loadRoles} className="h-8 gap-1 text-xs">
                <RefreshCw className={cn("size-3", auditLogsLoading && "animate-spin")} />
                <span>Refresh Logs</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Immutable log of administrative grants, role changes, revocations, and block assignments.
            </p>

            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="p-3 font-semibold">Timestamp</th>
                    <th className="p-3 font-semibold">Action</th>
                    <th className="p-3 font-semibold">Target / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-xs text-muted-foreground">
                        {auditLogsLoading ? "Loading audit logs..." : "No administrative audit log entries recorded yet."}
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-secondary/20">
                        <td className="p-3 whitespace-nowrap text-muted-foreground font-mono text-[11px]">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <Badge variant="outline" className="font-mono text-[10px] uppercase">
                            {log.action}
                          </Badge>
                        </td>
                        <td className="p-3 text-foreground font-mono text-[11px]">
                          {log.details ? (
                            <span className="break-all">{JSON.stringify(log.details)}</span>
                          ) : (
                            <span className="text-muted-foreground">Target: {log.target_user_id || "System"}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: STORE BRANDING SETTINGS (Super Admin & Owner) */}
      {activeTab === "branding" && canManageBranding(adminRole) && (
        <div className="mt-6">
          <StoreBrandingTab
            adminRole={adminRole}
            onNavigateStorefront={() => {}}
          />
        </div>
      )}

      {/* TAB 6: DELIVERY BLOCKS ARCHITECTURE (Super Admin & Owner) */}
      {activeTab === "blocks" && canManageBlocks(adminRole) && (
        <BlockManagementTab adminRole={adminRole} />
      )}
    </div>
  );
}
