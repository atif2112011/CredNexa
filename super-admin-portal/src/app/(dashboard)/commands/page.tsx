import { CommandFilters } from "@/components/commands/command-filters";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

type CommandsPageProps = {
  searchParams: Promise<{
    status?: string;
    commandType?: string;
    triggeredBy?: string;
    from?: string;
    to?: string;
  }>;
};

export default async function CommandsPage({ searchParams }: CommandsPageProps) {
  const filters = await searchParams;
  const data = await getList("/admin/commands", {
    status: filters.status,
    commandType: filters.commandType,
    triggeredBy: filters.triggeredBy,
    from: filters.from,
    to: filters.to,
    limit: 100
  });

  return (
    <>
      <PageHeader
        title="Commands Triggered"
        description="Track lock, unlock, temporary unlock, FCM delivery, and device acknowledgements."
        actions={<CommandFilters />}
      />
      <ResourceTable
        rows={data.items}
        columns={[
          { key: "commandType", header: "Command", type: "status" },
          { key: "status", header: "Status", type: "status" },
          { key: "triggeredBy", header: "Triggered By", type: "status" },
          { key: "tenantId.name", header: "Tenant", className: "max-w-48 truncate" },
          { key: "deviceId.imei", header: "IMEI", className: "max-w-40 truncate" },
          { key: "deviceId.state", header: "Device State", type: "status" },
          { key: "triggeredByAccountId.name", header: "Actor", className: "max-w-40 truncate" },
          { key: "sentAt", header: "Sent", type: "date" },
          { key: "acknowledgedAt", header: "Acknowledged", type: "date" },
          { key: "createdAt", header: "Created", type: "date" }
        ]}
      />
    </>
  );
}
