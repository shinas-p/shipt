import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { categories as defaultCategories, products as defaultProducts } from "@/data/products";
import type { Category, Product, CategoryId, CheckoutFormData, CartItem, PlacedOrderResult, TrackedOrder, DeliveryBlock } from "@/lib/types";
import { createAdminNotification } from "@/lib/notifications";
import { triggerAdminWebPush } from "@/lib/pushNotifications";

import promoFallback from "@/assets/promo.jpg";

// Clean branded fallback image if a product image is genuinely unavailable
export const BRAND_FALLBACK_IMAGE = promoFallback;

// Local image resolver keyed by product slug and ID (resolves bundled local assets)
export const localImageMap: Record<string, string> = {};
for (const p of defaultProducts) {
  localImageMap[p.id] = p.image;
  const slug = (p as any).slug || p.id;
  localImageMap[slug] = p.image;
}

/**
 * Resolves the display product image for an order item using snapshots, joined product images,
 * bundled local assets, and guaranteed branded fallback.
 */
export function resolveOrderItemImage(item: {
  product_id?: string | null;
  product_name?: string;
  image_url?: string | null;
  products?: { image_url?: string | null } | null;
}): string {
  // 1. Direct snapshot image_url if provided on the item
  if (
    item.image_url &&
    (item.image_url.startsWith("http") || item.image_url.startsWith("/")) &&
    !item.image_url.includes("/storage/v1/object/public/posters/p-")
  ) {
    return item.image_url;
  }

  // 2. Joined product image_url from Supabase Storage
  if (
    item.products?.image_url &&
    (item.products.image_url.startsWith("http") || item.products.image_url.startsWith("/")) &&
    !item.products.image_url.includes("/storage/v1/object/public/posters/p-")
  ) {
    return item.products.image_url;
  }

  // 3. Bundled catalog image keyed by product_id
  if (item.product_id) {
    const localImg = localImageMap[item.product_id];
    if (localImg) return localImg;
  }

  // 4. Bundled catalog image matched by product_name
  if (item.product_name) {
    const match = defaultProducts.find(
      (p) => p.name.toLowerCase().trim() === item.product_name?.toLowerCase().trim()
    );
    if (match) return match.image;
  }

  // 5. Clean branded fallback image
  return BRAND_FALLBACK_IMAGE;
}

/**
 * Loads categories from Supabase with graceful fallback to default categories
 */
export async function loadCategories(): Promise<Category[]> {
  if (!isSupabaseConfigured) {
    return defaultCategories;
  }

  try {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, blurb, display_order, is_active")
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (error || !data || data.length === 0) {
      return defaultCategories;
    }

    return data.map((c) => ({
      id: c.id as CategoryId,
      name: c.name,
      blurb: c.blurb,
    }));
  } catch {
    return defaultCategories;
  }
}

/**
 * Loads products from Supabase.
 * Returns only active products (is_active = true).
 * When all products are archived or store is empty, returns an empty array [].
 * Throws on network or database errors so callers can distinguish errors from an empty catalog.
 */
export async function loadProducts(): Promise<Product[]> {
  if (!isSupabaseConfigured) {
    return [];
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(error.message || "Failed to load products from store database.");
  }

  if (!data || data.length === 0) {
    return [];
  }

  return data.map((p) => {
    // Resolve product image:
    // 1. If an admin uploaded an image to Supabase Storage or specified a custom URL, prioritize it
    let imageSrc = "";
    if (
      p.image_url &&
      (p.image_url.startsWith("http") || p.image_url.startsWith("/")) &&
      !p.image_url.includes("/storage/v1/object/public/posters/p-")
    ) {
      imageSrc = p.image_url;
    }

    // 2. Fall back to bundled catalog assets for initial catalogue items
    if (!imageSrc) {
      imageSrc = (p.slug && localImageMap[p.slug]) || (p.id && localImageMap[p.id]) || "";
    }

    // 3. Fall back to clean branded SVG fallback
    if (!imageSrc) {
      imageSrc = BRAND_FALLBACK_IMAGE;
    }

    const prod: Product = {
      id: p.id,
      name: p.name,
      size: p.size,
      description: p.description || "",
      price: Number(p.price),
      category: p.category_id as CategoryId,
      image: imageSrc,
      stock: p.stock ?? 0,
      bestseller: Boolean(p.bestseller),
      isNew: Boolean(p.is_new),
      slug: p.slug || undefined,
    };
    if (p.original_price != null) {
      prod.originalPrice = Number(p.original_price);
    }
    return prod;
  });
}

/**
 * Loads active delivery blocks from Supabase with graceful fallback
 */
export async function loadActiveDeliveryBlocks(): Promise<DeliveryBlock[]> {
  const fallbackBlocks: DeliveryBlock[] = [
    { id: "Block A", name: "Block A", is_active: true },
    { id: "Block B", name: "Block B", is_active: true },
    { id: "Main Campus", name: "Main Campus", is_active: true },
  ];

  if (!isSupabaseConfigured) {
    return fallbackBlocks;
  }

  try {
    const { data, error } = await supabase
      .from("delivery_blocks")
      .select("id, name, description, is_active, created_at")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error || !data || data.length === 0) {
      return fallbackBlocks;
    }

    return data as DeliveryBlock[];
  } catch {
    return fallbackBlocks;
  }
}

/**
 * Places an order via the transactional SECURITY DEFINER RPC `create_order_with_inventory`
 */
