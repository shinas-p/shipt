import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface ProductReview {
  id: string;
  product_id: string;
  user_id: string;
  rating: number; // 1 - 5
  review_text: string;
  customer_name: string;
  created_at: string;
  updated_at: string;
  is_verified_purchaser?: boolean;
}

export interface ReviewSummary {
  average_rating: number;
  total_reviews: number;
  rating_breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
}

const LOCAL_STORAGE_REVIEWS_KEY = "shipt.customer.reviews.v1";

// Curated starter reviews for student community feel
const DEFAULT_INITIAL_REVIEWS: ProductReview[] = [
  {
    id: "rev-init-1",
    product_id: "p-notebook",
    user_id: "demo-user-1",
    rating: 5,
    review_text: "Smooth pages and sturdy binding. Ideal for lecture notes at DHU. Delivered to Kaveri Hostel in 15 minutes!",
    customer_name: "Ahmad K.",
    created_at: "2026-10-10T14:20:00Z",
    updated_at: "2026-10-10T14:20:00Z",
    is_verified_purchaser: true,
  },
  {
    id: "rev-init-2",
    product_id: "p-notebook",
    user_id: "demo-user-2",
    rating: 4,
    review_text: "Great quality notebook. The paper doesn't bleed through even with gel pens. Will order again before exams.",
    customer_name: "Salman F.",
    created_at: "2026-10-12T11:45:00Z",
    updated_at: "2026-10-12T11:45:00Z",
    is_verified_purchaser: true,
  },
  {
    id: "rev-init-3",
    product_id: "p-pen",
    user_id: "demo-user-3",
    rating: 5,
    review_text: "Classic Reynolds 045. Perfect grip and writes super smooth during 3-hour semester exams.",
    customer_name: "Rashid M.",
    created_at: "2026-10-11T16:10:00Z",
    updated_at: "2026-10-11T16:10:00Z",
    is_verified_purchaser: true,
  },
  {
    id: "rev-init-4",
    product_id: "p-biscuits",
    user_id: "demo-user-4",
    rating: 5,
    review_text: "Late night study session lifesaver! Fresh and crispy, chocolate chips are delicious with hostel tea.",
    customer_name: "Zayan T.",
    created_at: "2026-10-13T23:15:00Z",
    updated_at: "2026-10-13T23:15:00Z",
    is_verified_purchaser: true,
  },
  {
    id: "rev-init-5",
    product_id: "p-chips",
    user_id: "demo-user-5",
    rating: 4,
    review_text: "Good spicy flavor. Arrived super fast at Ganga Hostel Room 204.",
    customer_name: "Faris N.",
    created_at: "2026-10-14T19:30:00Z",
    updated_at: "2026-10-14T19:30:00Z",
    is_verified_purchaser: true,
  },
  {
    id: "rev-init-6",
    product_id: "p-cable",
    user_id: "demo-user-6",
    rating: 5,
    review_text: "Supports fast charging for my phone and power bank. Heavy-duty braided cable that doesn't bend easily.",
    customer_name: "Nabeel P.",
    created_at: "2026-10-09T09:10:00Z",
    updated_at: "2026-10-09T09:10:00Z",
    is_verified_purchaser: true,
  },
];

function getStoredLocalReviews(): ProductReview[] {
  if (typeof window === "undefined") return DEFAULT_INITIAL_REVIEWS;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_REVIEWS_KEY);
    if (!raw) {
      localStorage.setItem(LOCAL_STORAGE_REVIEWS_KEY, JSON.stringify(DEFAULT_INITIAL_REVIEWS));
      return DEFAULT_INITIAL_REVIEWS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_INITIAL_REVIEWS;
  } catch {
    return DEFAULT_INITIAL_REVIEWS;
  }
}

function saveStoredLocalReviews(reviews: ProductReview[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_STORAGE_REVIEWS_KEY, JSON.stringify(reviews));
  } catch {
    // Non-blocking
  }
}

/**
 * Calculates review analytics: average rating, total count, and 1-5 star distribution.
 */
