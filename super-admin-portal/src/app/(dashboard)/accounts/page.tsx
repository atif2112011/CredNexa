import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { accountFields } from "@/lib/forms";
import { getList } from "@/services/admin";

export default async function AccountsPage() {
  const data = await getList("/admin/accounts");

  return (
    <>
      <PageHeader title="Admin Accounts" description="Create and manage partner_admin and tenant_admin accounts." actions={<FormDialog title="Create admin account" triggerLabel="Create account" endpoint="/api/admin/accounts" fields={accountFields} />} />
      <ResourceTable
        rows={data.items}
        detailBasePath="/accounts"
        columns={[
          { key: "name", header: "Name" },
          { key: "email", header: "Email" },
          { key: "role", header: "Role" },
          { key: "tenantId.name", header: "Tenant" },
          { key: "channelPartnerId.name", header: "Partner" },
          { key: "isActive", header: "Status", type: "boolean" }
        ]}
      />
    </>
  );
}
