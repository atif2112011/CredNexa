import { PageHeader } from "@/components/shell/page-header";
import { backendFetch } from "@/lib/backend";
import type { DevBorrowerList } from "@/types/dev-tools";
import { CreateTestBorrower } from "./create-test-borrower";
import { TestBorrowersTable } from "./test-borrowers-table";

export default async function DevToolsPage({ searchParams }: {
  searchParams: Promise<{ page?: string; limit?: string; search?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const limit = [20, 50, 100].includes(Number(params.limit)) ? Number(params.limit) : 20;
  const search = params.search || "";
  const data = await backendFetch<DevBorrowerList>("/admin/dev-tools/test-borrowers", { query: { page, limit, search } });
  return <>
    <PageHeader title="Dev Tools" description="Create test borrowers, display their enrollment QR, and inspect provisioned devices." />
    <div className="space-y-6">
      <CreateTestBorrower pageSize={limit} />
      <TestBorrowersTable data={data} search={search} />
    </div>
  </>;
}
