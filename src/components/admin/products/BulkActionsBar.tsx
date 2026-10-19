import {
  DollarSign,
  Package,
  Layers,
  Eye,
  EyeOff,
  Archive,
  RotateCcw,
  Trash2,
  X,
  Star,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BulkActionType } from "./types";

interface BulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onTriggerAction: (type: BulkActionType) => void;
}

export function BulkActionsBar({
  selectedCount,
  onClearSelection,
  onTriggerAction,
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-4xl px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-card/95 p-3 sm:p-4 shadow-lift backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <Badge variant="default" className="bg-primary text-primary-foreground font-mono font-bold text-xs px-2.5 py-1">
            {selectedCount} Selected
          </Badge>
          <span className="text-xs font-semibold text-foreground hidden sm:inline">
            Bulk Operations:
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
          {/* Price Adjust */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onTriggerAction("price_adjust_percent")}
            className="h-8 gap-1 text-xs"
          >
            <DollarSign className="size-3.5" />
            <span>Price %</span>
          </Button>

          {/* Stock Adjust */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onTriggerAction("stock_adjust_add")}
            className="h-8 gap-1 text-xs"
          >
            <Package className="size-3.5" />
            <span>Stock +/-</span>
          </Button>

          {/* Move Category */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onTriggerAction("category_move")}
            className="h-8 gap-1 text-xs"
          >
            <Layers className="size-3.5" />
            <span>Category</span>
          </Button>

          {/* Visibility */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onTriggerAction("publish")}
            className="h-8 gap-1 text-xs"
            title="Publish Selected"
          >
            <Eye className="size-3.5" />
            <span className="hidden md:inline">Publish</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onTriggerAction("unpublish")}
            className="h-8 gap-1 text-xs"
            title="Unpublish Selected"
          >
            <EyeOff className="size-3.5" />
            <span className="hidden md:inline">Unpublish</span>
          </Button>

          {/* Archive / Delete */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onTriggerAction("archive")}
            className="h-8 gap-1 text-xs text-amber-600 dark:text-amber-400"
          >
            <Archive className="size-3.5" />
            <span className="hidden md:inline">Archive</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onTriggerAction("delete")}
            className="h-8 gap-1 text-xs text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5" />
            <span className="hidden md:inline">Delete</span>
          </Button>

          <div className="h-5 w-px bg-border mx-1" />

          {/* Clear Selection */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
            <span>Clear</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
