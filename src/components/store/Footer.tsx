import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Phone, Mail, MessageCircle } from "lucide-react";
import { categories } from "@/data/products";
import { useStore } from "@/lib/store";
import { useBranding } from "@/lib/branding";
import { useStoreContact } from "@/lib/contact";
import { Logo } from "./Header";

const soon = (name: string) => () => toast(`${name} — page coming soon`);

export function Footer() {
  const { setCategory } = useStore();
  const { branding } = useBranding();
  const { contact } = useStoreContact();
  const futurePolicies = [
    "My Orders",
    "Help centre",
    "Delivery policy",
    "Cancellation & refund policy",
    "Privacy policy",
  ];

  return (
    <footer className="mt-12 border-t border-border bg-card">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2 space-y-4">
          <div>
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              {branding.tagline} Everyday essentials delivered straight to your doorstep fast.
            </p>
          </div>

          {/* Quick Support Contacts */}
          <div className="space-y-1.5 pt-1 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Support & Inquiries:</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <a
                href={contact.phoneHref}
                className="inline-flex items-center gap-1.5 hover:text-foreground transition"
              >
                <Phone className="size-3.5 text-primary" />
                <span>{contact.phone}</span>
              </a>
              <a
                href={contact.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-foreground transition"
              >
                <MessageCircle className="size-3.5 text-emerald-600" />
                <span>WhatsApp</span>
              </a>
              <a
                href={contact.emailHref}
                className="inline-flex items-center gap-1.5 hover:text-foreground transition"
              >
                <Mail className="size-3.5 text-amber-600" />
                <span>{contact.email}</span>
              </a>
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-sans text-sm font-bold">Shop</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {categories.map((c) => (
              <li key={c.id}>
                <a
                  href="#shop"
                  onClick={() => setCategory(c.id)}
                  className="hover:text-foreground"
                >
                  {c.name}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-sans text-sm font-bold">Help & Support</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/contact" className="font-medium text-foreground hover:text-primary transition">
                Contact Us
              </Link>
            </li>
            <li>
              <Link to="/suggest-product" className="hover:text-foreground transition">
                Suggest a Product
              </Link>
            </li>
            {futurePolicies.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onClick={soon(f)}
                  className="text-left hover:text-foreground"
                >
                  {f}{" "}
                  <span className="text-[10px] uppercase text-muted-foreground/70">
                    · soon
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <p className="container-page py-5 text-xs text-muted-foreground">
          © {new Date().getFullYear()} {branding.store_name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
