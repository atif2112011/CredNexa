import Link from "next/link";
import { Building2, Landmark } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { cn } from "@/lib/utils";
import { getList } from "@/services/admin";

import { LedgerFilters } from "./ledger-filters";
import { LedgerTable } from "./ledger-table";

type LedgerPageProps = {
  searchParams: Promise<{
    tab?: string;
    page?: string;
    channelPartnerId?: string;
    tenantId?: string;
    type?: string;
    direction?: string;
    balanceType?: string;
    from?: string;
    to?: string;
  }>;
};

export default async function LedgersPage({ searchParams }: LedgerPageProps) {
  const params = await searchParams;
  const tab = params.tab === "tenant" ? "tenant" : "partner";
  const page = Math.max(Number(params.page) || 1, 1);
  const endpoint = tab === "partner" ? "/admin/ledgers/partners" : "/admin/ledgers/tenants";

  const [ledger, partners, tenants] = await Promise.all([
    getList(endpoint, {
      page,
      limit: 20,
      channelPartnerId: params.channelPartnerId,
      tenantId: params.tenantId,
      type: params.type,
      direction: params.direction,
      balanceType: tab === "partner" ? params.balanceType : undefined,
      from: params.from,
      to: params.to
    }),
    getList("/admin/channel-partners", { limit: 500 }),
    getList("/admin/tenants", { limit: 500 })
  ]);

  return (
    <>
      <PageHeader title="Ledgers" description="Review partner payout movements and tenant credit activity." />
      <div className="space-y-4">
        <nav className="inline-flex h-10 items-center gap-1 rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="Ledger type">
          <Link
            href="/ledgers?tab=partner"
            role="tab"
            aria-selected={tab === "partner"}
            className={cn("inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground", tab === "partner" && "bg-background text-foreground shadow-sm")}
          >
            <Landmark className="h-4 w-4" aria-hidden="true" />
            Partner Ledger
          </Link>
          <Link
            href="/ledgers?tab=tenant"
            role="tab"
            aria-selected={tab === "tenant"}
            className={cn("inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground", tab === "tenant" && "bg-background text-foreground shadow-sm")}
          >
            <Building2 className="h-4 w-4" aria-hidden="true" />
            Tenant Ledger
          </Link>
        </nav>
        <LedgerFilters tab={tab} partners={partners.items} tenants={tenants.items} />
        <LedgerTable tab={tab} items={ledger.items} pagination={ledger.pagination} searchParams={params} />
      </div>
    </>
  );
}
