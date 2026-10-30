import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Users,
  Search,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Clock,
  Edit3,
  RotateCcw,
  UserCheck,
  UserX,
  CreditCard,
  Wallet,
  Smartphone,
  Save,
  Check,
  X,
  Info,
  Loader2,
  History,
  FileText,
  Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type {
  StudentPaymentPolicy,
  StudentProfile,
  StudentPaymentAuditLog,
  StudentNoShowRecord,
  StorePaymentSettings,
} from "@/lib/types";
import {
  loadStorePaymentSettings,
  updateStorePaymentSettings,
  loadStudentProfiles,
  updateStudentPaymentPolicy,
  loadStudentPaymentAuditLogs,
  recordStudentNoShow,
  restoreStudentCashPrivileges,
  disputeStudentNoShow,
  loadStudentNoShowRecords,
  DEFAULT_STORE_PAYMENT_SETTINGS,
} from "@/lib/studentPaymentApi";
import type { AdminRole } from "@/lib/permissions";

interface StudentPaymentPoliciesViewProps {
  adminRole: AdminRole | null;
  onBackToSettings?: () => void;
}

export function StudentPaymentPoliciesView({
  adminRole,
  onBackToSettings,
}: StudentPaymentPoliciesViewProps) {
  const canModifySettings = adminRole === "super_admin" || adminRole === "owner";
  const canManagePolicies = adminRole === "super_admin" || adminRole === "owner" || adminRole === "store_manager";

  // Global store payment settings state
  const [storeSettings, setStoreSettings] = useState<StorePaymentSettings>(DEFAULT_STORE_PAYMENT_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);

  // Student directory state
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Dialog states
  const [selectedStudentForEdit, setSelectedStudentForEdit] = useState<StudentProfile | null>(null);
  const [targetPolicy, setTargetPolicy] = useState<StudentPaymentPolicy>("default");
  const [policyChangeReason, setPolicyChangeReason] = useState("");
  const [isUpdatingPolicy, setIsUpdatingPolicy] = useState(false);

  // Record No-Show state
  const [selectedStudentNoShow, setSelectedStudentNoShow] = useState<StudentProfile | null>(null);
  const [noShowOrderId, setNoShowOrderId] = useState("");
  const [noShowNotes, setNoShowNotes] = useState("");
  const [isRecordingNoShow, setIsRecordingNoShow] = useState(false);

  // Restore Cash state
  const [selectedStudentToRestore, setSelectedStudentToRestore] = useState<StudentProfile | null>(null);
  const [restoreReason, setRestoreReason] = useState("");
  const [isRestoringCash, setIsRestoringCash] = useState(false);

  // Audit Logs Modal state
  const [auditLogsStudent, setAuditLogsStudent] = useState<StudentProfile | null>(null);
  const [auditLogs, setAuditLogs] = useState<StudentPaymentAuditLog[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);

  // No-Show Records Modal state
  const [noShowRecordsStudent, setNoShowRecordsStudent] = useState<StudentProfile | null>(null);
  const [noShowRecords, setNoShowRecords] = useState<StudentNoShowRecord[]>([]);
  const [loadingNoShowRecords, setLoadingNoShowRecords] = useState(false);
  const [disputeRecordId, setDisputeRecordId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);

  // Load initial store settings
  const refreshStoreSettings = useCallback(async () => {
    const s = await loadStorePaymentSettings();
    setStoreSettings(s);
  }, []);

  // Load student directory
  const refreshStudents = useCallback(async () => {
    setIsLoadingStudents(true);
    try {
      const data = await loadStudentProfiles(searchQuery);
      setStudents(data);
    } catch {
      toast.error("Failed to load student directory");
    } finally {
      setIsLoadingStudents(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    refreshStoreSettings();
    refreshStudents();
  }, [refreshStoreSettings, refreshStudents]);

  // Handle saving store-wide settings
  const handleSaveStoreSettings = async () => {
    if (!canModifySettings) {
      toast.error("Access Denied: Only Super Admin or Owner can adjust store payment settings.");
      return;
    }
    setSavingSettings(true);
    try {
      const res = await updateStorePaymentSettings(storeSettings);
      if (!res.success) {
        toast.error(res.error || "Failed to save store payment settings");
      } else {
        toast.success("Store payment policy settings saved successfully");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to update store settings");
    } finally {
      setSavingSettings(false);
    }
  };

  // Open policy edit modal
  const handleOpenEditPolicy = (student: StudentProfile) => {
    setSelectedStudentForEdit(student);
    setTargetPolicy(student.payment_policy);
    setPolicyChangeReason("");
  };

  // Save policy change
  const handleSavePolicyChange = async () => {
    if (!selectedStudentForEdit) return;
    if (!canManagePolicies) {
      toast.error("Access Denied: You do not have permission to modify student payment policies.");
      return;
    }

    setIsUpdatingPolicy(true);
    try {
      const res = await updateStudentPaymentPolicy(
        selectedStudentForEdit.id,
        targetPolicy,
        policyChangeReason.trim() || `Policy changed from ${selectedStudentForEdit.payment_policy} to ${targetPolicy}`
      );

      if (!res.success) {
        toast.error(res.error || "Failed to update payment policy.");
        setIsUpdatingPolicy(false);
        return;
      }

      toast.success(
        `Payment policy for ${selectedStudentForEdit.full_name || "Student"} updated to ${targetPolicy.replace(/_/g, " ").toUpperCase()}`
      );

      // Local optimistic update
      setStudents((prev) =>
        prev.map((s) =>
          s.id === selectedStudentForEdit.id ? { ...s, payment_policy: targetPolicy } : s
        )
      );

      setSelectedStudentForEdit(null);
      refreshStudents();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update payment policy.");
    } finally {
      setIsUpdatingPolicy(false);
    }
  };

  // Reset to default helper
  const handleResetToDefault = async (student: StudentProfile) => {
    if (!canManagePolicies) {
      toast.error("Access Denied: You do not have permission to reset payment policies.");
      return;
    }

    try {
      const res = await updateStudentPaymentPolicy(
        student.id,
        "default",
        "Policy reset to Default (inherit store-wide rules)"
      );

      if (!res.success) {
        toast.error(res.error || "Failed to reset policy.");
        return;
      }

      toast.success(`Payment policy for ${student.full_name || "Student"} reset to Default.`);
      setStudents((prev) =>
        prev.map((s) => (s.id === student.id ? { ...s, payment_policy: "default" } : s))
      );
      refreshStudents();
    } catch (err: any) {
      toast.error(err?.message || "Failed to reset policy.");
    }
  };

  // Record verified uncollected cash order
  const handleRecordNoShow = async () => {
    if (!selectedStudentNoShow) return;
    if (!noShowOrderId.trim()) {
      toast.error("Please enter the Order ID or Reference Number.");
      return;
    }

    setIsRecordingNoShow(true);
    try {
      const res = await recordStudentNoShow(
        selectedStudentNoShow.id,
        noShowOrderId.trim(),
        noShowNotes.trim() || "Uncollected cash order verified"
      );

      if (!res.success) {
        toast.error(res.error || "Failed to record uncollected order.");
        setIsRecordingNoShow(false);
        return;
      }

      toast.success(`Uncollected order recorded against ${selectedStudentNoShow.full_name || "Student"}.`);
      setSelectedStudentNoShow(null);
      setNoShowOrderId("");
      setNoShowNotes("");
      refreshStudents();
    } catch (err: any) {
      toast.error(err?.message || "Failed to record uncollected order.");
    } finally {
      setIsRecordingNoShow(false);
    }
  };

  // Restore cash privileges
  const handleRestoreCash = async () => {
    if (!selectedStudentToRestore) return;
    setIsRestoringCash(true);
    try {
      const res = await restoreStudentCashPrivileges(
        selectedStudentToRestore.id,
        restoreReason.trim() || "Manual reinstatement by admin"
      );

      if (!res.success) {
        toast.error(res.error || "Failed to restore cash privileges.");
        setIsRestoringCash(false);
        return;
      }

      toast.success(`Cash ordering privileges restored for ${selectedStudentToRestore.full_name || "Student"}.`);
      setSelectedStudentToRestore(null);
      setRestoreReason("");
      refreshStudents();
    } catch (err: any) {
      toast.error(err?.message || "Failed to restore cash privileges.");
    } finally {
      setIsRestoringCash(false);
    }
  };

  // Open audit logs modal
  const handleOpenAuditLogs = async (student: StudentProfile) => {
    setAuditLogsStudent(student);
    setLoadingAuditLogs(true);
    try {
      const logs = await loadStudentPaymentAuditLogs(student.id);
      setAuditLogs(logs);
    } catch {
      toast.error("Failed to load audit logs");
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  // Open no-show records modal
  const handleOpenNoShowRecords = async (student: StudentProfile) => {
    setNoShowRecordsStudent(student);
    setLoadingNoShowRecords(true);
    try {
      const records = await loadStudentNoShowRecords(student.id);
      setNoShowRecords(records);
    } catch {
      toast.error("Failed to load uncollected order records");
    } finally {
      setLoadingNoShowRecords(false);
    }
  };

  // Submit dispute for no-show record
  const handleConfirmDispute = async () => {
    if (!disputeRecordId) return;
    setIsSubmittingDispute(true);
    try {
      const res = await disputeStudentNoShow(
        disputeRecordId,
        disputeReason.trim() || "Administrative review and resolution"
      );

      if (!res.success) {
        toast.error(res.error || "Failed to dispute record.");
        setIsSubmittingDispute(false);
        return;
      }

      toast.success("No-show record revoked and student standing recalculated.");
      setDisputeRecordId(null);
      setDisputeReason("");
      if (noShowRecordsStudent) {
        const records = await loadStudentNoShowRecords(noShowRecordsStudent.id);
        setNoShowRecords(records);
      }
      refreshStudents();
    } catch (err: any) {
      toast.error(err?.message || "Failed to dispute record.");
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const getPolicyBadge = (policy: StudentPaymentPolicy) => {
    switch (policy) {
      case "online_only":
        return (
          <Badge className="bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-300">
            Online Only
          </Badge>
        );
      case "cash_and_online":
        return (
          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300">
            Cash + Online
          </Badge>
        );
      case "cash_only":
        return (
          <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300">
            Cash Only
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground border-border">
            Default (Inherited)
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Student Payment Policies & Trust Controls
            </h2>
            <Badge variant="outline" className="text-xs">
              Campus Security
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
            Configure per-student payment privileges (Online Only, Cash restrictions), manage fake order prevention,
            and review uncollected orders and policy audit logs.
          </p>
        </div>

        {onBackToSettings && (
          <Button variant="outline" size="sm" onClick={onBackToSettings} className="gap-1.5 text-xs font-semibold">
            <span>Back to Settings</span>
          </Button>
        )}
      </div>

      {/* GLOBAL STORE PAYMENT SETTINGS CARD */}
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3.5">
          <div className="flex items-center gap-2">
            <Sliders className="size-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Global Store Payment Rules</h3>
          </div>
          {canModifySettings && (
            <Button
              variant="hero"
              size="sm"
              disabled={savingSettings}
              onClick={handleSaveStoreSettings}
              className="h-8 gap-1.5 text-xs font-bold"
            >
              {savingSettings ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              <span>Save Global Rules</span>
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Master Cash Toggle */}
          <div className="rounded-2xl border border-border/80 bg-secondary/30 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Wallet className="size-3.5 text-primary" />
                <span>Cash on Delivery</span>
              </span>
              <Switch
                checked={storeSettings.cash_payment_enabled}
                disabled={!canModifySettings || savingSettings}
                onCheckedChange={(checked) =>
                  setStoreSettings((s) => ({ ...s, cash_payment_enabled: checked }))
                }
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              When disabled, cash is forbidden store-wide and overrides individual cash permissions.
            </p>
          </div>

          {/* Master Online Toggle */}
          <div className="rounded-2xl border border-border/80 bg-secondary/30 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Smartphone className="size-3.5 text-primary" />
                <span>Online UPI Payment</span>
              </span>
              <Switch
                checked={storeSettings.online_payment_enabled}
                disabled={!canModifySettings || savingSettings}
                onCheckedChange={(checked) =>
                  setStoreSettings((s) => ({ ...s, online_payment_enabled: checked }))
                }
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Accept instant digital UPI transfers via QR on delivery or pickup counter.
            </p>
          </div>

          {/* Guest Cash Policy Toggle */}
          <div className="rounded-2xl border border-border/80 bg-secondary/30 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Users className="size-3.5 text-primary" />
                <span>Guest Cash Policy</span>
              </span>
              <Switch
                checked={storeSettings.guest_cash_allowed}
                disabled={!canModifySettings || savingSettings}
                onCheckedChange={(checked) =>
                  setStoreSettings((s) => ({ ...s, guest_cash_allowed: checked }))
                }
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              If disabled, unauthenticated guest checkouts must pay online; cash requires signed-in student account.
            </p>
          </div>

          {/* Configurable Threshold */}
          <div className="rounded-2xl border border-border/80 bg-secondary/30 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 text-warn" />
                <span>No-Show Threshold</span>
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={storeSettings.max_cash_no_shows_threshold}
                disabled={!canModifySettings || savingSettings}
                onChange={(e) =>
                  setStoreSettings((s) => ({
                    ...s,
                    max_cash_no_shows_threshold: Math.max(1, parseInt(e.target.value) || 2),
                  }))
                }
                className="h-7 w-14 rounded-lg border border-input bg-card px-2 text-center text-xs font-bold"
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Verified uncollected orders before automatic cash ordering restrictions apply.
            </p>
          </div>
        </div>
      </div>

      {/* STUDENT DIRECTORY SEARCH & CONTROLS */}
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search students by name, mobile, or student ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-4 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={refreshStudents} className="h-9 gap-1.5 text-xs font-semibold">
            <RefreshCw className={cn("size-3.5", isLoadingStudents && "animate-spin")} />
            <span>Refresh Directory</span>
          </Button>
        </div>

        {/* Students Table */}
        {isLoadingStudents ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto size-6 animate-spin text-primary" />
            <p className="mt-2 text-xs text-muted-foreground">Loading student records...</p>
          </div>
        ) : students.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <Users className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-bold text-foreground">No student profiles found</p>
            <p className="text-xs text-muted-foreground">Try adjusting your search query.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/80">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Student Name & ID</th>
                  <th className="px-4 py-3 font-semibold">Contact & Room</th>
                  <th className="px-4 py-3 font-semibold">Payment Policy</th>
                  <th className="px-4 py-3 font-semibold">Uncollected Orders</th>
                  <th className="px-4 py-3 font-semibold">Standing</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {students.map((student) => (
                  <tr key={student.id} className="hover:bg-secondary/20 transition">
                    <td className="px-4 py-3.5">
                      <p className="font-bold text-foreground">{student.full_name || "Anonymous Student"}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        {student.student_id ? `ID: ${student.student_id}` : student.id.slice(0, 8)}
                      </p>
                    </td>

                    <td className="px-4 py-3.5">
                      <p className="text-foreground">{student.phone || "No phone registered"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {student.default_hostel || student.default_block
                          ? `${student.default_hostel || student.default_block}${student.default_room ? ` (${student.default_room})` : ""}`
                          : "Campus Residence"}
                      </p>
                    </td>

                    <td className="px-4 py-3.5">
                      {getPolicyBadge(student.payment_policy)}
                    </td>

                    <td className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => handleOpenNoShowRecords(student)}
                        className="flex items-center gap-1.5 font-bold hover:underline"
                      >
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px]",
                            student.verified_no_show_count > 0
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-secondary text-muted-foreground"
                          )}
                        >
                          {student.verified_no_show_count} uncollected
                        </span>
                      </button>
                    </td>

                    <td className="px-4 py-3.5">
                      {student.cash_restricted ? (
                        <div className="space-y-0.5">
                          <Badge variant="destructive" className="text-[10px]">
                            Cash Restricted
                          </Badge>
                          {student.cash_restriction_reason && (
                            <p className="text-[10px] text-destructive truncate max-w-[150px]" title={student.cash_restriction_reason}>
                              {student.cash_restriction_reason}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-600/30 bg-emerald-500/5">
                          Good Standing
                        </Badge>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Change policy */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenEditPolicy(student)}
                          className="h-7 px-2.5 text-[11px] font-semibold gap-1"
                        >
                          <Edit3 className="size-3" />
                          <span>Policy</span>
                        </Button>

                        {/* Reset to default */}
                        {student.payment_policy !== "default" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResetToDefault(student)}
                            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                            title="Reset to Default"
                          >
                            <RotateCcw className="size-3" />
                          </Button>
                        )}

                        {/* Record No-Show */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedStudentNoShow(student);
                            setNoShowOrderId("");
                            setNoShowNotes("");
                          }}
                          className="h-7 px-2 text-[11px] text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                          title="Record Uncollected Cash Order"
                        >
                          <UserX className="size-3" />
                        </Button>

                        {/* Restore Cash */}
                        {student.cash_restricted && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedStudentToRestore(student);
                              setRestoreReason("");
                            }}
                            className="h-7 px-2 text-[11px] text-emerald-600 hover:bg-emerald-500/10"
                            title="Restore Cash Privileges"
                          >
                            <UserCheck className="size-3" />
                          </Button>
                        )}

                        {/* Audit Logs */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenAuditLogs(student)}
                          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                          title="View Policy Audit Trail"
                        >
                          <History className="size-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DIALOG: EDIT STUDENT PAYMENT POLICY */}
      <Dialog open={selectedStudentForEdit !== null} onOpenChange={(open) => !open && setSelectedStudentForEdit(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6 sm:p-8">
          {selectedStudentForEdit && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="font-display text-lg font-bold">
                  Update Payment Policy
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Adjust payment method eligibility for <strong>{selectedStudentForEdit.full_name}</strong>.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1 block">Payment Policy</label>
                  <select
                    value={targetPolicy}
                    onChange={(e) => setTargetPolicy(e.target.value as StudentPaymentPolicy)}
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary font-medium"
                  >
                    <option value="default">Default — Inherit store-wide payment rules</option>
                    <option value="online_only">Online Only — Required online payment; cash forbidden</option>
                    <option value="cash_and_online">Cash + Online — Allow both methods when globally active</option>
                    <option value="cash_only">Cash Only — Restrict account to cash payment only</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1 block">
                    Reason for Adjustment (Recorded in Audit Log)
                  </label>
                  <input
                    type="text"
                    value={policyChangeReason}
                    onChange={(e) => setPolicyChangeReason(e.target.value)}
                    placeholder="e.g. Requested by warden, fake orders restriction, or student appeal"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                  />
                </div>

                <div className="rounded-xl border border-border bg-secondary/30 p-3 text-[11px] text-muted-foreground leading-relaxed">
                  💡 Policy enforcement is validated server-side during checkout. Historical placed orders remain untouched.
                </div>
              </div>

              <DialogFooter className="pt-3">
                <Button variant="ghost" size="sm" onClick={() => setSelectedStudentForEdit(null)}>
                  Cancel
                </Button>
                <Button
                  variant="hero"
                  size="sm"
                  disabled={isUpdatingPolicy}
                  onClick={handleSavePolicyChange}
                  className="gap-1.5"
                >
                  {isUpdatingPolicy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  <span>Save Policy</span>
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG: RECORD UNCOLLECTED ORDER / NO-SHOW */}
      <Dialog open={selectedStudentNoShow !== null} onOpenChange={(open) => !open && setSelectedStudentNoShow(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6 sm:p-8">
          {selectedStudentNoShow && (
            <div className="space-y-4">
              <DialogHeader>
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="size-5" />
                  <DialogTitle className="font-display text-lg font-bold">
                    Record Uncollected Cash Order
                  </DialogTitle>
                </div>
                <DialogDescription className="text-xs text-muted-foreground">
                  Record verified uncollected order for <strong>{selectedStudentNoShow.full_name}</strong>.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1 block">Order Reference or ID</label>
                  <input
                    type="text"
                    value={noShowOrderId}
                    onChange={(e) => setNoShowOrderId(e.target.value)}
                    placeholder="e.g. QM-20261030-ABCD"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground mb-1 block">Verification Notes</label>
                  <input
                    type="text"
                    value={noShowNotes}
                    onChange={(e) => setNoShowNotes(e.target.value)}
                    placeholder="e.g. Delivery rider called 3x at room 204, student did not show"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                  />
                </div>

                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                  ⚠️ Note: When verified no-shows reach the store threshold ({storeSettings.max_cash_no_shows_threshold}),
                  the student will be automatically restricted from placing new cash orders until reviewed.
                </div>
              </div>

              <DialogFooter className="pt-3">
                <Button variant="ghost" size="sm" onClick={() => setSelectedStudentNoShow(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isRecordingNoShow}
                  onClick={handleRecordNoShow}
                  className="gap-1.5"
                >
                  {isRecordingNoShow ? <Loader2 className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />}
                  <span>Record No-Show</span>
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG: RESTORE CASH PRIVILEGES */}
      <Dialog open={selectedStudentToRestore !== null} onOpenChange={(open) => !open && setSelectedStudentToRestore(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6 sm:p-8">
          {selectedStudentToRestore && (
            <div className="space-y-4">
              <DialogHeader>
                <div className="flex items-center gap-2 text-emerald-600">
                  <UserCheck className="size-5" />
                  <DialogTitle className="font-display text-lg font-bold">
                    Restore Cash Privileges
                  </DialogTitle>
                </div>
                <DialogDescription className="text-xs text-muted-foreground">
                  Reinstate Cash on Delivery eligibility for <strong>{selectedStudentToRestore.full_name}</strong>.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-semibold text-foreground mb-1 block">Reason / Justification</label>
                  <input
                    type="text"
                    value={restoreReason}
                    onChange={(e) => setRestoreReason(e.target.value)}
                    placeholder="e.g. Student settled outstanding dues or verified hostel absence"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
                  />
                </div>
              </div>

              <DialogFooter className="pt-3">
                <Button variant="ghost" size="sm" onClick={() => setSelectedStudentToRestore(null)}>
                  Cancel
                </Button>
                <Button
                  variant="hero"
                  size="sm"
                  disabled={isRestoringCash}
                  onClick={handleRestoreCash}
                  className="gap-1.5"
                >
                  {isRestoringCash ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  <span>Restore Privileges</span>
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* MODAL: AUDIT LOGS TRAIL */}
      <Dialog open={auditLogsStudent !== null} onOpenChange={(open) => !open && setAuditLogsStudent(null)}>
        <DialogContent className="max-w-lg rounded-3xl p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold flex items-center gap-2">
              <History className="size-4 text-primary" />
              <span>Policy Audit History</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Audit log of payment policy adjustments for <strong>{auditLogsStudent?.full_name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 max-h-[60vh] overflow-y-auto space-y-3">
            {loadingAuditLogs ? (
              <div className="py-8 text-center">
                <Loader2 className="mx-auto size-5 animate-spin text-primary" />
              </div>
            ) : auditLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No policy adjustments recorded.</p>
            ) : (
              auditLogs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-border bg-secondary/30 p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">
                      {log.previous_policy} → <strong className="text-primary">{log.new_policy}</strong>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                  {log.reason && (
                    <p className="text-[11px] text-muted-foreground">
                      <strong>Reason:</strong> {log.reason}
                    </p>
                  )}
                  {log.changed_by && (
                    <p className="text-[10px] text-muted-foreground/80 font-mono">
                      Admin ID: {log.changed_by.slice(0, 8)}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: UNCOLLECTED ORDER RECORDS & DISPUTES */}
      <Dialog open={noShowRecordsStudent !== null} onOpenChange={(open) => !open && setNoShowRecordsStudent(null)}>
        <DialogContent className="max-w-lg rounded-3xl p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold flex items-center gap-2">
              <UserX className="size-4 text-amber-600" />
              <span>Uncollected Orders History</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Recorded verified no-shows for <strong>{noShowRecordsStudent?.full_name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 max-h-[60vh] overflow-y-auto space-y-3">
            {loadingNoShowRecords ? (
              <div className="py-8 text-center">
                <Loader2 className="mx-auto size-5 animate-spin text-primary" />
              </div>
            ) : noShowRecords.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No uncollected orders on record.</p>
            ) : (
              noShowRecords.map((rec) => (
                <div
                  key={rec.id}
                  className={cn(
                    "rounded-2xl border p-3 text-xs space-y-1.5",
                    rec.status === "verified"
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-border bg-secondary/20 opacity-60"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-foreground">
                      {rec.order_number || rec.order_id || "Unlinked Order"}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        rec.status === "verified"
                          ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {rec.status.toUpperCase()}
                    </Badge>
                  </div>

                  {rec.notes && <p className="text-[11px] text-muted-foreground">{rec.notes}</p>}

                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/50">
                    <span>Recorded: {new Date(rec.created_at).toLocaleString()}</span>
                    {rec.status === "verified" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDisputeRecordId(rec.id);
                          setDisputeReason("");
                        }}
                        className="h-6 px-2 text-[10px] text-destructive hover:bg-destructive/10"
                      >
                        Dispute / Revoke
                      </Button>
                    )}
                  </div>

                  {rec.status === "revoked" && rec.revoke_reason && (
                    <p className="text-[10px] text-emerald-600">
                      <strong>Revoke reason:</strong> {rec.revoke_reason}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* DISPUTE CONFIRMATION MODAL */}
      <Dialog open={disputeRecordId !== null} onOpenChange={(open) => !open && setDisputeRecordId(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold">
              Dispute & Revoke No-Show Record
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Revoking this record will decrement the student's verified no-show count and restore cash privileges if eligible.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">Revocation Reason</label>
              <input
                type="text"
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="e.g. Delivery rider reported wrong room number or student was in exam"
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>

          <DialogFooter className="pt-3">
            <Button variant="ghost" size="sm" onClick={() => setDisputeRecordId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isSubmittingDispute}
              onClick={handleConfirmDispute}
            >
              {isSubmittingDispute ? <Loader2 className="size-3.5 animate-spin" /> : "Confirm Revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

