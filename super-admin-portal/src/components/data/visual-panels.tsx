import { AlertTriangle, CheckCircle2, FileText, Image, LockKeyhole, ShieldCheck, Smartphone } from "lucide-react";

import { StatusBadge } from "@/components/data/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { RecordItem } from "@/types/api";

function humanize(value: unknown) {
  return String(value ?? "-").split("_").join(" ").toLowerCase();
}

function BoolPill({ value, label }: { value: unknown; label: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <StatusBadge value={value ? "enabled" : "disabled"} />
    </div>
  );
}

function RuleCard({ title, items }: { title: string; items: { label: string; value: unknown }[] }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="font-medium capitalize text-foreground">{String(item.value ?? "-")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function RuleStatusCard({ title, items }: { title: string; items: { label: string; value: unknown; badge?: boolean }[] }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="font-medium capitalize text-foreground">
              {item.badge ? <StatusBadge value={item.value} /> : String(item.value ?? "-")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function TenantPolicyPanel({ policy }: { policy?: unknown }) {
  const item = (policy || {}) as RecordItem;
  const lockRules = (item.lockRules || {}) as RecordItem;
  const unlockRules = (item.unlockRules || {}) as RecordItem;
  const tempUnlockRules = (item.tempUnlockRules || {}) as RecordItem;
  const escalationRules = (item.escalationRules || {}) as RecordItem;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tenant Policy</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <RuleCard
            title="Lock Rules"
            items={[
              { label: "DPD", value: lockRules.dpd },
              { label: "Grace days", value: lockRules.gracePeriodDays },
              { label: "Lock on expiry", value: lockRules.lockOnGraceExpiry ? "Yes" : "No" }
            ]}
          />
          <RuleCard
            title="Unlock Rules"
            items={[
              { label: "Type", value: unlockRules.unlockType },
              { label: "Delay minutes", value: unlockRules.delayMinutes },
              { label: "Full payment", value: unlockRules.requireFullPayment ? "Required" : "Optional" }
            ]}
          />
          <RuleCard
            title="Temporary Unlock"
            items={[
              { label: "Default hours", value: tempUnlockRules.defaultDurationHours },
              { label: "Max hours", value: tempUnlockRules.maxDurationHours }
            ]}
          />
          <RuleCard
            title="Escalation"
            items={[
              { label: "Tenant SLA", value: `${escalationRules.slaHours ?? "-"}h` },
              { label: "Partner SLA", value: `${escalationRules.partnerEscalationSlaHours ?? "-"}h` },
              { label: "Auto escalate", value: escalationRules.autoEscalateOnSLABreach ? "Yes" : "No" }
            ]}
          />
        </div>
        <div className="text-xs text-muted-foreground">
          Version {String(item.version ?? "-")} · Updated {formatDate(item.updatedAt as string)}
        </div>
      </CardContent>
    </Card>
  );
}

export function DevicePoliciesPanel({ policies }: { policies?: unknown }) {
  const items = Array.isArray(policies) ? (policies as RecordItem[]) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Device Policies</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((policy) => {
          const restrictions = (policy.restrictions || {}) as RecordItem;
          const allowedApps = Array.isArray(restrictions.allowedApps) ? restrictions.allowedApps : [];
          const blockedApps = Array.isArray(restrictions.blockedApps) ? restrictions.blockedApps : [];
          return (
            <div key={String(policy._id || policy.policyKey)} className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{String(policy.policyKey || "-")}</h3>
                  <p className="text-xs text-muted-foreground">Version {String(policy.version ?? "-")}</p>
                </div>
                <StatusBadge value={policy.isActive ? "active" : "inactive"} />
              </div>
              <div className="flex flex-col gap-2">
                <BoolPill value={restrictions.lockMode} label="Lock mode" />
                <BoolPill value={restrictions.disableFactoryReset} label="Factory reset blocked" />
                <BoolPill value={restrictions.disableStatusBar} label="Status bar blocked" />
                <BoolPill value={restrictions.disableAdb} label="ADB blocked" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{allowedApps.length} allowed apps</Badge>
                <Badge variant="outline">{blockedApps.length} blocked apps</Badge>
              </div>
            </div>
          );
        })}
        {!items.length ? <p className="text-sm text-muted-foreground">No device policies found.</p> : null}
      </CardContent>
    </Card>
  );
}

export function DeviceSummaryPanel({ summary }: { summary?: unknown }) {
  const items = Array.isArray(summary) ? (summary as RecordItem[]) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Device Summary</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={String(item._id)} className="flex items-center gap-3 rounded-xl border bg-muted/20 p-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Smartphone className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{String(item.count ?? 0)}</p>
              <p className="text-xs font-medium uppercase text-muted-foreground">{String(item._id ?? "Unknown")}</p>
            </div>
          </div>
        ))}
        {!items.length ? <p className="text-sm text-muted-foreground">No devices found.</p> : null}
      </CardContent>
    </Card>
  );
}

export function OpenCasesPanel({ cases }: { cases?: unknown }) {
  const items = Array.isArray(cases) ? (cases as RecordItem[]) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open Cases</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.map((item) => (
          <div key={String(item._id || item.caseId)} className="rounded-xl border bg-muted/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{String(item.caseId || "Case")}</p>
                <p className="text-sm text-muted-foreground">{String(item.reason || item.details || "-")}</p>
              </div>
              <StatusBadge value={item.status} />
            </div>
          </div>
        ))}
        {!items.length ? <p className="text-sm text-muted-foreground">No open cases.</p> : null}
      </CardContent>
    </Card>
  );
}

