import { createFileRoute } from "@tanstack/react-router";
import { BannerCarousel } from "@/components/store/BannerCarousel";
import { CategoryGrid, ProductGrid, RecentlyAdded } from "@/components/store/Sections";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shipz Mart — Everyday Essentials Delivered to Your Hostel | Darul Huda University" },
      {
        name: "description",
        content:
          "Order snacks, drinks, stationery, notebooks, toiletries, and hostel essentials online with fast doorstep delivery across Darul Huda Islamic University campus.",
      },
      {
        name: "keywords",
        content:
          "Shipz Mart, Shipt, Darul Huda University campus store, hostel essentials delivery, stationery Chemmad, study snacks, exam kits",
      },
      { property: "og:title", content: "Shipz Mart — Everyday Essentials Delivered to Your Hostel" },
      {
        property: "og:description",
        content:
          "Order snacks, drinks, stationery, notebooks, toiletries, and hostel essentials online with fast doorstep delivery across Darul Huda Islamic University campus.",
      },
      { property: "og:url", content: "https://www.shipz.store/" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://www.shipz.store/android-chrome-512x512.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Shipz Mart — Everyday Essentials Delivered to Your Hostel" },
      {
        name: "twitter:description",
        content:
          "Fast doorstep delivery for snacks, stationery, and hostel supplies across Darul Huda University.",
      },
    ],
    links: [
      { rel: "canonical", href: "https://www.shipz.store/" },
    ],
  }),
  component: Index,
});

function Index() {
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Shipz Mart",
    alternateName: ["ShipT", "Shipt Mart"],
    url: "https://www.shipz.store/",
    potentialAction: {
      "@type": "SearchAction",
      target: "https://www.shipz.store/?search={search_term_string}",
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <div className="py-1 md:py-2">
      {/* Search Engine Optimization: Structured Data JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />

      {/* Screen-Reader & SEO Level 1 Heading */}
      <h1 className="sr-only">
        Shipz Mart — Everyday Essentials Delivered to Your Hostel at Darul Huda University
      </h1>

      <BannerCarousel />
      <CategoryGrid />
      <ProductGrid />
      <RecentlyAdded />
    </div>
  );
}
