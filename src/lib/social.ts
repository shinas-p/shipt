/**
 * Shipt Mart — Configurable Social Media Links Library
 *
 * Provides validated URL management for WhatsApp Channel, Instagram, and Facebook.
 * Ensures strict host validation, safe external tab navigation, and truthful database persistence.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface SocialLinks {
  whatsapp?: string | null | undefined;
  instagram?: string | null | undefined;
  facebook?: string | null | undefined;
}

export const SOCIAL_STORAGE_KEY = "shipt_social_links_cache_v1";

export interface SocialValidationResult {
  isValid: boolean;
  normalizedUrl?: string | undefined;
  error?: string | undefined;
}

/**
 * Permitted hostnames for each social media platform
 */
export const PERMITTED_SOCIAL_HOSTS = {
  whatsapp: ["whatsapp.com", "chat.whatsapp.com", "wa.me"],
  instagram: ["instagram.com", "www.instagram.com", "instagr.am"],
  facebook: ["facebook.com", "www.facebook.com", "fb.com", "www.fb.com", "fb.me", "m.facebook.com"],
} as const;

/**
 * Validates and normalizes social media URLs
 */
export function validateSocialUrl(
  platform: "whatsapp" | "instagram" | "facebook",
  rawUrl: string | null | undefined
): SocialValidationResult {
  if (!rawUrl || !rawUrl.trim()) {
    // Empty value is valid (means unconfigured/hidden)
    return { isValid: true, normalizedUrl: "" };
  }

  const trimmed = rawUrl.trim();

  // Guard against dangerous schemes
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  ) {
    return { isValid: false, error: "Invalid URL scheme. Only HTTP and HTTPS are permitted." };
  }

  let parsedUrl: URL;
  try {
    const withScheme = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
    parsedUrl = new URL(withScheme);
  } catch {
    return { isValid: false, error: `Invalid ${platform} URL format.` };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { isValid: false, error: "Only HTTPS or HTTP URLs are allowed." };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const allowed = PERMITTED_SOCIAL_HOSTS[platform];

  const isPermitted = allowed.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`)
  );

  if (!isPermitted) {
    return {
      isValid: false,
      error: `Invalid hostname for ${platform}. Permitted domains: ${allowed.join(", ")}.`,
    };
  }

  return {
    isValid: true,
    normalizedUrl: parsedUrl.toString(),
  };
}

export interface UpdateSocialLinksResult {
  success: boolean;
  persistedToDatabase: boolean;
  localOnly?: boolean | undefined;
  warning?: string | undefined;
  error?: string | undefined;
}

export function useSocialLinks(): {
  socialLinks: SocialLinks;
  isLoading: boolean;
  dbStatus: "synced" | "migration_required" | "offline" | "error";
  refreshSocialLinks: () => Promise<void>;
  updateSocialLinks: (newLinks: SocialLinks) => Promise<UpdateSocialLinksResult>;
} {
  const [socialLinks, setSocialLinks] = useState<SocialLinks>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(SOCIAL_STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === "object") {
            return {
              whatsapp: parsed.whatsapp || null,
              instagram: parsed.instagram || null,
              facebook: parsed.facebook || null,
            };
          }
        }
      } catch {
        // Fallback
      }
    }
    // Default: completely empty per specification (no dummy URLs)
    return {
      whatsapp: null,
      instagram: null,
      facebook: null,
    };
  });

  const [isLoading, setIsLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<"synced" | "migration_required" | "offline" | "error">("synced");

  const refreshSocialLinks = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setDbStatus("offline");
      return;
    }

    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("store_settings")
        .select("social_whatsapp, social_instagram, social_facebook")
        .eq("id", "default")
        .maybeSingle();

      if (error) {
        const isMissingColumns =
          error.code === "PGRST204" ||
          error.code === "PGRST205" ||
          error.code === "42703" ||
          error.message?.includes("schema cache") ||
          error.message?.includes("does not exist") ||
          error.message?.includes("column");

        if (isMissingColumns) {
          setDbStatus("migration_required");
        } else {
          setDbStatus("error");
        }
        return;
      }

      if (data) {
        setDbStatus("synced");
        const fresh: SocialLinks = {
          whatsapp: data.social_whatsapp ? data.social_whatsapp.trim() : null,
          instagram: data.social_instagram ? data.social_instagram.trim() : null,
          facebook: data.social_facebook ? data.social_facebook.trim() : null,
        };
        setSocialLinks(fresh);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(SOCIAL_STORAGE_KEY, JSON.stringify(fresh));
          } catch {}
        }
      }
    } catch {
      setDbStatus("error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSocialLinks();
  }, [refreshSocialLinks]);

  const updateSocialLinks = useCallback(
    async (newLinks: SocialLinks): Promise<UpdateSocialLinksResult> => {
      // Validate inputs
      const waVal = validateSocialUrl("whatsapp", newLinks.whatsapp);
      if (!waVal.isValid) {
        return {
          success: false,
          persistedToDatabase: false,
          error: `WhatsApp Channel: ${waVal.error}`,
        };
      }

      const instaVal = validateSocialUrl("instagram", newLinks.instagram);
      if (!instaVal.isValid) {
        return {
          success: false,
          persistedToDatabase: false,
          error: `Instagram: ${instaVal.error}`,
        };
      }

      const fbVal = validateSocialUrl("facebook", newLinks.facebook);
      if (!fbVal.isValid) {
        return {
          success: false,
          persistedToDatabase: false,
          error: `Facebook: ${fbVal.error}`,
        };
      }

      const normalized: SocialLinks = {
        whatsapp: waVal.normalizedUrl ? waVal.normalizedUrl : null,
        instagram: instaVal.normalizedUrl ? instaVal.normalizedUrl : null,
        facebook: fbVal.normalizedUrl ? fbVal.normalizedUrl : null,
      };

      // Always update local cache
      setSocialLinks(normalized);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(SOCIAL_STORAGE_KEY, JSON.stringify(normalized));
        } catch {}
      }

      if (!isSupabaseConfigured) {
        return {
          success: false,
          persistedToDatabase: false,
          localOnly: true,
          warning: "Saved locally in this browser only. Supabase client is unconfigured.",
        };
      }

      try {
        const payload = {
          social_whatsapp: normalized.whatsapp,
          social_instagram: normalized.instagram,
          social_facebook: normalized.facebook,
          updated_at: new Date().toISOString(),
        };

        const { error: dbError } = await supabase
          .from("store_settings")
          .update(payload)
          .eq("id", "default");

        if (dbError) {
          const isMissingColumns =
            dbError.code === "PGRST204" ||
            dbError.code === "PGRST205" ||
            dbError.code === "42703" ||
            dbError.message?.includes("schema cache") ||
            dbError.message?.includes("does not exist") ||
            dbError.message?.includes("column");

          if (isMissingColumns) {
            setDbStatus("migration_required");
            return {
              success: false,
              persistedToDatabase: false,
              localOnly: true,
              warning:
                "Database migration required: social columns (social_whatsapp, social_instagram, social_facebook) do not exist in public.store_settings yet. Changes are saved in this browser only.",
            };
          }

          setDbStatus("error");
          return {
            success: false,
            persistedToDatabase: false,
            error: `Database save error: ${dbError.message}`,
          };
        }

        setDbStatus("synced");
        return {
          success: true,
          persistedToDatabase: true,
        };
      } catch (err: any) {
        setDbStatus("error");
        return {
          success: false,
          persistedToDatabase: false,
          error: `Network error: ${err?.message || "Failed to reach database"}`,
        };
      }
    },
    []
  );

  return {
    socialLinks,
    isLoading,
    dbStatus,
    refreshSocialLinks,
    updateSocialLinks,
  };
}
