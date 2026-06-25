import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatusBadge({ value }: { value?: unknown }) {
  const text = String(value ?? "-");
  const normalized = text.toLowerCase();
  const className = normalized === "sent" || normalized === "approved" || normalized === "low" || normalized.includes("active") || normalized.includes("resolved") || normalized.includes("current") || normalized.includes("acknowledged") || normalized.includes("enabled")
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    : normalized === "skipped" || normalized === "medium" || normalized.includes("pending") || normalized.includes("review") || normalized.includes("grace")
      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      : normalized === "borrower_app" || normalized === "policy_update"
      ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
      : normalized === "tenant_app" || normalized === "notification"
      ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200"
      : normalized === "partner_app" || normalized === "app_notification"
      ? "bg-teal-50 text-teal-700 ring-1 ring-teal-200"
      : normalized === "high"
        ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200"
        : normalized === "failed" || normalized.includes("reject") || normalized.includes("locked") || normalized.includes("critical") || normalized.includes("open") || normalized.includes("disabled")
        ? "bg-destructive/10 text-destructive ring-1 ring-destructive/20"
        : "bg-secondary text-secondary-foreground";

  return <Badge variant="secondary" className={cn("capitalize", className)}>{text.split("_").join(" ").toLowerCase()}</Badge>;
}
