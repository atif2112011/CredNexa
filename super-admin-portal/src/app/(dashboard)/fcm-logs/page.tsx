import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

import { FcmLogFilters } from "./fcm-log-filters";
import { FcmLogsTable } from "./fcm-logs-table";

type FcmLogsPageProps = {
  searchParams: Promise<{
    page?: string;
    status?: string;
    targetApp?: string;
    recipientType?: string;
    messageType?: string;
    from?: string;
    to?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  }>;
};

export default async function FcmLogsPage({ searchParams }: FcmLogsPageProps) {
  const params = await searchParams;
  const page = Math.max(Number(params.page) || 1, 1);
  const data = await getList("/admin/fcm-logs", {
    page,
    limit: 20,
    status: params.status,
    targetApp: params.targetApp,
    recipientType: params.recipientType,
    messageType: params.messageType,
    from: params.from,
    to: params.to,
    search: params.search,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder
  });

  return (
    <>
      <PageHeader
        title="FCM Logs"
        description="Inspect borrower, tenant, and partner app push delivery attempts."
        actions={<FcmLogFilters />}
      />

      <FcmLogsTable items={data.items} pagination={data.pagination} searchParams={params} />
    </>
  );
}
