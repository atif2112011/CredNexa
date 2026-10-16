import { tableQuery, type TableSearchParams } from "@/lib/table-query";
import { CommandFilters } from "@/components/commands/command-filters";
import { CommandsTable } from "@/components/commands/commands-table";
import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

type CommandsPageProps = {
  searchParams: Promise<TableSearchParams>;
};

export default async function CommandsPage({ searchParams }: CommandsPageProps) {
  const filters = await searchParams;
  const data = await getList("/admin/commands", {
    status: filters.status,
    commandType: filters.commandType,
    triggeredBy: filters.triggeredBy,
    from: filters.from,
    to: filters.to,
    ...tableQuery(filters)
  });

  return (
    <>
      <PageHeader
        title="Commands Triggered"
        description="Track device commands and select any row to view its delivery and acknowledgement details."
        actions={<CommandFilters />}
      />
      <CommandsTable rows={data.items} pagination={data.pagination} />
    </>
  );
}