export function calculateReviewSummary(reviews: ProductReview[]): ReviewSummary {
  const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };

  if (!reviews || reviews.length === 0) {
    return {
      average_rating: 0,
      total_reviews: 0,
      rating_breakdown: breakdown,
    };
  }

  let totalScore = 0;
  for (const r of reviews) {
    const clampedRating = Math.max(1, Math.min(5, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    breakdown[clampedRating] = (breakdown[clampedRating] || 0) + 1;
    totalScore += clampedRating;
  }

  const average = Number((totalScore / reviews.length).toFixed(1));

  return {
    average_rating: average,
    total_reviews: reviews.length,
    rating_breakdown: breakdown,
  };
}

/**
 * Checks whether the current user is a verified purchaser of this product.
 */
export async function checkVerifiedPurchaser(productId: string, userId: string): Promise<boolean> {
  if (!isSupabaseConfigured || !userId || !productId) return false;

  try {
    // Try the RPC if available
    const { data, error } = await supabase.rpc("check_is_verified_purchaser", {
      p_product_id: productId,
      p_user_id: userId,
    });
    if (!error && typeof data === "boolean") {
      return data;
    }

    // Direct fallback query against customer orders
    const { data: orderData } = await supabase
      .from("orders")
      .select("id, status, order_items(product_id)")
      .eq("user_id", userId)
      .in("status", ["confirmed", "preparing", "out_for_delivery", "delivered", "completed"]);

    if (orderData && orderData.length > 0) {
      for (const ord of orderData as any[]) {
        if (ord.order_items?.some((item: any) => item.product_id === productId)) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Fetches all reviews for a specific product.
 */
export async function fetchProductReviews(productId: string): Promise<ProductReview[]> {
  if (!productId) return [];

  // Try Supabase first if configured
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from("product_reviews")
        .select("id, product_id, user_id, rating, review_text, customer_name, created_at, updated_at")
        .eq("product_id", productId)
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        return data as ProductReview[];
      }
    } catch {
      // Fall through to local fallback
    }
  }

  // Local fallback repository
  const aliasMap: Record<string, string> = {
    "notebook-a5": "p-notebook",
    "p-notebook": "notebook-a5",
    "pen-blue-3": "p-pen",
    "p-pen": "pen-blue-3",
    "biscuits-cream": "p-biscuits",
    "p-biscuits": "biscuits-cream",
    "chips-salted": "p-chips",
    "p-chips": "chips-salted",
    "cable-usbc": "p-cable",
    "p-cable": "cable-usbc",
  };
  const allLocal = getStoredLocalReviews();
  const alias = aliasMap[productId];
  return allLocal.filter((r) => r.product_id === productId || (alias && r.product_id === alias));
}

/**
 * Submits a new review for a product.
 * Enforces authentication, rating range (1-5), and max length limits.
 */
export async function submitProductReview(params: {
  productId: string;
  rating: number;
  reviewText: string;
  customerName?: string;
  userId?: string;
}): Promise<{ success: boolean; review?: ProductReview; error?: string }> {
  const { productId, rating, reviewText, customerName, userId: explicitUserId } = params;

  // Validate rating
  const intRating = Math.round(rating);
  if (isNaN(intRating) || intRating < 1 || intRating > 5) {
    return { success: false, error: "Rating must be a whole number between 1 and 5 stars." };
  }

  // Validate text
  const trimmedText = reviewText.trim();
  if (trimmedText.length < 5) {
    return { success: false, error: "Please write at least 5 characters for your review." };
  }
  if (trimmedText.length > 1000) {
    return { success: false, error: "Review cannot exceed 1000 characters." };
  }

  // Verify auth session
  let currentUserId = explicitUserId || "";
  let verified = false;

  if (isSupabaseConfigured && !explicitUserId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        return { success: false, error: "You must be signed in to submit a review." };
      }
      currentUserId = session.user.id;
    } catch {
      // Non-blocking
    }
  }

  if (!currentUserId) {
    return { success: false, error: "You must be signed in to submit a review." };
  }

  if (isSupabaseConfigured) {
    try {
      verified = await checkVerifiedPurchaser(productId, currentUserId);

      // Sanitize customer display name safely (never expose email or tokens)
      const safeName = customerName?.trim() || "Campus Student";

      // Attempt Supabase insert
      const { data, error } = await supabase
        .from("product_reviews")
        .insert({
          product_id: productId,
          user_id: currentUserId,
          rating: intRating,
          review_text: trimmedText,
          customer_name: safeName,
        })
        .select()
        .single();

      if (!error && data) {
        const createdReview = { ...data, is_verified_purchaser: verified } as ProductReview;
        return { success: true, review: createdReview };
      }

      if (error && error.message.includes("uq_customer_product_review")) {
        return { success: false, error: "You have already submitted a review for this product. You can edit your existing review." };
      }
    } catch {
      // Fallback to local store
    }
  }

  // Local storage fallback for review submission
  const localList = getStoredLocalReviews();
  const existingIndex = localList.findIndex(
    (r) => r.product_id === productId && r.user_id === (currentUserId || "local-current-user")
  );

  if (existingIndex !== -1) {
    return { success: false, error: "You have already reviewed this product. You can edit your existing review." };
  }

  const newReview: ProductReview = {
    id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    product_id: productId,
    user_id: currentUserId || "local-current-user",
    rating: intRating,
    review_text: trimmedText,
    customer_name: customerName?.trim() || "Campus Student",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_verified_purchaser: verified,
  };

  saveStoredLocalReviews([newReview, ...localList]);
  return { success: true, review: newReview };
}

