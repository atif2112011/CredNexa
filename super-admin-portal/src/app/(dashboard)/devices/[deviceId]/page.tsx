import { DetailGrid } from "@/components/data/detail-grid";
import { JsonPanel } from "@/components/data/json-panel";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

export default async function DeviceDetailPage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const detail = await getDetail<RecordItem>(`/admin/devices/${deviceId}`);
  const commands = await getDetail<RecordItem[]>(`/admin/devices/${deviceId}/commands`);
  const auditLogs = await getDetail<RecordItem[]>(`/admin/devices/${deviceId}/audit-logs`);
  const device = detail.device as RecordItem;

  return (
    <>
      <PageHeader title={String(device.imei || "Device")} description="Device state, borrower mapping, policy snapshot, command history, and audit trail." />
      <div className="space-y-6">
        <DetailGrid title="Device Detail" data={device} fields={[{ label: "IMEI", key: "imei" }, { label: "Model", key: "deviceModel" }, { label: "Maker", key: "manufacturer" }, { label: "State", key: "state" }, { label: "Policy", key: "currentPolicyKey" }, { label: "Tenant", key: "tenantId.name" }, { label: "Borrower", key: "userId.name" }, { label: "Updated", key: "updatedAt", type: "date" }]} />
        <div className="grid gap-6 xl:grid-cols-2">
          <JsonPanel title="Active Policy" data={detail.policy} />
          <JsonPanel title="Open Risk Flags" data={detail.riskFlags} />
        </div>
        <Card>
          <CardHeader><CardTitle>Command History</CardTitle></CardHeader>
          <CardContent><ResourceTable rows={(commands as RecordItem[]) || []} columns={[{ key: "commandType", header: "Command" }, { key: "status", header: "Status", type: "status" }, { key: "triggeredBy", header: "Triggered By" }, { key: "createdAt", header: "Created", type: "date" }]} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Audit Trail</CardTitle></CardHeader>
          <CardContent><ResourceTable rows={(auditLogs as RecordItem[]) || []} columns={[{ key: "eventType", header: "Event" }, { key: "actorId", header: "Actor" }, { key: "reason", header: "Reason" }, { key: "timestamp", header: "Time", type: "date" }]} /></CardContent>
        </Card>
      </div>
    </>
  );
}
