import type { CategoryId } from "@/lib/types";

export interface DBProduct {
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
  created_at?: string;
  updated_at?: string;
}

export interface DBCategory {
  id: string;
  name: string;
  blurb: string;
  display_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DBInventoryMovement {
  id: string;
  product_id: string;
  order_id?: string | null;
  movement_type:
    | "order_deduction"
    | "order_cancellation_restock"
    | "manual_adjustment"
    | "restock_shipment"
    | "damaged_loss";
  quantity_change: number;
  previous_stock: number;
  new_stock: number;
  reason?: string | null;
  performed_by?: string | null;
  created_at: string;
  products?: {
    name: string;
    size: string;
    image_url?: string | null;
  } | null;
}

export type ProductSortField = "name" | "price" | "stock" | "created_at" | "display_order";
export type SortDirection = "asc" | "desc";

export interface ProductFilters {
  search: string;
  category: string;
  stockStatus: "all" | "in_stock" | "low_stock" | "out_of_stock";
  activeStatus: "all" | "active" | "archived";
  bestseller: "all" | "yes" | "no";
  sortField: ProductSortField;
  sortDirection: SortDirection;
}

export type BulkActionType =
  | "price_adjust_percent"
  | "price_adjust_fixed"
  | "price_set_fixed"
  | "stock_adjust_add"
  | "stock_adjust_sub"
  | "stock_set_fixed"
  | "category_move"
  | "publish"
  | "unpublish"
  | "bestseller_enable"
  | "bestseller_disable"
  | "archive"
  | "restore"
  | "delete";

export interface BulkOperationPlan {
  type: BulkActionType;
  selectedIds: string[];
  paramValue?: string | number;
  reason?: string;
}

export interface ImportRow {
  rowNumber: number;
  name: string;
  size: string;
  category_id: string;
  price: number;
  original_price: number | null;
  stock: number;
  description: string;
  is_active: boolean;
  bestseller: boolean;
  slug?: string | undefined;
  image_url?: string | undefined;
  isValid: boolean;
  errors: string[];
  isUpdate?: boolean | undefined;
  existingId?: string | undefined;
}
