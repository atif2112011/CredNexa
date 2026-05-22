import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export function GlobalLoader({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex min-h-[60vh] items-center justify-center p-8", className)}>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border bg-card text-primary shadow-sm">
          <LoaderCircle className="size-7 animate-spin" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">Fetching latest platform data</p>
        </div>
      </div>
    </div>
  );
}
