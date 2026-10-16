import { tableQuery, type TableSearchParams } from "@/lib/table-query";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

export default async function RiskFlagsPage({ searchParams }: { searchParams: Promise<TableSearchParams> }) {
  const params = await searchParams;
  const data = await getList("/admin/risk-flags", { ...params, ...tableQuery(params), status: params.status || "active", });

  return (
    <>
      <PageHeader title="Risk Monitoring" description="Server-verified integrity risks, app repair actions, and admin mitigation workflow." />
      <ResourceTable
        pagination={data.pagination}
        rows={data.items}
        detailBasePath="/risk-flags"
        columns={[
          { key: "type", header: "Type" },
          { key: "severity", header: "Severity", type: "status" },
          { key: "status", header: "Status", type: "status" },
          { key: "riskBucket", header: "Bucket", type: "status" },
          { key: "deviceId.imei", header: "Device" },
          { key: "tenantId.name", header: "Tenant" },
          { key: "lastDetectedAt", header: "Last Detected", type: "date" }
        ]}
      />
    </>
  );
}
