import Link from "next/link";

import { StatusBadge } from "@/components/data/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatDate, getNestedValue } from "@/lib/utils";
import type { Pagination, RecordItem } from "@/types/api";

type LedgerTableProps = {
  tab: "partner" | "tenant";
  items: RecordItem[];
  pagination: Pagination;
  searchParams: Record<string, string | undefined>;
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function pageHref(params: Record<string, string | undefined>, page: number) {
  const next = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) next.set(key, value); });
  next.set("page", String(page));
  return `/ledgers?${next.toString()}`;
}

function displayName(row: RecordItem, key: string) {
  return String(getNestedValue(row, key) || "-");
}

function transactionContext(row: RecordItem, tab: "partner" | "tenant") {
  if (tab === "tenant") {
    const borrower = displayName(row, "userId.name");
    const loanId = displayName(row, "userId.loanId");
    return borrower !== "-" ? `${borrower}${loanId !== "-" ? ` · ${loanId}` : ""}` : "-";
  }
  if (row.keysPurchased) return `${number.format(Number(row.keysPurchased))} keys${row.purchaseAmount ? ` · ${inr.format(Number(row.purchaseAmount))}` : ""}`;
  const reference = getNestedValue(row, "payoutRequestId.adminReferenceId") || getNestedValue(row, "payoutRequestId._id");
  return String(reference || "-");
}

export function LedgerTable({ tab, items, pagination, searchParams }: LedgerTableProps) {
  const value = (amount: unknown) => tab === "partner" ? inr.format(Number(amount || 0)) : number.format(Number(amount || 0));

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs font-semibold uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">{tab === "partner" ? "Partner" : "Tenant"}</th>
              <th className="px-4 py-3">{tab === "partner" ? "Tenant" : "Partner"}</th>
              <th className="px-4 py-3">Type</th>
              {tab === "partner" ? <th className="px-4 py-3">Balance</th> : null}
              <th className="px-4 py-3 text-right">Delta</th>
              <th className="px-4 py-3 text-right">Before</th>
              <th className="px-4 py-3 text-right">After</th>
              <th className="px-4 py-3">Context</th>
              <th className="px-4 py-3">Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? items.map((row) => {
              const delta = Number(row.delta || 0);
              return (
                <tr key={String(row._id || row.id)} className="border-t hover:bg-muted/20">
                  <td className="whitespace-nowrap px-4 py-3">{formatDate(row.createdAt as string)}</td>
                  <td className="px-4 py-3 font-medium">{displayName(row, tab === "partner" ? "channelPartnerId.name" : "tenantId.name")}</td>
                  <td className="px-4 py-3">{displayName(row, tab === "partner" ? "tenantId.name" : "tenantId.channelPartnerId.name")}</td>
                  <td className="px-4 py-3"><StatusBadge value={row.type} /></td>
                  {tab === "partner" ? <td className="px-4 py-3"><StatusBadge value={row.balanceType} /></td> : null}
                  <td className="px-4 py-3 text-right"><Badge variant="outline" className={cn(delta > 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-destructive/20 bg-destructive/10 text-destructive")}>{delta > 0 ? "+" : ""}{value(delta)}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums">{value(row.balanceBefore)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{value(row.balanceAfter)}</td>
                  <td className="max-w-64 px-4 py-3">{transactionContext(row, tab)}</td>
                  <td className="max-w-72 px-4 py-3 text-muted-foreground">{String(row.reason || "-")}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan={tab === "partner" ? 10 : 9} className="px-4 py-12 text-center text-muted-foreground">No ledger entries found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-3">
        <p className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.pages || 1} · {pagination.total} entries</p>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className={pagination.page <= 1 ? "pointer-events-none opacity-50" : undefined}><Link href={pageHref(searchParams, Math.max(1, pagination.page - 1))}>Previous</Link></Button>
          <Button asChild variant="outline" size="sm" className={pagination.page >= pagination.pages ? "pointer-events-none opacity-50" : undefined}><Link href={pageHref(searchParams, pagination.page + 1)}>Next</Link></Button>
        </div>
      </div>
    </div>
  );
}
