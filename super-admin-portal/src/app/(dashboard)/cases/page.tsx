import { CaseFilter } from "@/components/cases/case-filter";
import { CasesTable } from "@/components/cases/cases-table";
import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

type CasesPageProps = {
  searchParams: Promise<{ status?: string }>;
};

const filterLabels: Record<string, string> = {
  all: "All cases",
  ESCALATED_PARTNER: "Cases escalated to partners",
  ESCALATED_ADMIN: "Cases escalated to admin"
};

export default async function CasesPage({ searchParams }: CasesPageProps) {
  const { status = "all" } = await searchParams;
  const data = await getList("/admin/escalations", { status, limit: 100 });

  return (
    <>
      <PageHeader
        title="Cases"
        description={filterLabels[status] || "All cases"}
        actions={<CaseFilter />}
      />
      <CasesTable rows={data.items} />
    </>
  );
}
