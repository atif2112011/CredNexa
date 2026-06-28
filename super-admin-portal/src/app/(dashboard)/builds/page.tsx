import { PageHeader } from "@/components/shell/page-header";
import { getList } from "@/services/admin";

import { BuildsTable } from "./builds-table";

type BuildsPageProps = {
  searchParams: Promise<{
    page?: string;
    channel?: string;
    status?: string;
  }>;
};

export default async function BuildsPage({ searchParams }: BuildsPageProps) {
  const params = await searchParams;
  const page = Math.max(Number(params.page) || 1, 1);
  const channel = params.channel && ["production", "qa"].includes(params.channel) ? params.channel : "all";
  const status = params.status && ["draft", "published", "archived"].includes(params.status) ? params.status : "all";
  const data = await getList("/admin/app-builds", {
    page,
    limit: 20,
    ...(channel !== "all" ? { channel } : {}),
    ...(status !== "all" ? { status } : {})
  });

  return (
    <>
      <PageHeader title="Builds" description="Upload Android APK builds and inspect uploaded build metadata." />
      <BuildsTable items={data.items} pagination={data.pagination} selectedChannel={channel} selectedStatus={status} />
    </>
  );
}
