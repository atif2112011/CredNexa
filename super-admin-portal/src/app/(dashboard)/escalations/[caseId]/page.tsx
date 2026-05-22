import { ResolveCaseDialog } from "@/components/cases/resolve-case-dialog";
import { DetailGrid } from "@/components/data/detail-grid";
import { CasePayloadPanel } from "@/components/data/visual-panels";
import { PageHeader } from "@/components/shell/page-header";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

function isResolvable(status: unknown) {
  return ["ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"].includes(String(status));
}

export default async function EscalationDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const data = await getDetail(`/admin/escalations/${caseId}`);
  const unlockRequest = data.unlockRequest as RecordItem;
  const canResolve = isResolvable(unlockRequest.status);

  return (
    <>
      <PageHeader
        title={String(unlockRequest.caseId || caseId)}
        description={canResolve ? "Review evidence and resolve this escalated unlock case." : "Resolved cases are read-only."}
        actions={canResolve ? <ResolveCaseDialog item={unlockRequest} /> : null}
      />
      <div className="flex flex-col gap-6">
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
        <CasePayloadPanel item={unlockRequest} />
      </div>
    </>
  );
}
