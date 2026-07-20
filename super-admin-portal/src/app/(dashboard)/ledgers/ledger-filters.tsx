"use client";

import { RotateCcw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecordItem } from "@/types/api";

const partnerTypes = [
  "TENANT_KEY_PURCHASE_COMMISSION",
  "PAYOUT_REQUEST_HOLD",
  "PAYOUT_REJECTED_RELEASE",
  "PAYOUT_APPROVED_PAID",
  "ADMIN_ADJUSTMENT"
];

const tenantTypes = ["ADMIN_ADJUSTMENT", "TENANT_CREDIT_PURCHASE", "BORROWER_CREATION"];

function idOf(item: RecordItem) {
  return String(item._id || item.id || "");
}

function partnerIdOfTenant(tenant: RecordItem) {
  const partner = tenant.channelPartnerId;
  return String(partner && typeof partner === "object" ? (partner as RecordItem)._id || (partner as RecordItem).id || "" : partner || "");
}

export function LedgerFilters({ tab, partners, tenants }: { tab: "partner" | "tenant"; partners: RecordItem[]; tenants: RecordItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedPartner = searchParams.get("channelPartnerId") || "all";
  const visibleTenants = selectedPartner === "all" ? tenants : tenants.filter((tenant) => partnerIdOfTenant(tenant) === selectedPartner);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    params.delete("page");
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    if (key === "channelPartnerId") params.delete("tenantId");
    router.push(`${pathname}?${params.toString()}`);
  }

  const selectClass = "h-9 max-w-60 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <div className="flex flex-wrap items-end gap-3 border-y bg-muted/20 px-1 py-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-muted-foreground">Partner</span>
        <select className={selectClass} value={selectedPartner} onChange={(event) => updateParam("channelPartnerId", event.target.value)}>
          <option value="all">All partners</option>
          {partners.map((partner) => <option key={idOf(partner)} value={idOf(partner)}>{String(partner.name || "Partner")}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-muted-foreground">Tenant</span>
        <select className={selectClass} value={searchParams.get("tenantId") || "all"} onChange={(event) => updateParam("tenantId", event.target.value)}>
          <option value="all">All tenants</option>
          {visibleTenants.map((tenant) => <option key={idOf(tenant)} value={idOf(tenant)}>{String(tenant.name || "Tenant")}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-muted-foreground">Transaction</span>
        <select className={selectClass} value={searchParams.get("type") || "all"} onChange={(event) => updateParam("type", event.target.value)}>
          <option value="all">All types</option>
          {(tab === "partner" ? partnerTypes : tenantTypes).map((type) => <option key={type} value={type}>{type.split("_").join(" ").toLowerCase()}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-muted-foreground">Direction</span>
        <select className={selectClass} value={searchParams.get("direction") || "all"} onChange={(event) => updateParam("direction", event.target.value)}>
          <option value="all">All</option>
          <option value="credit">Credit</option>
          <option value="debit">Debit</option>
        </select>
      </label>
      {tab === "partner" ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-muted-foreground">Balance</span>
          <select className={selectClass} value={searchParams.get("balanceType") || "all"} onChange={(event) => updateParam("balanceType", event.target.value)}>
            <option value="all">All balances</option>
            <option value="AVAILABLE">Available</option>
            <option value="HOLD">Hold</option>
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-muted-foreground">From</span>
        <Input type="date" value={searchParams.get("from") || ""} onChange={(event) => updateParam("from", event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-muted-foreground">To</span>
        <Input type="date" value={searchParams.get("to") || ""} onChange={(event) => updateParam("to", event.target.value)} />
      </label>
      <Button type="button" variant="outline" onClick={() => router.push(`${pathname}?tab=${tab}`)}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        Reset
      </Button>
    </div>
  );
}
