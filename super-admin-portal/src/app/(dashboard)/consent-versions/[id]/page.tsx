import { PublishConsentAction } from "@/components/actions/publish-consent-action";
import { DetailGrid } from "@/components/data/detail-grid";
import { FormDialog } from "@/components/data/form-dialog";
import { ConsentTextPanel } from "@/components/data/visual-panels";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { consentFields } from "@/lib/forms";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

export default async function ConsentVersionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const consent = (await getDetail(`/admin/consent-versions/${id}`)) as RecordItem;
  const published = Boolean(consent.isCurrent || consent.publishedAt);
  const consentFormValues = {
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
        title={`Consent ${String(consent.version || "")}`}
        description={published ? "Published consent versions are read-only. Duplicate this version to make changes." : "Edit this draft or publish it when the legal text is ready."}
        actions={
          <>
            {!published ? (
              <FormDialog
                title="Edit consent version"
                triggerLabel="Edit consent"
                endpoint={`/api/admin/consent-versions/${id}`}
                method="PATCH"
                fields={consentFields}
                defaultValues={consentFormValues}
                variant="outline"
              />
            ) : null}
            <FormDialog
              title="Duplicate consent version"
              description="Enter a new version number, review the copied text, and save it as a draft."
              triggerLabel="Duplicate"
              endpoint="/api/admin/consent-versions"
              fields={consentFields}
              defaultValues={{ ...consentFormValues, version: "" }}
              variant={published ? "default" : "secondary"}
            />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <DetailGrid title="Consent Detail" data={consent} fields={[{ label: "Version", key: "version" }, { label: "Title", key: "title" }, { label: "Current", key: "isCurrent", type: "boolean" }, { label: "Published", key: "publishedAt", type: "date" }, { label: "Created", key: "createdAt", type: "date" }]} />
          <ConsentTextPanel consent={consent} />
        </div>
        <Card>
          <CardHeader><CardTitle>Publish Version</CardTitle></CardHeader>
          <CardContent><PublishConsentAction consentId={id} /></CardContent>
        </Card>
      </div>
    </>
  );
}
