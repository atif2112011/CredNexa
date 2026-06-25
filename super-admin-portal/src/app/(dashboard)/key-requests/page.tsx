import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

import { KeyRequestFilters } from "./key-request-filters";
import { KeyRequestsTable } from "./key-requests-table";

type KeyRequestsPageProps = {
  searchParams: Promise<{
    page?: string;
    tenantId?: string;
    channelPartnerId?: string;
    status?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  }>;
};

export default async function KeyRequestsPage({ searchParams }: KeyRequestsPageProps) {
  const params = await searchParams;
  const page = Math.max(Number(params.page) || 1, 1);

  const [requests, tenants, partners] = await Promise.all([
    getList("/admin/tenant-credit-purchases", {
      page,
      limit: 20,
      tenantId: params.tenantId,
      channelPartnerId: params.channelPartnerId,
      status: params.status,
      search: params.search,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder
    }),
    getList("/admin/tenants", { limit: 500 }),
    getList("/admin/channel-partners", { limit: 500 })
  ]);

  return (
    <>
      <PageHeader
        title="Key Requests"
        description="Review tenant key purchase requests and approve verified credit purchases."
        actions={<KeyRequestFilters tenants={tenants.items} partners={partners.items} />}
      />
      <KeyRequestsTable items={requests.items} pagination={requests.pagination} searchParams={params} />
    </>
  );
}
