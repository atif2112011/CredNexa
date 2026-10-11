import { notFound } from "next/navigation";

import { DeleteConsentAction } from "@/components/actions/delete-consent-action";
import { PublishConsentAction } from "@/components/actions/publish-consent-action";
import { DetailGrid } from "@/components/data/detail-grid";
import { FormDialog } from "@/components/data/form-dialog";
import { ConsentTextPanel } from "@/components/data/visual-panels";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { consentFields } from "@/lib/forms";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

export default async function RunningConsentVersionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const consent = (await getDetail(`/admin/consent-versions/${id}`)) as RecordItem;
  if (consent.enrollmentMode !== "RUNNING_APP") notFound();
  const published = Boolean(consent.isCurrent || consent.publishedAt);
  const values = {
    version: consent.version,
    title: consent.title,
    borrowerAgreementText: consent.borrowerAgreementText,
    deviceControlConsentText: consent.deviceControlConsentText,
    privacyPolicyText: consent.privacyPolicyText,
    tripartiteAckText: consent.tripartiteAckText
  };

  return (
    <>
      <PageHeader
        title={`Running Consent ${String(consent.version || "")}`}
        description={published ? "Published consent is read-only. Duplicate it to make changes." : "Edit or delete this draft, or publish it when ready."}
        actions={
          <>
            {!published ? (
              <>
                <FormDialog title="Edit running consent" triggerLabel="Edit consent" endpoint={`/api/admin/consent-versions/${id}`} method="PATCH" fields={consentFields} defaultValues={values} fixedPayload={{ enrollmentMode: "RUNNING_APP" }} variant="outline" />
                <DeleteConsentAction consentId={id} returnPath="/running-consent-versions" />
              </>
            ) : null}
            <FormDialog title="Duplicate running consent" description="Enter a globally unique version, review the copied text, and save a draft." triggerLabel="Duplicate" endpoint="/api/admin/consent-versions" fields={consentFields} defaultValues={{ ...values, version: "" }} fixedPayload={{ enrollmentMode: "RUNNING_APP" }} variant={published ? "default" : "secondary"} />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <DetailGrid title="Consent Detail" data={consent} fields={[{ label: "Version", key: "version" }, { label: "Title", key: "title" }, { label: "Current", key: "isCurrent", type: "boolean" }, { label: "Published", key: "publishedAt", type: "date" }, { label: "Created", key: "createdAt", type: "date" }]} />
          <ConsentTextPanel consent={consent} />
        </div>
        {!published ? (
          <Card>
            <CardHeader><CardTitle>Publish Version</CardTitle></CardHeader>
            <CardContent><PublishConsentAction consentId={id} /></CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