export function ConsentTextPanel({ consent }: { consent: RecordItem }) {
  const sections = [
    ["Borrower Agreement", consent.borrowerAgreementText],
    ["Device Control Consent", consent.deviceControlConsentText],
    ["Privacy Policy", consent.privacyPolicyText],
    ["Tripartite Acknowledgement", consent.tripartiteAckText]
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consent Text</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sections.map(([title, text]) => (
          <section key={String(title)} className="rounded-xl border bg-muted/20 p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="size-4 text-primary" aria-hidden="true" />
              <h3 className="font-semibold">{String(title)}</h3>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{String(text || "-")}</p>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

export function ActivePolicyPanel({ policy }: { policy?: unknown }) {
  const item = (policy || {}) as RecordItem;
  const restrictions = (item.restrictions || {}) as RecordItem;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Policy</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/20 p-4">
          <div>
            <p className="text-lg font-semibold">{String(item.policyKey || "-")}</p>
            <p className="text-sm text-muted-foreground">Version {String(item.version ?? "-")}</p>
          </div>
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {restrictions.lockMode ? <LockKeyhole className="size-5" aria-hidden="true" /> : <ShieldCheck className="size-5" aria-hidden="true" />}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <BoolPill value={restrictions.lockMode} label="Lock mode" />
          <BoolPill value={restrictions.disableFactoryReset} label="Factory reset blocked" />
          <BoolPill value={restrictions.disableStatusBar} label="Status bar blocked" />
          <BoolPill value={restrictions.disableAdb} label="ADB blocked" />
        </div>
      </CardContent>
    </Card>
  );
}

export function RiskFlagMetricsPanel({ flags }: { flags?: unknown }) {
  const items = Array.isArray(flags) ? (flags as RecordItem[]) : [];
  const open = items.filter((item) => String(item.status).toLowerCase() === "open").length;
  const high = items.filter((item) => ["high", "critical"].includes(String(item.severity).toLowerCase())).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open Risk Flags</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric icon={AlertTriangle} label="Total" value={items.length} />
          <Metric icon={AlertTriangle} label="Open" value={open} />
          <Metric icon={CheckCircle2} label="High severity" value={high} />
        </div>
        <div className="flex flex-col gap-3">
          {items.slice(0, 5).map((item) => (
            <div key={String(item._id)} className="rounded-xl border bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{humanize(item.type)}</p>
                  <p className="text-sm text-muted-foreground">{String(item.message || "-")}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <StatusBadge value={item.severity} />
                  <StatusBadge value={item.status} />
                </div>
              </div>
            </div>
          ))}
          {!items.length ? <p className="text-sm text-muted-foreground">No open risk flags.</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function CasePayloadPanel({ item }: { item: RecordItem }) {
  const evidenceUrl = String(item.imageUrl || "");
  const resolved = Boolean(item.resolvedAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Case Information</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <RuleStatusCard
            title="Request"
            items={[
              { label: "Case ID", value: item.caseId },
              { label: "Category", value: humanize(item.reasonCategory) },
              { label: "Status", value: item.status, badge: true }
            ]}
          />
          <RuleCard
            title="SLA"
            items={[
              { label: "Tenant deadline", value: formatDate(item.slaDeadline as string) },
              { label: "Partner deadline", value: formatDate(item.partnerSlaDeadline as string) },
              { label: "Admin escalated", value: formatDate(item.escalatedToAdminAt as string) }
            ]}
          />
          <RuleStatusCard
            title="Resolution"
            items={[
              { label: "Resolved", value: resolved ? "yes" : "no", badge: true },
              { label: "Action", value: item.resolutionAction || "pending", badge: true },
              { label: "Resolved at", value: formatDate(item.resolvedAt as string) }
            ]}
          />
          <RuleCard
            title="Timeline"
            items={[
              { label: "Created", value: formatDate(item.createdAt as string) },
              { label: "Updated", value: formatDate(item.updatedAt as string) },
              { label: "Temp duration", value: item.tempUnlockDurationHours ? `${item.tempUnlockDurationHours}h` : "-" }
            ]}
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <section className="rounded-xl border bg-muted/20 p-4">
            <h3 className="font-semibold">Borrower Reason</h3>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{String(item.reason || "-")}</p>
            {item.details ? (
              <>
                <h4 className="mt-4 text-sm font-semibold">Details</h4>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{String(item.details)}</p>
              </>
            ) : null}
            {item.resolutionNote ? (
              <>
                <h4 className="mt-4 text-sm font-semibold">Resolution Note</h4>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{String(item.resolutionNote)}</p>
              </>
            ) : null}
          </section>
          <section className="rounded-xl border bg-muted/20 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Image className="size-4 text-primary" aria-hidden="true" />
              <h3 className="font-semibold">Evidence</h3>
            </div>
            {evidenceUrl ? (
              <a href={evidenceUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                Open evidence image
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">No evidence image attached.</p>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof AlertTriangle; label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
    </div>
  );
}
