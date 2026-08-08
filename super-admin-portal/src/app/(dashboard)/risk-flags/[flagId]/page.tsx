import { RiskFlagActions } from "@/components/actions/risk-flag-actions";
import { DetailGrid } from "@/components/data/detail-grid";
import { JsonPanel } from "@/components/data/json-panel";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

export default async function RiskFlagDetailPage({ params }: { params: Promise<{ flagId: string }> }) {
  const { flagId } = await params;
  const data = await getDetail<RecordItem>(`/admin/risk-flags/${flagId}`);
  const riskFlag = data.riskFlag as RecordItem;
  const integrityChecks = (data.integrityChecks as RecordItem[]) || [];
  const commands = (data.commands as RecordItem[]) || [];
  const auditLogs = (data.auditLogs as RecordItem[]) || [];
  const activeCriticalRiskFlags = (data.activeCriticalRiskFlags as RecordItem[]) || [];

  return (
    <>
      <PageHeader title={String(riskFlag.type || "Risk Flag")} description="Risk evidence, device context, mitigation commands, and audit trail." />
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <DetailGrid
            title="Risk Detail"
            data={riskFlag}
            fields={[
              { label: "Type", key: "type" },
              { label: "Severity", key: "severity" },
              { label: "Status", key: "status" },
              { label: "Bucket", key: "riskBucket" },
              { label: "Remediation", key: "remediationMethod" },
              { label: "Source", key: "source" },
              { label: "Device", key: "deviceId.imei" },
              { label: "Borrower", key: "userId.name" },
              { label: "Tenant", key: "tenantId.name" },
              { label: "First Detected", key: "firstDetectedAt", type: "date" },
              { label: "Last Detected", key: "lastDetectedAt", type: "date" },
              { label: "Cleared", key: "clearedAt", type: "date" }
            ]}
          />
          <RiskFlagActions riskFlag={riskFlag} activeCriticalRiskFlags={activeCriticalRiskFlags} />
        </div>
        <JsonPanel title="Evidence" data={(riskFlag.evidence as RecordItem) || {}} />
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">Integrity Checks</h2>
            <ResourceTable
              rows={integrityChecks}
              columns={[
                { key: "result", header: "Result", type: "status" },
                { key: "reasonCode", header: "Reason" },
                { key: "checkType", header: "Check" },
                { key: "integrityStatus", header: "Integrity", type: "status" },
                { key: "createdAt", header: "Time", type: "date" }
              ]}
            />
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">Commands</h2>
            <ResourceTable
              rows={commands}
              columns={[
                { key: "commandType", header: "Command" },
                { key: "status", header: "Status", type: "status" },
                { key: "triggeredBy", header: "By" },
                { key: "createdAt", header: "Created", type: "date" }
              ]}
            />
          </section>
        </div>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Audit Trail</h2>
          <ResourceTable
            rows={auditLogs}
            columns={[
              { key: "eventType", header: "Event" },
              { key: "reason", header: "Reason" },
              { key: "timestamp", header: "Time", type: "date" }
            ]}
          />
        </section>
      </div>
    </>
  );
}
