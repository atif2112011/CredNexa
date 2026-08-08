"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";

import { DataTable } from "@/components/data/data-table";
import { StatusBadge } from "@/components/data/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { formatDate, getNestedValue } from "@/lib/utils";
import type { RecordItem } from "@/types/api";

const commandDescriptions: Record<string, string> = {
  LOCK: "Locks the managed device and applies the configured lock policy.",
  UNLOCK: "Removes the device lock and restores normal managed-device access.",
  TEMP_UNLOCK: "Temporarily unlocks the device for the duration included in the command.",
  POLICY_UPDATE: "Applies the latest device policy and target state.",
  UPCOMING_PAYMENT: "Notifies the borrower app about an upcoming payment.",
  NOTIFICATION: "Displays the supplied notification to the borrower.",
  RUN_INTEGRITY_CHECK: "Requests an immediate device integrity assessment.",
  SHOW_REMEDIATION: "Opens or displays remediation guidance in the borrower app.",
  INSTALL_UPDATE: "Requests installation of the specified borrower-app update.",
  WIPE_DEVICE: "Requests the managed device wipe workflow.",
  REPROVISION_REQUIRED: "Tells the borrower app that device-owner reprovisioning is required.",
  RESTRICTIONS_UPDATE: "Applies the per-device app and feature restrictions in the command payload.",
  GET_LOCATION: "Requests one fresh device location fix. It does not enable continuous tracking.",
  RELEASE_DEVICE: "Permanently releases the device from management after the app completes Device Owner release.",
  EMI_REMINDER: "Sends an EMI payment reminder to the borrower app."
};

const securityControlNames: Record<string, string> = {
  SET_FACTORY_RESET_BLOCKED: "factory reset from Android Settings",
  SET_USB_DEBUGGING_BLOCKED: "USB debugging features",
  SET_UNKNOWN_APP_INSTALL_BLOCKED: "installation of apps from unknown sources"
};

const columns: ColumnDef<RecordItem>[] = [
  {
    accessorKey: "commandType",
    header: "Command",
    cell: ({ row }) => <StatusBadge value={row.original.commandType} />
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge value={row.original.status} />
  },
  {
    accessorKey: "triggeredBy",
    header: "Triggered By",
    cell: ({ row }) => <StatusBadge value={row.original.triggeredBy} />
  },
  {
    accessorKey: "tenantId.name",
    header: "Tenant",
    cell: ({ row }) => <div className="max-w-48 truncate">{textValue(getNestedValue(row.original, "tenantId.name"))}</div>
  },
  {
    accessorKey: "deviceId.imei",
    header: "IMEI",
    cell: ({ row }) => <div className="max-w-40 truncate">{textValue(getNestedValue(row.original, "deviceId.imei"))}</div>
  },
  {
    accessorKey: "deviceId.state",
    header: "Device State",
    cell: ({ row }) => <StatusBadge value={getNestedValue(row.original, "deviceId.state")} />
  },
  {
    accessorKey: "triggeredByAccountId.name",
    header: "Actor",
    cell: ({ row }) => <div className="max-w-40 truncate">{textValue(getNestedValue(row.original, "triggeredByAccountId.name"))}</div>
  },
  {
    accessorKey: "sentAt",
    header: "Sent",
    cell: ({ row }) => formatDateValue(row.original.sentAt)
  },
  {
    accessorKey: "acknowledgedAt",
    header: "Acknowledged",
    cell: ({ row }) => formatDateValue(row.original.acknowledgedAt)
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => formatDateValue(row.original.createdAt)
  }
];

function textValue(value: unknown) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function formatDateValue(value: unknown) {
  return formatDate(typeof value === "string" ? value : null);
}

function asRecord(value: unknown): RecordItem {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordItem
    : {};
}

function hasDetails(value: RecordItem) {
  return Object.keys(value).length > 0;
}

function commandDescription(command: RecordItem) {
  const commandType = String(command.commandType || "");
  const controlName = securityControlNames[commandType];
  if (controlName) {
    const payload = asRecord(command.payload);
    const blocked = payload.blocked === true || payload.blocked === "true";
    return blocked
      ? `Blocks ${controlName} on the managed device.`
      : `Allows ${controlName} on the managed device.`;
  }

  return commandDescriptions[commandType] || "Sends a managed-device instruction using the command payload shown below.";
}

function DetailItem({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium">{textValue(value)}</dd>
    </div>
  );
}

function JsonDetails({ title, value }: { title: string; value: RecordItem }) {
  if (!hasDetails(value)) return null;

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

export function CommandsTable({ rows }: { rows: RecordItem[] }) {
  const [selectedCommand, setSelectedCommand] = useState<RecordItem | null>(null);
  const device = asRecord(selectedCommand?.deviceId);
  const tenant = asRecord(selectedCommand?.tenantId);
  const actor = asRecord(selectedCommand?.triggeredByAccountId);
  const payload = asRecord(selectedCommand?.payload);
  const acknowledgement = asRecord(selectedCommand?.ackPayload);

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        searchPlaceholder="Search commands..."
        onRowClick={setSelectedCommand}
      />

      <Dialog open={Boolean(selectedCommand)} onOpenChange={(open) => !open && setSelectedCommand(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {selectedCommand ? (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2 pr-8">
                  <DialogTitle>Command details</DialogTitle>
                  <StatusBadge value={selectedCommand.commandType} />
                  <StatusBadge value={selectedCommand.status} />
                </div>
                <DialogDescription>{commandDescription(selectedCommand)}</DialogDescription>
              </DialogHeader>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Command lifecycle</h3>
                <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailItem label="Created" value={formatDateValue(selectedCommand.createdAt)} />
                  <DetailItem label="Sent" value={formatDateValue(selectedCommand.sentAt)} />
                  <DetailItem label="Acknowledged" value={formatDateValue(selectedCommand.acknowledgedAt)} />
                  <DetailItem label="Expires" value={formatDateValue(selectedCommand.expiresAt)} />
                </dl>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Context</h3>
                <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailItem label="Command ID" value={selectedCommand._id || selectedCommand.id} />
                  <DetailItem label="Tenant" value={tenant.name} />
                  <DetailItem label="IMEI" value={device.imei} />
                  <DetailItem label="Device" value={[device.manufacturer, device.deviceModel].filter(Boolean).join(" ") || "-"} />
                  <DetailItem label="Device state" value={device.state} />
                  <DetailItem label="Triggered by" value={selectedCommand.triggeredBy} />
                  <DetailItem label="Actor" value={actor.name} />
                  <DetailItem label="Actor email" value={actor.email} />
                  <DetailItem label="Actor role" value={actor.role} />
                </dl>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Delivery and retries</h3>
                <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailItem label="FCM message ID" value={selectedCommand.fcmMessageId} />
                  <DetailItem label="Retry count" value={selectedCommand.retryCount ?? 0} />
                  <DetailItem label="Maximum retries" value={selectedCommand.maxRetries ?? 0} />
                  <DetailItem label="Next retry" value={formatDateValue(selectedCommand.nextRetryAt)} />
                  <DetailItem label="Failure source" value={selectedCommand.failureSource} />
                  <DetailItem label="Failure reason" value={selectedCommand.failureReason} />
                </dl>
              </section>

              <JsonDetails title="Command payload" value={payload} />
              <JsonDetails title="Device acknowledgement" value={acknowledgement} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
