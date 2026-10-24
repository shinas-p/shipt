import { useState, useEffect } from "react";
import {
  ShieldAlert,
  Power,
  Clock,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Eye,
  Calendar,
  History,
  FileText,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMaintenance, type MaintenanceAuditLog } from "@/lib/maintenance";
import { MaintenanceView } from "@/components/store/MaintenanceView";
import { type AdminRole } from "@/lib/permissions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MaintenanceModeTabProps {
  adminRole: AdminRole | null;
}

const PRESET_MESSAGES = [
  {
    label: "Inventory Restock",
    text: "We are currently restocking our campus warehouse with fresh snacks, beverages, and stationery. We will be back shortly!",
  },
  {
    label: "Catalogue & Price Calibration",
    text: "We are updating our catalogue and syncing the latest campus pricing. Back online soon!",
  },
  {
    label: "Scheduled Maintenance",
    text: "Scheduled maintenance is currently underway to make your delivery experience even faster. Thank you for your patience!",
  },
];

export function MaintenanceModeTab({ adminRole }: MaintenanceModeTabProps) {
  const isSuperAdmin = adminRole === "super_admin";

  const {
    isMaintenanceMode,
    maintenanceMessage,
    maintenanceReopenAt,
    isLoading: isMaintenanceLoading,
    setMaintenanceMode,
    fetchAuditLogs,
    refreshMaintenance,
  } = useMaintenance();

  // Local configuration form state
  const [localMessage, setLocalMessage] = useState(maintenanceMessage);
  const [localReopenAt, setLocalReopenAt] = useState<string>(
    maintenanceReopenAt
      ? new Date(maintenanceReopenAt).toISOString().slice(0, 16)
      : ""
  );

  // Modal & Async states
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingToggleTarget, setPendingToggleTarget] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Audit Logs state
  const [auditLogs, setAuditLogs] = useState<MaintenanceAuditLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Keep local form in sync with remote context updates
  useEffect(() => {
    setLocalMessage(maintenanceMessage);
    setLocalReopenAt(
      maintenanceReopenAt
        ? new Date(maintenanceReopenAt).toISOString().slice(0, 16)
        : ""
    );
  }, [maintenanceMessage, maintenanceReopenAt]);

  // Load audit logs on mount
  useEffect(() => {
    if (isSuperAdmin) {
      loadAuditLogs();
    }
  }, [isSuperAdmin]);

  const loadAuditLogs = async () => {
    setLogsLoading(true);
    try {
      const logs = await fetchAuditLogs();
      setAuditLogs(logs);
    } catch {
      toast.error("Could not load maintenance audit trail.");
    } finally {
      setLogsLoading(false);
    }
  };

  // Quick DateTime preset helpers
  const handleSetQuickDuration = (hoursFromNow: number) => {
    const target = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
    const offset = target.getTimezoneOffset() * 60000;
    const localIso = new Date(target.getTime() - offset).toISOString().slice(0, 16);
    setLocalReopenAt(localIso);
  };

  const handleSetTomorrowMorning = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const offset = tomorrow.getTimezoneOffset() * 60000;
    const localIso = new Date(tomorrow.getTime() - offset).toISOString().slice(0, 16);
    setLocalReopenAt(localIso);
  };

  // Trigger confirmation dialog for toggle switch
  const handleToggleClick = (target: boolean) => {
    setPendingToggleTarget(target);
    setConfirmDialogOpen(true);
  };

  // Perform confirmed toggle
  const handleConfirmToggle = async () => {
    setConfirmDialogOpen(false);
    setIsUpdating(true);

    const reopenIso = localReopenAt ? new Date(localReopenAt).toISOString() : null;

    try {
      const result = await setMaintenanceMode(
        pendingToggleTarget,
        localMessage,
        reopenIso
      );

      if (result.success) {
        toast.success(
          pendingToggleTarget
            ? "Maintenance Mode ACTIVATED. Storefront is now closed to customers."
            : "Maintenance Mode DEACTIVATED. Storefront reopened to customers."
        );
        loadAuditLogs();
      } else {
        toast.error(`Failed to update maintenance mode: ${result.error}`);
      }
    } catch (err: any) {
      toast.error(err?.message || "An unexpected error occurred.");
    } finally {
      setIsUpdating(false);
    }
  };

  // Save changes to announcement or reopen date without toggling on/off
  const handleSaveSettings = async () => {
    setIsUpdating(true);
    const reopenIso = localReopenAt ? new Date(localReopenAt).toISOString() : null;

    try {
      const result = await setMaintenanceMode(
        isMaintenanceMode,
        localMessage,
        reopenIso
      );

      if (result.success) {
        toast.success("Maintenance announcement & schedule updated successfully.");
        loadAuditLogs();
      } else {
        toast.error(`Failed to save settings: ${result.error}`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to save settings.");
    } finally {
      setIsUpdating(false);
    }
  };

  // Restricted view for non-super admins
  if (!isSuperAdmin) {
    return (
      <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-8 text-center space-y-4">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-destructive/15 text-destructive">
          <ShieldAlert className="size-6" />
        </div>
        <h2 className="font-display text-lg font-bold text-foreground">
          Super Administrator Authority Required
        </h2>
        <p className="max-w-md mx-auto text-xs text-muted-foreground leading-relaxed">
          Maintenance mode temporarily closes customer storefront checkout, restocks
          catalogues, and alters public store availability. Only authenticated users with the
          Super Administrator role can toggle or configure maintenance settings.
        </p>
        <Badge variant="outline" className="border-destructive/40 text-destructive text-[11px]">
          Current Role: {adminRole || "Unauthorized"}
        </Badge>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Header / Status Banner */}
      <div
        className={cn(
          "rounded-3xl border p-6 sm:p-8 transition-colors shadow-soft relative overflow-hidden",
          isMaintenanceMode
            ? "border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-background"
            : "border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background"
        )}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "size-3 rounded-full animate-ping",
                  isMaintenanceMode ? "bg-amber-500" : "bg-emerald-500"
                )}
              />
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-bold uppercase tracking-wider px-2.5 py-0.5",
                  isMaintenanceMode
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                )}
              >
                {isMaintenanceMode ? "Maintenance Mode Active" : "Storefront Live & Operating"}
              </Badge>
            </div>

            <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              {isMaintenanceMode
                ? "Customer Storefront is Currently Closed"
                : "Customer Storefront is Open for Orders"}
            </h2>

            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {isMaintenanceMode
                ? "Customer routes (homepage, product pages, cart, checkout) are replaced with the maintenance page. Direct checkout and API orders are blocked server-side. Staff /admin portal and order tracking remain fully operational."
                : "Customers can freely browse products, build carts, and complete checkout. Super Admin can activate maintenance below to pause order intake for restocking or catalogue calibration."}
            </p>
          </div>

          {/* Master Switch */}
          <div className="flex flex-col items-start sm:items-end gap-3 shrink-0 rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-foreground">
                {isMaintenanceMode ? "Maintenance Mode: ON" : "Maintenance Mode: OFF"}
              </span>
              <Switch
                id="maintenance-toggle-switch"
                checked={isMaintenanceMode}
                onCheckedChange={handleToggleClick}
                disabled={isUpdating || isMaintenanceLoading}
                className={cn(
                  isMaintenanceMode
                    ? "data-[state=checked]:bg-amber-600 dark:data-[state=checked]:bg-amber-500"
                    : ""
                )}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsPreviewOpen(true)}
                className="h-8 text-xs font-semibold gap-1.5 rounded-full"
              >
                <Eye className="size-3.5" />
                <span>Live Preview</span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => refreshMaintenance()}
                disabled={isMaintenanceLoading}
                className="h-8 text-xs font-semibold gap-1.5 rounded-full"
                title="Refresh latest status from Supabase"
              >
                <RefreshCw
                  className={cn("size-3.5", isMaintenanceLoading && "animate-spin text-primary")}
                />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Configuration Settings Card */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft space-y-6">
        <div>
          <h3 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            <span>Storefront Announcement & Reopening Schedule</span>
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Customize the message and estimated reopening time displayed to customers while the store is under maintenance.
          </p>
        </div>

        {/* Announcement Message Editor */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label
              htmlFor="maintenance-message-textarea"
              className="text-xs font-bold text-foreground"
            >
              Public Announcement Message
            </label>
            <span className="text-[11px] text-muted-foreground">
              {localMessage.length} characters
            </span>
          </div>

          <Textarea
            id="maintenance-message-textarea"
            rows={3}
            value={localMessage}
            onChange={(e) => setLocalMessage(e.target.value)}
            placeholder="Explain why the store is temporarily closed and when customers can expect to shop again..."
            className="rounded-2xl border-input text-xs sm:text-sm resize-none focus-visible:ring-primary"
          />

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-semibold text-muted-foreground mr-1">
              Quick presets:
            </span>
            {PRESET_MESSAGES.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setLocalMessage(preset.text)}
                className="rounded-full border border-border bg-secondary/50 px-3 py-1 text-[11px] font-medium text-foreground hover:bg-secondary hover:border-primary/40 transition"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Expected Reopening Schedule */}
        <div className="space-y-3 border-t border-border pt-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <label
              htmlFor="maintenance-reopen-input"
              className="text-xs font-bold text-foreground flex items-center gap-1.5"
            >
              <Clock className="size-4 text-primary" />
              <span>Expected Reopening Date & Time (Optional)</span>
            </label>
            {localReopenAt && (
              <span className="text-xs font-medium text-primary">
                Preview: {new Date(localReopenAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              id="maintenance-reopen-input"
              type="datetime-local"
              value={localReopenAt}
              onChange={(e) => setLocalReopenAt(e.target.value)}
              className="h-10 rounded-xl border border-input bg-card px-3 text-xs sm:text-sm font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />

            {/* Quick Time Shortcuts */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSetQuickDuration(1)}
              className="h-9 text-xs rounded-xl"
            >
              +1 Hour
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSetQuickDuration(2)}
              className="h-9 text-xs rounded-xl"
            >
              +2 Hours
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSetQuickDuration(4)}
              className="h-9 text-xs rounded-xl"
            >
              +4 Hours
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSetTomorrowMorning}
              className="h-9 text-xs rounded-xl"
            >
              Tomorrow 9 AM
            </Button>

            {localReopenAt && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLocalReopenAt("")}
                className="h-9 text-xs text-muted-foreground hover:text-destructive rounded-xl"
              >
                Clear Schedule
              </Button>
            )}
          </div>
        </div>

        {/* Actions bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-[11px] text-muted-foreground">
            Changes take effect immediately across all active customer tabs via Supabase Realtime.
          </p>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleSaveSettings}
            disabled={isUpdating}
            className="font-bold text-xs rounded-xl px-5 gap-2"
          >
            {isUpdating ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5" />
                <span>Save Announcement & Schedule</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 3. Security Audit Trail Card */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
              <History className="size-5 text-primary" />
              <span>Maintenance Security Audit Trail</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Authoritative log of all maintenance mode activations and deactivations.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadAuditLogs}
            disabled={logsLoading}
            className="h-8 text-xs rounded-full gap-1.5"
          >
            <RefreshCw className={cn("size-3.5", logsLoading && "animate-spin")} />
            <span>Refresh Logs</span>
          </Button>
        </div>

        {logsLoading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <Loader2 className="size-5 animate-spin mx-auto text-primary mb-2" />
            <span>Loading audit trail...</span>
          </div>
        ) : auditLogs.length === 0 ? (
          <div className="py-8 text-center rounded-2xl border border-dashed border-border/70 text-xs text-muted-foreground">
            No maintenance mode events recorded in the audit log yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/60 text-muted-foreground uppercase text-[10px] tracking-wider font-semibold border-b border-border">
                <tr>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Admin Email</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Configured Announcement</th>
                  <th className="py-3 px-4">Expected Reopen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {auditLogs.map((log) => {
                  const isEnabledAction = log.action === "maintenance_mode_enabled";
                  const details = log.details || {};
                  return (
                    <tr key={log.id} className="hover:bg-secondary/30 transition">
                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="py-3 px-4 font-semibold text-foreground">
                        {log.actor_email}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] font-bold uppercase",
                            isEnabledAction
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          )}
                        >
                          {isEnabledAction ? "Enabled" : "Disabled"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-foreground/80 max-w-xs truncate" title={details.maintenance_message}>
                        {details.maintenance_message || "—"}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                        {details.maintenance_reopen_at
                          ? new Date(details.maintenance_reopen_at).toLocaleString(undefined, {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "None"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Confirmation Dialog for Mode Toggling */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent className="rounded-3xl border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl font-bold flex items-center gap-2">
              {pendingToggleTarget ? (
                <>
                  <AlertTriangle className="size-5 text-amber-500" />
                  <span>Activate Storefront Maintenance Mode?</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-5 text-emerald-500" />
                  <span>Reopen Customer Storefront?</span>
                </>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed pt-2">
              {pendingToggleTarget ? (
                <span>
                  Activating maintenance mode will immediately close the customer storefront.
                  Visitors on routes such as the homepage, product details, cart, and checkout will
                  see the maintenance screen. Any direct checkout attempts will be blocked by the
                  server. You and authorized staff can still access the Admin Portal and manage orders.
                </span>
              ) : (
                <span>
                  Deactivating maintenance mode will immediately restore the public storefront.
                  Customers across all active tabs will instantly be able to browse catalogue items,
                  build carts, and place new orders via real-time synchronization.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0 pt-4">
            <AlertDialogCancel className="rounded-xl text-xs font-semibold">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmToggle}
              className={cn(
                "rounded-xl text-xs font-bold",
                pendingToggleTarget
                  ? "bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-500 dark:hover:bg-emerald-600"
              )}
            >
              {pendingToggleTarget ? "Yes, Activate Maintenance" : "Yes, Reopen Storefront"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 5. Live Customer Experience Preview Modal */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden border-border bg-forest rounded-3xl max-h-[90vh]">
          <DialogHeader className="p-4 bg-black/40 border-b border-white/10 text-white flex flex-row items-center justify-between">
            <DialogTitle className="text-xs font-bold uppercase tracking-wider text-lime flex items-center gap-2">
              <Eye className="size-4" />
              <span>Customer Screen Preview (How customers see maintenance)</span>
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto max-h-[80vh]">
            <MaintenanceView
              isPreview
              previewMessage={localMessage}
              previewReopenAt={localReopenAt ? new Date(localReopenAt).toISOString() : null}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
