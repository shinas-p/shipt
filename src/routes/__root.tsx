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
      { title: "Shipt Mart — Everyday Essentials Delivered" },
      { name: "description", content: "Shipt Mart: Fast and reliable delivery for snacks, stationery, personal care, and everyday essentials straight to your door." },
      { property: "og:title", content: "Shipt Mart — Everyday Essentials Delivered" },
      { property: "og:description", content: "Shipt Mart: Fast and reliable delivery for snacks, stationery, personal care, and everyday essentials straight to your door." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&display=swap" },
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

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
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
