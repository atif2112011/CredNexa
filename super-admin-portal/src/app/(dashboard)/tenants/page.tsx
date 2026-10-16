import { tableQuery, type TableSearchParams } from "@/lib/table-query";
import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { buildTenantFields } from "@/lib/forms";
import { getAllList, getList } from "@/services/admin";

export default async function TenantsPage({ searchParams }: { searchParams: Promise<TableSearchParams> }) {
  const params = await searchParams;
  const [data, partners] = await Promise.all([
    getList("/admin/tenants", { ...params, ...tableQuery(params) }),
    getAllList("/admin/channel-partners")
  ]);
  const tenantFields = buildTenantFields(partners.items);

  return (
    <>
      <PageHeader title="Tenants" description="Manage tenant onboarding, support profile, status, and centrally copied policies." actions={<FormDialog title="Create tenant" triggerLabel="Create tenant" endpoint="/api/admin/tenants" fields={tenantFields} successVariant="tenant" />} />
      <ResourceTable
        pagination={data.pagination}
        rows={data.items}
        detailBasePath="/tenants"
        columns={[
          { key: "name", header: "Name" },
          { key: "type", header: "Type" },
          { key: "channelPartnerId.name", header: "Partner" },
          { key: "pocName", header: "POC" },
          { key: "supportPhone", header: "Support phone" },
          { key: "address.district", header: "District" },
          { key: "isActive", header: "Status", type: "boolean" }
        ]}
      />
    </>
  );
}
