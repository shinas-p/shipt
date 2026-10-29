/**
 * ShipT Mart — Installable Progressive Web App (PWA) Prompt Component
 *
 * Provides:
 * 1. Non-intrusive install banner using native beforeinstallprompt event.
 * 2. Platform-specific guidance for iOS / Safari (Share -> Add to Home Screen).
 * 3. LocalStorage dismissal memory so users are never nagged repeatedly.
 * 4. Automatic suppression when already operating in standalone / installed mode.
 */

import { useState, useEffect, useCallback } from "react";
import { Download, X, Smartphone, Share, PlusSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

export const PWA_DISMISSED_KEY = "shipt_pwa_install_dismissed_v1";
const DISMISSED_KEY = PWA_DISMISSED_KEY;

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [isIos, setIsIos] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(true); // start hidden
  const [showIosGuide, setShowIosGuide] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Check if already running in standalone / installed mode
    const standaloneCheck =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(standaloneCheck);

    if (standaloneCheck) return; // Do not show if already installed

    // 2. Check if user already dismissed recently
    const dismissedTimestamp = localStorage.getItem(DISMISSED_KEY);
    if (dismissedTimestamp) {
      const daysSinceDismissal =
        (Date.now() - parseInt(dismissedTimestamp, 10)) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissal < 14) {
        // Suppress for 14 days after dismissal
        return;
      }
    }

    // 3. Detect iOS Safari
    const ua = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(ua);
    const isSafari = ua.includes("safari") && !ua.includes("chrome") && !ua.includes("crios");
    setIsIos(isIosDevice && isSafari);

    // 4. Capture native beforeinstallprompt event (Chromium, Edge, Android)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsDismissed(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    // If iOS Safari, allow showing after small delay if not dismissed
    if (isIosDevice && isSafari && !dismissedTimestamp) {
      const timer = setTimeout(() => {
        setIsDismissed(false);
      }, 4000);
      return () => clearTimeout(timer);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          setIsDismissed(true);
        }
        setDeferredPrompt(null);
      } catch (err) {
        console.warn("[ShipT PWA] Install prompt error:", err);
      }
    } else if (isIos) {
      setShowIosGuide((prev) => !prev);
    }
  }, [deferredPrompt, isIos]);

  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
    setShowIosGuide(false);
    try {
      localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    } catch {}
  }, []);

  // Suppress rendering if standalone, dismissed, or unsupported
  if (isStandalone || isDismissed || (!deferredPrompt && !isIos)) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Install ShipT App"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md z-40 duration-300 animate-in fade-in slide-in-from-bottom-4"
    >
      <div className="relative rounded-2xl border border-primary/20 bg-card p-4 shadow-xl backdrop-blur-md">
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss app install banner"
          className="absolute top-2.5 right-2.5 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-3.5 pr-6">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Smartphone className="size-6" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-display text-sm font-bold text-foreground">
                Install ShipT App
              </h4>
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                Fast & Offline
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Add ShipT to your home screen for quick campus ordering, instant load times, and delivery notifications.
            </p>

            {/* iOS Safari Guided Steps */}
            {showIosGuide && isIos && (
              <div className="mt-3 rounded-xl border border-border/80 bg-secondary/50 p-2.5 text-[11px] text-muted-foreground space-y-1.5 animate-in fade-in">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <Share className="size-3.5 text-primary" />
                  <span>To install on iPhone or iPad:</span>
                </p>
                <ol className="list-decimal list-inside space-y-1 pl-1">
                  <li>Tap the <strong>Share</strong> button at the bottom of Safari</li>
                  <li>Scroll down and tap <strong>Add to Home Screen</strong> (<PlusSquare className="inline size-3 text-foreground" />)</li>
                  <li>Tap <strong>Add</strong> in the top right</li>
                </ol>
              </div>
            )}

            <div className="mt-3.5 flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleInstallClick}
                className="h-8 px-3.5 text-xs font-bold gap-1.5"
                id="pwa-install-banner-btn"
              >
                <Download className="size-3.5" />
                <span>{isIos ? (showIosGuide ? "Hide Guide" : "How to Install") : "Install Now"}</span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Not now
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
