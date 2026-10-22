import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Safely retrieve environment variables across client and SSR contexts using static property access
// Vite's define plugin statically replaces static member expressions (e.g. import.meta.env.VITE_*) at build time.
const supabaseUrl: string =
  (typeof import.meta !== "undefined" && import.meta.env && (
    import.meta.env.VITE_SUPABASE_URL ||
    import.meta.env.VITE_PUBLIC_SUPABASE_URL ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL
  )) ||
  (typeof process !== "undefined" && process.env && (
    process.env["VITE_SUPABASE_URL"] ||
    process.env["NEXT_PUBLIC_SUPABASE_URL"] ||
    process.env["SUPABASE_URL"]
  )) ||
  "";

const supabasePublishableKey: string =
  (typeof import.meta !== "undefined" && import.meta.env && (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )) ||
  (typeof process !== "undefined" && process.env && (
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["VITE_SUPABASE_ANON_KEY"] ||
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ||
    process.env["SUPABASE_ANON_KEY"]
  )) ||
  "";

/**
 * Checks if Supabase credentials are configured with non-placeholder values.
 */
export const isSupabaseConfigured: boolean = Boolean(
  supabaseUrl &&
    supabasePublishableKey &&
    !supabaseUrl.includes("your-project-ref") &&
    !supabaseUrl.includes("placeholder") &&
    supabasePublishableKey !== "your-supabase-publishable-key" &&
    supabasePublishableKey !== "placeholder-anon-key"
);

/**
 * Validates the current Supabase configuration.
 * Returns a validation status and names of missing environment variables without exposing sensitive values.
 */
export function validateSupabaseConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!supabaseUrl || supabaseUrl.includes("your-project-ref") || supabaseUrl.includes("placeholder")) {
    missing.push("VITE_SUPABASE_URL");
  }
  if (
    !supabasePublishableKey ||
    supabasePublishableKey === "your-supabase-publishable-key" ||
    supabasePublishableKey === "placeholder-anon-key"
  ) {
    missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  }
  return {
    valid: missing.length === 0,
    missing,
  };
}

let clientInstance: SupabaseClient | null = null;

/**
 * Creates or retrieves the singleton Supabase client.
 * Throws a safe, clear error if environment variables are missing.
 */
export function getSupabase(): SupabaseClient {
  if (clientInstance) {
    return clientInstance;
  }

  const { valid, missing } = validateSupabaseConfig();
  if (!valid) {
    throw new Error(
      `[Shipt Mart Supabase] Missing required environment variable(s): ${missing.join(
        ", "
      )}. Please configure them in your .env.local file.`
    );
  }

  clientInstance = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: typeof window !== "undefined",
      autoRefreshToken: typeof window !== "undefined",
      detectSessionInUrl: typeof window !== "undefined",
    },
  });

  return clientInstance;
}

/**
 * Singleton Supabase client export.
 * If credentials are not yet configured (e.g., during headless builds), returns a stub client to prevent import crashes.
 */
export const supabase: SupabaseClient = (() => {
  if (isSupabaseConfigured) {
    return getSupabase();
  }

  // Fallback to prevent bundle/import breakage during initialization when unconfigured
  return createClient(
    supabaseUrl || "https://placeholder.supabase.co",
    supabasePublishableKey || "placeholder-anon-key",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
})();
