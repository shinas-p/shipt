import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type {
  StudentPaymentPolicy,
  StudentProfile,
  StudentPaymentAuditLog,
  StudentNoShowRecord,
  StorePaymentSettings,
} from "@/lib/types";
import { createAdminNotification } from "@/lib/notifications";

export const DEFAULT_STORE_PAYMENT_SETTINGS: StorePaymentSettings = {
  cash_payment_enabled: true,
  online_payment_enabled: true,
  guest_cash_allowed: true,
  max_cash_no_shows_threshold: 2,
};

export interface ResolvedPaymentEligibility {
  cashAllowed: boolean;
  onlineAllowed: boolean;
  cashReason?: string | undefined;
  onlineReason?: string | undefined;
  policy: StudentPaymentPolicy;
}

/**
 * Resolves effective payment method eligibility given student profile and store settings
 */
export function resolveStudentPaymentPolicy(
  profile: Partial<StudentProfile> | null | undefined,
  settings: StorePaymentSettings,
  isAuthenticated: boolean
): ResolvedPaymentEligibility {
  const policy: StudentPaymentPolicy = profile?.payment_policy || "default";
  const isCashRestricted = !!profile?.cash_restricted;

  let cashAllowed = settings.cash_payment_enabled;
  let cashReason: string | undefined;

  let onlineAllowed = settings.online_payment_enabled;
  let onlineReason: string | undefined;

  if (!settings.cash_payment_enabled) {
    cashAllowed = false;
    cashReason = "Cash payment is temporarily disabled store-wide.";
  } else if (!isAuthenticated) {
    if (!settings.guest_cash_allowed) {
      cashAllowed = false;
      cashReason = "Guest cash orders are restricted. Please sign in or use online payment.";
    }
  } else if (policy === "online_only") {
    cashAllowed = false;
    cashReason = "Online payment is required for your account.";
  } else if (isCashRestricted) {
    cashAllowed = false;
    cashReason = profile?.cash_restriction_reason || "Cash orders restricted due to uncollected orders.";
  }

  if (!settings.online_payment_enabled) {
    onlineAllowed = false;
    onlineReason = "Online payment is currently unavailable store-wide.";
  } else if (isAuthenticated && policy === "cash_only") {
    onlineAllowed = false;
    onlineReason = "Cash payment only is configured for your account.";
  }

  return {
    cashAllowed,
    onlineAllowed,
    cashReason,
    onlineReason,
    policy,
  };
}

/**
 * Loads store-wide payment policy settings
 */
export async function loadStorePaymentSettings(): Promise<StorePaymentSettings> {
  if (!isSupabaseConfigured) {
    return DEFAULT_STORE_PAYMENT_SETTINGS;
  }

  try {
    const { data, error } = await supabase
      .from("store_settings")
      .select("cash_payment_enabled, online_payment_enabled, guest_cash_allowed, max_cash_no_shows_threshold")
      .eq("id", "default")
      .maybeSingle();

    if (error || !data) {
      return DEFAULT_STORE_PAYMENT_SETTINGS;
    }

    return {
      cash_payment_enabled: data.cash_payment_enabled ?? true,
      online_payment_enabled: data.online_payment_enabled ?? true,
      guest_cash_allowed: data.guest_cash_allowed ?? true,
      max_cash_no_shows_threshold: data.max_cash_no_shows_threshold ?? 2,
    };
  } catch {
    return DEFAULT_STORE_PAYMENT_SETTINGS;
  }
}

/**
 * Updates store-wide payment settings (Super Admin / Owner)
 */
export async function updateStorePaymentSettings(
  settings: StorePaymentSettings
): Promise<{ success: boolean; data?: StorePaymentSettings; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: true, data: settings };
  }

  try {
    const { data, error } = await supabase.rpc("admin_update_store_payment_settings", {
      p_cash_enabled: settings.cash_payment_enabled,
      p_online_enabled: settings.online_payment_enabled,
      p_guest_cash_allowed: settings.guest_cash_allowed,
      p_threshold: settings.max_cash_no_shows_threshold,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: settings };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to update payment settings." };
  }
}

/**
 * Loads registered student/customer profiles for administrative review
 */
