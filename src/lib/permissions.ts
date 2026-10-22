/**
 * Shipt Mart — Centralized Role-Based Access Control (RBAC) & Permissions Model
 *
 * Enforces least-privilege access across the 4 administrative roles:
 * 1. Super Admin: Highest system administrator; manages roles, security, blocks, catalog, costs, all orders.
 * 2. Owner: Full business management; manages catalog, banners, branding, all orders, private costs & margins.
 * 3. Store Manager: Operational management; manages catalog, inventory, all orders. Cannot access costs/margins/roles.
 * 4. Block Manager: Strictly limited to assigned block orders & delivery. Cannot access costs, other blocks, catalog, or roles.
 */

export type AdminRole = "super_admin" | "owner" | "store_manager" | "block_manager";

export type AdminPermission =
  | "manage_roles"
  | "manage_security_settings"
  | "manage_block_assignments"
  | "manage_products"
  | "manage_categories"
  | "manage_inventory"
  | "manage_banners"
  | "manage_branding"
  | "view_all_orders"
  | "view_assigned_block_orders"
  | "update_order_status"
  | "manage_supplier_costs"
  | "view_profitability_reports"
  | "view_business_reports"
  | "view_operational_reports"
  | "view_audit_logs";

export interface RoleMetadata {
  id: AdminRole;
  title: string;
  badgeLabel: string;
  badgeClass: string;
  description: string;
}

export const ADMIN_ROLES_METADATA: Record<AdminRole, RoleMetadata> = {
  super_admin: {
    id: "super_admin",
    title: "Super Administrator",
    badgeLabel: "Super Admin",
    badgeClass: "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-400",
    description: "Highest system authority. Manages admin roles, security audit logs, delivery blocks, all orders, and confidential supplier costs.",
  },
  owner: {
    id: "owner",
    title: "Store Owner",
    badgeLabel: "Owner",
    badgeClass: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
    description: "Full business authority. Manages products, categories, inventory, banners, store branding, all orders, and private supplier costs/margins.",
  },
  store_manager: {
    id: "store_manager",
    title: "Store Manager",
    badgeLabel: "Store Manager",
    badgeClass: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400",
    description: "Operational store manager. Manages products, categories, stock levels, and store orders. Confidential supplier costs are restricted.",
  },
  block_manager: {
    id: "block_manager",
    title: "Block Delivery Manager",
    badgeLabel: "Block Manager",
    badgeClass: "bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-400",
    description: "Local block coordinator. Strictly restricted to viewing and processing orders within their assigned delivery block.",
  },
};

/**
 * Authoritative Permission Sets for each Role
 */
export const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<AdminPermission>> = {
  super_admin: new Set<AdminPermission>([
    "manage_roles",
    "manage_security_settings",
    "manage_block_assignments",
    "manage_products",
    "manage_categories",
    "manage_inventory",
    "manage_banners",
    "manage_branding",
    "view_all_orders",
    "view_assigned_block_orders",
    "update_order_status",
    "manage_supplier_costs",
    "view_profitability_reports",
    "view_business_reports",
    "view_operational_reports",
    "view_audit_logs",
  ]),
  owner: new Set<AdminPermission>([
    "manage_products",
    "manage_categories",
    "manage_inventory",
    "manage_banners",
    "manage_branding",
    "view_all_orders",
    "view_assigned_block_orders",
    "update_order_status",
    "manage_supplier_costs",
    "view_profitability_reports",
    "view_business_reports",
    "view_operational_reports",
  ]),
  store_manager: new Set<AdminPermission>([
    "manage_products",
    "manage_categories",
    "manage_inventory",
    "view_all_orders",
    "view_assigned_block_orders",
    "update_order_status",
    "view_operational_reports",
  ]),
  block_manager: new Set<AdminPermission>([
    "view_assigned_block_orders",
    "update_order_status",
    "view_operational_reports",
  ]),
};

/**
 * Centralized authorization check
 */
export function hasPermission(role: AdminRole | null | undefined, permission: AdminPermission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/**
 * Convenience authorization helpers
 */
export function canManageCosts(role: AdminRole | null | undefined): boolean {
  return hasPermission(role, "manage_supplier_costs");
}

export function canManageRoles(role: AdminRole | null | undefined): boolean {
  return hasPermission(role, "manage_roles");
}

export function canManageCatalog(role: AdminRole | null | undefined): boolean {
  return hasPermission(role, "manage_products");
}

export function canManageBanners(role: AdminRole | null | undefined): boolean {
  return hasPermission(role, "manage_banners");
}

export function canManageBranding(role: AdminRole | null | undefined): boolean {
  return hasPermission(role, "manage_branding");
}

export function canViewAllOrders(role: AdminRole | null | undefined): boolean {
  return hasPermission(role, "view_all_orders");
}

export function canViewAuditLogs(role: AdminRole | null | undefined): boolean {
  return hasPermission(role, "view_audit_logs");
}

export function isBlockManager(role: AdminRole | null | undefined): boolean {
  return role === "block_manager";
}

export function getRoleBadge(role: AdminRole | null | undefined): { label: string; className: string } {
  if (!role || !ADMIN_ROLES_METADATA[role]) {
    return {
      label: "Customer / Guest",
      className: "bg-secondary text-secondary-foreground border-border",
    };
  }
  const meta = ADMIN_ROLES_METADATA[role];
  return {
    label: meta.badgeLabel,
    className: meta.badgeClass,
  };
}
