import { createFileRoute } from "@tanstack/react-router";
import { BannerCarousel } from "@/components/store/BannerCarousel";
import { CategoryGrid, ProductGrid, RecentlyAdded } from "@/components/store/Sections";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shipt Mart — Everyday Essentials Delivered" },
      { name: "description", content: "Snacks, stationery, personal care, and everyday essentials delivered straight to your door." },
      { property: "og:title", content: "Shipt Mart — Everyday Essentials Delivered" },
      { property: "og:description", content: "Snacks, stationery, personal care, and everyday essentials delivered straight to your door." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="py-1 md:py-2">
      <BannerCarousel />
      <CategoryGrid />
      <ProductGrid />
      <RecentlyAdded />
    </div>
  );
}
