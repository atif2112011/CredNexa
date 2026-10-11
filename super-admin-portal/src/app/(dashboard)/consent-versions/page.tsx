import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { consentFields } from "@/lib/forms";
import { getList } from "@/services/admin";

export default async function ConsentVersionsPage() {
  const data = await getList("/admin/consent-versions", { enrollmentMode: "DEVICE_OWNER_QR", limit: 100 });

  return (
    <>
      <PageHeader title="Device Owner Consent" description="Manage consent for QR-provisioned Device Owner enrollment." actions={<FormDialog title="Create Device Owner consent" triggerLabel="Create version" endpoint="/api/admin/consent-versions" fields={consentFields} fixedPayload={{ enrollmentMode: "DEVICE_OWNER_QR" }} />} />
      <ResourceTable
        rows={data.items}
        detailBasePath="/consent-versions"
        columns={[
          { key: "version", header: "Version" },
          { key: "title", header: "Title" },
          { key: "isCurrent", header: "Current", type: "boolean" },
          { key: "publishedAt", header: "Published", type: "date" },
          { key: "createdAt", header: "Created", type: "date" }
        ]}
      />
    </>
  );
}
