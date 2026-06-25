import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

import { PayoutRequestFilters } from "./payout-request-filters";
import { PayoutRequestsTable } from "./payout-requests-table";

type PayoutRequestsPageProps = {
  searchParams: Promise<{
    page?: string;
    channelPartnerId?: string;
    status?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  }>;
};

export default async function PayoutRequestsPage({ searchParams }: PayoutRequestsPageProps) {
  const params = await searchParams;
  const page = Math.max(Number(params.page) || 1, 1);

  const [requests, partners] = await Promise.all([
    getList("/admin/partner-payouts", {
      page,
      limit: 20,
      channelPartnerId: params.channelPartnerId,
      status: params.status,
      search: params.search,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder
    }),
    getList("/admin/channel-partners", { limit: 500 })
  ]);

  return (
    <>
      <PageHeader
        title="Payout Requests"
        description="Review partner payout requests and approve verified payouts."
        actions={<PayoutRequestFilters partners={partners.items} />}
      />
      <PayoutRequestsTable items={requests.items} pagination={requests.pagination} searchParams={params} />
    </>
  );
}
