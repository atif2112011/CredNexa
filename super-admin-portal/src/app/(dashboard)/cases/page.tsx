import { tableQuery, type TableSearchParams } from "@/lib/table-query";
import { CaseFilter } from "@/components/cases/case-filter";
import { CasesTable } from "@/components/cases/cases-table";
import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

type CasesPageProps = {
  searchParams: Promise<TableSearchParams>;
};

const filterLabels: Record<string, string> = {
  all: "All temporary unlock requests",
  ESCALATED_PARTNER: "Requests escalated to partners",
  ESCALATED_ADMIN: "Requests escalated to admin"
};

export default async function CasesPage({ searchParams }: CasesPageProps) {
  const params = await searchParams;
  const status = params.status || "all";
  const data = await getList("/admin/escalations", { ...params, ...tableQuery(params), status });

  return (
    <>
      <PageHeader
        title="Temp Unlock Requests"
        description={filterLabels[status] || "All temporary unlock requests"}
        actions={<CaseFilter />}
      />
      <CasesTable rows={data.items} pagination={data.pagination} />
    </>
  );
}
