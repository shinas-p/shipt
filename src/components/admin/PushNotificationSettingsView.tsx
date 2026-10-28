/**
 * ShipT Mart — Web Push Notification & Device Management View
 *
 * Allows administrators to:
 * 1. Subscribe and unsubscribe the current device via browser Push API.
 * 2. View and remove registered devices.
 * 3. Test push delivery via the server-side Edge Function.
 * 4. Inspect real-time push diagnostics (VAPID, Service Worker, HTTPS, Permissions).
 */

import { useState } from "react";
import {
  BellRing,
  Smartphone,
  Laptop,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Trash2,
  Send,
  Loader2,
  ArrowLeft,
  ShieldCheck,
  Info,
  RefreshCw,
  Key,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePushNotifications } from "@/lib/pushNotifications";
import type { AdminRole } from "@/lib/permissions";
import { canAccessSettings } from "@/lib/permissions";

interface PushNotificationSettingsViewProps {
  adminRole: AdminRole | null;
  onBackToDashboard?: () => void;
}

export function PushNotificationSettingsView({
  adminRole,
  onBackToDashboard,
}: PushNotificationSettingsViewProps) {
  const isAuthorized = canAccessSettings(adminRole);

  const {
    isSupported,
    isSecureContext,
    vapidKey,
    permission,
    isSubscribed,
    currentEndpoint,
    subscriptions,
    isLoading,
    isActionInProgress,
    statusMessage,
    errorMessage,
    diagnostics,
    enablePush,
    disablePush,
    removeDevice,
    sendTestPush,
    refreshSubscriptions,
  } = usePushNotifications();

  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleTestPush = async () => {
    setTestResult(null);
    const res = await sendTestPush();
    setTestResult(res);
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
              <BellRing className="size-6 text-primary" />
              <span>Web Push Notifications</span>
            </h2>
            <Badge
              variant="outline"
              className={
                isSubscribed
                  ? "border-emerald-500/40 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400"
                  : "border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-400"
              }
            >
              {isSubscribed ? "Push Active on this Device" : "Push Disabled"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Receive instant, reliable alerts for new customer orders even when all website tabs are closed.
          </p>
        </div>
      </div>

      {/* Status & Feedback Banners */}
      {statusMessage && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-3 animate-in fade-in">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="font-semibold">{statusMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-start gap-3 animate-in fade-in">
          <XCircle className="size-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">Web Push Notice</p>
            <p className="leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Missing VAPID Configuration Notice */}
      {!diagnostics.vapidConfigured && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3">
          <Key className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-1.5">
            <p className="font-bold">VAPID Configuration Required for Web Push</p>
            <p className="leading-relaxed">
              To send Web Push notifications when tabs are closed, configure <code className="font-mono text-[11px] bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">VITE_VAPID_PUBLIC_KEY</code> in your environment, and set <code className="font-mono text-[11px] bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">VAPID_PRIVATE_KEY</code> in your Supabase Edge Function secrets.
            </p>
            <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
              * Note: In-app notification bell alerts, live Supabase Realtime updates, and audio chimes remain fully functional while VAPID is configured.
            </p>
          </div>
        </div>
      )}

      {/* Main Controls Card */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
          <div>
            <h3 className="font-display text-base font-bold text-foreground">
              Current Device Subscription
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage push notification delivery for this specific browser and device.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isSubscribed ? (
              <Button
                type="button"
                onClick={enablePush}
                disabled={isActionInProgress || !isSupported}
                className="h-10 px-4 text-xs font-bold gap-2"
                id="admin-enable-push-btn"
              >
                {isActionInProgress ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Subscribing...</span>
                  </>
                ) : (
                  <>
                    <BellRing className="size-4" />
                    <span>Enable Push Notifications</span>
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={disablePush}
                disabled={isActionInProgress}
                className="h-10 px-4 text-xs font-bold text-destructive hover:bg-destructive/10 gap-2 border-destructive/30"
                id="admin-disable-push-btn"
              >
                {isActionInProgress ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Disabling...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-4" />
                    <span>Disable on this Device</span>
                  </>
                )}
              </Button>
            )}

            {isSubscribed && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleTestPush}
                disabled={isActionInProgress || !isAuthorized}
                className="h-10 px-4 text-xs font-bold gap-2"
                id="admin-test-push-btn"
              >
                <Send className="size-3.5" />
                <span>Send Test Notification</span>
              </Button>
            )}
          </div>
        </div>

        {/* Test Result Feedback */}
        {testResult && (
          <div
            className={`rounded-2xl p-3.5 text-xs flex items-center gap-2.5 ${
              testResult.success
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                : "bg-destructive/10 border border-destructive/30 text-destructive"
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="size-4 shrink-0 text-destructive" />
            )}
            <span className="font-semibold">{testResult.message}</span>
          </div>
        )}

        {/* Registered Devices List */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <span>Your Subscribed Devices</span>
              <span className="font-mono text-[10px] bg-secondary px-1.5 py-0.5 rounded">
                {subscriptions.length}
              </span>
            </h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={refreshSubscriptions}
              className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
            >
              <RefreshCw className="size-3" />
              <span>Refresh</span>
            </Button>
          </div>

          {subscriptions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">No devices currently subscribed</p>
              <p>
                Click "Enable Push Notifications" above to receive alerts on this device when orders arrive.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60 rounded-2xl border border-border bg-background/50 overflow-hidden">
              {subscriptions.map((sub) => {
                const isCurrent = sub.endpoint === currentEndpoint;
                const isMobile =
                  sub.device_label.toLowerCase().includes("android") ||
                  sub.device_label.toLowerCase().includes("ios");

                return (
                  <div
                    key={sub.id}
                    className="p-3.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-foreground">
                        {isMobile ? <Smartphone className="size-4 text-primary" /> : <Laptop className="size-4 text-primary" />}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-foreground truncate">{sub.device_label}</p>
                          {isCurrent && (
                            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                              This Device
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground font-mono truncate max-w-xs">
                          {sub.endpoint.slice(0, 48)}...
                        </p>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDevice(sub.endpoint)}
                      title="Remove device"
                      className="h-8 px-2.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Diagnostics Panel */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft space-y-4">
        <h3 className="font-display text-sm font-bold text-foreground flex items-center gap-2">
          <Info className="size-4 text-primary" />
          <span>System & Browser Diagnostics</span>
        </h3>

        <div className="grid gap-3 sm:grid-cols-2 text-xs">
          <div className="rounded-xl border border-border/80 bg-background/50 p-3 flex items-center justify-between">
            <span className="text-muted-foreground">Browser Push API:</span>
            <span className={`font-semibold ${diagnostics.supported ? "text-emerald-600" : "text-destructive"}`}>
              {diagnostics.supported ? "Supported" : "Not Supported"}
            </span>
          </div>

          <div className="rounded-xl border border-border/80 bg-background/50 p-3 flex items-center justify-between">
            <span className="text-muted-foreground">Security Context (HTTPS):</span>
            <span className={`font-semibold ${diagnostics.secureContext ? "text-emerald-600" : "text-destructive"}`}>
              {diagnostics.secureContext ? "Secure" : "Insecure (Requires HTTPS)"}
            </span>
          </div>

          <div className="rounded-xl border border-border/80 bg-background/50 p-3 flex items-center justify-between">
            <span className="text-muted-foreground">Browser Permission:</span>
            <span className="font-semibold capitalize">
              {permission}
            </span>
          </div>

          <div className="rounded-xl border border-border/80 bg-background/50 p-3 flex items-center justify-between">
            <span className="text-muted-foreground">VAPID Public Key:</span>
            <span className={`font-semibold ${diagnostics.vapidConfigured ? "text-emerald-600" : "text-amber-600"}`}>
              {diagnostics.vapidConfigured ? "Configured" : "Setup Required"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
