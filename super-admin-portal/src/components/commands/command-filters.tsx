"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const filterSets = [
  {
    key: "status",
    label: "Status",
    options: [
      ["All", "all"],
      ["Pending", "pending"],
      ["Sent", "sent"],
      ["Acknowledged", "acknowledged"],
      ["Failed", "failed"]
    ]
  },
  {
    key: "commandType",
    label: "Command",
    options: [
      ["All", "all"],
      ["Lock", "LOCK"],
      ["Unlock", "UNLOCK"],
      ["Temp unlock", "TEMP_UNLOCK"]
    ]
  },
  {
    key: "triggeredBy",
    label: "Triggered by",
    options: [
      ["All", "all"],
      ["Auto policy", "auto_policy"],
      ["Payment unlock", "payment_unlock"],
      ["Manual tenant", "manual_tenant"],
      ["Partner admin", "partner_admin"],
      ["Super admin", "super_admin"],
      ["Temp unlock expiry", "temp_unlock_expiry"]
    ]
  }
];

export function CommandFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (!value || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {filterSets.map((filter) => (
        <label key={filter.key} className="flex items-center gap-2 text-sm">
          <span className="font-medium text-muted-foreground">{filter.label}</span>
          <select
            value={searchParams.get(filter.key) || "all"}
            onChange={(event) => updateParam(filter.key, event.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {filter.options.map(([label, value]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium text-muted-foreground">From</span>
        <input
          type="date"
          value={searchParams.get("from") || ""}
          onChange={(event) => updateParam("from", event.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium text-muted-foreground">To</span>
        <input
          type="date"
          value={searchParams.get("to") || ""}
          onChange={(event) => updateParam("to", event.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>
    </div>
  );
}
