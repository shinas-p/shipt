import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  Eye,
  Sun,
  Moon,
  Globe,
  ShoppingBag,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useBranding } from "@/lib/branding";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { canManageBranding, type AdminRole } from "@/lib/permissions";

interface StoreBrandingTabProps {
  adminRole: AdminRole | null;
  onNavigateStorefront?: () => void;
}

export function StoreBrandingTab({
  adminRole,
  onNavigateStorefront,
}: StoreBrandingTabProps) {
  const canManage = canManageBranding(adminRole);
  const isSuperAdmin = adminRole === "super_admin";
  const { branding, isLoading: brandingLoading, updateBranding, refreshBranding } = useBranding();

  // Local Form State
  const [storeName, setStoreName] = useState(branding.store_name);
  const [tagline, setTagline] = useState(branding.tagline);
  const [logoUrl, setLogoUrl] = useState<string | null>(branding.logo_url);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(branding.favicon_url);

  // Logo upload state
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreviewBg, setLogoPreviewBg] = useState<"light" | "dark">("light");
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Favicon upload state
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  // Save State
  const [isSaving, setIsSaving] = useState(false);

  // Sync state when branding context updates (e.g. from background refresh)
  useEffect(() => {
    setStoreName(branding.store_name);
    setTagline(branding.tagline);
    setLogoUrl(branding.logo_url);
    setFaviconUrl(branding.favicon_url);
  }, [branding]);

  // Detect unsaved changes
  const hasUnsavedChanges =
    storeName.trim() !== branding.store_name ||
    tagline.trim() !== branding.tagline ||
    logoUrl !== branding.logo_url ||
    faviconUrl !== branding.favicon_url;

  // Reset to last saved
  const handleReset = () => {
    setStoreName(branding.store_name);
    setTagline(branding.tagline);
    setLogoUrl(branding.logo_url);
    setFaviconUrl(branding.favicon_url);
    toast.info("Restored form to last saved branding settings.");
  };

  // Upload Logo Handler
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!validTypes.includes(file.type)) {
      toast.error("Invalid logo format: Only PNG, JPG, and WebP are supported.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo file too large: Maximum limit is 2 MB.");
      return;
    }

    setUploadingLogo(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `branding/logo-${Date.now()}-${Math.random().toString(36).substring(2, 6)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("posters")
        .upload(fileName, file, { upsert: true });

      if (uploadError) {
        toast.error(`Logo upload failed: ${uploadError.message}`);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("posters").getPublicUrl(fileName);

      setLogoUrl(publicUrl);
      toast.success("Logo uploaded! Preview updated. Click 'Save Changes' to apply globally.");
    } catch (err: any) {
      toast.error(`Upload error: ${err?.message || "Failed to upload logo"}`);
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  // Upload Favicon Handler
  const handleFaviconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/webp"];
    if (!validTypes.includes(file.type) && !file.name.endsWith(".ico")) {
      toast.error("Invalid favicon format: Only ICO, PNG, and WebP are supported.");
      return;
    }

    if (file.size > 1024 * 1024) {
      toast.error("Favicon file too large: Maximum limit is 1 MB.");
      return;
    }

    setUploadingFavicon(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `branding/favicon-${Date.now()}-${Math.random().toString(36).substring(2, 6)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("posters")
        .upload(fileName, file, { upsert: true });

      if (uploadError) {
        toast.error(`Favicon upload failed: ${uploadError.message}`);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("posters").getPublicUrl(fileName);

      setFaviconUrl(publicUrl);
      toast.success("Favicon uploaded! Click 'Save Changes' to apply to browser tabs.");
    } catch (err: any) {
      toast.error(`Upload error: ${err?.message || "Failed to upload favicon"}`);
    } finally {
      setUploadingFavicon(false);
      if (faviconInputRef.current) faviconInputRef.current.value = "";
    }
  };

  // Save Settings
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      toast.error("Permission Denied: Only Super Admins and Owners can update branding.");
      return;
    }

    const cleanName = storeName.trim();
    if (!cleanName) {
      toast.error("Store Name cannot be empty.");
      return;
    }

    const cleanTagline = tagline.trim();
    if (!cleanTagline) {
      toast.error("Tagline cannot be empty.");
      return;
    }

    setIsSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const result = await updateBranding(
        {
          store_name: cleanName,
          tagline: cleanTagline,
          logo_url: logoUrl,
          favicon_url: faviconUrl,
        },
        session?.user?.id
      );

      if (!result.success) {
        toast.error(`Failed to save settings: ${result.error || "Unknown error"}`);
        return;
      }

      toast.success(
        `Store branding updated successfully! "${cleanName}" is now applied across the website.`
      );
    } catch (err: any) {
      toast.error(`Error: ${err?.message || "Failed to save branding"}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="size-5" />
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Store Branding & App Identity
            </h2>
          </div>
          <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground">
            Configure your store name, official logo, browser tab favicon, and promotional tagline.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-semibold animate-pulse">
              Unsaved changes
            </Badge>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshBranding}
            disabled={brandingLoading}
            className="h-9 gap-1.5 text-xs font-semibold"
          >
            <RefreshCw className={cn("size-3.5", brandingLoading && "animate-spin")} />
            <span>Refresh</span>
          </Button>

          {onNavigateStorefront && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onNavigateStorefront}
              className="h-9 gap-1.5 text-xs font-semibold"
            >
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">Storefront</span>
            </Button>
          )}
        </div>
      </div>

      {/* Role Restriction Notice for Non-Super-Admins */}
      {!canManage && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 sm:p-5 text-destructive flex items-start gap-3">
          <ShieldAlert className="size-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-display text-sm font-bold">
              {adminRole === "store_manager" ? "Store Manager View (Read-Only)" : "Staff View (Read-Only)"}
            </h4>
            <p className="text-xs leading-relaxed text-destructive/90">
              Only authorized <strong>Super Admins and Owners</strong> can update global branding, store names, and logo assets. You can review the current branding below, but modifications are restricted on both the frontend and database levels.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="grid gap-8 lg:grid-cols-12">
        {/* LEFT COLUMN: BRANDING FORM CONTROLS */}
        <div className="space-y-6 lg:col-span-7">
          {/* Card 1: Store Name & Tagline */}
          <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-5">
            <h3 className="font-display text-base font-bold text-foreground flex items-center gap-2">
              <Globe className="size-4 text-primary" />
              <span>Store Identity</span>
            </h3>

            <div>
              <label htmlFor="store-name-input" className="block text-xs font-bold text-foreground">
                Store Name <span className="text-destructive">*</span>
              </label>
              <p className="text-[11px] text-muted-foreground mt-0.5 mb-1.5">
                Displayed in the main navigation bar, page titles, notifications, and customer receipts.
              </p>
              <input
                id="store-name-input"
                type="text"
                disabled={!canManage}
                maxLength={50}
                required
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="e.g. Shipt"
                className="h-10 w-full rounded-xl border border-input bg-background px-3.5 text-sm font-semibold outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>Default: Shipt</span>
                <span>{storeName.length} / 50</span>
              </div>
            </div>

            <div>
              <label htmlFor="tagline-input" className="block text-xs font-bold text-foreground">
                Store Tagline <span className="text-destructive">*</span>
              </label>
              <p className="text-[11px] text-muted-foreground mt-0.5 mb-1.5">
                Official slogan shown in the top banner, intro splash, and footer.
              </p>
              <input
                id="tagline-input"
                type="text"
                disabled={!canManage}
                maxLength={120}
                required
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="e.g. Everyday Essentials. Delivered Fast."
                className="h-10 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>Default: Everyday Essentials. Delivered Fast.</span>
                <span>{tagline.length} / 120</span>
              </div>
            </div>
          </div>

          {/* Card 2: App Logo Management */}
          <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-foreground flex items-center gap-2">
                <ShoppingBag className="size-4 text-primary" />
                <span>App Logo Asset</span>
              </h3>
              {logoUrl && (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                  Custom Logo Active
                </Badge>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Upload your custom logo. We recommend a square or wide logo with a transparent background (PNG, WebP, or high-res JPG, max 2 MB).
            </p>

            {/* Logo Preview Card with Light / Dark Contrast Toggle */}
            <div className="rounded-2xl border border-border/80 overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/80 bg-secondary/50 px-3.5 py-2 text-xs">
                <span className="font-semibold text-muted-foreground">Logo Contrast Preview</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setLogoPreviewBg("light")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition",
                      logoPreviewBg === "light"
                        ? "bg-card text-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Sun className="size-3" />
                    <span>Light</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogoPreviewBg("dark")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition",
                      logoPreviewBg === "dark"
                        ? "bg-card text-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Moon className="size-3" />
                    <span>Dark</span>
                  </button>
                </div>
              </div>

              <div
                className={cn(
                  "p-8 flex items-center justify-center transition-colors min-h-[140px]",
                  logoPreviewBg === "light"
                    ? "bg-[#FDFBF7] text-foreground"
                    : "bg-[#1B4D3E] text-white"
                )}
              >
                {logoUrl ? (
                  <div className="flex flex-col items-center gap-2">
                    <img
                      src={logoUrl}
                      alt={storeName}
                      className="max-h-20 max-w-[240px] object-contain drop-shadow-xs"
                    />
                    <span className="text-[10px] opacity-75 font-mono">Custom Logo</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs">
                      <ShoppingBag className="size-5" />
                    </span>
                    <span className="font-display text-xl font-extrabold tracking-tight">
                      {storeName}
                    </span>
                    <span className="text-[10px] opacity-75 font-mono ml-2">(Default Icon)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Upload & Remove Controls */}
            {canManage && (
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <input
                  type="file"
                  ref={logoInputRef}
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                  id="logo-upload-input"
                />

                <Button
                  type="button"
                  variant="hero"
                  size="sm"
                  disabled={uploadingLogo}
                  onClick={() => logoInputRef.current?.click()}
                  className="h-9 gap-1.5 text-xs font-bold"
                >
                  {uploadingLogo ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="size-3.5" />
                      <span>{logoUrl ? "Replace Logo" : "Upload Logo"}</span>
                    </>
                  )}
                </Button>

                {logoUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLogoUrl(null);
                      toast.info("Logo reset to default icon. Click 'Save Changes' to confirm.");
                    }}
                    className="h-9 text-xs text-destructive hover:bg-destructive/10 gap-1"
                  >
                    <Trash2 className="size-3.5" />
                    <span>Reset to Default Icon</span>
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Card 3: Browser Favicon Management */}
          <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-4">
            <h3 className="font-display text-base font-bold text-foreground flex items-center gap-2">
              <Globe className="size-4 text-primary" />
              <span>Browser Tab Favicon</span>
            </h3>

            <p className="text-xs text-muted-foreground">
              Displayed in browser tabs, bookmarks, and mobile home screen shortcuts. Supported: ICO, PNG, WebP (max 1 MB).
            </p>

            {/* Simulated Browser Tab Bar */}
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <div className="flex items-center gap-2 max-w-xs rounded-lg border border-border/70 bg-card px-3 py-1.5 shadow-2xs">
                {faviconUrl ? (
                  <img src={faviconUrl} alt="Favicon" className="size-4 rounded-sm object-contain" />
                ) : (
                  <span className="grid size-4 place-items-center rounded-xs bg-primary text-[9px] font-bold text-primary-foreground">
                    S
                  </span>
                )}
                <span className="truncate text-xs font-medium text-foreground">
                  {storeName} — {tagline}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground font-mono">×</span>
              </div>
            </div>

            {canManage && (
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <input
                  type="file"
                  ref={faviconInputRef}
                  accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/webp"
                  onChange={handleFaviconUpload}
                  className="hidden"
                  id="favicon-upload-input"
                />

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingFavicon}
                  onClick={() => faviconInputRef.current?.click()}
                  className="h-9 gap-1.5 text-xs font-bold"
                >
                  {uploadingFavicon ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="size-3.5" />
                      <span>{faviconUrl ? "Replace Favicon" : "Upload Favicon"}</span>
                    </>
                  )}
                </Button>

                {faviconUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFaviconUrl(null);
                      toast.info("Favicon removed. Click 'Save Changes' to confirm.");
                    }}
                    className="h-9 text-xs text-destructive hover:bg-destructive/10 gap-1"
                  >
                    <Trash2 className="size-3.5" />
                    <span>Remove Favicon</span>
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Form Action Controls */}
          {canManage && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={!hasUnsavedChanges || isSaving}
                onClick={handleReset}
                className="h-10 text-xs font-semibold"
              >
                Reset Unsaved Changes
              </Button>

              <Button
                type="submit"
                variant="hero"
                disabled={!hasUnsavedChanges || isSaving}
                className="h-10 min-w-[160px] gap-2 font-bold shadow-sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" />
                    <span>Save Changes</span>
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: REAL-TIME STOREFRONT MOCKUP PREVIEW */}
        <div className="space-y-6 lg:col-span-5">
          <div className="sticky top-6 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-5">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <h3 className="font-display text-base font-bold text-foreground flex items-center gap-2">
                <Eye className="size-4 text-primary" />
                <span>Live Storefront Preview</span>
              </h3>
              <Badge variant="outline" className="text-[10px] font-mono">
                Real-time
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              Preview of how your branding appears to customers across store headers, banners, and footers.
            </p>

            {/* Mockup 1: Top Announcement Bar */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                1. Top Announcement Bar
              </span>
              <div className="overflow-hidden rounded-xl border border-border bg-forest text-forest-foreground p-2.5 text-center text-xs font-medium">
                <span className="mr-1.5 inline-block size-1.5 rounded-full bg-lime align-middle" />
                <span>{storeName} — {tagline} Fast delivery straight to your door.</span>
              </div>
            </div>

            {/* Mockup 2: Header Navigation Logo */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                2. Storefront Header & Logo
              </span>
              <div className="rounded-2xl border border-border bg-background/90 p-4 shadow-2xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {logoUrl ? (
                    <img src={logoUrl} alt={storeName} className="h-9 max-w-[120px] object-contain" />
                  ) : (
                    <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                      <ShoppingBag className="size-5" />
                    </span>
                  )}
                  <span className="font-display text-lg font-extrabold tracking-tight">
                    {storeName}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="rounded-full bg-secondary px-2.5 py-1 font-semibold">Search</span>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">Cart</span>
                </div>
              </div>
            </div>

            {/* Mockup 3: Footer Copyright Notice */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                3. Footer Identity & Copyright
              </span>
              <div className="rounded-2xl border border-border bg-[#FDFBF7] p-4 text-xs space-y-2">
                <p className="font-display font-bold text-sm text-foreground">{storeName}</p>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  {tagline} Everyday essentials delivered straight to your hostel room.
                </p>
                <div className="border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                  © {new Date().getFullYear()} {storeName}. All rights reserved.
                </div>
              </div>
            </div>

            {/* Mockup 4: Admin Portal Header */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                4. Admin Dashboard Header
              </span>
              <div className="rounded-2xl border border-border bg-card p-3.5 shadow-2xs flex items-center gap-2.5">
                {logoUrl ? (
                  <img src={logoUrl} alt={storeName} className="size-9 rounded-xl object-contain border border-border/80" />
                ) : (
                  <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <ShoppingBag className="size-4.5" />
                  </div>
                )}
                <div>
                  <p className="font-display font-bold text-sm">{storeName} Administration</p>
                  <p className="text-[10px] text-muted-foreground">Super Admin Portal</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
