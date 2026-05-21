import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

export default async function DevicesPage() {
  const data = await getList("/admin/devices");

  return (
    <>
      <PageHeader title="Device Oversight" description="Search registered devices and inspect state, command history, and audit activity." />
      <ResourceTable
        rows={data.items}
        detailBasePath="/devices"
        columns={[
          { key: "imei", header: "IMEI" },
          { key: "deviceModel", header: "Model" },
          { key: "manufacturer", header: "Maker" },
          { key: "state", header: "State", type: "status" },
          { key: "tenantId.name", header: "Tenant" },
          { key: "userId.name", header: "Borrower" },
          { key: "updatedAt", header: "Updated", type: "date" }
        ]}
      />
    </>
  );
}
