import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { createAdminNotification } from "@/lib/notifications";

export type SuggestionStatus = "pending" | "reviewed" | "approved" | "rejected";

export interface ProductSuggestion {
  id: string;
  user_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  product_name: string;
  category: string | null;
  brand: string | null;
  expected_price: number | null;
  quantity: number;
  reason: string | null;
  photo_url: string | null;
  status: SuggestionStatus;
  admin_notes: string | null;
  approval_email_sent_at?: string | null | undefined;
  approval_email_error?: string | null | undefined;
  created_at: string;
  updated_at: string;
  reviewed_by: string | null;
}

export interface SubmitSuggestionInput {
  user_id?: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  product_name: string;
  category?: string | null;
  brand?: string | null;
  expected_price?: number | null;
  quantity?: number;
  reason?: string | null;
  photo_url?: string | null;
}

const LOCAL_STORAGE_SUGGESTIONS_KEY = "shipt_customer_suggestions_v1";

/**
 * Uploads an optional product suggestion photo to the 'product-suggestions' bucket
 */
export async function uploadSuggestionPhoto(
  file: File,
  userId?: string | null
): Promise<{ url?: string; error?: string }> {
  if (!isSupabaseConfigured) {
    return { error: "Database service not configured" };
  }

  // Validate file format and size (max 5 MB)
  const validTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!validTypes.includes(file.type)) {
    return { error: "Please upload a valid image (JPEG, PNG, or WebP)." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: "Photo must be less than 5 MB." };
  }

  try {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const pathPrefix = userId || "guest";
    const filePath = `${pathPrefix}/${timestamp}_${randomSuffix}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("product-suggestions")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      // If product-suggestions bucket does not exist, try posters or public fallback
      const { data: posterData, error: posterError } = await supabase.storage
        .from("posters")
        .upload(`suggestions/${filePath}`, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (posterError) {
        return { error: uploadError.message };
      }

      const { data: publicUrlData } = supabase.storage
        .from("posters")
        .getPublicUrl(`suggestions/${filePath}`);

      return { url: publicUrlData.publicUrl };
    }

    const { data: publicUrlData } = supabase.storage
      .from("product-suggestions")
      .getPublicUrl(filePath);

    return { url: publicUrlData.publicUrl };
  } catch (err: any) {
    return { error: err?.message || "Failed to upload photo" };
  }
}

/**
 * Submits a new customer product suggestion to Supabase
 */
export async function submitProductSuggestion(
  input: SubmitSuggestionInput,
  photoFile?: File | null
): Promise<{ success: boolean; data?: ProductSuggestion; error?: string }> {
  if (!input.product_name?.trim()) {
    return { success: false, error: "Product name is required." };
  }
  if (!input.customer_email?.trim()) {
    return { success: false, error: "Contact email is required." };
  }

  let finalPhotoUrl = input.photo_url || null;

  if (photoFile) {
    const uploadRes = await uploadSuggestionPhoto(photoFile, input.user_id);
    if (uploadRes.error) {
      return { success: false, error: uploadRes.error };
    }
    finalPhotoUrl = uploadRes.url || null;
  }

  const payload = {
    user_id: input.user_id || null,
    customer_name: input.customer_name.trim(),
    customer_email: input.customer_email.trim().toLowerCase(),
    customer_phone: input.customer_phone?.trim() || null,
    product_name: input.product_name.trim(),
    category: input.category || null,
    brand: input.brand?.trim() || null,
    expected_price: input.expected_price ? Number(input.expected_price) : null,
    quantity: input.quantity ? Math.max(1, Number(input.quantity)) : 1,
    reason: input.reason?.trim() || null,
    photo_url: finalPhotoUrl,
    status: "pending" as SuggestionStatus,
  };

  if (!isSupabaseConfigured) {
    // Local mock for offline dev
    const mock: ProductSuggestion = {
      ...payload,
      id: `local_${Date.now()}`,
      admin_notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reviewed_by: null,
    };
    saveLocalSuggestion(mock);
    return { success: true, data: mock };
  }

  try {
    const { data, error } = await supabase
      .from("product_suggestions")
      .insert([payload])
      .select()
      .single();

    if (error) {
      // If table is not yet in Supabase schema cache, save locally so customer experience is seamless
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message.includes("schema cache") ||
        error.message.includes("does not exist")
      ) {
        const fallback: ProductSuggestion = {
          ...payload,
          id: `local_${Date.now()}`,
          admin_notes: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          reviewed_by: null,
        };
        saveLocalSuggestion(fallback);
        return { success: true, data: fallback };
      }
      return { success: false, error: error.message };
    }

    const suggestionResult = data as ProductSuggestion;
    if (suggestionResult) {
      saveLocalSuggestion(suggestionResult);
    }

    // Emit admin notification for customer suggestion (decoupled)
    try {
      await createAdminNotification({
        event_type: "new_suggestion",
        title: `New Product Suggestion: ${payload.product_name}`,
        message: `${payload.customer_name} requested "${payload.product_name}" (${payload.category || "General"}). Expected quantity: ${payload.quantity}.`,
        metadata: {
          suggestion_id: suggestionResult.id,
          product_name: payload.product_name,
          category: payload.category,
          customer_email: payload.customer_email,
        },
        dedup_key: `suggestion_created:${suggestionResult.id}`,
      });
    } catch {}

    return { success: true, data: suggestionResult };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to submit suggestion" };
  }
}

/**
 * Fetches suggestions submitted by a specific user
 */
export async function fetchCustomerSuggestions(
  userId: string
): Promise<ProductSuggestion[]> {
  const local = getLocalSuggestions().filter((s) => s.user_id === userId);

  if (!isSupabaseConfigured) {
    return local;
  }

  try {
    const { data, error } = await supabase
      .from("product_suggestions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error || !data) {
      return local;
    }

    return data as ProductSuggestion[];
  } catch {
    return local;
  }
}

/**
 * Fetches all product suggestions for admin review
 */
export async function fetchAllSuggestions(): Promise<ProductSuggestion[]> {
  const local = getLocalSuggestions();

  if (!isSupabaseConfigured) {
    return local;
  }

  try {
    const { data, error } = await supabase
      .from("product_suggestions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !data) {
      return local;
    }

    // Merge any unique local items
    const ids = new Set(data.map((d: any) => d.id));
    const merged = [...data, ...local.filter((l) => !ids.has(l.id))];
    return merged as ProductSuggestion[];
  } catch {
    return local;
  }
}

/**
 * Updates suggestion review status and notes by an authorized admin.
 * If status transitions to 'approved', automatically triggers the customer email notification.
 */
export async function updateSuggestionStatus(
  id: string,
  status: SuggestionStatus,
  adminNotes?: string | null,
  reviewedBy?: string | null,
  previousStatus?: SuggestionStatus
): Promise<{
  success: boolean;
  error?: string | undefined;
  emailSent?: boolean | undefined;
  emailError?: string | undefined;
  alreadySent?: boolean | undefined;
}> {
  let emailSent = false;
  let emailError: string | undefined = undefined;
  let alreadySent = false;

  // 1. Update local cache
  const local = getLocalSuggestions();
  const idx = local.findIndex((s) => s.id === id);
  if (idx !== -1) {
    const item = local[idx];
    if (item) {
      item.status = status;
      if (adminNotes !== undefined) item.admin_notes = adminNotes;
      item.updated_at = new Date().toISOString();
      item.reviewed_by = reviewedBy || null;
      saveLocalSuggestionsList(local);
    }
  }

  // If local offline mock or unconfigured
  if (!isSupabaseConfigured || id.startsWith("local_")) {
    // If genuine transition to approved in local mode
    if (status === "approved" && previousStatus !== "approved") {
      emailSent = true;
      if (idx !== -1 && local[idx]) {
        local[idx].approval_email_sent_at = new Date().toISOString();
        saveLocalSuggestionsList(local);
      }
    }
    return { success: true, emailSent };
  }

  try {
    const payload: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (adminNotes !== undefined) payload["admin_notes"] = adminNotes;
    if (reviewedBy) payload["reviewed_by"] = reviewedBy;

    // 2. Persist status update to Supabase
    const { error: dbError } = await supabase
      .from("product_suggestions")
      .update(payload)
      .eq("id", id);

    if (dbError) {
      // If table is local or not in schema cache, don't hard crash
      if (
        dbError.code === "PGRST205" ||
        dbError.code === "42P01" ||
        dbError.message.includes("schema cache")
      ) {
        return { success: true };
      }
      return { success: false, error: dbError.message };
    }

    // 3. Trigger approval notification ONLY on genuine transition from non-approved to approved
    const isApprovalTransition = previousStatus !== "approved" && status === "approved";

    if (isApprovalTransition) {
      try {
        const { data: fnData, error: fnError } = await supabase.functions.invoke(
          "notify-suggestion-approved",
          {
            body: { suggestionId: id },
          }
        );

        if (fnError) {
          emailError = fnError.message;
        } else if (fnData?.alreadySent) {
          alreadySent = true;
          emailSent = true;
        } else if (fnData?.delivered) {
          emailSent = true;
          if (idx !== -1 && local[idx]) {
            local[idx].approval_email_sent_at = fnData.sentAt || new Date().toISOString();
            local[idx].approval_email_error = null;
            saveLocalSuggestionsList(local);
          }
        } else if (fnData?.error) {
          emailError = fnData.error;
          if (idx !== -1 && local[idx]) {
            local[idx].approval_email_error = fnData.error;
            saveLocalSuggestionsList(local);
          }
        }
      } catch (invokeErr: any) {
        emailError = invokeErr?.message || "Notification dispatch failed";
      }
    }

    return {
      success: true,
      emailSent,
      emailError,
      alreadySent,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to update suggestion" };
  }
}

/**
 * Retries approval email notification for an already approved suggestion
 */
export async function retryApprovalNotification(
  id: string
): Promise<{ success: boolean; error?: string; emailSent?: boolean }> {
  if (!isSupabaseConfigured || id.startsWith("local_")) {
    return { success: true, emailSent: true };
  }

  try {
    const { data: fnData, error: fnError } = await supabase.functions.invoke(
      "notify-suggestion-approved",
      {
        body: { suggestionId: id },
      }
    );

    if (fnError) {
      return { success: false, error: fnError.message };
    }

    if (fnData?.delivered || fnData?.alreadySent) {
      return { success: true, emailSent: true };
    }

    return { success: false, error: fnData?.error || "Failed to deliver notification email" };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to retry email notification" };
  }
}

function getLocalSuggestions(): ProductSuggestion[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SUGGESTIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalSuggestion(item: ProductSuggestion) {
  const current = getLocalSuggestions();
  const filtered = current.filter((s) => s.id !== item.id);
  const updated = [item, ...filtered];
  saveLocalSuggestionsList(updated);
}

function saveLocalSuggestionsList(list: ProductSuggestion[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_STORAGE_SUGGESTIONS_KEY, JSON.stringify(list));
  } catch {}
}
