// Demo catalogue — sample prices only, not verified market prices.
// Replace with a database query when the backend is connected.
import type { Category, Product } from "@/lib/types";
import notebook from "@/assets/p-notebook.jpg";
import pen from "@/assets/p-pen.jpg";
import biscuits from "@/assets/p-biscuits.jpg";
import chips from "@/assets/p-chips.jpg";
import chocolate from "@/assets/p-chocolate.jpg";
import toothpaste from "@/assets/p-toothpaste.jpg";
import soap from "@/assets/p-soap.jpg";
import cable from "@/assets/p-cable.jpg";
import detergent from "@/assets/p-detergent.jpg";
import highlighter from "@/assets/p-highlighter.jpg";

export const BRAND_NAME = "Shipt Mart";
export const BRAND_TAGLINE = "Everyday Essentials. Delivered Fast.";
export const CAMPUS_NAME = "Shipt Mart";

export const categories: Category[] = [
  { id: "snacks", name: "Snacks & Drinks", blurb: "Late-night fuel" },
  { id: "stationery", name: "Stationery", blurb: "Notes & pens" },
  { id: "personal-care", name: "Personal Care", blurb: "Daily basics" },
  { id: "hostel", name: "Hostel Essentials", blurb: "Room & laundry" },
  { id: "electronics", name: "Electronics & Accessories", blurb: "Cables & more" },
  { id: "exam", name: "Exam Essentials", blurb: "Ace the paper" },
];

export const SEED_UUID_TO_SLUG: Record<string, string> = {
  "a0000000-0000-0000-0000-000000000001": "notebook-a5",
  "a0000000-0000-0000-0000-000000000002": "pen-blue-3",
  "a0000000-0000-0000-0000-000000000003": "biscuits-cream",
  "a0000000-0000-0000-0000-000000000004": "chips-salted",
  "a0000000-0000-0000-0000-000000000005": "chocolate-dark",
  "a0000000-0000-0000-0000-000000000006": "toothpaste-mint",
  "a0000000-0000-0000-0000-000000000007": "soap-herbal",
  "a0000000-0000-0000-0000-000000000008": "cable-usbc",
  "a0000000-0000-0000-0000-000000000009": "detergent-sachet",
  "a0000000-0000-0000-0000-000000000010": "highlighter-4",
};

export const SLUG_TO_SEED_UUID: Record<string, string> = {
  "notebook-a5": "a0000000-0000-0000-0000-000000000001",
  "pen-blue-3": "a0000000-0000-0000-0000-000000000002",
  "biscuits-cream": "a0000000-0000-0000-0000-000000000003",
  "chips-salted": "a0000000-0000-0000-0000-000000000004",
  "chocolate-dark": "a0000000-0000-0000-0000-000000000005",
  "toothpaste-mint": "a0000000-0000-0000-0000-000000000006",
  "soap-herbal": "a0000000-0000-0000-0000-000000000007",
  "cable-usbc": "a0000000-0000-0000-0000-000000000008",
  "detergent-sachet": "a0000000-0000-0000-0000-000000000009",
  "highlighter-4": "a0000000-0000-0000-0000-000000000010",
};

export const products: Product[] = [
  { id: "notebook-a5", slug: "notebook-a5", name: "Spiral Notebook", size: "A5 · 160 pages", description: "Kraft-cover ruled notebook with sturdy wire binding. Perfect for lecture notes.", price: 60, originalPrice: 75, category: "stationery", image: notebook, stock: 24, bestseller: true },
  { id: "pen-blue-3", slug: "pen-blue-3", name: "Blue Ballpoint Pens", size: "Pack of 3", description: "Smooth-writing blue ballpoint pens with a comfortable grip.", price: 30, category: "exam", image: pen, stock: 40, bestseller: true },
  { id: "biscuits-cream", slug: "biscuits-cream", name: "Cream Biscuits", size: "120 g", description: "Classic vanilla cream sandwich biscuits for study breaks.", price: 25, category: "snacks", image: biscuits, stock: 18 },
  { id: "chips-salted", slug: "chips-salted", name: "Salted Potato Chips", size: "52 g", description: "Crunchy, lightly salted potato chips.", price: 20, category: "snacks", image: chips, stock: 30, bestseller: true },
  { id: "chocolate-dark", slug: "chocolate-dark", name: "Dark Chocolate Bar", size: "50 g", description: "Rich dark chocolate — a small treat after a long day.", price: 80, originalPrice: 95, category: "snacks", image: chocolate, stock: 0 },
  { id: "toothpaste-mint", slug: "toothpaste-mint", name: "Mint Toothpaste", size: "100 g", description: "Fresh mint fluoride toothpaste for everyday use.", price: 55, category: "personal-care", image: toothpaste, stock: 15 },
  { id: "soap-herbal", slug: "soap-herbal", name: "Herbal Bathing Soap", size: "100 g", description: "Gentle herbal soap bar with a fresh scent.", price: 40, category: "personal-care", image: soap, stock: 22, isNew: true },
  { id: "cable-usbc", slug: "cable-usbc", name: "USB-C Charging Cable", size: "1 m", description: "Durable USB-C to USB-C cable for phones and tablets.", price: 199, originalPrice: 249, category: "electronics", image: cable, stock: 6, isNew: true },
  { id: "detergent-sachet", slug: "detergent-sachet", name: "Detergent Sachets", size: "Pack of 3", description: "Single-wash detergent powder sachets — easy for quick everyday laundry.", price: 30, category: "hostel", image: detergent, stock: 3, isNew: true },
  { id: "highlighter-4", slug: "highlighter-4", name: "Highlighter Set", size: "4 colours", description: "Bright chisel-tip highlighters for revision season.", price: 90, category: "exam", image: highlighter, stock: 12, isNew: true },
];

export const getProduct = (id: string): Product | undefined => {
  if (!id) return undefined;
  const lower = id.toLowerCase().trim();
  const mappedSlug = SEED_UUID_TO_SLUG[lower];
  const mappedUuid = SLUG_TO_SEED_UUID[lower];

  return products.find(
    (p) =>
      p.id === id ||
      p.id.toLowerCase() === lower ||
      (p.slug && (p.slug === id || p.slug.toLowerCase() === lower)) ||
      (mappedSlug && (p.slug === mappedSlug || p.id === mappedSlug)) ||
      (mappedUuid && (p.id === mappedUuid || p.slug === mappedUuid))
  );
};
export const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;
