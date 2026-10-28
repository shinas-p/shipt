import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Phone,
  Mail,
  MessageCircle,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Building2,
  Clock,
  Sparkles,
  ExternalLink,
  Instagram,
  Facebook,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/lib/branding";
import { useStoreContact } from "@/lib/contact";
import { useSocialLinks } from "@/lib/social";
import { STORE_CONTACT, getWhatsAppChatLink } from "@/data/contact";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Us — Shipt Mart Campus Store" },
      {
        name: "description",
        content:
          "Need help or have questions? Contact Shipt Mart support via phone, email, or WhatsApp for quick campus delivery assistance.",
      },
      { property: "og:title", content: "Contact Us — Shipt Mart" },
      {
        property: "og:description",
        content:
          "Reach out to Shipt Mart support via phone (+91 9605174298), email, or WhatsApp.",
      },
    ],
  }),
  component: ContactPage,
});

export function ContactPage() {
  const { branding } = useBranding();
  const { contact } = useStoreContact();
  const { socialLinks } = useSocialLinks();

  return (
    <div className="min-h-screen bg-background py-8 sm:py-12">
      <div className="container-page max-w-4xl space-y-8">
        {/* Navigation Breadcrumb */}
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3 gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Link to="/">
              <ArrowLeft className="size-4" />
              <span>Back to Store</span>
            </Link>
          </Button>
        </div>

        {/* Header Hero Banner */}
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-10">
          <div className="relative z-10 max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
              <Sparkles className="size-3.5" />
              <span>Campus Customer Support</span>
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              We're here to help you
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed sm:text-base">
              Have questions about your order, delivery to your hostel, or need help with a purchase? Get in touch with the {branding.store_name} team directly.
            </p>
          </div>
        </div>

        {/* Contact Channels Grid */}
        <div className="grid gap-6 md:grid-cols-3">
          {/* Channel 1: WhatsApp Support */}
          <div className="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-soft transition hover:border-primary/40 hover:shadow-lift">
            <div className="space-y-3">
              <div className="grid size-12 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600">
                <MessageCircle className="size-6" />
              </div>
              <h2 className="font-display text-lg font-bold text-foreground">WhatsApp Support</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Chat with our support executive for instant order inquiries and quick help.
              </p>
              <p className="font-mono text-sm font-bold text-foreground">{contact.whatsapp}</p>
            </div>
            <div className="pt-6">
              <a
                href={contact.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground shadow-2xs transition hover:bg-primary/90 active:scale-95"
                id="contact-whatsapp-btn"
              >
                <span>Chat on WhatsApp</span>
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>

          {/* Channel 2: Phone Call */}
          <div className="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-soft transition hover:border-primary/40 hover:shadow-lift">
            <div className="space-y-3">
              <div className="grid size-12 place-items-center rounded-2xl bg-blue-500/10 text-blue-600">
                <Phone className="size-6" />
              </div>
              <h2 className="font-display text-lg font-bold text-foreground">Phone Support</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Direct phone helpline for urgent order questions and campus delivery coordination.
              </p>
              <p className="font-mono text-sm font-bold text-foreground">{contact.phone}</p>
            </div>
            <div className="pt-6">
              <a
                href={contact.phoneHref}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-input bg-background px-4 text-xs font-bold text-foreground transition hover:bg-accent hover:text-accent-foreground active:scale-95"
                id="contact-phone-btn"
              >
                <span>Call Helpline</span>
                <Phone className="size-3.5" />
              </a>
            </div>
          </div>

          {/* Channel 3: Email Support */}
          <div className="flex flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-soft transition hover:border-primary/40 hover:shadow-lift">
            <div className="space-y-3">
              <div className="grid size-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600">
                <Mail className="size-6" />
              </div>
              <h2 className="font-display text-lg font-bold text-foreground">Email Support</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Send us inquiries, feedback, or suggestions directly to our inbox.
              </p>
              <p className="font-mono text-xs font-bold text-foreground truncate" title={contact.email}>
                {contact.email}
              </p>
            </div>
            <div className="pt-6">
              <a
                href={contact.emailHref}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-input bg-background px-4 text-xs font-bold text-foreground transition hover:bg-accent hover:text-accent-foreground active:scale-95"
                id="contact-email-btn"
              >
                <span>Send Email</span>
                <Mail className="size-3.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Configurable Social Media Section (Hidden when unconfigured) */}
        {(socialLinks.whatsapp || socialLinks.instagram || socialLinks.facebook) && (
          <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8 space-y-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-primary">
                <Share2 className="size-3.5" />
                <span>Follow & Connect</span>
              </div>
              <h3 className="font-display text-lg font-bold text-foreground">
                Join our Campus Community
              </h3>
              <p className="text-xs text-muted-foreground">
                Stay updated with the latest product arrivals, flash offers, and store announcements across our official channels.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 pt-2">
              {socialLinks.whatsapp && (
                <a
                  href={socialLinks.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Join our WhatsApp Channel"
                  className="flex items-center justify-between rounded-2xl border border-border/80 bg-background/50 p-4 transition hover:border-emerald-500/50 hover:bg-emerald-500/5 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
                      <MessageCircle className="size-5" />
                    </div>
                    <div>
                      <p className="font-display text-xs font-bold text-foreground group-hover:text-emerald-600 transition">
                        WhatsApp Channel
                      </p>
                      <p className="text-[11px] text-muted-foreground">Daily drops & alerts</p>
                    </div>
                  </div>
                  <ExternalLink className="size-4 text-muted-foreground group-hover:text-emerald-600 transition" />
                </a>
              )}

              {socialLinks.instagram && (
                <a
                  href={socialLinks.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Follow us on Instagram"
                  className="flex items-center justify-between rounded-2xl border border-border/80 bg-background/50 p-4 transition hover:border-pink-500/50 hover:bg-pink-500/5 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-xl bg-pink-500/10 text-pink-600">
                      <Instagram className="size-5" />
                    </div>
                    <div>
                      <p className="font-display text-xs font-bold text-foreground group-hover:text-pink-600 transition">
                        Instagram
                      </p>
                      <p className="text-[11px] text-muted-foreground">Stories & sneak peeks</p>
                    </div>
                  </div>
                  <ExternalLink className="size-4 text-muted-foreground group-hover:text-pink-600 transition" />
                </a>
              )}

              {socialLinks.facebook && (
                <a
                  href={socialLinks.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Follow us on Facebook"
                  className="flex items-center justify-between rounded-2xl border border-border/80 bg-background/50 p-4 transition hover:border-blue-500/50 hover:bg-blue-500/5 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                      <Facebook className="size-5" />
                    </div>
                    <div>
                      <p className="font-display text-xs font-bold text-foreground group-hover:text-blue-600 transition">
                        Facebook
                      </p>
                      <p className="text-[11px] text-muted-foreground">Community & updates</p>
                    </div>
                  </div>
                  <ExternalLink className="size-4 text-muted-foreground group-hover:text-blue-600 transition" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Suggestion & Quick Action Card */}
        <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center sm:text-left">
            <h3 className="font-display text-base font-bold text-foreground">Looking for a specific product?</h3>
            <p className="text-xs text-muted-foreground max-w-lg">
              Can't find what you need in the store? Submit a product suggestion and our team will work to bring it to campus!
            </p>
          </div>
          <Button asChild variant="hero" className="shrink-0 h-11 px-5 text-xs font-bold gap-2">
            <Link to="/suggest-product">
              <span>Suggest a Product</span>
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
