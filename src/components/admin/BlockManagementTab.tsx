import { useState, useEffect, useCallback } from "react";
import {
  Building2,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Users,
  Edit3,
  ShieldCheck,
  Package,
  Clock,
  Check,
  X,
  Power,
  PowerOff,
  UserCheck,
  UserX,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { canManageBlocks, type AdminRole } from "@/lib/permissions";

export interface DeliveryBlockStats {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  assigned_manager_id: string | null;
  assigned_manager_email: string | null;
  assigned_manager_name: string | null;
  total_orders: number;
  active_orders: number;
  latest_claimed_at: string | null;
}

interface BlockManagerCandidate {
  user_id: string;
  email: string;
  full_name: string | null;
  assigned_block: string | null;
}

interface BlockManagementTabProps {
  adminRole: AdminRole | null;
}

export function BlockManagementTab({ adminRole }: BlockManagementTabProps) {
  const canManage = canManageBlocks(adminRole);

  const [blocks, setBlocks] = useState<DeliveryBlockStats[]>([]);
  const [candidates, setCandidates] = useState<BlockManagerCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBlockId, setNewBlockId] = useState("");
  const [newBlockName, setNewBlockName] = useState("");
  const [newBlockDescription, setNewBlockDescription] = useState("");
  const [newBlockManagerId, setNewBlockManagerId] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);

  // Edit Modal State
  const [editingBlock, setEditingBlock] = useState<DeliveryBlockStats | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editManagerId, setEditManagerId] = useState<string>("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Quick Manager Assignment Modal State
  const [assigningBlock, setAssigningBlock] = useState<DeliveryBlockStats | null>(null);
  const [selectedManagerId, setSelectedManagerId] = useState<string>("");
  const [isAssigning, setIsAssigning] = useState(false);

  // Load blocks and block manager candidates
  const loadData = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);

    if (!isSupabaseConfigured) {
      // Mock demonstration data for demo environment
      const mockBlocks: DeliveryBlockStats[] = [
        {
          id: "Block A",
          name: "Block A",
          description: "Senior Residence Wing - 4 floors",
          is_active: true,
          created_at: new Date().toISOString(),
          assigned_manager_id: "m-1",
          assigned_manager_email: "manager.a@shiptmart.com",
          assigned_manager_name: "Ahmad Block Lead",
          total_orders: 142,
          active_orders: 4,
          latest_claimed_at: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: "Block B",
          name: "Block B",
          description: "Junior Residence Wing",
          is_active: true,
          created_at: new Date().toISOString(),
          assigned_manager_id: "m-2",
          assigned_manager_email: "manager.b@shiptmart.com",
          assigned_manager_name: "Bilal Coordinator",
          total_orders: 98,
          active_orders: 2,
          latest_claimed_at: new Date(Date.now() - 7200000).toISOString(),
        },
        {
          id: "Main Campus",
          name: "Main Campus",
          description: "Central Academic & Faculty Quad",
          is_active: true,
          created_at: new Date().toISOString(),
          assigned_manager_id: null,
          assigned_manager_email: null,
          assigned_manager_name: null,
          total_orders: 54,
          active_orders: 1,
          latest_claimed_at: new Date(Date.now() - 14400000).toISOString(),
        },
      ];
      setBlocks(mockBlocks);
      setCandidates([
        { user_id: "m-1", email: "manager.a@shiptmart.com", full_name: "Ahmad Block Lead", assigned_block: "Block A" },
        { user_id: "m-2", email: "manager.b@shiptmart.com", full_name: "Bilal Coordinator", assigned_block: "Block B" },
        { user_id: "m-3", email: "manager.c@shiptmart.com", full_name: "Tariq Delivery", assigned_block: null },
      ]);
      setLoading(false);
      return;
    }

    try {
      // 1. Fetch blocks with stats via dedicated RPC
      const { data: statsData, error: statsError } = await supabase.rpc(
        "admin_get_delivery_blocks_with_stats"
      );

      if (!statsError && statsData) {
        setBlocks(statsData as DeliveryBlockStats[]);
      } else {
        // Fallback: direct table query if RPC is pending migration
        const { data: rawBlocks } = await supabase
          .from("delivery_blocks")
          .select("id, name, description, is_active, created_at")
          .order("name", { ascending: true });

        if (rawBlocks) {
          const mapped: DeliveryBlockStats[] = rawBlocks.map((b) => ({
            id: b.id,
            name: b.name,
            description: b.description,
            is_active: b.is_active,
            created_at: b.created_at,
            assigned_manager_id: null,
            assigned_manager_email: null,
            assigned_manager_name: null,
            total_orders: 0,
            active_orders: 0,
            latest_claimed_at: null,
          }));
          setBlocks(mapped);
        }
      }

      // 2. Fetch candidates for Block Manager (staff with role = 'block_manager')
      const { data: roleStaff } = await supabase
        .from("admin_roles")
        .select(`
          user_id,
          role,
          assigned_block
        `)
        .eq("role", "block_manager");

      if (roleStaff && roleStaff.length > 0) {
        const userIds = roleStaff.map((r) => r.user_id);
        const { data: profileList } = await supabase
          .from("profiles")
          .select("id, full_name, phone")
          .in("id", userIds);

        const profileMap = new Map((profileList || []).map((p) => [p.id, p]));

        const candList: BlockManagerCandidate[] = roleStaff.map((r) => {
          const prof = profileMap.get(r.user_id);
          return {
            user_id: r.user_id,
            email: `Staff ${r.user_id.slice(0, 8)}`,
            full_name: prof?.full_name || null,
            assigned_block: r.assigned_block,
          };
        });
        setCandidates(candList);
      } else {
        setCandidates([]);
      }
    } catch (err: any) {
      toast.error(`Failed to load block statistics: ${err?.message}`);
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Create Block
  const handleCreateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlockId.trim() || !newBlockName.trim()) {
      toast.error("Block ID and display name are required.");
      return;
    }

    setIsCreating(true);
    try {
      const { error } = await supabase.rpc("admin_manage_delivery_block", {
        p_action: "create",
        p_id: newBlockId.trim(),
        p_name: newBlockName.trim(),
        p_description: newBlockDescription.trim() || null,
        p_is_active: true,
        p_manager_user_id: newBlockManagerId || null,
      });

      if (error) {
        toast.error(`Unable to create delivery block: ${error.message}`);
        return;
      }

      toast.success(`Delivery block "${newBlockName}" created successfully!`);
      setIsCreateOpen(false);
      setNewBlockId("");
      setNewBlockName("");
      setNewBlockDescription("");
      setNewBlockManagerId("");
      loadData();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Handle Edit Block
  const handleUpdateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBlock) return;

    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc("admin_manage_delivery_block", {
        p_action: "update",
        p_id: editingBlock.id,
        p_name: editName.trim(),
        p_description: editDescription.trim() || null,
        p_is_active: editIsActive,
        p_manager_user_id: editManagerId || null,
      });

      if (error) {
        toast.error(`Unable to update block: ${error.message}`);
        return;
      }

      toast.success(`Block "${editingBlock.id}" updated successfully!`);
      setEditingBlock(null);
      loadData();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle Toggle Active
  const handleToggleActive = async (block: DeliveryBlockStats) => {
    try {
      const { error } = await supabase.rpc("admin_manage_delivery_block", {
        p_action: "toggle_active",
        p_id: block.id,
        p_name: null,
        p_description: null,
        p_is_active: null,
        p_manager_user_id: null,
      });

      if (error) {
        toast.error(`Failed to toggle block status: ${error.message}`);
        return;
      }

      toast.success(
        block.is_active
          ? `Delivery block "${block.name}" deactivated. Historical orders remain preserved.`
          : `Delivery block "${block.name}" activated and available for customer checkout!`
      );
      loadData();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    }
  };

  // Handle Manager Assignment
  const handleAssignManager = async () => {
    if (!assigningBlock) return;

    setIsAssigning(true);
    try {
      const { error } = await supabase.rpc("admin_manage_delivery_block", {
        p_action: "assign_manager",
        p_id: assigningBlock.id,
        p_name: null,
        p_description: null,
        p_is_active: null,
        p_manager_user_id: selectedManagerId || null,
      });

      if (error) {
        toast.error(`Failed to assign Block Manager: ${error.message}`);
        return;
      }

      toast.success(
        selectedManagerId
          ? `Block Manager assigned to "${assigningBlock.name}"!`
          : `Manager assignment cleared for "${assigningBlock.name}".`
      );
      setAssigningBlock(null);
      setSelectedManagerId("");
      loadData();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    } finally {
      setIsAssigning(false);
    }
  };

  // Filtered blocks
  const filteredBlocks = blocks.filter((b) => {
    if (statusFilter === "active" && !b.is_active) return false;
    if (statusFilter === "inactive" && b.is_active) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        b.id.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q) ||
        (b.description && b.description.toLowerCase().includes(q)) ||
        (b.assigned_manager_name && b.assigned_manager_name.toLowerCase().includes(q)) ||
        (b.assigned_manager_email && b.assigned_manager_email.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const activeCount = blocks.filter((b) => b.is_active).length;
  const assignedCount = blocks.filter((b) => b.assigned_manager_id).length;
  const totalActiveOrders = blocks.reduce((acc, b) => acc + Number(b.active_orders || 0), 0);

  if (!canManage) {
    return (
      <div className="mt-8 rounded-3xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <AlertCircle className="mx-auto size-12 text-destructive" />
        <h3 className="mt-4 font-display text-lg font-bold text-foreground">
          Access Denied
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Delivery block administration is restricted strictly to Super Administrators and Store Owners.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-3xl border border-border bg-card p-6 shadow-soft">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </span>
            <h2 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Delivery Block Management
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Configure dynamic delivery sectors, manage active status for customer checkout, and assign local Block Managers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="gap-1.5 text-xs h-9"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            <span>Refresh</span>
          </Button>
          <Button
            type="button"
            variant="hero"
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="gap-1.5 text-xs font-bold h-9"
          >
            <Plus className="size-4" />
            <span>Add Delivery Block</span>
          </Button>
        </div>
      </div>

      {/* Overview Metric Badges */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold">Total Blocks</span>
            <Building2 className="size-4 text-primary" />
          </div>
          <p className="mt-2 font-display text-2xl font-black text-foreground">{blocks.length}</p>
          <p className="text-[11px] text-muted-foreground">Configured in database</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold">Active Sectors</span>
            <CheckCircle2 className="size-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-display text-2xl font-black text-emerald-600">{activeCount}</p>
          <p className="text-[11px] text-muted-foreground">Available at checkout</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold">Assigned Managers</span>
            <Users className="size-4 text-primary" />
          </div>
          <p className="mt-2 font-display text-2xl font-black text-foreground">{assignedCount}</p>
          <p className="text-[11px] text-muted-foreground">Block leads active</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold">In-Flight Orders</span>
            <Package className="size-4 text-warn-foreground" />
          </div>
          <p className="mt-2 font-display text-2xl font-black text-foreground">{totalActiveOrders}</p>
          <p className="text-[11px] text-muted-foreground">Processing right now</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 max-w-sm">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search blocks or managers..."
              className="h-9 w-full rounded-xl border border-input bg-card pl-8 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-9 rounded-xl border border-input bg-card px-3 text-xs font-semibold outline-none focus:border-primary"
          >
            <option value="all">All Sectors ({blocks.length})</option>
            <option value="active">Active Only ({activeCount})</option>
            <option value="inactive">Inactive ({blocks.length - activeCount})</option>
          </select>
        </div>
      </div>

      {/* Blocks Grid / Cards */}
      {filteredBlocks.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No delivery blocks found matching your criteria.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredBlocks.map((b) => (
            <div
              key={b.id}
              className={cn(
                "flex flex-col justify-between rounded-3xl border bg-card p-5 shadow-2xs transition hover:shadow-soft",
                b.is_active ? "border-border hover:border-primary/40" : "border-border/60 bg-muted/20 opacity-80"
              )}
            >
              <div>
                {/* Header: Name and Status Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-bold text-foreground">
                      {b.name}
                    </h3>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      ID: <span className="font-semibold text-foreground/80">{b.id}</span>
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] uppercase font-bold",
                      b.is_active
                        ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                        : "bg-muted text-muted-foreground border-border"
                    )}
                  >
                    {b.is_active ? "Active at Checkout" : "Inactive / Archived"}
                  </Badge>
                </div>

                {b.description && (
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                    {b.description}
                  </p>
                )}

                {/* Manager Allocation Card */}
                <div className="mt-4 rounded-2xl border border-border/70 bg-secondary/30 p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Assigned Block Manager
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAssigningBlock(b);
                        setSelectedManagerId(b.assigned_manager_id || "");
                      }}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      {b.assigned_manager_id ? "Reassign" : "Assign"}
                    </button>
                  </div>

                  {b.assigned_manager_id ? (
                    <div className="flex items-center gap-2 pt-0.5">
                      <div className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
                        <Users className="size-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-foreground truncate">
                          {b.assigned_manager_name || b.assigned_manager_email || "Staff Lead"}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {b.assigned_manager_email}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-warn-foreground pt-0.5">
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span className="text-[11px] font-semibold">Unassigned — Managed by Super Admin & Owner</span>
                    </div>
                  )}
                </div>

                {/* Orders Statistics */}
                <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-xl border border-border/50 bg-card p-2">
                    <span className="text-[10px] font-medium text-muted-foreground">Active Orders</span>
                    <p className="font-mono text-sm font-extrabold text-foreground">{b.active_orders}</p>
                  </div>
                  <div className="rounded-xl border border-border/50 bg-card p-2">
                    <span className="text-[10px] font-medium text-muted-foreground">Total Orders</span>
                    <p className="font-mono text-sm font-extrabold text-foreground">{b.total_orders}</p>
                  </div>
                </div>

                {b.latest_claimed_at && (
                  <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="size-3" />
                    <span>Last claimed: {new Date(b.latest_claimed_at).toLocaleTimeString()}</span>
                  </p>
                )}
              </div>

              {/* Actions Footer */}
              <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-3 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggleActive(b)}
                  className={cn(
                    "gap-1.5 text-xs h-8 flex-1 font-semibold",
                    b.is_active ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  {b.is_active ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                  <span>{b.is_active ? "Deactivate" : "Activate"}</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingBlock(b);
                    setEditName(b.name);
                    setEditDescription(b.description || "");
                    setEditIsActive(b.is_active);
                    setEditManagerId(b.assigned_manager_id || "");
                  }}
                  className="gap-1.5 text-xs h-8 flex-1 font-semibold"
                >
                  <Edit3 className="size-3.5" />
                  <span>Edit Details</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE NEW BLOCK MODAL */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6 sm:p-7">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold">
              Add New Delivery Block
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define a new campus sector for customer doorstep deliveries. Block IDs are permanent identifiers.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateBlock} className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Block Database ID (Immutable Reference)
              </label>
              <input
                type="text"
                required
                value={newBlockId}
                onChange={(e) => setNewBlockId(e.target.value)}
                placeholder="e.g. Block E or Science Wing"
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary font-mono"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Used in order foreign keys and database validation.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Display Name (Checkout Label)
              </label>
              <input
                type="text"
                required
                value={newBlockName}
                onChange={(e) => setNewBlockName(e.target.value)}
                placeholder="e.g. Block E — Postgraduate Wing"
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Description / Dispatch Notes (Optional)
              </label>
              <textarea
                value={newBlockDescription}
                onChange={(e) => setNewBlockDescription(e.target.value)}
                placeholder="e.g. Floors 1 to 4 with elevator access via courtyard"
                className="h-20 w-full rounded-xl border border-input bg-card p-3 text-xs outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Initial Block Manager Assignment (Optional)
              </label>
              <select
                value={newBlockManagerId}
                onChange={(e) => setNewBlockManagerId(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-medium outline-none focus:border-primary"
              >
                <option value="">Leave Unassigned (Super Admin & Owner manage)</option>
                {candidates.map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.full_name || c.email} {c.assigned_block ? `(Currently on ${c.assigned_block})` : "(Unassigned)"}
                  </option>
                ))}
              </select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
                className="h-9 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                size="sm"
                disabled={isCreating}
                className="h-9 text-xs font-bold px-4"
              >
                {isCreating ? "Creating Block..." : "Create Delivery Block"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT BLOCK MODAL */}
      <Dialog open={editingBlock !== null} onOpenChange={(open) => !open && setEditingBlock(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6 sm:p-7">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold">
              Edit Delivery Block: {editingBlock?.id}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Update display names, operational descriptions, and active status for checkout.
            </DialogDescription>
          </DialogHeader>

          {editingBlock && (
            <form onSubmit={handleUpdateBlock} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Description / Dispatch Notes
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="h-20 w-full rounded-xl border border-input bg-card p-3 text-xs outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Assigned Block Manager
                </label>
                <select
                  value={editManagerId}
                  onChange={(e) => setEditManagerId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-medium outline-none focus:border-primary"
                >
                  <option value="">Leave Unassigned</option>
                  {candidates.map((c) => (
                    <option key={c.user_id} value={c.user_id}>
                      {c.full_name || c.email} {c.assigned_block === editingBlock.id ? "— (Current Lead)" : c.assigned_block ? `— (On ${c.assigned_block})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="editIsActiveCheckbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="size-4 rounded accent-primary"
                />
                <label htmlFor="editIsActiveCheckbox" className="text-xs font-semibold text-foreground">
                  Block is active and available in customer checkout
                </label>
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingBlock(null)}
                  className="h-9 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="hero"
                  size="sm"
                  disabled={isUpdating}
                  className="h-9 text-xs font-bold px-4"
                >
                  {isUpdating ? "Saving Changes..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* QUICK ASSIGN MANAGER MODAL */}
      <Dialog open={assigningBlock !== null} onOpenChange={(open) => !open && setAssigningBlock(null)}>
        <DialogContent className="max-w-sm rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-base font-bold">
              Allocate Block Manager
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Select an authorized staff member with the Block Manager role for <strong>{assigningBlock?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground">
                Staff Candidate
              </label>
              <select
                value={selectedManagerId}
                onChange={(e) => setSelectedManagerId(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-medium outline-none focus:border-primary"
              >
                <option value="">Unassign Manager (Clear lead)</option>
                {candidates.map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.full_name || c.email} {c.assigned_block ? `— (Currently on ${c.assigned_block})` : "— (Available)"}
                  </option>
                ))}
              </select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAssigningBlock(null)}
                className="h-9 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="hero"
                size="sm"
                disabled={isAssigning}
                onClick={handleAssignManager}
                className="h-9 text-xs font-bold px-4"
              >
                {isAssigning ? "Assigning..." : "Confirm Assignment"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
