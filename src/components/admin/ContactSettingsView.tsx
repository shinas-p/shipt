import { useState, useEffect } from "react";
import {
  Phone,
  Mail,
  MessageCircle,
  Save,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Shield,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStoreContact } from "@/lib/contact";
import { cleanPhoneNumber } from "@/data/contact";
import { canManageContact, type AdminRole } from "@/lib/permissions";
import { toast } from "sonner";

interface ContactSettingsViewProps {
  adminRole: AdminRole | null;
  onBackToDashboard?: () => void;
}

export function ContactSettingsView({
  adminRole,
  onBackToDashboard,
}: ContactSettingsViewProps) {
  const { contact, updateContact, isLoading } = useStoreContact();
  const isAuthorized = canManageContact(adminRole);

  const [phone, setPhone] = useState(contact.phone);
  const [email, setEmail] = useState(contact.email);
  const [whatsapp, setWhatsapp] = useState(contact.whatsapp);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setPhone(contact.phone);
    setEmail(contact.email);
    setWhatsapp(contact.whatsapp);
  }, [contact]);

  // Dynamically compute authoritative links from the active inputs
  const cleanPhone = cleanPhoneNumber(phone);
  const cleanWa = cleanPhoneNumber(whatsapp);
  const dynamicPhoneHref = cleanPhone ? `tel:+${cleanPhone}` : "";
  const dynamicEmailHref = email.trim() ? `mailto:${email.trim()}` : "";
  const dynamicWhatsappHref = cleanWa ? `https://wa.me/${cleanWa}` : "";

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthorized) {
      toast.error("Only Super Admin is authorized to change official contact settings.");
      return;
    }

    if (!phone.trim() || !email.trim() || !whatsapp.trim()) {
      setErrorMsg("All contact fields (Phone, Email, WhatsApp) are required.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSaveSuccess(false);

    try {
      const res = await updateContact({
        phone: phone.trim(),
        email: email.trim(),
        whatsapp: whatsapp.trim(),
      });

      if (!res.success) {
        setErrorMsg(res.error || "Failed to update contact settings");
        toast.error(res.error || "Failed to update contact settings");
      } else {
        setSaveSuccess(true);
        toast.success("Store contact information updated successfully!");
        setTimeout(() => setSaveSuccess(false), 4000);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save contact settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Navigation Breadcrumb */}
      {onBackToDashboard && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBackToDashboard}
            className="-ml-3 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            <span>Back to Settings Hub</span>
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
              <Phone className="size-3.5" />
              <span>Contact Coordinates</span>
            </div>
            <h2 className="mt-2 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Store Contact Information
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Official customer helpline, email, and WhatsApp numbers shared across the storefront and footer.
            </p>
          </div>

          {!isAuthorized && (
            <div className="inline-flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
              <ShieldAlert className="size-4 shrink-0" />
              <span>Read-Only: Super Admin permission required to edit</span>
            </div>
          )}
        </div>
      </div>

      {/* Save Success Banner */}
      {saveSuccess && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          <span>Contact coordinates successfully updated across the store!</span>
        </div>
      )}

      {/* Error Banner */}
      {errorMsg && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs font-semibold text-destructive flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Settings Form */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            {/* Phone Number */}
            <div className="space-y-2">
              <label htmlFor="admin-contact-phone-input" className="block text-xs font-bold text-foreground">
                Support Phone Number <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <Phone className="size-4" />
                </span>
                <input
                  type="text"
                  required
                  disabled={!isAuthorized}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 9605174298"
                  className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-75 disabled:cursor-not-allowed font-mono"
                  id="admin-contact-phone-input"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Callable link: <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{dynamicPhoneHref || "—"}</code>
              </p>
            </div>

            {/* Email Address */}
            <div className="space-y-2">
              <label htmlFor="admin-contact-email-input" className="block text-xs font-bold text-foreground">
                Support Email <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <Mail className="size-4" />
                </span>
                <input
                  type="email"
                  required
                  disabled={!isAuthorized}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dhemartforyou@gmail.com"
                  className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-75 disabled:cursor-not-allowed font-mono"
                  id="admin-contact-email-input"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Email link: <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{dynamicEmailHref || "—"}</code>
              </p>
            </div>

            {/* WhatsApp Number */}
            <div className="space-y-2">
              <label htmlFor="admin-contact-whatsapp-input" className="block text-xs font-bold text-foreground">
                WhatsApp Number <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <MessageCircle className="size-4" />
                </span>
                <input
                  type="text"
                  required
                  disabled={!isAuthorized}
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="+91 9605174298"
                  className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-75 disabled:cursor-not-allowed font-mono"
                  id="admin-contact-whatsapp-input"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                WhatsApp chat link: <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{dynamicWhatsappHref || "—"}</code>
              </p>
            </div>
          </div>

          {/* Test Links Preview */}
          <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
            <h4 className="text-xs font-bold text-foreground mb-2">Live Test Actions:</h4>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={dynamicPhoneHref || "#"}
                className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary transition"
              >
                <Phone className="size-3 text-primary" />
                <span>Test Phone Link</span>
              </a>
              <a
                href={dynamicWhatsappHref || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary transition"
              >
                <MessageCircle className="size-3 text-emerald-600" />
                <span>Test WhatsApp Link</span>
                <ExternalLink className="size-2.5 opacity-60" />
              </a>
              <a
                href={dynamicEmailHref || "#"}
                className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary transition"
              >
                <Mail className="size-3 text-amber-600" />
                <span>Test Email Link</span>
              </a>
            </div>
          </div>

          {/* Submit Button */}
          {isAuthorized && (
            <div className="pt-2">
              <Button
                type="submit"
                variant="hero"
                disabled={saving}
                className="h-11 px-8 font-bold text-xs gap-2"
                id="save-contact-settings-btn"
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <>
                    <Save className="size-4" />
                    <span>Save Contact Settings</span>
                  </>
                )}
              </Button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
