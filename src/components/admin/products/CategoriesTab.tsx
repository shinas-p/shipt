import { useState } from "react";
import {
  Layers,
  Plus,
  Edit3,
  Trash2,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Package,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBCategory, DBProduct } from "./types";
import { type AdminRole } from "@/lib/permissions";

interface CategoriesTabProps {
  categories: DBCategory[];
  products: DBProduct[];
  adminRole: AdminRole | null;
  onRefresh: () => Promise<void>;
}

export function CategoriesTab({
  categories,
  products,
  adminRole,
  onRefresh,
}: CategoriesTabProps) {
  const isSuperAdmin = adminRole === "super_admin";

  const [editingCategory, setEditingCategory] = useState<DBCategory | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form State
  const [catId, setCatId] = useState("");
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [displayOrder, setDisplayOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Deletion guard dialog
  const [deleteTarget, setDeleteTarget] = useState<DBCategory | null>(null);
  const [reassignCategory, setReassignCategory] = useState<string>("");
  const [deleting, setDeleting] = useState(false);

  // Count products per category
  const productCountMap = products.reduce((acc, p) => {
    acc[p.category_id] = (acc[p.category_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const openCreateModal = () => {
    setEditingCategory(null);
    setCatId("");
    setName("");
    setBlurb("");
    setDisplayOrder(String(categories.length + 1));
    setIsActive(true);
    setIsCreating(true);
  };

  const openEditModal = (cat: DBCategory) => {
    setIsCreating(false);
    setEditingCategory(cat);
    setCatId(cat.id);
    setName(cat.name);
    setBlurb(cat.blurb || "");
    setDisplayOrder(String(cat.display_order ?? 0));
    setIsActive(cat.is_active);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Category name is required.");
      return;
    }

    const cleanId = catId.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") ||
      name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        blurb: blurb.trim(),
        display_order: parseInt(displayOrder, 10) || 0,
        is_active: isActive,
      };

      if (editingCategory) {
        const { error } = await supabase
          .from("categories")
          .update(payload)
          .eq("id", editingCategory.id);

        if (error) {
          toast.error(`Update failed: ${error.message}`);
          return;
        }
        toast.success(`Category "${name}" updated successfully!`);
      } else {
        const { error } = await supabase
          .from("categories")
          .insert([{ id: cleanId, ...payload }]);

        if (error) {
          toast.error(`Create failed: ${error.message}`);
          return;
        }
        toast.success(`Category "${name}" created!`);
      }

      await onRefresh();
      setIsCreating(false);
      setEditingCategory(null);
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Safe category deletion check
  const handleDeleteCheck = (cat: DBCategory) => {
    const assignedCount = productCountMap[cat.id] || 0;
    setDeleteTarget(cat);
    const otherCategories = categories.filter((c) => c.id !== cat.id);
    setReassignCategory(otherCategories[0]?.id ?? "");
  };

  const handleExecuteDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      const assignedCount = productCountMap[deleteTarget.id] || 0;

      if (assignedCount > 0) {
        if (!reassignCategory) {
          toast.error("Please select a target category to reassign active products to.");
          setDeleting(false);
          return;
        }

        // Reassign products first to satisfy ON DELETE RESTRICT foreign key
        const { error: reassignErr } = await supabase
          .from("products")
          .update({ category_id: reassignCategory })
          .eq("category_id", deleteTarget.id);

        if (reassignErr) {
          toast.error(`Failed to reassign products: ${reassignErr.message}`);
          setDeleting(false);
          return;
        }

        toast.info(
          `Reassigned ${assignedCount} products from "${deleteTarget.name}" to target category.`
        );
      }

      // Now safe to delete category
      const { error: delErr } = await supabase
        .from("categories")
        .delete()
        .eq("id", deleteTarget.id);

      if (delErr) {
        toast.error(`Category deletion failed: ${delErr.message}`);
        setDeleting(false);
        return;
      }

      toast.success(`Category "${deleteTarget.name}" deleted.`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err: any) {
      toast.error(`Error: ${err?.message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border bg-card p-5 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="size-5 text-primary" />
            <h3 className="font-display text-base font-bold text-foreground">
              Campus Categories Management
            </h3>
            <Badge variant="outline" className="text-xs font-mono">
              {categories.length} Categories
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Manage product departments, navigation tags, and display sequences across the student marketplace.
          </p>
        </div>

        {isSuperAdmin ? (
          <Button
            variant="hero"
            size="sm"
            onClick={openCreateModal}
            className="h-9 gap-1.5 text-xs font-bold"
          >
            <Plus className="size-4" />
            <span>Add Category</span>
          </Button>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Store Manager View (Category modification restricted to Super Admin)
          </Badge>
        )}
      </div>

      {/* Categories Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => {
          const productCount = productCountMap[cat.id] || 0;

          return (
            <div
              key={cat.id}
              className="flex flex-col justify-between rounded-3xl border border-border bg-card p-5 shadow-2xs transition hover:border-primary/40"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-display text-base font-bold text-foreground">
                      {cat.name}
                    </h4>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      ID: {cat.id}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-bold uppercase",
                      cat.is_active
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-muted bg-muted text-muted-foreground"
                    )}
                  >
                    {cat.is_active ? "Active" : "Hidden"}
                  </Badge>
                </div>

                <p className="mt-2.5 text-xs text-muted-foreground line-clamp-2">
                  {cat.blurb || "No blurb provided."}
                </p>

                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-foreground">
                    <Package className="size-3.5 text-primary" />
                    <span>{productCount} Products</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Display Order: {cat.display_order}
                  </span>
                </div>
              </div>

              {isSuperAdmin && (
                <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/60 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openEditModal(cat)}
                    className="h-8 gap-1 text-xs"
                  >
                    <Edit3 className="size-3" />
                    <span>Edit</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteCheck(cat)}
                    className="h-8 text-xs text-destructive hover:bg-destructive/10 px-2.5"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* CREATE / EDIT CATEGORY MODAL */}
      <Dialog
        open={isCreating || editingCategory !== null}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreating(false);
            setEditingCategory(null);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-3xl p-6 sm:p-7">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-foreground">
              {editingCategory ? `Edit Category: ${editingCategory.name}` : "Create Category"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Configure department label, storefront blurb, and display ordering.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="mt-4 space-y-3.5">
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Category Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!editingCategory) {
                    setCatId(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
                  }
                }}
                placeholder="e.g. Snacks & Munchies"
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Category ID (Slug) <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                disabled={editingCategory !== null}
                value={catId}
                onChange={(e) => setCatId(e.target.value)}
                placeholder="e.g. snacks"
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-mono outline-none focus:border-primary disabled:opacity-60 disabled:bg-muted"
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Identifier used in URLs and database foreign key mappings.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Storefront Blurb / Subtitle
              </label>
              <textarea
                rows={2}
                value={blurb}
                onChange={(e) => setBlurb(e.target.value)}
                placeholder="Quick campus delivery for midnight cram sessions..."
                className="w-full rounded-xl border border-input bg-card p-2.5 text-xs outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Display Order Sequence
              </label>
              <input
                type="number"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="cat-active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="size-4 rounded text-primary"
              />
              <label htmlFor="cat-active" className="text-xs font-semibold text-foreground">
                Active in Storefront Header & Filter Bar
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsCreating(false);
                  setEditingCategory(null);
                }}
                className="h-9 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                size="sm"
                disabled={saving}
                className="h-9 px-4 text-xs font-bold"
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : editingCategory ? (
                  "Save Changes"
                ) : (
                  "Create Category"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* CATEGORY DELETION & SAFE REASSIGNMENT MODAL */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-md rounded-3xl p-6 sm:p-7">
          <DialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="size-5" />
              <DialogTitle className="font-display text-lg font-bold">
                Delete Category: {deleteTarget?.name}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Database integrity protection ensures no orphaned catalogue products or broken order histories.
            </DialogDescription>
          </DialogHeader>

          {deleteTarget && (
            <div className="space-y-4 pt-2 text-xs">
              {(productCountMap[deleteTarget.id] || 0) > 0 ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-800 dark:text-amber-200 space-y-1.5">
                    <p className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                      <span>{productCountMap[deleteTarget.id]} Products Currently Assigned</span>
                    </p>
                    <p className="text-[11px] leading-relaxed">
                      This category contains products. PostgreSQL enforces foreign key constraints.
                      To safely delete this category, choose a replacement category to transfer these products into first.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block font-semibold text-foreground">
                      Reassign Products To:
                    </label>
                    <select
                      value={reassignCategory}
                      onChange={(e) => setReassignCategory(e.target.value)}
                      className="h-10 w-full rounded-xl border border-input bg-card px-3 text-xs outline-none focus:border-primary capitalize"
                    >
                      {categories
                        .filter((c) => c.id !== deleteTarget.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  This category has no assigned products. It can be safely removed immediately.
                </p>
              )}

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget(null)}
                  className="h-9 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={handleExecuteDelete}
                  className="h-9 px-4 text-xs font-bold"
                >
                  {deleting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (productCountMap[deleteTarget.id] || 0) > 0 ? (
                    "Reassign & Delete"
                  ) : (
                    "Delete Category"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
