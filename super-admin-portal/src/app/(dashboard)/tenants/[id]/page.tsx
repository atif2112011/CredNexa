import { DetailGrid } from "@/components/data/detail-grid";
import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { DevicePoliciesPanel, DeviceSummaryPanel, OpenCasesPanel, TenantPolicyPanel } from "@/components/data/visual-panels";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { statusFields, tenantUpdateFields } from "@/lib/forms";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDetail(`/admin/tenants/${id}`);
  const tenant = data.tenant as RecordItem;

  return (
    <>
      <PageHeader
        title={String(tenant.name || "Tenant")}
        description="Tenant profile, policies, admins, open cases, and unresolved risk flags."
        actions={
          <>
            <FormDialog title="Update tenant" triggerLabel="Update" endpoint={`/api/admin/tenants/${id}`} method="PATCH" fields={tenantUpdateFields} defaultValues={tenant} />
            <FormDialog title="Change status" triggerLabel="Activate / Deactivate" endpoint={`/api/admin/tenants/${id}/status`} method="PATCH" fields={statusFields} defaultValues={{ isActive: tenant.isActive ? "true" : "false" }} />
          </>
        }
      />
      <div className="space-y-6">
        <DetailGrid title="Tenant Detail" data={tenant} fields={[{ label: "Name", key: "name" }, { label: "Type", key: "type" }, { label: "Partner", key: "channelPartnerId.name" }, { label: "Active", key: "isActive", type: "boolean" }, { label: "Support email", key: "supportEmail" }, { label: "Support phone", key: "supportPhone" }]} />
        <TenantPolicyPanel policy={data.tenantPolicy} />
        <DevicePoliciesPanel policies={data.devicePolicies} />
        <Card>
          <CardHeader><CardTitle>Admin Accounts</CardTitle></CardHeader>
          <CardContent><ResourceTable rows={(data.accounts as RecordItem[]) || []} detailBasePath="/accounts" columns={[{ key: "name", header: "Name" }, { key: "email", header: "Email" }, { key: "role", header: "Role" }, { key: "isActive", header: "Status", type: "boolean" }]} /></CardContent>
        </Card>
        <div className="grid gap-6 xl:grid-cols-2">
          <DeviceSummaryPanel summary={data.deviceSummary} />
          <OpenCasesPanel cases={data.openCases} />
        </div>
      </div>
    </>
  );
}
