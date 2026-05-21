import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatusBadge({ value }: { value?: unknown }) {
  const text = String(value ?? "-");
  const normalized = text.toLowerCase();
  const className = normalized.includes("active") || normalized.includes("resolved") || normalized.includes("current")
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    : normalized.includes("pending") || normalized.includes("review") || normalized.includes("grace")
      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      : normalized.includes("reject") || normalized.includes("locked") || normalized.includes("critical")
        ? "bg-destructive/10 text-destructive ring-1 ring-destructive/20"
        : "bg-secondary text-secondary-foreground";

  return <Badge variant="secondary" className={cn("capitalize", className)}>{text}</Badge>;
}
