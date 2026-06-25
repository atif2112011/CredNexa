"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecordItem } from "@/types/api";

type PayoutRequestFiltersProps = {
  partners: RecordItem[];
};

const statusOptions = [
  ["All", "all"],
  ["Pending", "PENDING"],
  ["Approved", "APPROVED"],
  ["Rejected", "REJECTED"]
];

export function PayoutRequestFilters({ partners }: PayoutRequestFiltersProps) {
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
          <span className="sr-only">Search payout requests</span>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, status, amount..." className="pl-9" />
        </label>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium text-muted-foreground">Partner</span>
        <select
          value={searchParams.get("channelPartnerId") || "all"}
          onChange={(event) => updateParam("channelPartnerId", event.target.value)}
          className="h-9 max-w-56 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="all">All</option>
          {partners.map((partner) => (
            <option key={String(partner._id || partner.id)} value={String(partner._id || partner.id)}>
              {String(partner.name || "Partner")}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium text-muted-foreground">Status</span>
        <select
          value={searchParams.get("status") || "all"}
          onChange={(event) => updateParam("status", event.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {statusOptions.map(([label, value]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
