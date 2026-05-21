import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

export default async function AuditLogsPage() {
  const data = await getList("/admin/audit-logs");

  return (
    <>
      <PageHeader title="Audit Logs" description="Platform-wide audit trail for admin, tenant, partner, user, case, and device events." />
      <ResourceTable
        rows={data.items}
        columns={[
          { key: "eventType", header: "Event" },
          { key: "actorId", header: "Actor" },
          { key: "tenantId", header: "Tenant" },
          { key: "channelPartnerId", header: "Partner" },
          { key: "caseId", header: "Case" },
          { key: "reason", header: "Reason" },
          { key: "timestamp", header: "Time", type: "date" }
        ]}
      />
    </>
  );
}
