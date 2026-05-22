import { PublishConsentAction } from "@/components/actions/publish-consent-action";
import { DetailGrid } from "@/components/data/detail-grid";
import { ConsentTextPanel } from "@/components/data/visual-panels";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";

export default async function ConsentVersionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const consent = (await getDetail(`/admin/consent-versions/${id}`)) as RecordItem;

  return (
    <>
      <PageHeader title={`Consent ${String(consent.version || "")}`} description="Legal text, publish state, and current active marker." />
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
