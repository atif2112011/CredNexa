import { DetailGrid } from "@/components/data/detail-grid";
import { FormDialog } from "@/components/data/form-dialog";
import { PageHeader } from "@/components/shell/page-header";
import { accountUpdateFields, statusFields } from "@/lib/forms";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

export default async function AccountDetailPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const account = (await getDetail(`/admin/accounts/${accountId}`)) as RecordItem;

  return (
    <>
      <PageHeader
        title={String(account.name || "Admin account")}
        description="Account scope, contact details, and operational status."
        actions={
          <>
            <FormDialog title="Update account" triggerLabel="Update" endpoint={`/api/admin/accounts/${accountId}`} method="PATCH" fields={accountUpdateFields} defaultValues={account} variant="default" />
            <FormDialog title="Change status" triggerLabel="Activate / Deactivate" endpoint={`/api/admin/accounts/${accountId}/status`} method="PATCH" fields={statusFields} defaultValues={{ isActive: account.isActive ? "true" : "false" }} variant="default" />
          </>
        }
      />
      <DetailGrid
        title="Account Detail"
        data={account}
        fields={[
          { label: "Name", key: "name" },
          { label: "Email", key: "email" },
          { label: "Mobile", key: "mobile" },
          { label: "Role", key: "role" },
          { label: "Tenant", key: "tenantId.name" },
          { label: "Partner", key: "channelPartnerId.name" },
          { label: "Active", key: "isActive", type: "boolean" },
          { label: "Created", key: "createdAt", type: "date" }
        ]}
      />
    </>
  );
}
