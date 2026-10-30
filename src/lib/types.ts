export type CategoryId =
  | "snacks"
  | "stationery"
  | "personal-care"
  | "hostel"
  | "electronics"
  | "exam";

export interface Category {
  id: CategoryId;
  name: string;
  blurb: string;
}

export interface Product {
  id: string;
  name: string;
  size: string;
  description: string;
  price: number;
  originalPrice?: number | undefined;
  category: CategoryId;
  image: string;
  stock: number;
  bestseller?: boolean | undefined;
  isNew?: boolean | undefined;
  slug?: string | undefined;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export type PaymentMethod = "upi" | "cod" | "payu";

export type OrderStatus =
  | "pending_payment"
  | "placed"
  | "confirmed"
  | "preparing"
  | "ready_for_pickup"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "paid"
  | "completed"
  | "failed"
  | "expired"
  | "refund_pending"
  | "refunded";

export type CustomerNotificationEventType =
  | "order_placed"
  | "payment_initiated"
  | "payment_success"
  | "payment_failed"
  | "order_confirmed"
  | "order_preparing"
  | "order_ready"
  | "order_out_for_delivery"
  | "order_completed"
  | "order_cancelled"
  | "refund_requested"
  | "refund_processing"
  | "refund_completed"
  | "refund_rejected";

export interface CustomerNotification {
  id: string;
  user_id: string;
  order_id?: string | null;
  order_number?: string | null;
  event_type: CustomerNotificationEventType;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  is_read: boolean;
  read_at?: string | null;
  dedup_key?: string | null;
  created_at: string;
}

export interface PayUInitiateParams {
  order_id: string;
  order_number: string;
  amount: number;
  product_info: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  surl?: string;
  furl?: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
}

export interface PayUCheckoutPayload {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  phone: string;
  surl: string;
  furl: string;
  hash: string;
  action_url: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
}

export interface OrderRefundRecord {
  id: string;
  order_id: string;
  payment_id?: string | null;
  amount: number;
  status: "pending" | "processing" | "completed" | "rejected";
  reason?: string | null;
  requested_by?: string | null;
  processed_by?: string | null;
  gateway_refund_id?: string | null;
  admin_notes?: string | null;
  created_at: string;
  updated_at: string;
}
export type DeliveryMethod = "hostel_delivery" | "campus_pickup";

export type StudentPaymentPolicy = "default" | "online_only" | "cash_and_online" | "cash_only";

export interface StudentProfile {
  id: string;
  full_name: string | null;
  phone: string | null;
  student_id?: string | null;
  email?: string | null;
  payment_policy: StudentPaymentPolicy;
  verified_no_show_count: number;
  cash_restricted: boolean;
  cash_restriction_reason?: string | null;
  cash_restricted_at?: string | null;
  default_hostel?: string | null;
  default_block?: string | null;
  default_room?: string | null;
  avatar_url?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface StudentPaymentAuditLog {
  id: string;
  student_id: string;
  changed_by?: string | null;
  changed_by_name?: string | null;
  changed_by_email?: string | null;
  previous_policy: StudentPaymentPolicy;
  new_policy: StudentPaymentPolicy;
  reason?: string | null;
  created_at: string;
}

export interface StudentNoShowRecord {
  id: string;
  student_id: string;
  order_id?: string | null;
  order_number?: string | null;
  recorded_by?: string | null;
  recorded_by_email?: string | null;
  notes?: string | null;
  status: "verified" | "disputed" | "revoked";
  revoked_by?: string | null;
  revoked_at?: string | null;
  revoke_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StorePaymentSettings {
  cash_payment_enabled: boolean;
  online_payment_enabled: boolean;
  guest_cash_allowed: boolean;
  max_cash_no_shows_threshold: number;
}

export type AdminOrderStatusTab = "all" | "pending" | "processing" | "completed" | "cancelled";

export interface CheckoutFormData {
  name: string;
  phone: string;
  deliveryMethod: DeliveryMethod;
  deliveryBlockId?: string;
  hostel?: string;
  block?: string;
  room?: string;
  pickupLocation?: string;
  instructions?: string;
  payment: PaymentMethod;
}

export interface PlacedOrderResult {
  order_id: string;
  order_number: string;
  guest_tracking_token?: string | null;
  total_amount: number;
  status: string;
  payment_method: string;
  payment_status: string;
  payu_txnid?: string | null;
  payu_mihpayid?: string | null;
  payment_expires_at?: string | null;
  delivery_block_id?: string | null;
}

export interface TrackedOrder {
  order_number: string;
  status: string;
  customer_name: string;
  delivery_method: string;
  delivery_block_id?: string | null;
  hostel?: string | null;
  block?: string | null;
  room?: string | null;
  pickup_location?: string | null;
  claimed_by?: string | null;
  claimed_at?: string | null;
  subtotal: number;
  total_amount: number;
  payment_method: string;
  payment_status: string;
  payu_txnid?: string | null;
  payu_mihpayid?: string | null;
  payment_expires_at?: string | null;
  created_at: string;
  items: Array<{
    product_name: string;
    product_size: string;
    unit_price: number;
    quantity: number;
    total_price: number;
  }>;
}

export interface DeliveryBlock {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  display_order?: number;
  assigned_manager_id?: string | null;
  assigned_manager_name?: string | null;
  assigned_manager_email?: string | null;
  total_orders?: number;
  active_orders?: number;
  latest_claimed_at?: string | null;
}

export interface AdminOrderItem {
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

export interface AdminOrderStatusHistory {
  id: string;
  order_id?: string;
  previous_status?: string | null;
  new_status: string;
  notes?: string | null;
  created_at: string;
}

export interface AdminOrder {
  id: string;
  order_number: string;
  user_id?: string | null;
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
  payu_txnid?: string | null;
  payu_mihpayid?: string | null;
  payment_expires_at?: string | null;
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
