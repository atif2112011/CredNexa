import { PageHeader } from "@/components/shell/page-header";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

import { PayoutConstantsForm } from "./payout-constants-form";

export default async function PayoutConstantsPage() {
  const payoutConstants = await getDetail<RecordItem>("/admin/payout/constants");

  return (
    <>
      <PageHeader title="Payout Constants" description="Global payout and tenant credit purchase configuration." />
      <PayoutConstantsForm payoutConstants={payoutConstants} />
    </>
  );
}
