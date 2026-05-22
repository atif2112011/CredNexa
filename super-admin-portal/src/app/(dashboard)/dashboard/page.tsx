import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  Landmark,
  ListChecks,
  ShieldAlert,
  Smartphone,
  Users
} from "lucide-react";
import type { ComponentType } from "react";

import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboard } from "@/services/admin";
import type { RecordItem } from "@/types/api";

type CountMap = Record<string, number>;

const statAccent = {
  blue: "bg-primary/10 text-primary ring-primary/15",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200"
};

function StatCard({
  label,
  value,
  icon: Icon,
  accent
}: {
  label: string;
  value: unknown;
  icon: ComponentType<{ className?: string }>;
  accent: keyof typeof statAccent;
}) {
  return (
    <Card className="border-border/80 bg-card/95 shadow-sm transition-colors hover:border-primary/30">
      <CardContent className="flex min-h-32 items-center justify-between p-5">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{String(value ?? 0)}</p>
        </div>
        <div className={`rounded-2xl p-3 ring-1 ${statAccent[accent]}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function mapEntries(data: unknown) {
  return Object.entries((data || {}) as CountMap).sort((a, b) => b[1] - a[1]);
}

function BreakdownCard({
  title,
  description,
  data,
  icon: Icon
}: {
  title: string;
  description: string;
  data: unknown;
  icon: ComponentType<{ className?: string }>;
}) {
  const entries = mapEntries(data);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <Card className="border-border/80 bg-card/95 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-2xl bg-muted p-3 text-primary ring-1 ring-border">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent>
        {entries.length ? (
          <div className="flex flex-col gap-4">
            {entries.map(([label, count]) => {
              const percent = total ? Math.round((count / total) * 100) : 0;
              return (
                <div key={label} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium capitalize text-foreground">{label.split("_").join(" ").toLowerCase()}</span>
                    <span className="text-muted-foreground">{count} - {percent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(percent, 6)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No activity recorded yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const dashboard = await getDashboard();
  const totals = (dashboard.totals || {}) as Record<string, unknown>;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Platform overview across partners, tenants, accounts, devices, escalations, and risks."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Partners" value={totals.channelPartners} icon={Landmark} accent="blue" />
        <StatCard label="Tenants" value={totals.tenants} icon={Building2} accent="cyan" />
        <StatCard label="Accounts" value={totals.accounts} icon={Users} accent="violet" />
        <StatCard label="Devices" value={totals.devices} icon={Smartphone} accent="emerald" />
        <StatCard label="Open Cases" value={totals.openEscalations} icon={ShieldAlert} accent="amber" />
        <StatCard label="Risk Flags" value={Object.values((dashboard.riskFlagsByStatus || {}) as Record<string, number>).reduce((a, b) => a + b, 0)} icon={AlertTriangle} accent="rose" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Recent Escalations</h2>
            <p className="text-sm text-muted-foreground">Newest admin-facing unlock cases.</p>
          </div>
          <ResourceTable
            rows={(dashboard.recentEscalations as RecordItem[]) || []}
            detailBasePath="/escalations"
            columns={[
              { key: "caseId", header: "Case" },
              { key: "status", header: "Status", type: "status" },
              { key: "tenantId.name", header: "Tenant" },
              { key: "userId.name", header: "Borrower" }
            ]}
          />
        </section>
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Recent Risk Flags</h2>
            <p className="text-sm text-muted-foreground">Operational signals that need review.</p>
          </div>
          <ResourceTable
            rows={(dashboard.recentRiskFlags as RecordItem[]) || []}
            columns={[
              { key: "type", header: "Type" },
              { key: "severity", header: "Severity", type: "status" },
              { key: "status", header: "Status", type: "status" },
              { key: "message", header: "Message" }
            ]}
          />
        </section>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <BreakdownCard title="Devices By State" description="Current fleet distribution." data={dashboard.devicesByState} icon={Activity} />
        <BreakdownCard title="Escalations By Status" description="Case movement across admin queues." data={dashboard.escalationsByStatus} icon={ListChecks} />
        <BreakdownCard title="Risk By Severity" description="Open risk signal concentration." data={dashboard.riskFlagsBySeverity} icon={BarChart3} />
      </div>
    </>
  );
}
