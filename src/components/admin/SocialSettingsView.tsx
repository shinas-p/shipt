import { useState, useEffect, useRef } from "react";
import {
  MessageCircle,
  Instagram,
  Facebook,
  Save,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Shield,
  ShieldAlert,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSocialLinks, validateSocialUrl, PERMITTED_SOCIAL_HOSTS } from "@/lib/social";
import { canAccessSettings, type AdminRole } from "@/lib/permissions";
import { toast } from "sonner";

interface SocialSettingsViewProps {
  adminRole: AdminRole | null;
  onBackToDashboard?: () => void;
}

export function SocialSettingsView({
  adminRole,
  onBackToDashboard,
}: SocialSettingsViewProps) {
  const { socialLinks, updateSocialLinks, isLoading, dbStatus } = useSocialLinks();
  const isAuthorized = canAccessSettings(adminRole);

  const [whatsapp, setWhatsapp] = useState(socialLinks.whatsapp || "");
  const [instagram, setInstagram] = useState(socialLinks.instagram || "");
  const [facebook, setFacebook] = useState(socialLinks.facebook || "");

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [localWarning, setLocalWarning] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDirtyRef = useRef(false);

  useEffect(() => {
    if (!isDirtyRef.current) {
      setWhatsapp(socialLinks.whatsapp || "");
      setInstagram(socialLinks.instagram || "");
      setFacebook(socialLinks.facebook || "");
    }
  }, [socialLinks]);

  // Real-time validations
  const waValidation = validateSocialUrl("whatsapp", whatsapp);
  const instaValidation = validateSocialUrl("instagram", instagram);
  const fbValidation = validateSocialUrl("facebook", facebook);

  const hasValidationErrors =
    !waValidation.isValid || !instaValidation.isValid || !fbValidation.isValid;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthorized) {
      toast.error("Permission Denied: Only Super Admin and Store Owner can configure social links.");
      return;
    }

    if (hasValidationErrors) {
      setErrorMsg("Please fix URL formatting errors before saving.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setLocalWarning(null);
    setSaveSuccess(false);

    try {
      const res = await updateSocialLinks({
        whatsapp: whatsapp.trim() || null,
        instagram: instagram.trim() || null,
        facebook: facebook.trim() || null,
      });

      if (res.persistedToDatabase) {
        setSaveSuccess(true);
        setLocalWarning(null);
        setErrorMsg(null);
        isDirtyRef.current = false;
        toast.success("Social media links saved and persisted to database!");
        setTimeout(() => setSaveSuccess(false), 5000);
      } else if (res.localOnly) {
        setSaveSuccess(false);
        setLocalWarning(
          res.warning ||
            "Social links saved to this browser only. Database columns are missing — apply migration 20261028000000 to persist for all customer devices."
        );
        setErrorMsg(null);
        toast.warning("Saved locally only. Database migration pending in Supabase.");
      } else {
        setSaveSuccess(false);
        setLocalWarning(null);
        setErrorMsg(res.error || "Failed to update social settings.");
        toast.error(`Error saving social links: ${res.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setSaveSuccess(false);
      setErrorMsg(err?.message || "Failed to reach server.");
      toast.error(`Save error: ${err?.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          {onBackToDashboard && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onBackToDashboard}
              className="-ml-3 mb-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              <span>Back to Settings Overview</span>
            </Button>
          )}
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl flex items-center gap-2">
              <Share2 className="size-6 text-primary" />
              <span>Social Media Links</span>
            </h2>
            <Badge
              variant="outline"
              className={
                isAuthorized
                  ? "border-emerald-500/40 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400"
                  : "border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-400"
              }
            >
              {isAuthorized ? "Super Admin & Owner" : "Read-Only"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure official links for your WhatsApp Channel, Instagram, and Facebook. Links appear in the storefront footer and Contact page. Leave blank to hide.
          </p>
        </div>
      </div>

      {/* Role Notice */}
      {!isAuthorized && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3">
          <ShieldAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">Administrative Permission Required</p>
            <p>
              Your current role ({adminRole || "Staff"}) has read-only access. Only Super Administrators and Store Owners are permitted to change official social links.
            </p>
          </div>
        </div>
      )}

      {/* Database Status Alert */}
      {dbStatus === "migration_required" && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3">
          <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">Database Migration Pending</p>
            <p>
              Social media columns (<code className="font-mono text-[11px] bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">social_whatsapp</code>, <code className="font-mono text-[11px] bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">social_instagram</code>, <code className="font-mono text-[11px] bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">social_facebook</code>) do not exist yet in <code className="font-mono text-[11px] bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">public.store_settings</code>. Any changes saved will be cached in this browser until migration <code className="font-mono text-[11px] bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">20261028000000_social_links_and_admin_notifications.sql</code> is applied.
            </p>
          </div>
        </div>
      )}

      {/* Success Banner */}
      {saveSuccess && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-3 animate-in fade-in">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="font-semibold">
            Social media links successfully updated and persisted to database!
          </p>
        </div>
      )}

      {/* Local Only Warning */}
      {localWarning && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-3">
          <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <p className="leading-relaxed">{localWarning}</p>
        </div>
      )}

      {/* Error Banner */}
      {errorMsg && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-start gap-3">
          <AlertCircle className="size-5 shrink-0 mt-0.5" />
          <p className="font-semibold leading-relaxed">{errorMsg}</p>
        </div>
      )}

      {/* Form Card */}
      <form onSubmit={handleSave} className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8 space-y-6">
        <div className="space-y-4">
          <h3 className="font-display text-base font-bold text-foreground flex items-center gap-2">
            <span>Configurable Platform Links</span>
            <span className="text-xs font-normal text-muted-foreground">(Leave empty to hide link on storefront)</span>
          </h3>

          {/* 1. WhatsApp Channel */}
          <div className="space-y-1.5">
            <label htmlFor="social-whatsapp" className="text-xs font-semibold text-foreground flex items-center gap-2">
              <MessageCircle className="size-4 text-emerald-600" />
              <span>WhatsApp Channel URL</span>
            </label>
            <input
              id="social-whatsapp"
              type="text"
              disabled={!isAuthorized || saving}
              value={whatsapp}
              onChange={(e) => {
                isDirtyRef.current = true;
                setWhatsapp(e.target.value);
              }}
              placeholder="e.g. https://whatsapp.com/channel/0029VaABCD12345"
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs outline-none focus:border-primary disabled:opacity-60 font-mono"
            />
            {!waValidation.isValid && (
              <p className="text-[11px] text-destructive font-medium">{waValidation.error}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Official WhatsApp updates channel. Permitted hosts: {PERMITTED_SOCIAL_HOSTS.whatsapp.join(", ")}.
            </p>
          </div>

          {/* 2. Instagram */}
          <div className="space-y-1.5 pt-2 border-t border-border/40">
            <label htmlFor="social-instagram" className="text-xs font-semibold text-foreground flex items-center gap-2">
              <Instagram className="size-4 text-pink-600" />
              <span>Instagram Page URL</span>
            </label>
            <input
              id="social-instagram"
              type="text"
              disabled={!isAuthorized || saving}
              value={instagram}
              onChange={(e) => {
                isDirtyRef.current = true;
                setInstagram(e.target.value);
              }}
              placeholder="e.g. https://instagram.com/shiptmart"
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs outline-none focus:border-primary disabled:opacity-60 font-mono"
            />
            {!instaValidation.isValid && (
              <p className="text-[11px] text-destructive font-medium">{instaValidation.error}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Official Instagram profile. Permitted hosts: {PERMITTED_SOCIAL_HOSTS.instagram.join(", ")}.
            </p>
          </div>

          {/* 3. Facebook */}
          <div className="space-y-1.5 pt-2 border-t border-border/40">
            <label htmlFor="social-facebook" className="text-xs font-semibold text-foreground flex items-center gap-2">
              <Facebook className="size-4 text-blue-600" />
              <span>Facebook Page URL</span>
            </label>
            <input
              id="social-facebook"
              type="text"
              disabled={!isAuthorized || saving}
              value={facebook}
              onChange={(e) => {
                isDirtyRef.current = true;
                setFacebook(e.target.value);
              }}
              placeholder="e.g. https://facebook.com/shiptmart"
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs outline-none focus:border-primary disabled:opacity-60 font-mono"
            />
            {!fbValidation.isValid && (
              <p className="text-[11px] text-destructive font-medium">{fbValidation.error}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Official Facebook page or group. Permitted hosts: {PERMITTED_SOCIAL_HOSTS.facebook.join(", ")}.
            </p>
          </div>
        </div>

        {/* Live Preview Card */}
        <div className="rounded-2xl border border-border/80 bg-secondary/30 p-4 space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Storefront Live Preview
          </h4>
          {(!whatsapp && !instagram && !facebook) ? (
            <p className="text-xs text-muted-foreground italic">
              All social links are currently unconfigured. The social media icons section will be safely hidden on the storefront footer and Contact page.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {whatsapp && waValidation.isValid && (
                <a
                  href={waValidation.normalizedUrl || whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:text-emerald-600 transition"
                >
                  <MessageCircle className="size-3.5 text-emerald-600" />
                  <span>WhatsApp Channel</span>
                  <ExternalLink className="size-3 text-muted-foreground" />
                </a>
              )}
              {instagram && instaValidation.isValid && (
                <a
                  href={instaValidation.normalizedUrl || instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:text-pink-600 transition"
                >
                  <Instagram className="size-3.5 text-pink-600" />
                  <span>Instagram</span>
                  <ExternalLink className="size-3 text-muted-foreground" />
                </a>
              )}
              {facebook && fbValidation.isValid && (
                <a
                  href={fbValidation.normalizedUrl || facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:text-blue-600 transition"
                >
                  <Facebook className="size-3.5 text-blue-600" />
                  <span>Facebook</span>
                  <ExternalLink className="size-3 text-muted-foreground" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Shield className="size-3.5 text-primary" />
            <span>Authorized for Super Admin and Store Owner</span>
          </div>

          <Button
            type="submit"
            disabled={!isAuthorized || saving || isLoading || hasValidationErrors}
            className="h-10 px-5 text-xs font-bold gap-2"
            id="social-settings-save-btn"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Saving Links...</span>
              </>
            ) : (
              <>
                <Save className="size-4" />
                <span>Save Social Links</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
