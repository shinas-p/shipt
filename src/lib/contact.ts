import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  STORE_CONTACT,
  CONTACT_STORAGE_KEY,
  type StoreContactInfo,
  cleanPhoneNumber,
} from "@/data/contact";

export interface UpdateContactResult {
  success: boolean;
  persistedToDatabase: boolean;
  localOnly?: boolean | undefined;
  warning?: string | undefined;
  error?: string | undefined;
}

export function useStoreContact(): {
  contact: StoreContactInfo;
  isLoading: boolean;
  dbStatus: "synced" | "migration_required" | "offline" | "error";
  refreshContact: () => Promise<void>;
  updateContact: (
    newContact: Partial<{ phone: string; email: string; whatsapp: string }>
  ) => Promise<UpdateContactResult>;
} {
  const [contact, setContact] = useState<StoreContactInfo>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(CONTACT_STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed.phone === "string") {
            const rawPhone = cleanPhoneNumber(parsed.phone);
            const rawWa = cleanPhoneNumber(parsed.whatsapp || parsed.phone);
            return {
              phone: parsed.phone,
              phoneRaw: rawPhone,
              email: parsed.email || STORE_CONTACT.email,
              whatsapp: parsed.whatsapp || parsed.phone,
              whatsappRaw: rawWa,
              phoneHref: `tel:+${rawPhone}`,
              emailHref: `mailto:${parsed.email || STORE_CONTACT.email}`,
              whatsappHref: `https://wa.me/${rawWa}`,
            };
          }
        }
      } catch {
        // Fall back to default
      }
    }
    return STORE_CONTACT;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<"synced" | "migration_required" | "offline" | "error">("synced");

  const refreshContact = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setDbStatus("offline");
      return;
    }
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("store_settings")
        .select("contact_phone, contact_email, contact_whatsapp")
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
        const phone = data.contact_phone || STORE_CONTACT.phone;
        const email = data.contact_email || STORE_CONTACT.email;
        const whatsapp = data.contact_whatsapp || STORE_CONTACT.whatsapp;

        const rawPhone = cleanPhoneNumber(phone);
        const rawWa = cleanPhoneNumber(whatsapp);

        const fresh: StoreContactInfo = {
          phone,
          phoneRaw: rawPhone,
          email,
          whatsapp,
          whatsappRaw: rawWa,
          phoneHref: `tel:+${rawPhone}`,
          emailHref: `mailto:${email}`,
          whatsappHref: `https://wa.me/${rawWa}`,
        };

        setContact(fresh);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(CONTACT_STORAGE_KEY, JSON.stringify(fresh));
          } catch {}
        }
      }
    } catch {
      setDbStatus("error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateContact = useCallback(
    async (
      newContact: Partial<{ phone: string; email: string; whatsapp: string }>
    ): Promise<UpdateContactResult> => {
      try {
        const phone = newContact.phone !== undefined ? newContact.phone.trim() : contact.phone;
        const email = newContact.email !== undefined ? newContact.email.trim() : contact.email;
        const whatsapp = newContact.whatsapp !== undefined ? newContact.whatsapp.trim() : contact.whatsapp;

        const rawPhone = cleanPhoneNumber(phone);
        const rawWa = cleanPhoneNumber(whatsapp);

        const fresh: StoreContactInfo = {
          phone,
          phoneRaw: rawPhone,
          email,
          whatsapp,
          whatsappRaw: rawWa,
          phoneHref: `tel:+${rawPhone}`,
          emailHref: `mailto:${email}`,
          whatsappHref: `https://wa.me/${rawWa}`,
        };

        // Cache locally in current browser session
        setContact(fresh);
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(CONTACT_STORAGE_KEY, JSON.stringify(fresh));
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

        const payload: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };
        if (newContact.phone !== undefined) payload["contact_phone"] = phone;
        if (newContact.email !== undefined) payload["contact_email"] = email;
        if (newContact.whatsapp !== undefined) payload["contact_whatsapp"] = whatsapp;

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
                "Database migration required: contact columns (contact_phone, contact_email, contact_whatsapp) do not exist in public.store_settings. Changes are saved in this browser only until migration 20261026000000 is applied.",
            };
          }

          setDbStatus("error");
          return {
            success: false,
            persistedToDatabase: false,
            localOnly: false,
            error: dbError.message || "Failed to update store contact in database.",
          };
        }

        setDbStatus("synced");
        return {
          success: true,
          persistedToDatabase: true,
        };
      } catch (err: any) {
        return {
          success: false,
          persistedToDatabase: false,
          localOnly: false,
          error: err?.message || "Failed to update contact settings.",
        };
      }
    },
    [contact]
  );

  useEffect(() => {
    refreshContact();
  }, [refreshContact]);

  return { contact, isLoading, dbStatus, refreshContact, updateContact };
}
