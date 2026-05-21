import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

export default async function EscalationsPage() {
  const data = await getList("/admin/escalations");

  return (
    <>
      <PageHeader title="Escalation Queue" description="Inspect ESCALATED_ADMIN cases and perform mandatory-reason overrides." />
      <ResourceTable
        rows={data.items}
        detailBasePath="/escalations"
        columns={[
          { key: "caseId", header: "Case" },
          { key: "status", header: "Status", type: "status" },
          { key: "tenantId.name", header: "Tenant" },
          { key: "channelPartnerId.name", header: "Partner" },
          { key: "userId.name", header: "Borrower" },
          { key: "deviceId.imei", header: "IMEI" },
          { key: "createdAt", header: "Created", type: "date" }
        ]}
      />
    </>
  );
}
