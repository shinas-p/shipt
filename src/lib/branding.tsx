import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface StoreBranding {
  store_name: string;
  tagline: string;
  logo_url: string | null;
  favicon_url: string | null;
  updated_at?: string;
}

export const DEFAULT_BRANDING: StoreBranding = {
  store_name: "Shipt Mart",
  tagline: "Everyday Essentials. Delivered Fast.",
  logo_url: null,
  favicon_url: null,
};

const BRANDING_CACHE_KEY = "shipt_store_branding_cache_v1";

interface BrandingContextType {
  branding: StoreBranding;
  isLoading: boolean;
  error: string | null;
  refreshBranding: () => Promise<void>;
  updateBranding: (
    payload: Partial<StoreBranding>,
    userId?: string | null
  ) => Promise<{ success: boolean; error?: string }>;
}

const BrandingContext = createContext<BrandingContextType | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  // 1. Initialize from cache or default branding
  const [branding, setBranding] = useState<StoreBranding>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(BRANDING_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed.store_name === "string") {
            return {
              store_name: parsed.store_name || DEFAULT_BRANDING.store_name,
              tagline: parsed.tagline || DEFAULT_BRANDING.tagline,
              logo_url: parsed.logo_url ?? null,
              favicon_url: parsed.favicon_url ?? null,
              updated_at: parsed.updated_at,
            };
          }
        }
      } catch {
        // Fallback to defaults
      }
    }
    return DEFAULT_BRANDING;
  });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 2. Fetch fresh branding from Supabase
  const refreshBranding = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      const { data, error: fetchErr } = await supabase
        .from("store_settings")
        .select("store_name, tagline, logo_url, favicon_url, updated_at")
        .eq("id", "default")
        .maybeSingle();

      if (fetchErr) {
        // If table doesn't exist yet or permission denied, keep sensible default
        if (!fetchErr.message.includes("does not exist") && !fetchErr.message.includes("relation")) {
          setError(fetchErr.message);
        }
        return;
      }

      if (data) {
        const fresh: StoreBranding = {
          store_name: data.store_name || DEFAULT_BRANDING.store_name,
          tagline: data.tagline || DEFAULT_BRANDING.tagline,
          logo_url: data.logo_url ?? null,
          favicon_url: data.favicon_url ?? null,
          updated_at: data.updated_at,
        };
        setBranding(fresh);

        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(fresh));
          } catch {}
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load store branding");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBranding();
  }, [refreshBranding]);

  // 3. Dynamic browser title & favicon updater
  useEffect(() => {
    if (typeof document === "undefined") return;

    // Dynamically update document title if it contains store name or tagline
    const currentTitle = document.title;
    if (
      currentTitle.includes("Shipt") ||
      currentTitle.includes(DEFAULT_BRANDING.store_name) ||
      currentTitle.includes(branding.store_name)
    ) {
      if (currentTitle.includes("—")) {
        const parts = currentTitle.split("—");
        const suffix = parts[1]?.trim() || branding.tagline;
        document.title = `${branding.store_name} — ${suffix}`;
      } else {
        document.title = `${branding.store_name} — ${branding.tagline}`;
      }
    }

    // Dynamically update favicon if custom favicon is provided
    if (branding.favicon_url) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.getElementsByTagName("head")[0]?.appendChild(link);
      }
      link.href = branding.favicon_url;
    }
  }, [branding.store_name, branding.tagline, branding.favicon_url]);

  // 4. Update branding persistently (Super Admin)
  const updateBranding = async (
    payload: Partial<StoreBranding>,
    userId?: string | null
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setError(null);
      const merged: StoreBranding = {
        store_name: payload.store_name?.trim() || branding.store_name,
        tagline: payload.tagline?.trim() || branding.tagline,
        logo_url: payload.logo_url !== undefined ? payload.logo_url : branding.logo_url,
        favicon_url: payload.favicon_url !== undefined ? payload.favicon_url : branding.favicon_url,
        updated_at: new Date().toISOString(),
      };

      // Update local state and localStorage cache immediately
      setBranding(merged);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(merged));
        } catch {}
      }

      // Persist to Supabase if configured
      if (isSupabaseConfigured) {
        const { error: dbError } = await supabase.from("store_settings").upsert(
          {
            id: "default",
            store_name: merged.store_name,
            tagline: merged.tagline,
            logo_url: merged.logo_url,
            favicon_url: merged.favicon_url,
            updated_at: merged.updated_at,
            updated_by: userId ?? null,
          },
          { onConflict: "id" }
        );

        if (dbError) {
          setError(dbError.message);
          return { success: false, error: dbError.message };
        }
      }

      return { success: true };
    } catch (err: any) {
      const msg = err?.message || "Failed to save branding settings";
      setError(msg);
      return { success: false, error: msg };
    }
  };

  return (
    <BrandingContext.Provider
      value={{
        branding,
        isLoading,
        error,
        refreshBranding,
        updateBranding,
      }}
    >
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextType {
  const context = useContext(BrandingContext);
  if (!context) {
    // Return sensible defaults if used outside provider (e.g. isolated test environments)
    return {
      branding: DEFAULT_BRANDING,
      isLoading: false,
      error: null,
      refreshBranding: async () => {},
      updateBranding: async () => ({ success: true }),
    };
  }
  return context;
}
