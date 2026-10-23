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

export type PaymentMethod = "upi" | "cod";
export type DeliveryMethod = "hostel_delivery" | "campus_pickup";

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
