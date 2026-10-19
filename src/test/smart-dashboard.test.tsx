import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  SmartDashboard,
  AdminOrder,
  DBProduct,
} from "@/components/admin/SmartDashboard";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className, ...props }: any) => (
    <a href={to} className={className} {...props}>
      {children}
    </a>
  ),
}));

describe("Shipt Smart Dashboard Enhancement", { timeout: 15000 }, () => {
  const mockOnRefresh = vi.fn();
  const mockOnNavigateTab = vi.fn();
  const mockOnAddNewProduct = vi.fn();
  const mockOnManageInventory = vi.fn();
  const mockOnViewOrder = vi.fn();
  const mockOnEditProduct = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const now = new Date();
  const todayISO = now.toISOString();

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayISO = yesterday.toISOString();

  const mockProducts: DBProduct[] = [
    {
      id: "prod-1",
      name: "Blue Ballpoint Pens",
      size: "Pack of 5",
      description: "Smooth gel pens",
      price: 30,
      stock: 1, // Low stock (1 <= 5)
      category_id: "exam",
      image_url: "/pens.jpg",
      is_active: true,
    },
    {
      id: "prod-2",
      name: "Notebook Spiral A5",
      size: "160 pages",
      description: "College ruled",
      price: 60,
      stock: 0, // Out of stock (0 <= 5)
      category_id: "stationery",
      image_url: "/notebook.jpg",
      is_active: true,
    },
    {
      id: "prod-3",
      name: "Dark Chocolate Bar",
      size: "50 g",
      description: "70% Cocoa",
      price: 80,
      stock: 15, // Healthy stock (> 5)
      category_id: "snacks",
      image_url: "/chocolate.jpg",
      is_active: true,
    },
    {
      id: "prod-4",
      name: "Salted Potato Chips",
      size: "80 g",
      description: "Crispy",
      price: 25,
      stock: 22, // Healthy stock (> 5)
      category_id: "snacks",
      image_url: "/chips.jpg",
      is_active: true,
    },
  ];

  const mockOrders: AdminOrder[] = [
    // Today paid order (Gross sales = 150)
    {
      id: "order-1",
      order_number: "QM-20261018-A1B2C3D4",
      customer_name: "Rahul Sharma",
      customer_phone: "9876543210",
      delivery_method: "hostel_delivery",
      hostel: "Ganga Hostel",
      room: "204",
      status: "completed",
      subtotal: 150,
      total_amount: 150,
      payment_method: "upi",
      payment_status: "completed",
      created_at: todayISO,
    },
    // Today active placed order (Pending, unpaid yet = 220)
    {
      id: "order-2",
      order_number: "QM-20261018-E5F6G7H8",
      customer_name: "Priya Nair",
      customer_phone: "9123456780",
      delivery_method: "campus_pickup",
      pickup_location: "Shipt Central Hub",
      status: "placed",
      subtotal: 220,
      total_amount: 220,
      payment_method: "cod",
      payment_status: "pending",
      created_at: todayISO,
    },
    // Today cancelled order (Should NOT count in sales, even if total_amount is set)
    {
      id: "order-3",
      order_number: "QM-20261018-CANCEL01",
      customer_name: "Aman Khan",
      customer_phone: "9988776655",
      delivery_method: "hostel_delivery",
      hostel: "Yamuna Hostel",
      room: "102",
      status: "cancelled",
      subtotal: 300,
      total_amount: 300,
      payment_method: "upi",
      payment_status: "refunded",
      created_at: todayISO,
    },
    // Yesterday completed order (Should NOT count in today's sales or today's orders)
    {
      id: "order-4",
      order_number: "QM-20261017-YEST0001",
      customer_name: "Sara Ali",
      customer_phone: "9876501234",
      delivery_method: "hostel_delivery",
      hostel: "Kaveri Hostel",
      room: "310",
      status: "completed",
      subtotal: 180,
      total_amount: 180,
      payment_method: "upi",
      payment_status: "completed",
      created_at: yesterdayISO,
    },
  ];

  it("calculates accurate summary metrics for Today's Sales, Orders, and Pending status", () => {
    render(
      <SmartDashboard
        orders={mockOrders}
        products={mockProducts}
        ordersLoading={false}
        productsLoading={false}
        adminRole="super_admin"
        onRefresh={mockOnRefresh}
        onNavigateTab={mockOnNavigateTab}
        onAddNewProduct={mockOnAddNewProduct}
        onManageInventory={mockOnManageInventory}
        onViewOrder={mockOnViewOrder}
        onEditProduct={mockOnEditProduct}
      />
    );

    // 1. Today's Sales: Only order-1 counts (150). order-2 is unpaid/pending, order-3 is cancelled.
    const salesCard = screen.getByTestId("metric-today-sales");
    expect(salesCard).toHaveTextContent("₹150");
    expect(salesCard).toHaveTextContent("1 order paid");

    // 2. Today's Orders: 3 orders created today (order-1, order-2, order-3)
    const ordersCard = screen.getByTestId("metric-today-orders");
    expect(ordersCard).toHaveTextContent("3");
    expect(ordersCard).toHaveTextContent("1 completed");

    // 3. Pending Orders: Only active non-terminal orders (order-2 with status 'placed')
    const pendingCard = screen.getByTestId("metric-pending-orders");
    expect(pendingCard).toHaveTextContent("1");
    expect(pendingCard).toHaveTextContent("1 new placed");

    // 4. Total Products: 4 products
    const productsCard = screen.getByTestId("metric-total-products");
    expect(productsCard).toHaveTextContent("4");
    expect(productsCard).toHaveTextContent("4 active in storefront");

    // 5. Low Stock: 2 items with stock <= 5 (prod-1 with 1, prod-2 with 0)
    const lowStockCard = screen.getByTestId("metric-low-stock");
    expect(lowStockCard).toHaveTextContent("2");
    expect(lowStockCard).toHaveTextContent("1 low stock · 1 out of stock");
  });

  it("renders low-stock alerts list with accurate badges and restock action", () => {
    render(
      <SmartDashboard
        orders={mockOrders}
        products={mockProducts}
        ordersLoading={false}
        productsLoading={false}
        adminRole="store_manager"
        onRefresh={mockOnRefresh}
        onNavigateTab={mockOnNavigateTab}
        onAddNewProduct={mockOnAddNewProduct}
        onManageInventory={mockOnManageInventory}
        onViewOrder={mockOnViewOrder}
        onEditProduct={mockOnEditProduct}
      />
    );

    expect(screen.getByText("Blue Ballpoint Pens")).toBeInTheDocument();
    expect(screen.getByText("1 left")).toBeInTheDocument();

    expect(screen.getByText("Notebook Spiral A5")).toBeInTheDocument();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();

    // Click restock button
    const restockButtons = screen.getAllByRole("button", { name: /restock/i });
    expect(restockButtons.length).toBe(2);
    fireEvent.click(restockButtons[0]!);
    expect(mockOnEditProduct).toHaveBeenCalledWith(mockProducts[1]); // Out of stock (0) is sorted first
  });

  it("handles empty order datasets gracefully without NaN or runtime errors", () => {
    render(
      <SmartDashboard
        orders={[]}
        products={mockProducts}
        ordersLoading={false}
        productsLoading={false}
        adminRole="store_manager"
        onRefresh={mockOnRefresh}
        onNavigateTab={mockOnNavigateTab}
        onAddNewProduct={mockOnAddNewProduct}
        onManageInventory={mockOnManageInventory}
        onViewOrder={mockOnViewOrder}
        onEditProduct={mockOnEditProduct}
      />
    );

    const salesCard = screen.getByTestId("metric-today-sales");
    expect(salesCard).toHaveTextContent("₹0");
    expect(salesCard).toHaveTextContent("0 paid orders today");

    const ordersCard = screen.getByTestId("metric-today-orders");
    expect(ordersCard).toHaveTextContent("0");

    expect(screen.getByText("No orders recorded yet")).toBeInTheDocument();
    expect(screen.getByText("No paid orders in the last 7 days")).toBeInTheDocument();
  });

  it("handles empty low stock dataset with healthy stock confirmation", () => {
    const fullyStocked = mockProducts.map((p) => ({ ...p, stock: 25 }));

    render(
      <SmartDashboard
        orders={mockOrders}
        products={fullyStocked}
        ordersLoading={false}
        productsLoading={false}
        adminRole="super_admin"
        onRefresh={mockOnRefresh}
        onNavigateTab={mockOnNavigateTab}
        onAddNewProduct={mockOnAddNewProduct}
        onManageInventory={mockOnManageInventory}
        onViewOrder={mockOnViewOrder}
        onEditProduct={mockOnEditProduct}
      />
    );

    expect(screen.getByText("Healthy Inventory")).toBeInTheDocument();
    expect(
      screen.getByText("All campus catalog products currently have 6 or more units in stock.")
    ).toBeInTheDocument();
  });

  it("respects role permissions: restricts Staff & Roles shortcut for Store Managers", () => {
    // 1. As store_manager
    const { rerender } = render(
      <SmartDashboard
        orders={mockOrders}
        products={mockProducts}
        ordersLoading={false}
        productsLoading={false}
        adminRole="store_manager"
        onRefresh={mockOnRefresh}
        onNavigateTab={mockOnNavigateTab}
        onAddNewProduct={mockOnAddNewProduct}
        onManageInventory={mockOnManageInventory}
        onViewOrder={mockOnViewOrder}
        onEditProduct={mockOnEditProduct}
      />
    );

    const rolesBtn = screen.getByRole("button", { name: /staff & roles/i });
    expect(rolesBtn).toBeDisabled();

    // 2. As super_admin
    rerender(
      <SmartDashboard
        orders={mockOrders}
        products={mockProducts}
        ordersLoading={false}
        productsLoading={false}
        adminRole="super_admin"
        onRefresh={mockOnRefresh}
        onNavigateTab={mockOnNavigateTab}
        onAddNewProduct={mockOnAddNewProduct}
        onManageInventory={mockOnManageInventory}
        onViewOrder={mockOnViewOrder}
        onEditProduct={mockOnEditProduct}
      />
    );

    const superRolesBtn = screen.getByRole("button", { name: /staff & roles/i });
    expect(superRolesBtn).not.toBeDisabled();
    fireEvent.click(superRolesBtn);
    expect(mockOnNavigateTab).toHaveBeenCalledWith("roles");
  });

  it("triggers quick-action shortcuts for Add Product, Manage Inventory, and View All Orders", () => {
    render(
      <SmartDashboard
        orders={mockOrders}
        products={mockProducts}
        ordersLoading={false}
        productsLoading={false}
        adminRole="super_admin"
        onRefresh={mockOnRefresh}
        onNavigateTab={mockOnNavigateTab}
        onAddNewProduct={mockOnAddNewProduct}
        onManageInventory={mockOnManageInventory}
        onViewOrder={mockOnViewOrder}
        onEditProduct={mockOnEditProduct}
      />
    );

    // Click Add Product
    const addProductBtn = screen.getByRole("button", { name: /add product/i });
    fireEvent.click(addProductBtn);
    expect(mockOnAddNewProduct).toHaveBeenCalledTimes(1);

    // Click Stock & Inventory
    const inventoryBtn = screen.getByRole("button", { name: /stock & inventory/i });
    fireEvent.click(inventoryBtn);
    expect(mockOnManageInventory).toHaveBeenCalledTimes(1);

    // Click View Orders
    const viewOrdersBtn = screen.getByRole("button", { name: /view orders/i });
    fireEvent.click(viewOrdersBtn);
    expect(mockOnNavigateTab).toHaveBeenCalledWith("orders");
  });

  it("allows authorized admin to open order details from recent orders table", () => {
    render(
      <SmartDashboard
        orders={mockOrders}
        products={mockProducts}
        ordersLoading={false}
        productsLoading={false}
        adminRole="super_admin"
        onRefresh={mockOnRefresh}
        onNavigateTab={mockOnNavigateTab}
        onAddNewProduct={mockOnAddNewProduct}
        onManageInventory={mockOnManageInventory}
        onViewOrder={mockOnViewOrder}
        onEditProduct={mockOnEditProduct}
      />
    );

    expect(screen.getByText("QM-20261018-A1B2C3D4")).toBeInTheDocument();
    expect(screen.getByText("Rahul Sharma")).toBeInTheDocument();

    const viewButtons = screen.getAllByRole("button", { name: /^view$/i });
    fireEvent.click(viewButtons[0]!);
    expect(mockOnViewOrder).toHaveBeenCalledWith(mockOrders[0]);
  });
});
