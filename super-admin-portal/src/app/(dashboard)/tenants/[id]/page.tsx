import { DetailGrid } from "@/components/data/detail-grid";
import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { DevicePoliciesPanel, DeviceSummaryPanel, OpenCasesPanel, TenantPolicyPanel } from "@/components/data/visual-panels";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { statusFields, tenantUpdateFields } from "@/lib/forms";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";
import { DiscountSlabsForm } from "./discount-slabs-form";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDetail(`/admin/tenants/${id}`);
  const tenant = data.tenant as RecordItem;
  const discountSlabs = Array.isArray(tenant.creditPurchaseDiscountSlabs)
    ? tenant.creditPurchaseDiscountSlabs.map((slab) => {
        const item = slab as RecordItem;
        return {
          minKeys: Number(item.minKeys),
          maxKeys: item.maxKeys === null || item.maxKeys === undefined ? null : Number(item.maxKeys),
          discountPercentage: Number(item.discountPercentage)
        };
      })
    : [];
  const tenantFormDefaults = {
    ...tenant,
    addressStreet: String((tenant.address as RecordItem | undefined)?.street || ""),
    addressCity: String((tenant.address as RecordItem | undefined)?.city || ""),
    addressDistrict: String((tenant.address as RecordItem | undefined)?.district || ""),
    addressState: String((tenant.address as RecordItem | undefined)?.state || ""),
    addressPincode: String((tenant.address as RecordItem | undefined)?.pincode || "")
  };

  return (
    <>
      <PageHeader
        title={String(tenant.name || "Tenant")}
        description="Tenant profile, policies, admins, open cases, and unresolved risk flags."
        actions={
          <>
            <FormDialog title="Update tenant" triggerLabel="Update" endpoint={`/api/admin/tenants/${id}`} method="PATCH" fields={tenantUpdateFields} defaultValues={tenantFormDefaults} />
            <FormDialog title="Change status" triggerLabel="Activate / Deactivate" endpoint={`/api/admin/tenants/${id}/status`} method="PATCH" fields={statusFields} defaultValues={{ isActive: tenant.isActive ? "true" : "false" }} />
          </>
        }
      />
      <div className="space-y-6">
        <DetailGrid title="Tenant Detail" data={tenant} fields={[{ label: "Name", key: "name" }, { label: "Type", key: "type" }, { label: "Partner", key: "channelPartnerId.name" }, { label: "Active", key: "isActive", type: "boolean" }, { label: "Support email", key: "supportEmail" }, { label: "Support phone", key: "supportPhone" }, { label: "Per key price", key: "creditPurchasePerKeyPrice" }, { label: "POC name", key: "pocName" }, { label: "POC phone", key: "pocPhone" }, { label: "POC designation", key: "pocDesignation" }, { label: "Address", key: "address.street" }, { label: "City", key: "address.city" }, { label: "District", key: "address.district" }, { label: "State", key: "address.state" }, { label: "Pincode", key: "address.pincode" }]} />
        <DiscountSlabsForm
          tenantId={id}
          initialSlabs={discountSlabs}
          initialVersion={Number(tenant.creditPurchaseDiscountVersion || 1)}
          maximumPurchase={2000}
        />
        <DetailGrid
          title="Tenant Metrics"
          data={tenant}
          fields={[
            { label: "Total borrowers", key: "metrics.borrowers.total" },
            { label: "Total devices", key: "metrics.devices.total" },
            { label: "Open cases", key: "metrics.cases.open" },
            { label: "Escalated to partner", key: "metrics.cases.escalatedToPartner" },
            { label: "Metrics refreshed", key: "metrics.updatedAt", type: "date" }
          ]}
        />
        <TenantPolicyPanel policy={data.tenantPolicy} />
        <DevicePoliciesPanel policies={data.devicePolicies} />
        <Card>
          <CardHeader><CardTitle>Admin Accounts</CardTitle></CardHeader>
          <CardContent><ResourceTable rows={(data.accounts as RecordItem[]) || []} detailBasePath="/accounts" columns={[{ key: "name", header: "Name" }, { key: "mobile", header: "Mobile" }, { key: "email", header: "Email" }, { key: "role", header: "Role" }, { key: "isActive", header: "Status", type: "boolean" }]} /></CardContent>
        </Card>
        <div className="grid gap-6 xl:grid-cols-2">
          <DeviceSummaryPanel summary={data.deviceSummary} />
          <OpenCasesPanel cases={data.openCases} />
        </div>
      </div>
    </>
  );
}
