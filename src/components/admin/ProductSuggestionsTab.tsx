import { useState, useEffect, useMemo } from "react";
import {
  Sparkles,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Package,
  Layers,
  ArrowLeft,
  Loader2,
  Save,
  ExternalLink,
  Eye,
  X,
  MessageSquare,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  fetchAllSuggestions,
  updateSuggestionStatus,
  retryApprovalNotification,
  type ProductSuggestion,
  type SuggestionStatus,
} from "@/lib/suggestions";
import { canManageSuggestions, type AdminRole } from "@/lib/permissions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ProductSuggestionsTabProps {
  adminRole: AdminRole | null;
  onBackToDashboard?: () => void;
}

export function ProductSuggestionsTab({
  adminRole,
  onBackToDashboard,
}: ProductSuggestionsTabProps) {
  const isAuthorized = canManageSuggestions(adminRole);

  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Status and Notes editing state
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});

  // Photo viewer modal
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; title: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchAllSuggestions();
      setSuggestions(data);

      // Pre-fill notes dictionary
      const notesMap: Record<string, string> = {};
      for (const item of data) {
        notesMap[item.id] = item.admin_notes || "";
      }
      setEditingNotes(notesMap);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredSuggestions = useMemo(() => {
    return suggestions.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          item.product_name.toLowerCase().includes(q) ||
          item.customer_name.toLowerCase().includes(q) ||
          item.customer_email.toLowerCase().includes(q) ||
          (item.brand && item.brand.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [suggestions, statusFilter, search]);

  const stats = useMemo(() => {
    let pending = 0;
    let reviewed = 0;
    let approved = 0;
    let rejected = 0;
    for (const item of suggestions) {
      if (item.status === "pending") pending++;
      else if (item.status === "reviewed") reviewed++;
      else if (item.status === "approved") approved++;
      else if (item.status === "rejected") rejected++;
    }
    return { total: suggestions.length, pending, reviewed, approved, rejected };
  }, [suggestions]);

  const handleStatusChange = async (
    id: string,
    newStatus: SuggestionStatus
  ) => {
    setUpdatingId(id);
    try {
      const currentItem = suggestions.find((s) => s.id === id);
      const previousStatus = currentItem?.status;
      const currentNotes = editingNotes[id] ?? null;
      const res = await updateSuggestionStatus(id, newStatus, currentNotes, null, previousStatus);
      if (res.success) {
        if (newStatus === "approved" && res.emailSent) {
          toast.success("Approved product! Customer notification email dispatched.");
        } else if (newStatus === "approved" && res.emailError) {
          toast.warning(`Approved product (Email notice: ${res.emailError})`);
        } else {
          toast.success(`Updated status to ${newStatus}`);
        }
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  status: newStatus,
                  approval_email_sent_at: res.emailSent ? new Date().toISOString() : s.approval_email_sent_at,
                  approval_email_error: res.emailError !== undefined ? res.emailError : s.approval_email_error,
                }
              : s
          )
        );
      } else {
        toast.error(res.error || "Failed to update status");
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRetryEmail = async (id: string) => {
    setUpdatingId(id);
    try {
      const res = await retryApprovalNotification(id);
      if (res.success) {
        toast.success("Approval notification email sent successfully!");
        setSuggestions((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  approval_email_sent_at: new Date().toISOString(),
                  approval_email_error: null,
                }
              : s
          )
        );
      } else {
        toast.error(res.error || "Failed to deliver email. Provider may be unconfigured.");
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSaveNotes = async (id: string) => {
    setUpdatingId(id);
    try {
      const notes = editingNotes[id] || "";
      const currentItem = suggestions.find((s) => s.id === id);
      const res = await updateSuggestionStatus(
        id,
        currentItem?.status || "pending",
        notes
      );
      if (res.success) {
        toast.success("Saved administrative notes");
        setSuggestions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, admin_notes: notes } : s))
        );
      } else {
        toast.error(res.error || "Failed to save notes");
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const getStatusBadge = (status: SuggestionStatus) => {
    switch (status) {
      case "approved":
        return {
          label: "Approved & Sourcing",
          className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
        };
      case "reviewed":
        return {
          label: "Under Review",
          className: "bg-blue-500/10 text-blue-700 border-blue-500/30",
        };
      case "rejected":
        return {
          label: "Rejected / Unavailable",
          className: "bg-destructive/10 text-destructive border-destructive/20",
        };
      default:
        return {
          label: "Pending Review",
          className: "bg-amber-500/10 text-amber-700 border-amber-500/30",
        };
    }
  };

  return (
    <div className="space-y-6">
      {/* Navigation Breadcrumb */}
      {onBackToDashboard && (
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
      )}

      {/* Header */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
              <Sparkles className="size-3.5" />
              <span>Campus Demand Management</span>
            </div>
            <h2 className="mt-2 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Customer Product Suggestions
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Review and manage item requests submitted by students and campus customers.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="text-xs self-start sm:self-center h-9"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : "Refresh List"}
          </Button>
        </div>

        {/* Counter Summary Cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-2xl border border-border bg-background p-3.5 text-center">
            <p className="text-[11px] font-semibold text-muted-foreground">Total Requests</p>
            <p className="font-display text-xl font-extrabold text-foreground">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-center">
            <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">Pending</p>
            <p className="font-display text-xl font-extrabold text-amber-900 dark:text-amber-200">{stats.pending}</p>
          </div>
          <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-3.5 text-center">
            <p className="text-[11px] font-semibold text-blue-800 dark:text-blue-300">In Review</p>
            <p className="font-display text-xl font-extrabold text-blue-900 dark:text-blue-200">{stats.reviewed}</p>
          </div>
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-center">
            <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">Approved</p>
            <p className="font-display text-xl font-extrabold text-emerald-900 dark:text-emerald-200">{stats.approved}</p>
          </div>
          <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-3.5 text-center col-span-2 sm:col-span-1">
            <p className="text-[11px] font-semibold text-destructive">Unavailable</p>
            <p className="font-display text-xl font-extrabold text-destructive">{stats.rejected}</p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search suggestions by product, brand, customer..."
            className="h-10 w-full rounded-xl border border-input bg-card pl-10 pr-3.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {(["all", "pending", "reviewed", "approved", "rejected"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-bold capitalize transition shrink-0",
                statusFilter === st
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "border border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Suggestions List */}
      {filteredSuggestions.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center text-xs text-muted-foreground">
          {search ? "No product suggestions match your search criteria." : "No product suggestions found."}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSuggestions.map((item) => {
            const badge = getStatusBadge(item.status);
            const isUpdating = updatingId === item.id;

            return (
              <div
                key={item.id}
                className="rounded-3xl border border-border bg-card p-5 shadow-soft transition hover:border-primary/30 sm:p-6"
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
                  {/* Left: Product & Customer Info */}
                  <div className="flex items-start gap-4">
                    {/* Photo thumbnail */}
                    {item.photo_url ? (
                      <button
                        type="button"
                        onClick={() => setSelectedPhoto({ url: item.photo_url!, title: item.product_name })}
                        className="group relative size-20 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted cursor-pointer hover:opacity-90"
                        title="Click to view full photo"
                      >
                        <img
                          src={item.photo_url}
                          alt={item.product_name}
                          className="h-full w-full object-cover transition group-hover:scale-105"
                        />
                        <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 group-hover:opacity-100 transition text-white">
                          <Eye className="size-5" />
                        </span>
                      </button>
                    ) : (
                      <div className="grid size-20 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                        <Package className="size-8" />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-base font-bold text-foreground">
                          {item.product_name}
                        </h3>
                        <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", badge.className)}>
                          {badge.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {item.category && (
                          <span className="inline-flex items-center gap-1">
                            <Layers className="size-3" />
                            <span>{item.category}</span>
                          </span>
                        )}
                        {item.brand && <span>Brand: <strong className="text-foreground">{item.brand}</strong></span>}
                        {item.expected_price && (
                          <span>Target Price: <strong className="text-foreground">₹{item.expected_price}</strong></span>
                        )}
                        <span>Qty: <strong className="text-foreground">{item.quantity}</strong></span>
                      </div>

                      {item.reason && (
                        <p className="mt-2 text-xs text-foreground/80 bg-muted/30 p-2.5 rounded-xl border border-border/60">
                          "{item.reason}"
                        </p>
                      )}

                      <div className="pt-1 text-[11px] text-muted-foreground">
                        Suggested by <strong className="text-foreground">{item.customer_name}</strong> (
                        <a href={`mailto:${item.customer_email}`} className="text-primary hover:underline">
                          {item.customer_email}
                        </a>
                        {item.customer_phone ? ` • ${item.customer_phone}` : ""}) on{" "}
                        {new Date(item.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  {/* Right: Status Selector & Admin Notes */}
                  <div className="w-full lg:w-80 shrink-0 space-y-3 pt-3 lg:pt-0 border-t lg:border-t-0 border-border">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Change Status:</label>
                      <select
                        value={item.status}
                        disabled={isUpdating}
                        onChange={(e) => handleStatusChange(item.id, e.target.value as SuggestionStatus)}
                        className="h-9 w-full rounded-xl border border-input bg-background px-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                      >
                        <option value="pending">Pending Review</option>
                        <option value="reviewed">Under Review</option>
                        <option value="approved">Approved & Sourcing</option>
                        <option value="rejected">Rejected / Unavailable</option>
                      </select>
                    </div>

                    {/* Email Notification Dispatch Status */}
                    {item.status === "approved" && (
                      <div className="pt-0.5">
                        {item.approval_email_sent_at ? (
                          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                            <span>Customer notified via email</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-900 dark:text-amber-200">
                            <div className="flex items-center gap-1.5 truncate">
                              <Mail className="size-3.5 shrink-0 text-amber-600" />
                              <span className="truncate">
                                {item.approval_email_error ? "Email pending setup" : "Email unsent"}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRetryEmail(item.id)}
                              disabled={isUpdating}
                              className="text-[10px] font-bold text-primary hover:underline shrink-0"
                            >
                              Dispatch Email
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Admin Notes:</label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={editingNotes[item.id] || ""}
                          onChange={(e) =>
                            setEditingNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                          placeholder="e.g. Inquired with distributor"
                          className="h-9 flex-1 rounded-xl border border-input bg-background px-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSaveNotes(item.id)}
                          disabled={isUpdating}
                          className="h-9 px-3 text-xs"
                          title="Save note"
                        >
                          <Save className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Photo Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="relative max-w-lg w-full rounded-3xl bg-card border border-border p-4 shadow-lift">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h4 className="font-bold text-sm text-foreground truncate">{selectedPhoto.title}</h4>
              <button
                type="button"
                onClick={() => setSelectedPhoto(null)}
                className="grid size-7 place-items-center rounded-full hover:bg-secondary transition"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-3 flex justify-center">
              <img
                src={selectedPhoto.url}
                alt={selectedPhoto.title}
                className="max-h-[70vh] rounded-2xl object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
