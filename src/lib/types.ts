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
  hostel: string;
  block: string;
  room: string;
  pickupLocation: string;
  instructions: string;
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
}

export interface TrackedOrder {
  order_number: string;
  status: string;
  customer_name: string;
  delivery_method: string;
  hostel?: string | null;
  block?: string | null;
  room?: string | null;
  pickup_location?: string | null;
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
