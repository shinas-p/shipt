import {
  Settings,
  Sparkles,
  Phone,
  Lightbulb,
  Image as ImageIcon,
  Users,
  ShieldAlert,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMaintenance } from "@/lib/maintenance";
import { useBranding } from "@/lib/branding";
import { useStoreContact } from "@/lib/contact";
import {
  canManageMaintenance,
  canManageContact,
  canManageBranding,
  canManageSuggestions,
  canManageBanners,
  canManageRoles,
  getRoleBadge,
  type AdminRole,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

export type SettingsSubView =
  | "hub"
  | "branding"
  | "contact"
  | "suggestions"
  | "maintenance"
  | "banners"
  | "roles";

interface SettingsDashboardTabProps {
  adminRole: AdminRole | null;
  onNavigateSubView: (view: SettingsSubView) => void;
}

export function SettingsDashboardTab({
  adminRole,
  onNavigateSubView,
}: SettingsDashboardTabProps) {
  const { branding } = useBranding();
  const { contact } = useStoreContact();
  const { isMaintenanceMode } = useMaintenance();

  const isSuperAdmin = adminRole === "super_admin";
  const roleBadge = getRoleBadge(adminRole);

  const categories = [
    {
      id: "branding",
      title: "Store Identity & Branding",
      icon: Sparkles,
      iconColor: "text-primary bg-primary/10",
      description: "Manage official store name, marketing tagline, custom header logo, and web favicon.",
      details: `Current: "${branding.store_name}" • ${branding.logo_url ? "Custom logo active" : "Default icon"}`,
      actionLabel: "Configure Store Branding",
      authorized: canManageBranding(adminRole),
      targetView: "branding" as SettingsSubView,
      badge: "General Settings",
    },
    {
      id: "banners",
      title: "Promotional Banners",
      icon: ImageIcon,
      iconColor: "text-purple-600 bg-purple-500/10",
      description: "Manage storefront top banners, promotional announcements, and marketing carousels.",
      details: "Promotional assets & marketing banners",
      actionLabel: "Manage Banners",
      authorized: canManageBanners(adminRole),
      targetView: "banners" as SettingsSubView,
      badge: "Marketing",
    },
    {
      id: "roles",
      title: "Staff Roles & Security",
      icon: Users,
      iconColor: "text-blue-600 bg-blue-500/10",
      description: "Invite campus managers, configure staff permissions, monitor audit activity, and manage credentials.",
      details: "Access control, team invitations & security logs",
      actionLabel: isSuperAdmin ? "Manage Staff & Security" : "Restricted to Super Admin",
      authorized: canManageRoles(adminRole),
      targetView: "roles" as SettingsSubView,
      badge: isSuperAdmin ? "Super Admin" : "Restricted",
    },
    {
      id: "maintenance",
      title: "Storefront Maintenance Mode",
      icon: ShieldAlert,
      iconColor: isMaintenanceMode ? "text-amber-600 bg-amber-500/10" : "text-emerald-600 bg-emerald-500/10",
      description: "Temporarily pause the customer storefront for catalogue restructuring, inventory counts, or operational updates.",
      details: isMaintenanceMode ? "Status: ACTIVE (Storefront Intercepted)" : "Status: Normal Store Operations",
      actionLabel: isSuperAdmin ? "Manage Maintenance Mode" : "Restricted to Super Admin",
      authorized: canManageMaintenance(adminRole),
      targetView: "maintenance" as SettingsSubView,
      badge: isSuperAdmin ? (isMaintenanceMode ? "Active Alert" : "Operational") : "Restricted",
      isMaintenanceActive: isMaintenanceMode,
    },
    {
      id: "suggestions",
      title: "Product Suggestions Management",
      icon: Lightbulb,
      iconColor: "text-amber-600 bg-amber-500/10",
      description: "Review customer product requests, check demand, inspect attached product photos, and update procurement statuses.",
      details: "Direct access to review student & customer demand",
      actionLabel: "Review Product Suggestions",
      authorized: canManageSuggestions(adminRole),
      targetView: "suggestions" as SettingsSubView,
      badge: "Customer Demand",
    },
    {
      id: "contact",
      title: "Store Contact Coordinates",
      icon: Phone,
      iconColor: "text-emerald-600 bg-emerald-500/10",
      description: "Manage official customer helpline, support email, and WhatsApp numbers shared across the storefront and footer.",
      details: `${contact.phone} • ${contact.email}`,
      actionLabel: isSuperAdmin ? "Manage Contact Information" : "View Contact Details",
      authorized: true, // Super Admin edits, others view
      targetView: "contact" as SettingsSubView,
      badge: isSuperAdmin ? "Super Admin" : "Read Only",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
              <Settings className="size-3.5" />
              <span>Central Settings Dashboard</span>
            </div>
            <h2 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Store Configuration & Operations Hub
            </h2>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Centralized navigation for store branding, customer contact information, student product suggestions, and maintenance controls.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <span className="text-xs text-muted-foreground font-semibold">Your Permission Level:</span>
            <span className={cn("rounded-full border px-3 py-1 text-xs font-bold", roleBadge.className)}>
              {roleBadge.label}
            </span>
          </div>
        </div>
      </div>

      {/* Settings Category Cards Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isAllowed = cat.authorized;

          return (
            <div
              key={cat.id}
              className={cn(
                "flex flex-col justify-between rounded-3xl border bg-card p-6 shadow-soft transition",
                isAllowed
                  ? "border-border hover:border-primary/40 hover:shadow-lift"
                  : "border-border/60 opacity-80"
              )}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className={cn("grid size-12 place-items-center rounded-2xl", cat.iconColor)}>
                    <Icon className="size-6" />
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
                      cat.isMaintenanceActive
                        ? "bg-amber-500/20 text-amber-800 border-amber-500/30"
                        : "bg-secondary text-secondary-foreground border-border"
                    )}
                  >
                    {cat.badge}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <h3 className="font-display text-lg font-bold text-foreground">
                    {cat.title}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {cat.description}
                  </p>
                </div>

                <div className="rounded-xl bg-muted/30 px-3.5 py-2 text-xs font-mono text-muted-foreground border border-border/50">
                  {cat.details}
                </div>
              </div>

              <div className="pt-6">
                {isAllowed ? (
                  <Button
                    type="button"
                    onClick={() => onNavigateSubView(cat.targetView)}
                    variant="hero"
                    className="w-full h-10 text-xs font-bold gap-2 justify-between"
                  >
                    <span>{cat.actionLabel}</span>
                    <ArrowRight className="size-3.5" />
                  </Button>
                ) : (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-border/80 bg-muted/40 py-2.5 text-xs font-semibold text-muted-foreground cursor-not-allowed">
                    <Lock className="size-3.5" />
                    <span>{cat.actionLabel}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
