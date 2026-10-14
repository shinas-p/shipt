import { createFileRoute } from "@tanstack/react-router";
import { BannerCarousel } from "@/components/store/BannerCarousel";
import { CategoryGrid, ProductGrid, RecentlyAdded } from "@/components/store/Sections";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shipt — Your Campus. Your Marketplace." },
      { name: "description", content: "Snacks, stationery, and hostel essentials delivered straight to your room at Darul Huda University." },
      { property: "og:title", content: "Shipt — Your Campus. Your Marketplace." },
      { property: "og:description", content: "Snacks, stationery, and hostel essentials delivered straight to your room at Darul Huda University." },
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
