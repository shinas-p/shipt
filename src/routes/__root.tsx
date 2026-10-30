import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth";
import { BrandingProvider } from "@/lib/branding";
import { MaintenanceProvider, useMaintenance } from "@/lib/maintenance";
import { StoreProvider } from "@/lib/store";
import { Header } from "@/components/store/Header";
import { Footer } from "@/components/store/Footer";
import { CartDrawer } from "@/components/store/CartDrawer";
import { ProductDetailsModal } from "@/components/store/ProductDetailsModal";
import { OpeningLogoAnimation } from "@/components/store/OpeningLogoAnimation";
import { MaintenanceView } from "@/components/store/MaintenanceView";
import { SuggestProductFab } from "@/components/store/SuggestProductFab";
import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Shipz Mart — Everyday Essentials Delivered to Your Hostel" },
      {
        name: "description",
        content:
          "Shipz Mart: Fast and reliable doorstep delivery for snacks, stationery, personal care, and everyday essentials across Darul Huda University campus.",
      },
      {
        name: "keywords",
        content:
          "Shipz Mart, Shipt, Darul Huda University store, campus shopping, hostel delivery, snacks delivery, stationery Chemmad, university essentials",
      },
      { property: "og:site_name", content: "Shipz Mart" },
      { property: "og:title", content: "Shipz Mart — Everyday Essentials Delivered to Your Hostel" },
      {
        property: "og:description",
        content:
          "Fast and reliable doorstep delivery for snacks, stationery, personal care, and everyday essentials across Darul Huda University campus.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.shipz.store/" },
      { property: "og:image", content: "https://www.shipz.store/android-chrome-512x512.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Shipz Mart — Everyday Essentials Delivered to Your Hostel" },
      {
        name: "twitter:description",
        content:
          "Fast doorstep delivery for snacks, stationery, and hostel supplies across Darul Huda University.",
      },
      { name: "theme-color", content: "#15803d" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "Shipz Mart" },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: "https://www.shipz.store/" },
      { rel: "preconnect", href: "https://qevjffvfxovkvyewbcrp.supabase.co" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Shipz Mart",
  alternateName: ["ShipT", "Shipt Mart"],
  url: "https://www.shipz.store",
  logo: "https://www.shipz.store/android-chrome-512x512.png",
  description:
    "Everyday essentials, snacks, stationery, and hostel supplies delivered fast across Darul Huda Islamic University campus.",
  address: {
    "@type": "PostalAddress",
    addressLocality: "Chemmad",
    addressRegion: "Kerala",
    postalCode: "676306",
    addressCountry: "IN",
  },
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "Customer Support",
    telephone: "+91 97475 79848",
    email: "shiptmart@gmail.com",
  },
};

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponentContent() {
  const { isMaintenanceMode } = useMaintenance();
  const location = useLocation();

  // Register single PWA & Web Push Service Worker safely on client mount
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          console.warn("[ShipT PWA] Service worker registration error:", err);
        });
    }
  }, []);

  const isBypassedRoute =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/accept-invitation") ||
    location.pathname.startsWith("/auth.callback") ||
    location.pathname.startsWith("/account");

  if (isMaintenanceMode && !isBypassedRoute) {
    return (
      <>
        <MaintenanceView />
        <Toaster position="top-center" richColors />
      </>
    );
  }

  const isFabHidden =
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/checkout") ||
    location.pathname.startsWith("/accept-invitation") ||
    location.pathname.startsWith("/auth") ||
    location.pathname.startsWith("/suggest-product");

  return (
    <>
      <OpeningLogoAnimation />
      <Header />
      <main className="overflow-x-hidden">
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <ProductDetailsModal />
      {!isFabHidden && <SuggestProductFab />}
      <PwaInstallPrompt />
      <Toaster position="top-center" richColors />
    </>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrandingProvider>
          <MaintenanceProvider>
            <StoreProvider>
              <RootComponentContent />
            </StoreProvider>
          </MaintenanceProvider>
        </BrandingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