export async function loadStudentProfiles(searchQuery?: string): Promise<StudentProfile[]> {
  if (!isSupabaseConfigured) {
    return [];
  }

  try {
    let query = supabase
      .from("profiles")
      .select(`
        id,
        full_name,
        phone,
        student_id,
        payment_policy,
        verified_no_show_count,
        cash_restricted,
        cash_restriction_reason,
        cash_restricted_at,
        default_hostel,
        default_block,
        default_room,
        avatar_url,
        created_at,
        updated_at
      `)
      .order("created_at", { ascending: false });

    if (searchQuery && searchQuery.trim()) {
      const q = `%${searchQuery.trim()}%`;
      query = query.or(`full_name.ilike.${q},phone.ilike.${q},student_id.ilike.${q}`);
    }

    const { data, error } = await query;
    if (error || !data) {
      return [];
    }

    return data.map((d: any) => ({
      id: d.id,
      full_name: d.full_name || "Unknown Student",
      phone: d.phone,
      student_id: d.student_id,
      payment_policy: (d.payment_policy as StudentPaymentPolicy) || "default",
      verified_no_show_count: d.verified_no_show_count || 0,
      cash_restricted: !!d.cash_restricted,
      cash_restriction_reason: d.cash_restriction_reason,
      cash_restricted_at: d.cash_restricted_at,
      default_hostel: d.default_hostel,
      default_block: d.default_block,
      default_room: d.default_room,
      avatar_url: d.avatar_url,
      created_at: d.created_at || new Date().toISOString(),
      updated_at: d.updated_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Updates a student's payment policy with audit trail
 */
export async function updateStudentPaymentPolicy(
  studentId: string,
  policy: StudentPaymentPolicy,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: true };
  }

  try {
    const { error } = await supabase.rpc("admin_update_student_payment_policy", {
      p_student_id: studentId,
      p_policy: policy,
      p_reason: reason?.trim() || "Policy changed in admin directory",
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to update payment policy." };
  }
}

/**
 * Loads audit logs for student payment policy adjustments
 */
export async function loadStudentPaymentAuditLogs(studentId?: string): Promise<StudentPaymentAuditLog[]> {
  if (!isSupabaseConfigured) {
    return [];
  }

  try {
    let query = supabase
      .from("student_payment_audit_logs")
      .select(`
        id,
        student_id,
        changed_by,
        previous_policy,
        new_policy,
        reason,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (studentId) {
      query = query.eq("student_id", studentId);
    }

    const { data, error } = await query;
    if (error || !data) {
      return [];
    }

    return data.map((d: any) => ({
      id: d.id,
      student_id: d.student_id,
      changed_by: d.changed_by,
      previous_policy: d.previous_policy as StudentPaymentPolicy,
      new_policy: d.new_policy as StudentPaymentPolicy,
      reason: d.reason,
      created_at: d.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Records a verified uncollected cash order / no-show against a student
 */
export async function recordStudentNoShow(
  studentId: string,
  orderId: string,
  notes?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: true, data: { cash_restricted: false, no_show_count: 1 } };
  }

  try {
    const { data, error } = await supabase.rpc("admin_record_student_no_show", {
      p_student_id: studentId,
      p_order_id: orderId,
      p_notes: notes?.trim() || "Uncollected order verified by delivery coordinator",
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to record uncollected order." };
  }
}

/**
 * Restores cash ordering privileges for a restricted student
 */
export async function restoreStudentCashPrivileges(
  studentId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: true };
  }

  try {
    const { error } = await supabase.rpc("admin_restore_cash_privileges", {
      p_student_id: studentId,
      p_reason: reason?.trim() || "Manual restoration by administrator",
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to restore cash privileges." };
  }
}

/**
 * Disputes or revokes an inaccurately recorded no-show
 */
export async function disputeStudentNoShow(
  recordId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: true };
  }

  try {
    const { error } = await supabase.rpc("admin_dispute_no_show_record", {
      p_record_id: recordId,
      p_reason: reason?.trim() || "Disputed or corrected by administrator",
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to resolve no-show record." };
  }
}

export const disputeStudentNoShowRecord = disputeStudentNoShow;

/**
 * Loads no-show records for a student or globally
 */
export async function loadStudentNoShowRecords(studentId?: string): Promise<StudentNoShowRecord[]> {
  if (!isSupabaseConfigured) {
    return [];
  }

  try {
    let query = supabase
      .from("student_no_show_records")
      .select(`
        id,
        student_id,
        order_id,
        recorded_by,
        notes,
        status,
        revoked_by,
        revoked_at,
        revoke_reason,
        created_at,
        updated_at
      `)
      .order("created_at", { ascending: false });

    if (studentId) {
      query = query.eq("student_id", studentId);
    }

    const { data, error } = await query;
    if (error || !data) {
      return [];
    }

    return data.map((d: any) => ({
      id: d.id,
      student_id: d.student_id,
      order_id: d.order_id,
      recorded_by: d.recorded_by,
      notes: d.notes,
      status: d.status,
      revoked_by: d.revoked_by,
      revoked_at: d.revoked_at,
      revoke_reason: d.revoke_reason,
      created_at: d.created_at,
      updated_at: d.updated_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Verifies online payment transaction securely server-side
 */
export async function verifyPaymentTransaction(
  orderId: string,
  reference: string,
  notes?: string
): Promise<{ success: boolean; verified?: boolean; status?: string; transaction_id?: string; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: true, verified: true, status: "PAID", transaction_id: reference };
  }

  try {
    const { data, error } = await supabase.rpc("verify_payment_transaction", {
      p_order_id: orderId,
      p_reference: reference.trim(),
      p_notes: notes?.trim() || null,
    });

    if (error) {
      return { success: false, verified: false, error: error.message };
    }

    return {
      success: true,
      verified: data?.verified ?? true,
      status: data?.status || "PAID",
      transaction_id: data?.transaction_id || reference,
    };
  } catch (err: any) {
    return { success: false, verified: false, error: err?.message || "Failed to verify payment." };
  }
}

/**
 * Customer-initiated cancellation RPC
 */
export async function customerCancelOrder(
  orderId: string,
  options?: {
    guestToken?: string | null;
    reason?: string | null;
  }
): Promise<{ success: boolean; refundStatus?: string; error?: string }> {
  if (!isSupabaseConfigured) {
    // Demo mode cancellation
    try {
      await createAdminNotification({
        order_id: orderId,
        order_number: "DEMO-CANCELLED",
        event_type: "order_cancelled",
        title: "Order Cancelled by Customer",
        message: `Customer cancelled order ${orderId}. Reason: ${options?.reason || "Self-service cancellation"}.`,
        dedup_key: `order_cancelled:${orderId}`,
      });
    } catch {}

    return {
      success: true,
      refundStatus: "not_applicable",
    };
  }

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
    const { data, error } = await supabase.rpc("customer_cancel_order", {
      p_order_id: isUuid ? orderId : null,
      p_guest_token: options?.guestToken?.trim() || null,
      p_reason: options?.reason?.trim() || null,
      p_order_number: !isUuid ? orderId : null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      refundStatus: data?.refund_status || "not_applicable",
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to cancel order." };
  }
}
