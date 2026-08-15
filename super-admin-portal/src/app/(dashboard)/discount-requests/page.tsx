import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

import { DiscountRequestFilters } from "./discount-request-filters";
import { DiscountRequestsTable } from "./discount-requests-table";

type DiscountRequestsPageProps = {
  searchParams: Promise<{
    page?: string;
    tenantId?: string;
    channelPartnerId?: string;
    status?: string;
    search?: string;
  }>;
};

export default async function DiscountRequestsPage({ searchParams }: DiscountRequestsPageProps) {
  const params = await searchParams;
  const page = Math.max(Number(params.page) || 1, 1);

  const [requests, tenants, partners] = await Promise.all([
    getList("/admin/tenant-credit-discount-changes", {
      page,
      limit: 20,
      tenantId: params.tenantId,
      channelPartnerId: params.channelPartnerId,
      status: params.status,
      search: params.search
    }),
    getList("/admin/tenants", { limit: 500 }),
    getList("/admin/channel-partners", { limit: 500 })
  ]);

  return (
    <>
      <PageHeader
        title="Discount Requests"
        description="Review partner requests to change tenant key-purchase discount slabs."
        actions={<DiscountRequestFilters tenants={tenants.items} partners={partners.items} />}
      />
      <DiscountRequestsTable items={requests.items} pagination={requests.pagination} searchParams={params} />
    </>
  );
}
