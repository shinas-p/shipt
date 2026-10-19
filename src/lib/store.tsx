import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import type { CartItem, Category, CategoryId, Product } from "@/lib/types";
import {
  categories as defaultCategories,
  products as defaultProducts,
  getProduct as defaultGetProduct,
  SEED_UUID_TO_SLUG,
  SLUG_TO_SEED_UUID,
} from "@/data/products";
import { loadCategories, loadProducts } from "@/lib/catalogApi";

// Guest cart & wishlist keys
const CART_KEY = "campusmart.demo.cart";
const WISH_KEY = "campusmart.demo.wishlist";

interface StoreCtx {
  cart: CartItem[];
  itemCount: number;
  subtotal: number;
  qtyOf: (id: string) => number;
  setQty: (p: Product, q: number) => void;
  add: (p: Product, q?: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  wishlist: string[];
  wishlistCount: number;
  savedWishlistProducts: Product[];
  isWished: (p: Product | string) => boolean;
  toggleWish: (p: Product) => void;
  clearWishlist: () => void;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
  search: string;
  setSearch: (s: string) => void;
  category: CategoryId | "all";
  setCategory: (c: CategoryId | "all") => void;
  detail: Product | null;
  setDetail: (p: Product | null) => void;
  products: Product[];
  categories: Category[];
  getProduct: (id: string) => Product | undefined;
  isLoadingCatalog: boolean;
  refreshCatalog: () => Promise<void>;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>(defaultProducts);
  const [categories, setCategories] = useState<Category[]>(defaultCategories);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [detail, setDetail] = useState<Product | null>(null);

  const refreshCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    try {
      const [cats, prods] = await Promise.all([loadCategories(), loadProducts()]);
      if (cats && cats.length > 0) setCategories(cats);
      if (prods && prods.length > 0) setProducts(prods);
    } catch {
      // Keep existing default catalog
    } finally {
      setIsLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    try {
      setCart(JSON.parse(localStorage.getItem(CART_KEY) || "[]"));
      const rawWish = JSON.parse(localStorage.getItem(WISH_KEY) || "[]");
      if (Array.isArray(rawWish)) {
        // Sanitize storage: non-empty strings only, deduplicated
        const cleanWish = Array.from(
          new Set(
            rawWish.filter(
              (x): x is string => typeof x === "string" && x.trim().length > 0
            )
          )
        );
        setWishlist(cleanWish);
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart, loaded]);

  useEffect(() => {
    if (loaded) {
      // Always persist unique IDs to prevent duplicate accumulation
      const uniqueWish = Array.from(new Set(wishlist));
      localStorage.setItem(WISH_KEY, JSON.stringify(uniqueWish));
    }
  }, [wishlist, loaded]);

  const getProduct = useCallback(
    (id: string): Product | undefined => {
      if (!id) return undefined;
      const lower = id.toLowerCase().trim();
      const mappedSlug = SEED_UUID_TO_SLUG[lower];
      const mappedUuid = SLUG_TO_SEED_UUID[lower];

      // 1. Search in current active products catalog (e.g. Supabase DB or updated local)
      const foundInState = products.find(
        (p) =>
          p.id === id ||
          p.id.toLowerCase() === lower ||
          (p.slug && (p.slug === id || p.slug.toLowerCase() === lower)) ||
          (mappedSlug && (p.slug === mappedSlug || p.id === mappedSlug)) ||
          (mappedUuid && (p.id === mappedUuid || p.slug === mappedUuid))
      );
      if (foundInState) return foundInState;

      // 2. Search fallback default products (handles offline, boot timing, and seed items)
      return defaultGetProduct(id);
    },
    [products]
  );

  // Authoritative resolved products from wishlist
  const savedWishlistProducts = useMemo(() => {
    const seen = new Set<string>();
    const resolved: Product[] = [];
    for (const rawId of wishlist) {
      const p = getProduct(rawId);
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        resolved.push(p);
      }
    }
    return resolved;
  }, [wishlist, getProduct]);

  const wishlistCount = savedWishlistProducts.length;

  const isWished = useCallback(
    (p: Product | string): boolean => {
      if (!p) return false;
      const targetId = typeof p === "string" ? p.trim() : p.id;
      const prod = typeof p === "string" ? getProduct(p) : p;

      if (prod) {
        return savedWishlistProducts.some(
          (item) =>
            item.id === prod.id ||
            (prod.slug && item.slug === prod.slug) ||
            item.id === targetId
        );
      }
      return wishlist.includes(targetId);
    },
    [savedWishlistProducts, wishlist, getProduct]
  );

  const toggleWish = useCallback(
    (p: Product) => {
      const currentlySaved = isWished(p);
      setWishlist((prev) => {
        const pSlug = p.slug;
        const mappedUuid = pSlug ? SLUG_TO_SEED_UUID[pSlug] : undefined;
        const mappedSlug = SEED_UUID_TO_SLUG[p.id];

        // Cleanly filter out all known representations
        const filtered = prev.filter(
          (id) =>
            id !== p.id &&
            id !== pSlug &&
            id !== mappedUuid &&
            id !== mappedSlug
        );

        if (currentlySaved) {
          return filtered;
        } else {
          // Standardize on canonical product ID
          return [...filtered, p.id];
        }
      });
      toast(currentlySaved ? `Removed ${p.name} from wishlist` : `Saved ${p.name} to wishlist`);
    },
    [isWished]
  );

  const clearWishlist = useCallback(() => {
    setWishlist([]);
    try {
      localStorage.removeItem(WISH_KEY);
    } catch {}
  }, []);

  const value = useMemo<StoreCtx>(() => {
    const qtyOf = (id: string) => cart.find((c) => c.productId === id)?.quantity ?? 0;

    const setQty = (p: Product, q: number) => {
      const clamped = Math.max(0, Math.min(q, p.stock));
      if (q > p.stock) toast.info(`Only ${p.stock} in stock for ${p.name}`);
      setCart((prev) => {
        const rest = prev.filter((c) => c.productId !== p.id);
        if (clamped === 0) return rest;
        const exists = prev.some((c) => c.productId === p.id);
        return exists
          ? prev.map((c) => (c.productId === p.id ? { ...c, quantity: clamped } : c))
          : [...prev, { productId: p.id, quantity: clamped }];
      });
    };

    return {
      cart,
      itemCount: cart.reduce((s, c) => s + c.quantity, 0),
      subtotal: cart.reduce((s, c) => s + (getProduct(c.productId)?.price ?? 0) * c.quantity, 0),
      qtyOf,
      setQty,
      add: (p, q = 1) => {
        if (p.stock === 0) {
          toast.error(`${p.name} is currently out of stock`);
          return;
        }
        setQty(p, qtyOf(p.id) + q);
        toast.success(`${p.name} added to cart`);
      },
      remove: (id) => setCart((prev) => prev.filter((c) => c.productId !== id)),
      clear: () => setCart([]),
      wishlist,
      wishlistCount,
      savedWishlistProducts,
      isWished,
      toggleWish,
      clearWishlist,
      cartOpen,
      setCartOpen,
      search,
      setSearch,
      category,
      setCategory,
      detail,
      setDetail,
      products,
      categories,
      getProduct,
      isLoadingCatalog,
      refreshCatalog,
    };
  }, [
    cart,
    wishlist,
    wishlistCount,
    savedWishlistProducts,
    isWished,
    toggleWish,
    clearWishlist,
    cartOpen,
    search,
    category,
    detail,
    products,
    categories,
    getProduct,
    isLoadingCatalog,
    refreshCatalog,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const defaultStoreValue: StoreCtx = {
  cart: [],
  itemCount: 0,
  subtotal: 0,
  qtyOf: () => 0,
  setQty: () => {},
  add: () => {},
  remove: () => {},
  clear: () => {},
  wishlist: [],
  wishlistCount: 0,
  savedWishlistProducts: [],
  isWished: () => false,
  toggleWish: () => {},
  clearWishlist: () => {},
  cartOpen: false,
  setCartOpen: () => {},
  search: "",
  setSearch: () => {},
  category: "all",
  setCategory: () => {},
  detail: null,
  setDetail: () => {},
  products: defaultProducts,
  categories: defaultCategories,
  getProduct: (id) => defaultGetProduct(id),
  isLoadingCatalog: false,
  refreshCatalog: async () => {},
};

export function useStore() {
  const c = useContext(Ctx);
  if (!c) {
    return defaultStoreValue;
  }
  return c;
}
