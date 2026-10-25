import React from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabVisibilitySettingsSection } from "@/components/admin/TabVisibilitySettingsSection";
import type { AdminRole } from "@/lib/permissions";
import type { AdminTabId } from "@/lib/adminTabVisibility";

interface TabVisibilitySettingsViewProps {
  adminRole: AdminRole | null;
  userId?: string | null | undefined;
  onBackToDashboard: () => void;
  onTabChange?: ((tabId: AdminTabId) => void) | undefined;
}

export function TabVisibilitySettingsView({
  adminRole,
  userId,
  onBackToDashboard,
  onTabChange,
}: TabVisibilitySettingsViewProps) {
  return (
    <div className="space-y-6">
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

      <TabVisibilitySettingsSection
        adminRole={adminRole}
        userId={userId}
        onTabChange={onTabChange}
      />
    </div>
  );
}
