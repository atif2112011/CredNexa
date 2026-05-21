import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { tenantFields } from "@/lib/forms";
import { getList } from "@/services/admin";

export default async function TenantsPage() {
  const data = await getList("/admin/tenants");

  return (
    <>
      <PageHeader title="Tenants" description="Manage tenant onboarding, support profile, status, and centrally copied policies." actions={<FormDialog title="Create tenant" triggerLabel="Create tenant" endpoint="/api/admin/tenants" fields={tenantFields} />} />
      <ResourceTable
        rows={data.items}
        detailBasePath="/tenants"
        columns={[
          { key: "name", header: "Name" },
          { key: "type", header: "Type" },
          { key: "channelPartnerId.name", header: "Partner" },
          { key: "capabilities", header: "Capabilities" },
          { key: "isActive", header: "Status", type: "boolean" }
        ]}
      />
    </>
  );
}
