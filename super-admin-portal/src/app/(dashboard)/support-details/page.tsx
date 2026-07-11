import { PageHeader } from "@/components/shell/page-header";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

import { SupportDetailsForm } from "./support-details-form";

export default async function SupportDetailsPage() {
  const supportDetails = await getDetail<RecordItem>("/admin/support-contact");

  return (
    <>
      <PageHeader title="Support Details" description="Company support contact details shown in the borrower app." />
      <SupportDetailsForm supportDetails={supportDetails} />
    </>
  );
}
