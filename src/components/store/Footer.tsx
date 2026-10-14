import { toast } from "sonner";
import { BRAND_NAME, categories } from "@/data/products";
import { useStore } from "@/lib/store";
import { Logo } from "./Header";

const soon = (name: string) => () => toast(`${name} — page coming soon`);

export function Footer() {
  const { setCategory } = useStore();
  const future = ["My Orders", "Help centre", "Contact us", "Delivery policy", "Cancellation & refund policy", "Privacy policy"];
  return (
    <footer className="mt-12 border-t border-border bg-card">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">Your Campus. Your Marketplace. Everyday essentials delivered straight to your hostel room at Darul Huda University.</p>
        </div>
        <div>
          <h3 className="font-sans text-sm font-bold">Shop</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {categories.map((c) => (
              <li key={c.id}><a href="#shop" onClick={() => setCategory(c.id)} className="hover:text-foreground">{c.name}</a></li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-sans text-sm font-bold">Help & policies</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {future.map((f) => (
              <li key={f}><button type="button" onClick={soon(f)} className="text-left hover:text-foreground">{f} <span className="text-[10px] uppercase text-muted-foreground/70">· soon</span></button></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <p className="container-page py-5 text-xs text-muted-foreground">© {new Date().getFullYear()} {BRAND_NAME}. All rights reserved.</p>
      </div>
    </footer>
  );
}
