import type { RecordItem } from "@/types/api";

export function withDeviceLabels(device: RecordItem): RecordItem {
  return {
    ...device,
    provisioningLabel: device.enrollmentMode === "RUNNING_APP" ? "Running provisioned" : "QR provisioned",
    dealerModeLabel: device.deviceControlMode === "MANUAL" ? "Manual" : "Automatic"
  };
}

export type DeviceTestingAction = {
  action: string;
  label: string;
  description: string;
  group: string;
  enabled: boolean;
  reason?: string | null;
  destructive?: boolean;
};
