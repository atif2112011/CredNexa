import { RiskFlagAcknowledge } from "@/components/actions/risk-flag-acknowledge";
import { ResourceTable } from "@/components/data/resource-table";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getList } from "@/services/admin";

export default async function RiskFlagsPage() {
  const data = await getList("/admin/risk-flags");

  return (
    <>
      <PageHeader title="Risk Monitoring" description="Repeated SLA breaches, suspicious devices, and operational risk flags." />
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Acknowledge Risk</CardTitle></CardHeader>
          <CardContent><RiskFlagAcknowledge /></CardContent>
        </Card>
        <ResourceTable
          rows={data.items}
          columns={[
            { key: "_id", header: "Flag ID" },
            { key: "type", header: "Type" },
            { key: "severity", header: "Severity", type: "status" },
            { key: "status", header: "Status", type: "status" },
            { key: "message", header: "Message" },
            { key: "createdAt", header: "Created", type: "date" }
          ]}
        />
      </div>
    </>
  );
}
