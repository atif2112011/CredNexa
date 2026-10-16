import { tableQuery, type TableSearchParams } from "@/lib/table-query";
import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { consentFields } from "@/lib/forms";
import { getList } from "@/services/admin";

export default async function RunningConsentVersionsPage({ searchParams }: { searchParams: Promise<TableSearchParams> }) {
  const params = await searchParams;
  const data = await getList("/admin/consent-versions", { ...params, ...tableQuery(params), enrollmentMode: "RUNNING_APP", });

  return (
    <>
      <PageHeader
        title="Running Device Consent"
        description="Create, review, publish, and manage consent for installed running-device enrollment. Published versions remain read-only."
        actions={<FormDialog title="Create running-device consent" triggerLabel="Create version" endpoint="/api/admin/consent-versions" fields={consentFields} fixedPayload={{ enrollmentMode: "RUNNING_APP" }} />}
      />
      <ResourceTable
        pagination={data.pagination}
        rows={data.items}
        detailBasePath="/running-consent-versions"
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
