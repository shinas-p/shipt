import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface MaintenanceState {
  isMaintenanceMode: boolean;
  maintenanceMessage: string;
  maintenanceReopenAt: string | null;
  updatedAt: string | null;
}

export interface MaintenanceAuditLog {
  id: string;
  actor_email: string;
  action: string;
  details: {
    is_maintenance_mode?: boolean;
    maintenance_message?: string;
    maintenance_reopen_at?: string | null;
  };
  created_at: string;
}

export const DEFAULT_MAINTENANCE_STATE: MaintenanceState = {
  isMaintenanceMode: false,
  maintenanceMessage:
    "We are currently restocking our inventory and updating our catalogue. We will be back shortly!",
  maintenanceReopenAt: null,
  updatedAt: null,
};

const MAINTENANCE_CACHE_KEY = "shipt_maintenance_state_cache_v1";

export interface MaintenanceContextType {
  isMaintenanceMode: boolean;
  maintenanceMessage: string;
  maintenanceReopenAt: string | null;
  isLoading: boolean;
  error: string | null;
  refreshMaintenance: () => Promise<void>;
  setMaintenanceMode: (
    enabled: boolean,
    message?: string,
    reopenAt?: string | null
  ) => Promise<{ success: boolean; error?: string }>;
  fetchAuditLogs: () => Promise<MaintenanceAuditLog[]>;
}

const MaintenanceContext = createContext<MaintenanceContextType | null>(null);

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MaintenanceState>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem(MAINTENANCE_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed.isMaintenanceMode === "boolean") {
            return {
              isMaintenanceMode: parsed.isMaintenanceMode,
              maintenanceMessage:
                parsed.maintenanceMessage || DEFAULT_MAINTENANCE_STATE.maintenanceMessage,
              maintenanceReopenAt: parsed.maintenanceReopenAt || null,
              updatedAt: parsed.updatedAt || null,
            };
          }
        }
      } catch {
        // Fallback to default
      }
    }
    return DEFAULT_MAINTENANCE_STATE;
  });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Fetch fresh maintenance state from Supabase store_settings
  const refreshMaintenance = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      const { data, error: fetchErr } = await supabase
        .from("store_settings")
        .select(
          "is_maintenance_mode, maintenance_message, maintenance_reopen_at, maintenance_updated_at"
        )
        .eq("id", "default")
        .maybeSingle();

      if (fetchErr) {
        // If column or table doesn't exist yet, keep default inactive state safely
        const isMissing =
          fetchErr.code === "PGRST205" ||
          fetchErr.code === "42P01" ||
          fetchErr.code === "42703" ||
          fetchErr.message?.includes("does not exist") ||
          fetchErr.message?.includes("column");

        if (!isMissing) {
          setError(fetchErr.message);
        }
        return;
      }

      if (data) {
        const fresh: MaintenanceState = {
          isMaintenanceMode: Boolean(data.is_maintenance_mode),
          maintenanceMessage:
            data.maintenance_message || DEFAULT_MAINTENANCE_STATE.maintenanceMessage,
          maintenanceReopenAt: data.maintenance_reopen_at || null,
          updatedAt: data.maintenance_updated_at || null,
        };

        setState(fresh);

        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(MAINTENANCE_CACHE_KEY, JSON.stringify(fresh));
          } catch {}
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load maintenance status");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMaintenance();
  }, [refreshMaintenance]);

  // 2. Real-Time Subscription: Listen for changes to store_settings across sessions
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channel = supabase
      .channel("maintenance_status_sync")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "store_settings",
          filter: "id=eq.default",
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated) {
            const nextState: MaintenanceState = {
              isMaintenanceMode: Boolean(updated.is_maintenance_mode),
              maintenanceMessage:
                updated.maintenance_message || DEFAULT_MAINTENANCE_STATE.maintenanceMessage,
              maintenanceReopenAt: updated.maintenance_reopen_at || null,
              updatedAt: updated.maintenance_updated_at || null,
            };

            setState(nextState);

            if (typeof window !== "undefined") {
              try {
                localStorage.setItem(MAINTENANCE_CACHE_KEY, JSON.stringify(nextState));
              } catch {}
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 3. Super Admin Setter RPC
  const setMaintenanceMode = async (
    enabled: boolean,
    message?: string,
    reopenAt?: string | null
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setError(null);
      const cleanMsg = (message || state.maintenanceMessage).trim();

      if (isSupabaseConfigured) {
        const { error: rpcErr } = await supabase.rpc("admin_set_maintenance_mode", {
          p_enabled: enabled,
          p_message: cleanMsg,
          p_reopen_at: reopenAt || null,
        });

        if (rpcErr) {
          setError(rpcErr.message);
          return { success: false, error: rpcErr.message };
        }
      }

      // Optimistically update local state
      const next: MaintenanceState = {
        isMaintenanceMode: enabled,
        maintenanceMessage: cleanMsg,
        maintenanceReopenAt: reopenAt || null,
        updatedAt: new Date().toISOString(),
      };
      setState(next);

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(MAINTENANCE_CACHE_KEY, JSON.stringify(next));
        } catch {}
      }

      return { success: true };
    } catch (err: any) {
      const msg = err?.message || "Failed to update maintenance settings.";
      setError(msg);
      return { success: false, error: msg };
    }
  };

  // 4. Fetch Audit Logs RPC for Super Admin
  const fetchAuditLogs = async (): Promise<MaintenanceAuditLog[]> => {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error: logErr } = await supabase.rpc("admin_get_maintenance_audit_logs", {
        p_limit: 30,
      });
      if (logErr) {
        console.warn("Audit logs query notice:", logErr.message);
        return [];
      }
      return (data || []) as MaintenanceAuditLog[];
    } catch {
      return [];
    }
  };

  return (
    <MaintenanceContext.Provider
      value={{
        isMaintenanceMode: state.isMaintenanceMode,
        maintenanceMessage: state.maintenanceMessage,
        maintenanceReopenAt: state.maintenanceReopenAt,
        isLoading,
        error,
        refreshMaintenance,
        setMaintenanceMode,
        fetchAuditLogs,
      }}
    >
      {children}
    </MaintenanceContext.Provider>
  );
}

export function useMaintenance(): MaintenanceContextType {
  const context = useContext(MaintenanceContext);
  if (!context) {
    return {
      isMaintenanceMode: false,
      maintenanceMessage: DEFAULT_MAINTENANCE_STATE.maintenanceMessage,
      maintenanceReopenAt: null,
      isLoading: false,
      error: null,
      refreshMaintenance: async () => {},
      setMaintenanceMode: async () => ({ success: true }),
      fetchAuditLogs: async () => [],
    };
  }
  return context;
}
