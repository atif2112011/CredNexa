import { DetailGrid } from "@/components/data/detail-grid";
import { FormDialog } from "@/components/data/form-dialog";
import { JsonPanel } from "@/components/data/json-panel";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { escalationReasonFields, tempUnlockFields } from "@/lib/forms";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

export default async function EscalationDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const data = await getDetail(`/admin/escalations/${caseId}`);
  const unlockRequest = data.unlockRequest as RecordItem;

  return (
    <>
      <PageHeader
        title={String(unlockRequest.caseId || caseId)}
        description="Super Admin override workspace for escalated unlock cases."
        actions={
          <>
            <FormDialog title="Full unlock" triggerLabel="Full unlock" endpoint={`/api/admin/escalations/${caseId}/unlock`} fields={escalationReasonFields} />
            <FormDialog title="Temporary unlock" triggerLabel="Temp unlock" endpoint={`/api/admin/escalations/${caseId}/temp-unlock`} fields={tempUnlockFields} variant="secondary" />
            <FormDialog title="Reject case" triggerLabel="Reject" endpoint={`/api/admin/escalations/${caseId}/reject`} fields={escalationReasonFields} variant="destructive" />
          </>
        }
      />
      <div className="space-y-6">
        <DetailGrid
          title="Case Detail"
          data={unlockRequest}
          fields={[
            { label: "Status", key: "status" },
            { label: "Borrower", key: "userId.name" },
            { label: "Mobile", key: "userId.mobile" },
            { label: "Tenant", key: "tenantId.name" },
            { label: "Partner", key: "channelPartnerId.name" },
            { label: "IMEI", key: "deviceId.imei" },
            { label: "Device state", key: "deviceId.state" },
            { label: "Created", key: "createdAt", type: "date" }
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-2">
          <JsonPanel title="Case Payload" data={unlockRequest} />
          <JsonPanel title="Audit Trail" data={data.auditLogs} />
        </div>
        <Card>
          <CardHeader><CardTitle>Command History</CardTitle></CardHeader>
          <CardContent><ResourceTable rows={(data.commands as RecordItem[]) || []} columns={[{ key: "commandType", header: "Command" }, { key: "status", header: "Status", type: "status" }, { key: "triggeredBy", header: "Triggered By" }, { key: "createdAt", header: "Created", type: "date" }]} /></CardContent>
        </Card>
      </div>
    </>
  );
}
