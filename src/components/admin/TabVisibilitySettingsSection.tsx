import React from "react";
import {
  SlidersHorizontal,
  RotateCcw,
  CheckCircle2,
  Lock,
  ShieldCheck,
  Info,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  useAdminTabVisibility,
  type AdminTabId,
  type AdminTabDefinition,
} from "@/lib/adminTabVisibility";
import type { AdminRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface TabVisibilitySettingsSectionProps {
  adminRole: AdminRole | null;
  userId?: string | null | undefined;
  onTabChange?: ((tabId: AdminTabId) => void) | undefined;
  className?: string | undefined;
}

export function TabVisibilitySettingsSection({
  adminRole,
  userId,
  onTabChange,
  className = "",
}: TabVisibilitySettingsSectionProps) {
  const {
    preferences,
    setShowAllTabs,
    setTabVisible,
    resetToDefault,
    isTabVisible,
    allTabs,
    visibleTabList,
  } = useAdminTabVisibility(userId, adminRole);

  const handleMasterToggle = (checked: boolean) => {
    setShowAllTabs(checked);
    toast.success(
      checked
        ? "Show All Tabs enabled. All navigation tabs are now visible."
        : "Individual tab customisation enabled. Toggle tabs below."
    );
  };

  const handleIndividualToggle = (tab: AdminTabDefinition, checked: boolean) => {
    if (tab.isProtected) return;

    // If master toggle is currently ON and user wants to turn an individual tab OFF:
    // Switch master toggle to false and set that tab to false
    if (preferences.showAllTabs && !checked) {
      setShowAllTabs(false);
      setTabVisible(tab.id, false);
      toast.info(`Switched to custom visibility. "${tab.label}" hidden from top navigation.`);
      return;
    }

    setTabVisible(tab.id, checked);
    toast.success(
      checked
        ? `"${tab.label}" tab is now visible in navigation.`
        : `"${tab.label}" tab hidden from navigation.`
    );
  };

  const handleReset = () => {
    resetToDefault();
    toast.success("Navigation tabs restored to default. All tabs are visible.");
  };

  const permittedTabs = allTabs.filter((t) => t.checkPermission(adminRole));
  const visibleCount = visibleTabList.length;
  const totalPermitted = permittedTabs.length;

  return (
    <div
      id="admin-tab-visibility-section"
      className={cn("rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8 space-y-6", className)}
    >
      {/* Header & Badges */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-border/70 pb-5">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
            <SlidersHorizontal className="size-3.5" />
            <span>Navigation Customisation</span>
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Admin Tab Visibility
          </h2>
          <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
            Choose which navigation tabs appear in your top admin bar. Enable{" "}
            <strong className="text-foreground">Show All Tabs</strong> to display every available tab,
            or customise individual tabs according to your daily workflow.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Badge
            variant="outline"
            className={cn(
              "px-3 py-1 text-xs font-bold",
              preferences.showAllTabs
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400"
                : "border-primary/30 bg-primary/10 text-primary"
            )}
          >
            {preferences.showAllTabs ? "Show All Tabs: Active" : "Custom Visibility"}
          </Badge>

          <Badge variant="secondary" className="px-3 py-1 text-xs font-bold">
            {visibleCount} of {totalPermitted} Tabs Visible
          </Badge>
        </div>
      </div>

      {/* Master Toggle & Reset Bar */}
      <div className="rounded-2xl border border-border/80 bg-muted/30 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="master-show-all-tabs"
                className="text-sm font-bold text-foreground cursor-pointer"
              >
                Show All Tabs
              </label>
              {preferences.showAllTabs && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" />
                  <span>All Active</span>
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              When enabled, all {totalPermitted} permitted navigation tabs are visible in the top navigation bar.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="h-9 gap-1.5 text-xs font-semibold rounded-xl"
            title="Restore all navigation tabs to visible"
          >
            <RotateCcw className="size-3.5" />
            <span>Reset to Default</span>
          </Button>

          <div className="flex items-center gap-2 pl-2 border-l border-border/60">
            <Switch
              id="master-show-all-tabs"
              checked={preferences.showAllTabs}
              onCheckedChange={handleMasterToggle}
              aria-label="Toggle Show All Tabs master switch"
            />
          </div>
        </div>
      </div>

      {/* Individual Tab Controls Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Individual Tab Controls ({allTabs.length} Total Tabs Discovered)
          </h3>
          {!preferences.showAllTabs && (
            <span className="text-[11px] text-primary font-semibold">
              Custom mode active • Switch any tab on or off
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {allTabs.map((tab) => {
            const Icon = tab.icon;
            const isPermitted = tab.checkPermission(adminRole);
            const isTabActive = isTabVisible(tab.id);
            const isLocked = tab.isProtected;

            return (
              <div
                key={tab.id}
                className={cn(
                  "flex items-start justify-between gap-3.5 rounded-2xl border p-4 transition-all duration-150",
                  !isPermitted
                    ? "border-border/50 bg-muted/20 opacity-60 cursor-not-allowed"
                    : isTabActive
                    ? "border-border bg-card shadow-2xs hover:border-primary/30"
                    : "border-border/60 bg-muted/10 opacity-75"
                )}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-xl",
                      !isPermitted
                        ? "bg-muted text-muted-foreground"
                        : isTabActive
                        ? "bg-primary/10 text-primary"
                        : "bg-muted/60 text-muted-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                  </div>

                  <div className="space-y-1 min-w-0 pr-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-foreground">
                        {tab.label}
                      </span>
                      {isLocked && (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-800 text-[10px] px-1.5 py-0 font-bold dark:text-emerald-400"
                        >
                          Always Visible
                        </Badge>
                      )}
                      {!isPermitted && (
                        <Badge
                          variant="outline"
                          className="border-amber-500/30 bg-amber-500/10 text-amber-800 text-[10px] px-1.5 py-0 font-bold dark:text-amber-400 flex items-center gap-1"
                        >
                          <Lock className="size-2.5" />
                          <span>Role Restricted</span>
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-tight">
                      {tab.description}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 pt-0.5">
                  {isLocked ? (
                    <div
                      title="Settings is essential for store administration and cannot be hidden."
                      className="cursor-not-allowed opacity-80"
                    >
                      <Switch
                        id={`tab-toggle-${tab.id}`}
                        checked={true}
                        disabled={true}
                        aria-label={`${tab.label} visibility (Always visible)`}
                      />
                    </div>
                  ) : !isPermitted ? (
                    <div
                      title={`Restricted: ${tab.permissionDescription}`}
                      className="cursor-not-allowed opacity-50"
                    >
                      <Switch
                        id={`tab-toggle-${tab.id}`}
                        checked={false}
                        disabled={true}
                        aria-label={`${tab.label} visibility (Restricted by role)`}
                      />
                    </div>
                  ) : (
                    <Switch
                      id={`tab-toggle-${tab.id}`}
                      checked={isTabActive}
                      onCheckedChange={(checked) => handleIndividualToggle(tab, checked)}
                      aria-label={`Toggle visibility of ${tab.label}`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Safety & Persistence Notice */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-border/70 bg-secondary/30 p-4 text-xs text-muted-foreground">
        <Info className="size-4 shrink-0 text-primary mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-semibold text-foreground">
            Personalised Navigation & Safety Guarantee
          </p>
          <p className="text-[11px] leading-relaxed">
            Tab visibility preferences are saved per administrator in local browser storage so your personal workspace
            does not overwrite other staff members. The <strong>Settings</strong> tab is always preserved so you
            can never be locked out, and underlying role permissions remain strictly enforced at all times.
          </p>
        </div>
      </div>
    </div>
  );
}
