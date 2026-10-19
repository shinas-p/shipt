import { useState } from "react";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  FileText,
  Layers,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/data/products";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DBProduct, DBCategory, ImportRow } from "./types";

interface ImportExportTabProps {
  products: DBProduct[];
  categories: DBCategory[];
  selectedIds: string[];
  onRefreshProducts: () => Promise<void>;
}

export function ImportExportTab({
  products,
  categories,
  selectedIds,
  onRefreshProducts,
}: ImportExportTabProps) {
  // Import state
  const [importMode, setImportMode] = useState<"create" | "update">("create");
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // Category IDs set for fast validation
  const validCategoryIds = new Set(categories.map((c) => c.id.toLowerCase()));

  // Existing slugs & names mapping for update / duplicate detection
  const existingProductMapBySlug = new Map<string, DBProduct>();
  const existingProductMapByName = new Map<string, DBProduct>();
  for (const p of products) {
    if (p.slug) existingProductMapBySlug.set(p.slug.toLowerCase().trim(), p);
    existingProductMapByName.set(p.name.toLowerCase().trim(), p);
  }

  // Handle file selection (CSV or XLSX)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsProcessingFile(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        toast.error("Spreadsheet contains no sheets.");
        setIsProcessingFile(false);
        return;
      }

      const worksheet = workbook.Sheets[firstSheetName];
      if (!worksheet) {
        toast.error("Could not read sheet data.");
        setIsProcessingFile(false);
        return;
      }

      const rawJson = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1 });
      if (!rawJson || rawJson.length < 2) {
        toast.error("File is empty or missing headers and data rows.");
        setIsProcessingFile(false);
        return;
      }

      // First row is header
      const headers = (rawJson[0] as string[]).map((h) =>
        String(h || "")
          .toLowerCase()
          .trim()
          .replace(/[\s_-]+/g, "")
      );

      // Find column indices
      const idxName = headers.findIndex((h) => h.includes("name") || h.includes("title"));
      const idxSize = headers.findIndex((h) => h.includes("size") || h.includes("unit") || h.includes("variant"));
      const idxCategory = headers.findIndex((h) => h.includes("category") || h.includes("department"));
      const idxPrice = headers.findIndex((h) => h === "price" || h.includes("sellingprice"));
      const idxOrigPrice = headers.findIndex((h) => h.includes("original") || h.includes("compareat") || h.includes("mrp"));
      const idxStock = headers.findIndex((h) => h.includes("stock") || h.includes("quantity") || h.includes("qty"));
      const idxDesc = headers.findIndex((h) => h.includes("description") || h.includes("desc"));
      const idxSlug = headers.findIndex((h) => h.includes("slug") || h.includes("sku") || h.includes("barcode"));
      const idxActive = headers.findIndex((h) => h.includes("active") || h.includes("published"));
      const idxBestseller = headers.findIndex((h) => h.includes("bestseller") || h.includes("featured"));

      if (idxName === -1 || idxPrice === -1) {
        toast.error('Missing required header columns. "name" and "price" columns must be present.');
        setIsProcessingFile(false);
        return;
      }

      // Process rows
      const rows: ImportRow[] = [];

      for (let i = 1; i < rawJson.length; i++) {
        const row = rawJson[i];
        if (!row || row.length === 0 || row.every((c: any) => c == null || String(c).trim() === "")) {
          continue; // skip blank row
        }

        const rawName = String(row[idxName] || "").trim();
        const rawSize = idxSize !== -1 && row[idxSize] != null ? String(row[idxSize]).trim() : "Standard";
        const rawCat = idxCategory !== -1 && row[idxCategory] != null ? String(row[idxCategory]).toLowerCase().trim() : categories[0]?.id ?? "snacks";
        const rawPrice = idxPrice !== -1 ? parseFloat(String(row[idxPrice]).replace(/[^0-9.]/g, "")) : NaN;
        const rawOrigPrice = idxOrigPrice !== -1 && row[idxOrigPrice] != null && String(row[idxOrigPrice]).trim() !== ""
          ? parseFloat(String(row[idxOrigPrice]).replace(/[^0-9.]/g, ""))
          : null;
        const rawStock = idxStock !== -1 && row[idxStock] != null ? parseInt(String(row[idxStock]).replace(/[^0-9]/g, ""), 10) : 10;
        const rawDesc = idxDesc !== -1 && row[idxDesc] != null ? String(row[idxDesc]).trim() : "";
        const rawSlug = idxSlug !== -1 && row[idxSlug] != null ? String(row[idxSlug]).toLowerCase().trim() : "";
        const rawActive = idxActive !== -1 ? String(row[idxActive]).toLowerCase() !== "false" && String(row[idxActive]).toLowerCase() !== "0" : true;
        const rawBestseller = idxBestseller !== -1 ? String(row[idxBestseller]).toLowerCase() === "true" || String(row[idxBestseller]).toLowerCase() === "1" : false;

        const rowErrors: string[] = [];

        if (!rawName) rowErrors.push("Product name is missing.");
        if (isNaN(rawPrice) || rawPrice < 0) rowErrors.push("Price must be a valid non-negative number.");
        if (rawOrigPrice !== null && (isNaN(rawOrigPrice) || rawOrigPrice < rawPrice)) {
          rowErrors.push("Original price cannot be less than selling price.");
        }
        if (isNaN(rawStock) || rawStock < 0) rowErrors.push("Stock must be a non-negative integer.");

        // Category validation
        let resolvedCat = rawCat;
        if (!validCategoryIds.has(resolvedCat)) {
          // Attempt match by name
          const catByName = categories.find((c) => c.name.toLowerCase() === rawCat);
          if (catByName) {
            resolvedCat = catByName.id;
          } else {
            rowErrors.push(`Unknown category "${rawCat}". Must be one of: ${Array.from(validCategoryIds).join(", ")}`);
          }
        }

        // Check if existing product for create vs update mode
        let isUpdate = false;
        let existingId: string | undefined = undefined;
        if (rawSlug && existingProductMapBySlug.has(rawSlug)) {
          isUpdate = true;
          existingId = existingProductMapBySlug.get(rawSlug)?.id;
        } else if (existingProductMapByName.has(rawName.toLowerCase())) {
          isUpdate = true;
          existingId = existingProductMapByName.get(rawName.toLowerCase())?.id;
        }

        rows.push({
          rowNumber: i + 1,
          name: rawName,
          size: rawSize,
          category_id: resolvedCat,
          price: isNaN(rawPrice) ? 0 : rawPrice,
          original_price: rawOrigPrice,
          stock: isNaN(rawStock) ? 0 : rawStock,
          description: rawDesc,
          slug: rawSlug || undefined,
          is_active: rawActive,
          bestseller: rawBestseller,
          isValid: rowErrors.length === 0,
          errors: rowErrors,
          isUpdate,
          existingId,
        });
      }

      setParsedRows(rows);
      toast.success(`Successfully parsed ${rows.length} rows from ${file.name}.`);
    } catch (err: any) {
      toast.error(`Failed to parse file: ${err?.message || "Invalid file format"}`);
    } finally {
      setIsProcessingFile(false);
    }
  };

  // Download official CSV template
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        name: "Campus Spiral Notebook A5",
        size: "A5 · 160 pages",
        category: "stationery",
        price: 60,
        original_price: 75,
        stock: 40,
        description: "Hardcover spiral binding notebook for lecture notes and exams.",
        slug: "spiral-notebook-a5",
        is_active: true,
        bestseller: true,
      },
      {
        name: "Lays Classic Salted Chips",
        size: "50 g",
        category: "snacks",
        price: 20,
        original_price: "",
        stock: 100,
        description: "Crispy potato chips for midnight hostel snacking.",
        slug: "lays-classic-salted-50g",
        is_active: true,
        bestseller: false,
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products_Template");
    XLSX.writeFile(wb, "shipt-catalogue-import-template.xlsx");
    toast.success("Downloaded Excel / CSV catalogue import template!");
  };

  // Download error report for invalid rows
  const handleDownloadErrorReport = () => {
    const invalidRows = parsedRows.filter((r) => !r.isValid);
    if (invalidRows.length === 0) return;

    const reportData = invalidRows.map((r) => ({
      row_number: r.rowNumber,
      product_name: r.name,
      category: r.category_id,
      price: r.price,
      stock: r.stock,
      errors: r.errors.join("; "),
    }));

    const ws = XLSX.utils.json_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Import_Errors");
    XLSX.writeFile(wb, "shipt-import-error-report.xlsx");
    toast.info("Error report exported.");
  };

  // Execute committed import
  const handleExecuteImport = async () => {
    const validRows = parsedRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      toast.error("No valid rows to import.");
      return;
    }

    setIsImporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const currentUserId = session?.user?.id ?? null;

      let createdCount = 0;
      let updatedCount = 0;

      for (const row of validRows) {
        const primaryImage =
          row.image_url ||
          "https://veqoclunlmhsrhoadepp.supabase.co/storage/v1/object/public/posters/p-notebook.jpg";

        const cleanSlug =
          row.slug ||
          row.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");

        if (importMode === "update" && row.isUpdate && row.existingId) {
          // Update existing product
          await supabase
            .from("products")
            .update({
              name: row.name,
              size: row.size,
              category_id: row.category_id,
              price: row.price,
              original_price: row.original_price,
              stock: row.stock,
              description: row.description,
              is_active: row.is_active,
              bestseller: row.bestseller,
            })
            .eq("id", row.existingId);

          updatedCount++;
        } else {
          // Create new product
          const uniqueSlug = `${cleanSlug}-${Date.now().toString().slice(-4)}-${Math.random()
            .toString(36)
            .substring(2, 5)}`;

          const { data: newProd, error } = await supabase
            .from("products")
            .insert([
              {
                name: row.name,
                slug: uniqueSlug,
                size: row.size,
                category_id: row.category_id,
                price: row.price,
                original_price: row.original_price,
                stock: row.stock,
                description: row.description,
                image_url: primaryImage,
                is_active: row.is_active,
                bestseller: row.bestseller,
                is_new: true,
              },
            ])
            .select("id")
            .single();

          if (!error && newProd && row.stock > 0) {
            // Record initial stock entry
            await supabase.from("inventory_movements").insert([
              {
                product_id: newProd.id,
                movement_type: "restock_shipment",
                quantity_change: row.stock,
                previous_stock: 0,
                new_stock: row.stock,
                reason: "Initial catalogue stock via bulk spreadsheet import",
                performed_by: currentUserId,
              },
            ]);
            createdCount++;
          }
        }
      }

      toast.success(
        `Import complete! Created ${createdCount} new products, updated ${updatedCount} existing products.`
      );
      setParsedRows([]);
      setFileName("");
      setConfirmModalOpen(false);
      await onRefreshProducts();
    } catch (err: any) {
      toast.error(`Import failed: ${err?.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Export functions (CSV & XLSX)
  const handleExport = (format: "csv" | "xlsx", scope: "selected" | "all") => {
    const targetProducts =
      scope === "selected" && selectedIds.length > 0
        ? products.filter((p) => selectedIds.includes(p.id))
        : products;

    if (targetProducts.length === 0) {
      toast.error("No products selected to export.");
      return;
    }

    const exportRows = targetProducts.map((p) => ({
      id: p.id,
      name: p.name,
      size: p.size,
      category: p.category_id,
      price: p.price,
      original_price: p.original_price ?? "",
      stock: p.stock,
      status: p.is_active ? "Published" : "Archived",
      bestseller: p.bestseller ? "Yes" : "No",
      slug: p.slug ?? "",
      description: p.description ?? "",
      created_at: p.created_at ?? "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Shipt_Catalogue");

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `shipt-catalogue-${scope}-${dateStr}.${format}`;

    if (format === "csv") {
      XLSX.writeFile(wb, fileName, { bookType: "csv" });
    } else {
      XLSX.writeFile(wb, fileName, { bookType: "xlsx" });
    }

    toast.success(`Exported ${targetProducts.length} products to ${fileName}!`);
  };

  // Calculations for UI preview
  const validCount = parsedRows.filter((r) => r.isValid).length;
  const invalidCount = parsedRows.filter((r) => !r.isValid).length;
  const updateCount = parsedRows.filter((r) => r.isValid && r.isUpdate).length;
  const createCount = parsedRows.filter((r) => r.isValid && !r.isUpdate).length;

  return (
    <div className="space-y-8">
      {/* SECTION 1: CATALOG IMPORT */}
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-7 shadow-2xs space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-primary" />
              <h3 className="font-display text-base font-bold text-foreground">
                Bulk Catalogue Import (CSV & Excel)
              </h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Add new inventory batches or bulk update existing items with spreadsheet files.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownloadTemplate}
            className="h-9 gap-1.5 text-xs font-semibold"
          >
            <Download className="size-3.5" />
            <span>Download Spreadsheet Template</span>
          </Button>
        </div>

        {/* Upload Dropzone */}
        <div className="rounded-3xl border-2 border-dashed border-border bg-secondary/30 p-8 text-center space-y-3">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Upload className="size-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-foreground">
              Upload your CSV or Excel (.xlsx) File
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Files are validated row-by-row before any changes are committed to the live database.
            </p>
          </div>

          <div className="pt-2">
            <input
              type="file"
              id="catalogue-file-input"
              accept=".csv, .xlsx, .xls"
              onChange={handleFileChange}
              disabled={isProcessingFile}
              className="hidden"
            />
            <Button
              type="button"
              variant="hero"
              size="sm"
              disabled={isProcessingFile}
              onClick={() => document.getElementById("catalogue-file-input")?.click()}
              className="h-9 gap-1.5 text-xs font-bold px-4"
            >
              {isProcessingFile ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Parsing Spreadsheet...</span>
                </>
              ) : (
                <>
                  <FileText className="size-4" />
                  <span>Choose Spreadsheet File</span>
                </>
              )}
            </Button>
          </div>

          {fileName && (
            <p className="text-xs font-mono text-primary font-semibold">
              Selected: {fileName} ({parsedRows.length} total rows parsed)
            </p>
          )}
        </div>

        {/* Parsed Preview Table & Actions */}
        {parsedRows.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-secondary/30 p-4">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="font-semibold text-foreground">Import Plan:</span>
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 font-bold">
                  {validCount} Valid Rows
                </Badge>
                {invalidCount > 0 && (
                  <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive font-bold">
                    {invalidCount} Invalid Rows
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  ({createCount} new to create, {updateCount} matching existing products)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as any)}
                  className="h-8 rounded-xl border border-input bg-card px-2.5 text-xs font-semibold outline-none"
                >
                  <option value="create">Create All as New Products</option>
                  <option value="update">Update Existing by Slug / Name</option>
                </select>

                {invalidCount > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadErrorReport}
                    className="h-8 gap-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <span>Download Errors</span>
                  </Button>
                )}

                <Button
                  type="button"
                  variant="hero"
                  size="sm"
                  disabled={validCount === 0}
                  onClick={() => setConfirmModalOpen(true)}
                  className="h-8 px-4 text-xs font-bold"
                >
                  Commit Import ({validCount} Valid)
                </Button>
              </div>
            </div>

            {/* Preview table (first 10 rows) */}
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="p-3 font-semibold">Row</th>
                    <th className="p-3 font-semibold">Status</th>
                    <th className="p-3 font-semibold">Product Name</th>
                    <th className="p-3 font-semibold">Category</th>
                    <th className="p-3 font-semibold">Price</th>
                    <th className="p-3 font-semibold">Stock</th>
                    <th className="p-3 font-semibold">Errors / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {parsedRows.slice(0, 10).map((r) => (
                    <tr
                      key={r.rowNumber}
                      className={cn(
                        "hover:bg-secondary/20 transition",
                        !r.isValid && "bg-destructive/5"
                      )}
                    >
                      <td className="p-3 font-mono text-muted-foreground">#{r.rowNumber}</td>
                      <td className="p-3">
                        {r.isValid ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                            <CheckCircle2 className="size-3.5" />
                            <span>{r.isUpdate && importMode === "update" ? "Update" : "New"}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive font-semibold">
                            <XCircle className="size-3.5" />
                            <span>Invalid</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-semibold text-foreground">{r.name}</td>
                      <td className="p-3 capitalize text-muted-foreground">{r.category_id}</td>
                      <td className="p-3 font-mono">{formatINR(r.price)}</td>
                      <td className="p-3 font-mono">{r.stock} units</td>
                      <td className="p-3 text-muted-foreground max-w-xs truncate">
                        {r.isValid ? "Ready for commit" : r.errors.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {parsedRows.length > 10 && (
              <p className="text-[11px] text-muted-foreground text-center">
                ...and {parsedRows.length - 10} more rows ready in plan.
              </p>
            )}
          </div>
        )}
      </div>

      {/* SECTION 2: CATALOG EXPORT */}
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-7 shadow-2xs space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <Download className="size-5 text-primary" />
            <h3 className="font-display text-base font-bold text-foreground">
              Export Catalogue & Warehouse Reports
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Download your active catalog for inventory reconciliation, suppliers, or offline auditing.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 pt-2">
          {/* Export All */}
          <div className="rounded-2xl border border-border bg-secondary/30 p-4 space-y-3">
            <div>
              <h4 className="text-xs font-bold text-foreground">Export Full Catalogue</h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                All {products.length} active and archived items currently in your store database.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleExport("csv", "all")}
                className="h-8 gap-1.5 text-xs font-semibold"
              >
                <span>Export CSV</span>
              </Button>
              <Button
                type="button"
                variant="hero"
                size="sm"
                onClick={() => handleExport("xlsx", "all")}
                className="h-8 gap-1.5 text-xs font-semibold"
              >
                <span>Export Excel (.xlsx)</span>
              </Button>
            </div>
          </div>

          {/* Export Selected */}
          <div className="rounded-2xl border border-border bg-secondary/30 p-4 space-y-3">
            <div>
              <h4 className="text-xs font-bold text-foreground">Export Selected Products</h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {selectedIds.length > 0
                  ? `${selectedIds.length} products currently selected in the table.`
                  : "No products selected. Check rows in the table first."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedIds.length === 0}
                onClick={() => handleExport("csv", "selected")}
                className="h-8 gap-1.5 text-xs font-semibold"
              >
                <span>Export Selected (CSV)</span>
              </Button>
              <Button
                type="button"
                variant="hero"
                size="sm"
                disabled={selectedIds.length === 0}
                onClick={() => handleExport("xlsx", "selected")}
                className="h-8 gap-1.5 text-xs font-semibold"
              >
                <span>Export Selected (.xlsx)</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* CONFIRM IMPORT MODAL */}
      <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-foreground">
              Confirm Catalogue Import
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Commit {validCount} validated items to the live store database.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2 text-xs">
            <div className="rounded-2xl border border-border bg-secondary/40 p-3 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Import Mode:</span>
                <span className="font-bold text-foreground">
                  {importMode === "update" ? "Update Existing & Create New" : "Create All as New"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valid Items to Commit:</span>
                <span className="font-mono font-bold text-primary">{validCount}</span>
              </div>
              {invalidCount > 0 && (
                <div className="flex justify-between text-amber-700 dark:text-amber-300">
                  <span>Skipped Invalid Rows:</span>
                  <span className="font-mono font-bold">{invalidCount}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmModalOpen(false)}
                className="h-9 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="hero"
                size="sm"
                disabled={isImporting}
                onClick={handleExecuteImport}
                className="h-9 px-4 text-xs font-bold"
              >
                {isImporting ? <Loader2 className="size-3.5 animate-spin" /> : "Execute Import"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
