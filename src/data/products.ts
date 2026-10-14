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

export const BRAND_NAME = "Shipt";
export const BRAND_TAGLINE = "Your Campus. Your Marketplace.";
export const CAMPUS_NAME = "Darul Huda University";

export const categories: Category[] = [
  { id: "snacks", name: "Snacks & Drinks", blurb: "Late-night fuel" },
  { id: "stationery", name: "Stationery", blurb: "Notes & pens" },
  { id: "personal-care", name: "Personal Care", blurb: "Daily basics" },
  { id: "hostel", name: "Hostel Essentials", blurb: "Room & laundry" },
  { id: "electronics", name: "Electronics & Accessories", blurb: "Cables & more" },
  { id: "exam", name: "Exam Essentials", blurb: "Ace the paper" },
];

export const products: Product[] = [
  { id: "notebook-a5", name: "Spiral Notebook", size: "A5 · 160 pages", description: "Kraft-cover ruled notebook with sturdy wire binding. Perfect for lecture notes.", price: 60, originalPrice: 75, category: "stationery", image: notebook, stock: 24, bestseller: true },
  { id: "pen-blue-3", name: "Blue Ballpoint Pens", size: "Pack of 3", description: "Smooth-writing blue ballpoint pens with a comfortable grip.", price: 30, category: "exam", image: pen, stock: 40, bestseller: true },
  { id: "biscuits-cream", name: "Cream Biscuits", size: "120 g", description: "Classic vanilla cream sandwich biscuits for study breaks.", price: 25, category: "snacks", image: biscuits, stock: 18 },
  { id: "chips-salted", name: "Salted Potato Chips", size: "52 g", description: "Crunchy, lightly salted potato chips.", price: 20, category: "snacks", image: chips, stock: 30, bestseller: true },
  { id: "chocolate-dark", name: "Dark Chocolate Bar", size: "50 g", description: "Rich dark chocolate — a small treat after a long day.", price: 80, originalPrice: 95, category: "snacks", image: chocolate, stock: 0 },
  { id: "toothpaste-mint", name: "Mint Toothpaste", size: "100 g", description: "Fresh mint fluoride toothpaste for everyday use.", price: 55, category: "personal-care", image: toothpaste, stock: 15 },
  { id: "soap-herbal", name: "Herbal Bathing Soap", size: "100 g", description: "Gentle herbal soap bar with a fresh scent.", price: 40, category: "personal-care", image: soap, stock: 22, isNew: true },
  { id: "cable-usbc", name: "USB-C Charging Cable", size: "1 m", description: "Durable USB-C to USB-C cable for phones and tablets.", price: 199, originalPrice: 249, category: "electronics", image: cable, stock: 6, isNew: true },
  { id: "detergent-sachet", name: "Detergent Sachets", size: "Pack of 3", description: "Single-wash detergent powder sachets — easy for hostel laundry.", price: 30, category: "hostel", image: detergent, stock: 3, isNew: true },
  { id: "highlighter-4", name: "Highlighter Set", size: "4 colours", description: "Bright chisel-tip highlighters for revision season.", price: 90, category: "exam", image: highlighter, stock: 12, isNew: true },
];

export const getProduct = (id: string) => products.find((p) => p.id === id);
export const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;
