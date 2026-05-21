import { FormDialog } from "@/components/data/form-dialog";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { partnerFields } from "@/lib/forms";
import { getList } from "@/services/admin";

export default async function PartnersPage() {
  const data = await getList("/admin/channel-partners");

  return (
    <>
      <PageHeader
        title="Channel Partners"
        description="Create, inspect, update, activate, and deactivate partner organizations."
        actions={<FormDialog title="Create partner" triggerLabel="Create partner" endpoint="/api/admin/channel-partners" fields={partnerFields} />}
      />
      <ResourceTable
        rows={data.items}
        detailBasePath="/partners"
        columns={[
          { key: "name", header: "Name" },
          { key: "type", header: "Type" },
          { key: "isActive", header: "Status", type: "boolean" },
          { key: "contactEmail", header: "Email" },
          { key: "createdAt", header: "Created", type: "date" }
        ]}
      />
    </>
  );
}
