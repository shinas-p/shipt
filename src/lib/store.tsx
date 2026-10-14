import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import type { CartItem, Category, CategoryId, Product } from "@/lib/types";
import { categories as defaultCategories, products as defaultProducts, getProduct as defaultGetProduct } from "@/data/products";
import { loadCategories, loadProducts } from "@/lib/catalogApi";

// Guest cart key
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
  toggleWish: (p: Product) => void;
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
      setWishlist(JSON.parse(localStorage.getItem(WISH_KEY) || "[]"));
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart, loaded]);

  useEffect(() => {
    if (loaded) localStorage.setItem(WISH_KEY, JSON.stringify(wishlist));
  }, [wishlist, loaded]);

  const getProduct = useCallback(
    (id: string): Product | undefined => {
      return (
        products.find((p) => p.id === id || (p as any).slug === id) ||
        defaultGetProduct(id)
      );
    },
    [products]
  );

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
      toggleWish: (p) => {
        const has = wishlist.includes(p.id);
        setWishlist((w) => (has ? w.filter((x) => x !== p.id) : [...w, p.id]));
        toast(has ? `Removed ${p.name} from wishlist` : `Saved ${p.name} to wishlist`);
      },
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
  toggleWish: () => {},
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
  getProduct: (id) => defaultProducts.find((p) => p.id === id),
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
