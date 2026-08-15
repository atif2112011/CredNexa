"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecordItem } from "@/types/api";

type DiscountRequestFiltersProps = { tenants: RecordItem[]; partners: RecordItem[] };

export function DiscountRequestFilters({ tenants, partners }: DiscountRequestFiltersProps) {
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
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    pushParams(params);
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams(searchParams);
    if (search.trim()) params.set("search", search.trim());
    else params.delete("search");
    pushParams(params);
  }

  const selectClass = "h-9 max-w-56 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form className="flex items-center gap-2" onSubmit={submitSearch}>
        <label className="relative block w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Search discount requests</span>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tenant or partner..." className="pl-9" />
        </label>
        <Button type="submit" variant="outline">Search</Button>
      </form>
      <select aria-label="Tenant" value={searchParams.get("tenantId") || "all"} onChange={(event) => updateParam("tenantId", event.target.value)} className={selectClass}>
        <option value="all">All tenants</option>
        {tenants.map((tenant) => <option key={String(tenant._id || tenant.id)} value={String(tenant._id || tenant.id)}>{String(tenant.name || "Tenant")}</option>)}
      </select>
      <select aria-label="Partner" value={searchParams.get("channelPartnerId") || "all"} onChange={(event) => updateParam("channelPartnerId", event.target.value)} className={selectClass}>
        <option value="all">All partners</option>
        {partners.map((partner) => <option key={String(partner._id || partner.id)} value={String(partner._id || partner.id)}>{String(partner.name || "Partner")}</option>)}
      </select>
      <select aria-label="Status" value={searchParams.get("status") || "all"} onChange={(event) => updateParam("status", event.target.value)} className={selectClass}>
        <option value="all">All statuses</option>
        <option value="PENDING">Pending</option>
        <option value="APPROVED">Approved</option>
        <option value="REJECTED">Rejected</option>
      </select>
    </div>
  );
}
