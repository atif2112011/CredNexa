"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const filterSets = [
  {
    key: "status",
    label: "Status",
    options: [
      ["All", "all"],
      ["Sent", "sent"],
      ["Failed", "failed"],
      ["Skipped", "skipped"]
    ]
  },
  {
    key: "targetApp",
    label: "Target App",
    options: [
      ["All", "all"],
      ["Borrower App", "borrower_app"],
      ["Tenant App", "tenant_app"],
      ["Partner App", "partner_app"]
    ]
  },
  {
    key: "recipientType",
    label: "Recipient",
    options: [
      ["All", "all"],
      ["Device", "device"],
      ["Tenant Admin", "tenant_admin"],
      ["Partner Admin", "partner_admin"]
    ]
  },
  {
    key: "messageType",
    label: "Message Type",
    options: [
      ["All", "all"],
      ["Policy Update", "POLICY_UPDATE"],
      ["Notification", "NOTIFICATION"],
      ["App Notification", "APP_NOTIFICATION"]
    ]
  }
];

export function FcmLogFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");

  function pushParams(params: URLSearchParams) {
    params.delete("page");
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (!value || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    pushParams(params);
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams(searchParams);
    if (search.trim()) {
      params.set("search", search.trim());
    } else {
      params.delete("search");
    }
    pushParams(params);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form className="flex min-w-64 items-center gap-2" onSubmit={submitSearch}>
        <label className="relative block w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Search FCM logs</span>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search logs..." className="pl-9" />
        </label>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

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