export async function placeOrder(
  form: CheckoutFormData,
  cart: CartItem[]
): Promise<{ success: boolean; data?: PlacedOrderResult; error?: string }> {
  if (!cart || cart.length === 0) {
    return { success: false, error: "Your cart is empty." };
  }

  const selectedBlock = form.deliveryBlockId || form.block || "";

  const payload = {
    customer_name: form.name.trim(),
    customer_phone: form.phone.trim(),
    delivery_method: form.deliveryMethod,
    delivery_block_id: form.deliveryMethod === "hostel_delivery" ? selectedBlock : null,
    hostel: form.deliveryMethod === "hostel_delivery" ? (form.hostel || selectedBlock) : null,
    block: form.deliveryMethod === "hostel_delivery" ? selectedBlock : null,
    room: form.deliveryMethod === "hostel_delivery" ? (form.room?.trim() || null) : null,
    pickup_location: form.deliveryMethod === "campus_pickup" ? form.pickupLocation : null,
    delivery_instructions: form.instructions?.trim() || null,
    payment_method: form.payment,
    items: cart.map((c) => ({
      product_id: c.productId,
      quantity: c.quantity,
    })),
  };

  if (!isSupabaseConfigured) {
    // Demo mode simulated response
    const mockOrderNumber = `QM-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;
    const mockOrderId = "demo-" + Math.random().toString(36).substring(2, 9);
    const demoTotal = cart.reduce((acc, c) => {
      const p = defaultProducts.find((item) => item.id === c.productId);
      return acc + ((p?.price || 0) * c.quantity);
    }, 0);

    const demoResult: PlacedOrderResult = {
      order_id: mockOrderId,
      order_number: mockOrderNumber,
      guest_tracking_token: "demo_token_" + Math.random().toString(36).substring(2, 10),
      total_amount: demoTotal,
      status: "placed",
      payment_method: form.payment,
      payment_status: "pending",
    };

    try {
      await createAdminNotification({
        order_id: demoResult.order_id,
        order_number: demoResult.order_number,
        event_type: "new_order",
        title: `New Order #${demoResult.order_number}`,
        message: `Order received for ₹${demoResult.total_amount} via ${payload.delivery_method === "hostel_delivery" ? `Hostel Delivery (${payload.delivery_block_id || "Campus"})` : "Campus Pickup"}.`,
        metadata: {
          total_amount: demoResult.total_amount,
          delivery_method: payload.delivery_method,
          delivery_block_id: payload.delivery_block_id,
          payment_method: payload.payment_method,
        },
        dedup_key: `order_created:${demoResult.order_id}`,
      });
    } catch { }

    return {
      success: true,
      data: demoResult,
    };
  }

  try {
    const { data, error } = await supabase.rpc("create_order_with_inventory", {
      order_payload: payload,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const orderResult = data as PlacedOrderResult;

    // Idempotent admin notification emission (decoupled from order transaction)
    try {
      await createAdminNotification({
        order_id: orderResult.order_id,
        order_number: orderResult.order_number,
        event_type: "new_order",
        title: `New Order #${orderResult.order_number}`,
        message: `Order received for ₹${orderResult.total_amount} via ${payload.delivery_method === "hostel_delivery" ? `Hostel Delivery (${payload.delivery_block_id || "Campus"})` : "Campus Pickup"}.`,
        metadata: {
          total_amount: orderResult.total_amount,
          delivery_method: payload.delivery_method,
          delivery_block_id: payload.delivery_block_id,
          payment_method: payload.payment_method,
        },
        dedup_key: `order_created:${orderResult.order_id}`,
      });
    } catch {
      // Notification error must NEVER undo or disrupt successful order placement
    }

    // Server-side Web Push delivery to subscribed admins (operates across closed tabs)
    try {
      await triggerAdminWebPush({
        order_id: orderResult.order_id,
        order_number: orderResult.order_number,
        total_amount: orderResult.total_amount,
        delivery_method: payload.delivery_method,
        event_type: "new_order",
      });
    } catch {
      // Push dispatch failure must never disrupt order completion
    }

    return {
      success: true,
      data: orderResult,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to place order. Please try again." };
  }
}

/**
 * Securely track a guest order via high-entropy tracking token RPC
 */
export async function trackGuestOrder(
  orderNumber: string,
  trackingToken: string
): Promise<{ success: boolean; data?: TrackedOrder; error?: string }> {
  if (!orderNumber || !trackingToken) {
    return { success: false, error: "Order number and tracking token are required." };
  }

  if (!isSupabaseConfigured) {
    return {
      success: true,
      data: {
        order_number: orderNumber.trim(),
        status: "placed",
        customer_name: "Customer",
        delivery_method: "hostel_delivery",
        hostel: "Ganga Hostel",
        block: "A",
        room: "204",
        subtotal: 150,
        total_amount: 150,
        payment_method: "upi",
        payment_status: "pending",
        created_at: new Date().toISOString(),
        items: [
          {
            product_name: "Spiral Notebook",
            product_size: "A5 · 160 pages",
            unit_price: 60,
            quantity: 1,
            total_price: 60,
          },
          {
            product_name: "Highlighter Set",
            product_size: "4 colours",
            unit_price: 90,
            quantity: 1,
            total_price: 90,
          },
        ],
      },
    };
  }

  try {
    const { data, error } = await supabase.rpc("get_guest_order", {
      p_order_number: orderNumber.trim(),
      p_tracking_token: trackingToken.trim(),
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as TrackedOrder };
  } catch (err: any) {
    return { success: false, error: err?.message || "Order not found." };
  }
}
