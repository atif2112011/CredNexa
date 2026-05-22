"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const filters = [
  { label: "All", value: "all" },
  { label: "Escalated to Partners", value: "ESCALATED_PARTNER" },
  { label: "Escalated to Admin", value: "ESCALATED_ADMIN" }
];

export function CaseFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("status") || "all";

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium text-muted-foreground">Filter</span>
      <select
        value={current}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams);
          params.set("status", event.target.value);
          router.push(`${pathname}?${params.toString()}`);
        }}
        className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {filters.map((filter) => (
          <option key={filter.value} value={filter.value}>
            {filter.label}
          </option>
        ))}
      </select>
    </label>
  );
}
