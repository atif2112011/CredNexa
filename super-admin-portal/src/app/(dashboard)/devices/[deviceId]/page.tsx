import { DetailGrid } from "@/components/data/detail-grid";
import { ResourceTable } from "@/components/data/resource-table";
import { ActivePolicyPanel, RiskFlagMetricsPanel } from "@/components/data/visual-panels";
import { DeviceOverridePanel } from "@/components/devices/device-override-panel";
import { DeviceReleasePanel } from "@/components/devices/device-release-panel";
import { DeviceRestrictionsPanel } from "@/components/devices/device-restrictions-panel";
import { DeviceSecurityControlsPanel } from "@/components/devices/device-security-controls-panel";
import { DeviceTelemetryPanel } from "@/components/devices/device-telemetry-panel";
import { DeviceTestingPanel } from "@/components/devices/device-testing-panel";
import { ManualOverrideTokenPanel } from "@/components/devices/manual-override-token-panel";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDetail } from "@/services/admin";
import type { RecordItem } from "@/types/api";
import { withDeviceLabels, type DeviceTestingAction } from "@/lib/device-provisioning";

export default async function DeviceDetailPage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const detail = await getDetail<RecordItem>(`/admin/devices/${deviceId}`);
  const commands = await getDetail<RecordItem[]>(`/admin/devices/${deviceId}/commands`);
  const auditLogs = await getDetail<RecordItem[]>(`/admin/devices/${deviceId}/audit-logs`);
  const device = withDeviceLabels(detail.device as RecordItem);
  const running = device.enrollmentMode === "RUNNING_APP";
  const manualOverrideTokens = running ? [] : await getDetail<RecordItem[]>(`/admin/devices/${deviceId}/manual-override-tokens`);
  const capabilities = (device.capabilities as RecordItem) || {};
  const capabilitiesFresh = Boolean(device.capabilitiesReceivedAt) && Date.now() - new Date(String(device.capabilitiesReceivedAt)).getTime() <= 24 * 60 * 60 * 1000;
  const riskFlags = (detail.riskFlags as RecordItem[]) || [];
  const emiSchedule = (detail.emiSchedule as RecordItem | null) || null;
  const release = (detail.release as RecordItem | null) || null;
  const releaseInProgressOrComplete = ["RELEASE_PENDING", "RELEASED"].includes(String(device.state || ""));

  return (
    <>
      <PageHeader title={String(device.imei || "Device")} description="Device state, borrower mapping, policy snapshot, command history, and audit trail." />
      <div className="space-y-6">
        <DetailGrid title="Device Detail" data={device} fields={[{ label: "IMEI", key: "imei" }, { label: "Provisioning", key: "provisioningLabel" }, { label: "Dealer Mode", key: "dealerModeLabel" }, { label: "Model", key: "deviceModel" }, { label: "Maker", key: "manufacturer" }, { label: "State", key: "state" }, { label: "Policy", key: "currentPolicyKey" }, { label: "Tenant", key: "tenantId.name" }, { label: "Borrower", key: "userId.name" }, { label: "Last Active", key: "lastSeenAt", type: "date" }]} />
        <DeviceReleasePanel deviceId={deviceId} schedule={emiSchedule} release={release} />
        <DeviceTestingPanel deviceId={deviceId} actions={(detail.testingActions as DeviceTestingAction[]) || []} running={running} />
        {running ? <Card>
          <CardHeader><CardTitle>Running App Permission Health</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Lock controls use the app overlay. Command acknowledgement confirms the reported result.</p>
            <p>Overlay: {capabilities.overlayAllowed === true ? "Allowed" : "Missing"} · Notifications: {capabilities.notificationsAllowed === true ? "Allowed" : "Missing"}</p>
            <p>Location: {String(capabilities.locationGrant || "Not granted")} · Location consent: {device.locationConsentAccepted ? "Accepted" : "Missing"}</p>
            <p>Permission report: {capabilitiesFresh ? "Current" : "Stale or missing"}</p>
          </CardContent>
        </Card> : null}
        <DeviceTelemetryPanel device={device} commands={(commands as RecordItem[]) || []} />
        {!releaseInProgressOrComplete ? (
          <>
            {!running ? <>
            <DeviceRestrictionsPanel device={device} commands={(commands as RecordItem[]) || []} />
            <DeviceSecurityControlsPanel
              device={device}
              latestCommands={(detail.latestSecurityControlCommands as RecordItem) || {}}
            />
            <ManualOverrideTokenPanel deviceId={deviceId} initialTokens={manualOverrideTokens || []} />
            </> : null}
            <DeviceOverridePanel device={device} riskFlags={riskFlags} />
          </>
        ) : null}
        <div className="grid gap-6 xl:grid-cols-2">
          <ActivePolicyPanel policy={detail.policy} running={running} />
          <RiskFlagMetricsPanel flags={riskFlags} />
        </div>
        <Card>
          <CardHeader><CardTitle>Command History</CardTitle></CardHeader>
          <CardContent><ResourceTable rows={(commands as RecordItem[]) || []} columns={[{ key: "commandType", header: "Command" }, { key: "status", header: "Status", type: "status" }, { key: "triggeredBy", header: "Triggered By" }, { key: "createdAt", header: "Created", type: "date" }]} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Audit Trail</CardTitle></CardHeader>
          <CardContent><ResourceTable rows={(auditLogs as RecordItem[]) || []} columns={[{ key: "eventType", header: "Event" }, { key: "actorId", header: "Actor" }, { key: "reason", header: "Reason" }, { key: "timestamp", header: "Time", type: "date" }]} /></CardContent>
        </Card>
      </div>
    </>
  );
}
