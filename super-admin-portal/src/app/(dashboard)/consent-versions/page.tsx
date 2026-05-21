import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { consentFields } from "@/lib/forms";
import { getList } from "@/services/admin";

export default async function ConsentVersionsPage() {
  const data = await getList("/admin/consent-versions");

  return (
    <>
      <PageHeader title="Consent Versions" description="Create legal consent versions and publish the active platform version." actions={<FormDialog title="Create consent version" triggerLabel="Create version" endpoint="/api/admin/consent-versions" fields={consentFields} />} />
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
