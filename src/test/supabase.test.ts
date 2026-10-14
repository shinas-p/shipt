import { describe, expect, it } from "vitest";
import { getSupabase, isSupabaseConfigured, supabase, validateSupabaseConfig } from "@/lib/supabase";

describe("Supabase Client Configuration", () => {
  it("exports a defined supabase client", () => {
    expect(supabase).toBeDefined();
    expect(supabase.auth).toBeDefined();
    expect(typeof supabase.from).toBe("function");
  });

  it("validates Supabase configuration safely", () => {
    const config = validateSupabaseConfig();
    expect(typeof config.valid).toBe("boolean");
    expect(Array.isArray(config.missing)).toBe(true);
  });

  it("initializes a singleton client via getSupabase when configured", () => {
    if (isSupabaseConfigured) {
      const client1 = getSupabase();
      const client2 = getSupabase();
      expect(client1).toBe(client2);
      expect(client1.auth).toBeDefined();
    } else {
      expect(() => getSupabase()).toThrowError(/\[Quick Mart Supabase\] Missing required environment variable/);
    }
  });
});
