import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: number;
  onChange: (v: number) => void;
  max: number;
  size?: "sm" | "md";
  label: string;
}

export function QuantitySelector({ value, onChange, max, size = "md", label }: Props) {
  const h = size === "sm" ? "h-9" : "h-11";
  return (
    <div className={cn("inline-flex items-center rounded-full bg-primary text-primary-foreground", h)} role="group" aria-label={`Quantity for ${label}`}>
      <button type="button" onClick={() => onChange(value - 1)} className={cn("grid aspect-square place-items-center rounded-full transition hover:bg-primary-foreground/15", h)} aria-label={`Decrease ${label}`}>
        <Minus className="size-4" />
      </button>
      <span className="min-w-6 text-center text-sm font-semibold tabular-nums" aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} className={cn("grid aspect-square place-items-center rounded-full transition hover:bg-primary-foreground/15 disabled:opacity-40", h)} aria-label={`Increase ${label}`}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}
