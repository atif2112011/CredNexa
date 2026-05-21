import { DetailGrid } from "@/components/data/detail-grid";
import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { partnerFields, statusFields } from "@/lib/forms";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDetail(`/admin/channel-partners/${id}`);
  const partner = data.channelPartner as RecordItem;

  return (
    <>
      <PageHeader
        title={String(partner.name || "Partner")}
        description="Partner profile, mapped tenants, and scoped admin accounts."
        actions={
          <>
            <FormDialog title="Update partner" triggerLabel="Update" endpoint={`/api/admin/channel-partners/${id}`} method="PATCH" fields={partnerFields} defaultValues={partner} variant="outline" />
            <FormDialog title="Change status" triggerLabel="Activate / Deactivate" endpoint={`/api/admin/channel-partners/${id}/status`} method="PATCH" fields={statusFields} defaultValues={{ isActive: partner.isActive ? "true" : "false" }} variant="secondary" />
          </>
        }
      />
      <div className="space-y-6">
        <DetailGrid
          title="Partner Detail"
          data={partner}
          fields={[
            { label: "Name", key: "name" },
            { label: "Type", key: "type" },
            { label: "Active", key: "isActive", type: "boolean" },
            { label: "Email", key: "contactEmail" },
            { label: "Phone", key: "contactPhone" },
            { label: "Created", key: "createdAt", type: "date" }
          ]}
        />
        <Card>
          <CardHeader>
            <CardTitle>Tenants</CardTitle>
          </CardHeader>
          <CardContent>
            <ResourceTable rows={(data.tenants as RecordItem[]) || []} detailBasePath="/tenants" columns={[{ key: "name", header: "Name" }, { key: "type", header: "Type" }, { key: "isActive", header: "Status", type: "boolean" }]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Admin Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <ResourceTable rows={(data.accounts as RecordItem[]) || []} detailBasePath="/accounts" columns={[{ key: "name", header: "Name" }, { key: "email", header: "Email" }, { key: "role", header: "Role" }, { key: "isActive", header: "Status", type: "boolean" }]} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