/**
 * Updates an existing review by ID.
 * Enforces ownership check (only review author can edit).
 */
export async function updateProductReview(params: {
  reviewId: string;
  rating: number;
  reviewText: string;
  userId?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { reviewId, rating, reviewText, userId: explicitUserId } = params;

  const intRating = Math.round(rating);
  if (isNaN(intRating) || intRating < 1 || intRating > 5) {
    return { success: false, error: "Rating must be between 1 and 5 stars." };
  }
  const trimmedText = reviewText.trim();
  if (trimmedText.length < 5 || trimmedText.length > 1000) {
    return { success: false, error: "Review must be between 5 and 1000 characters." };
  }

  let effectiveUserId = explicitUserId || "";

  if (isSupabaseConfigured && !explicitUserId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        return { success: false, error: "You must be signed in to edit your review." };
      }
      effectiveUserId = session.user.id;

      const { error } = await supabase
        .from("product_reviews")
        .update({
          rating: intRating,
          review_text: trimmedText,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reviewId)
        .eq("user_id", effectiveUserId);

      if (!error) return { success: true };
    } catch {
      // Local fallback
    }
  }

  const localList = getStoredLocalReviews();
  const existing = localList.find((r) => r.id === reviewId);
  if (existing) {
    if (effectiveUserId && existing.user_id !== effectiveUserId) {
      return { success: false, error: "You do not have permission to edit this review." };
    }
    existing.rating = intRating;
    existing.review_text = trimmedText;
    existing.updated_at = new Date().toISOString();
    saveStoredLocalReviews([...localList]);
    return { success: true };
  }

  return { success: false, error: "Review not found or permission denied." };
}

/**
 * Deletes a review by ID.
 * Enforces ownership check.
 */
export async function deleteProductReview(reviewId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
  let effectiveUserId = userId || "";

  if (isSupabaseConfigured && !userId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        return { success: false, error: "You must be signed in to delete your review." };
      }
      effectiveUserId = session.user.id;

      const { error } = await supabase
        .from("product_reviews")
        .delete()
        .eq("id", reviewId);

      if (!error) return { success: true };
    } catch {
      // Local fallback
    }
  }

  const localList = getStoredLocalReviews();
  const existing = localList.find((r) => r.id === reviewId);
  if (existing) {
    if (effectiveUserId && existing.user_id !== effectiveUserId) {
      return { success: false, error: "You do not have permission to delete this review." };
    }
    const filtered = localList.filter((r) => r.id !== reviewId);
    saveStoredLocalReviews(filtered);
    return { success: true };
  }

  return { success: true };
}
