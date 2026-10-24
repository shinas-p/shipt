/**
 * Shipt Mart — Authoritative Store Contact Information
 * 
 * Provides verified support phone, email, and WhatsApp coordinates
 * shared across the Contact Us page, global footer, and administrative settings.
 */

export interface StoreContactInfo {
  phone: string;
  phoneRaw: string;
  email: string;
  whatsapp: string;
  whatsappRaw: string;
  phoneHref: string;
  emailHref: string;
  whatsappHref: string;
}

export const STORE_CONTACT: StoreContactInfo = {
  phone: "+91 9605174298",
  phoneRaw: "919605174298",
  email: "dhemartforyou@gmail.com",
  whatsapp: "+91 9605174298",
  whatsappRaw: "919605174298",
  phoneHref: "tel:+919605174298",
  emailHref: "mailto:dhemartforyou@gmail.com",
  whatsappHref: "https://wa.me/919605174298",
};

export const CONTACT_STORAGE_KEY = "shipt_store_contact_cache_v1";

/**
 * Normalizes an Indian or international phone/whatsapp number to raw digits for wa.me/tel links
 */
export function cleanPhoneNumber(phone: string): string {
  return phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
}

/**
 * Generates an official WhatsApp chat link with optional pre-filled greeting
 */
export function getWhatsAppChatLink(number: string = STORE_CONTACT.whatsappRaw, message?: string): string {
  const clean = cleanPhoneNumber(number);
  const base = `https://wa.me/${clean}`;
  if (message) {
    return `${base}?text=${encodeURIComponent(message)}`;
  }
  return base;
}
