import { tableQuery, type TableSearchParams } from "@/lib/table-query";
import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { buildAccountFields } from "@/lib/forms";
import { getAllList, getList } from "@/services/admin";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<TableSearchParams> }) {
  const params = await searchParams;
  const [data, partners, tenants] = await Promise.all([
    getList("/admin/accounts", { ...params, ...tableQuery(params) }),
    getAllList("/admin/channel-partners"),
    getAllList("/admin/tenants")
  ]);
  const accountFields = buildAccountFields(partners.items, tenants.items);

  return (
    <>
      <PageHeader title="Admin Accounts" description="Create and manage partner_admin and tenant_admin accounts." actions={<FormDialog title="Create admin account" triggerLabel="Create account" endpoint="/api/admin/accounts" fields={accountFields} payloadMode="account" />} />
      <ResourceTable
        pagination={data.pagination}
        rows={data.items}
        detailBasePath="/accounts"
        columns={[
          { key: "name", header: "Name" },
          { key: "email", header: "Email" },
          { key: "mobile", header: "Mobile" },
          { key: "role", header: "Role" },
          { key: "tenantId.name", header: "Tenant" },
          { key: "channelPartnerId.name", header: "Partner" },
          { key: "isActive", header: "Status", type: "boolean" }
        ]}
      />
    </>
  );
}
