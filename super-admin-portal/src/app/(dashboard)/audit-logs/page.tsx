import { tableQuery, type TableSearchParams } from "@/lib/table-query";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<TableSearchParams> }) {
  const params = await searchParams;
  const data = await getList("/admin/audit-logs", { ...params, ...tableQuery(params) });

  return (
    <>
      <PageHeader title="Audit Logs" description="Platform-wide audit trail for admin, tenant, partner, user, case, and device events." />
      <ResourceTable
        pagination={data.pagination}
        rows={data.items}
        columns={[
          { key: "eventType", header: "Event" },
          { key: "actorId.name", header: "Actor", className: "max-w-40 truncate" },
          { key: "tenantId.name", header: "Tenant", className: "max-w-48 truncate" },
          { key: "channelPartnerId.name", header: "Partner", className: "max-w-48 truncate" },
          { key: "caseId", header: "Case", className: "max-w-36 truncate" },
          { key: "reason", header: "Reason", className: "max-w-64 truncate" },
          { key: "timestamp", header: "Time", type: "date" }
        ]}
      />
    </>
  );
}
