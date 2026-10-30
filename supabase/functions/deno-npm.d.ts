/**
 * Ambient type declarations for Deno npm: and jsr: specifiers
 * used in Supabase Edge Functions.
 */

declare module "npm:@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}

declare module "npm:@supabase/supabase-js@*" {
  export * from "@supabase/supabase-js";
}

declare module "npm:web-push@*" {
  const webpush: any;
  export default webpush;
}

