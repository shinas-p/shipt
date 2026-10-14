import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckoutForm } from "@/components/store/CheckoutForm";

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout — Shipt" },
      { name: "description", content: "Fast delivery to your hostel room or campus pickup at Darul Huda University." },
      { property: "og:title", content: "Checkout — Shipt" },
      { property: "og:description", content: "Fast delivery to your hostel room or campus pickup at Darul Huda University." },
    ],
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  return (
    <div className="container-page py-6 md:py-10">
      <Link to="/" className="text-sm font-semibold text-primary hover:underline">
        ← Continue shopping
      </Link>
      <h1 className="mt-3 font-display text-3xl font-extrabold sm:text-4xl text-foreground">
        Checkout
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Order essentials directly to your hostel room or arrange easy campus pickup.
      </p>
      <CheckoutForm />
    </div>
  );
}
