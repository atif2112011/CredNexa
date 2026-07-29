"use client";

import { Bug, Loader2, PackageX, RefreshCw, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import type { ApiResponse, RecordItem } from "@/types/api";

const controlOptions = [
  {
    key: "factoryReset",
    path: "factory-reset",
    label: "Factory reset",
    description: "Block user-initiated factory reset from Android Settings.",
    icon: RotateCcw
  },
  {
    key: "usbDebugging",
    path: "usb-debugging",
    label: "USB debugging",
    description: "Block access to Android debugging features and ADB.",
    icon: Bug
  },
  {
    key: "unknownAppInstalls",
    path: "unknown-app-installs",
    label: "Unknown app installs",
    description: "Block future APK installations from unknown sources.",
    icon: PackageX
  }
] as const;

type ControlKey = (typeof controlOptions)[number]["key"];
type ControlEntry = {
  desiredBlocked: boolean;
  appliedBlocked: boolean;
  desiredVersion: number;
  appliedVersion: number;
  updatedAt?: string | null;
  appliedAt?: string | null;
};
type SecurityControlState = Record<ControlKey, ControlEntry>;

const emptyEntry = (): ControlEntry => ({
  desiredBlocked: false,
  appliedBlocked: false,
  desiredVersion: 0,
  appliedVersion: 0,
  updatedAt: null,
  appliedAt: null
});

function asRecord(value: unknown): RecordItem {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordItem)
    : {};
}

function normalizeEntry(value: unknown): ControlEntry {
  const record = asRecord(value);
  return {
    desiredBlocked: Boolean(record.desiredBlocked),
    appliedBlocked: Boolean(record.appliedBlocked),
    desiredVersion: Math.max(Number(record.desiredVersion || 0), 0),
    appliedVersion: Math.max(Number(record.appliedVersion || 0), 0),
    updatedAt: record.updatedAt ? String(record.updatedAt) : null,
    appliedAt: record.appliedAt ? String(record.appliedAt) : null
  };
}

function normalizeState(value: unknown): SecurityControlState {
  const record = asRecord(value);
  return controlOptions.reduce<SecurityControlState>((result, option) => {
    result[option.key] = normalizeEntry(record[option.key]);
    return result;
  }, {
    factoryReset: emptyEntry(),
    usbDebugging: emptyEntry(),
    unknownAppInstalls: emptyEntry()
  });
}

export function DeviceSecurityControlsPanel({
  device,
  latestCommands
}: {
  device: RecordItem;
  latestCommands?: RecordItem;
}) {
  const router = useRouter();
  const deviceId = String(device._id || device.id || "");
  const incomingState = useMemo(
    () => normalizeState(device.securityControlState),
    [device.securityControlState]
  );
  const incomingCommands = useMemo(() => asRecord(latestCommands), [latestCommands]);
  const [controlState, setControlState] = useState(incomingState);
  const [commands, setCommands] = useState(incomingCommands);
  const [updatingKey, setUpdatingKey] = useState<ControlKey | null>(null);
  const released = ["RELEASE_PENDING", "RELEASED"].includes(String(device.state || ""));

  useEffect(() => {
    setControlState(incomingState);
    setCommands(incomingCommands);
  }, [incomingCommands, incomingState]);

  async function updateControl(key: ControlKey, blocked: boolean, retry = false) {
    const option = controlOptions.find((item) => item.key === key);
    if (!option) return;

    const previousState = controlState;
    if (!retry) {
      setControlState((current) => ({
        ...current,
        [key]: { ...current[key], desiredBlocked: blocked }
      }));
    }
    setUpdatingKey(key);

    const response = await fetch(`/api/admin/devices/${deviceId}/controls/${option.path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocked, retry })
    });
    const result = (await response.json().catch(() => null)) as ApiResponse<{
      securityControlState?: unknown;
      command?: RecordItem;
    }> | null;
    setUpdatingKey(null);

    if (!response.ok || !result?.success || !result.data?.securityControlState) {
      setControlState(previousState);
      toast.error(result?.error || "Unable to update device security control");
      return;
    }

    setControlState(normalizeState(result.data.securityControlState));
    setCommands((current) => ({ ...current, [key]: result.data?.command || null }));
    toast.success(retry ? `${option.label} command requeued` : `${option.label} control queued`);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Device Security Controls</CardTitle>
        <CardDescription>
          Persistent Device Owner controls remain active across lock and unlock policy changes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-3">
          {controlOptions.map(({ key, label, description, icon: Icon }) => {
            const entry = controlState[key];
            const command = asRecord(commands[key]);
            const waiting = entry.desiredVersion > entry.appliedVersion;
            const status = String(command.status || (waiting ? "pending" : "acknowledged"));
            const canRetry = waiting && ["failed", "expired"].includes(status.toLowerCase());
            const isUpdating = updatingKey === key;

            return (
              <div key={key} className="flex flex-col rounded-xl border bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg",
                      entry.desiredBlocked ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                    )}>
                      <Icon className="size-4" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="font-semibold">{label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={entry.desiredBlocked}
                    aria-label={`${entry.desiredBlocked ? "Allow" : "Block"} ${label}`}
                    disabled={released || Boolean(updatingKey)}
                    onClick={() => updateControl(key, !entry.desiredBlocked)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                      entry.desiredBlocked ? "bg-destructive" : "bg-input"
                    )}
                  >
                    <span className={cn(
                      "flex size-5 items-center justify-center rounded-full bg-background shadow-sm transition-transform",
                      entry.desiredBlocked ? "translate-x-[22px]" : "translate-x-0.5"
                    )}>
                      {isUpdating ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
                    </span>
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <StatusBadge value={status} />
                  {waiting ? <span className="font-medium text-amber-700">Awaiting device</span> : null}
                  <span className="text-muted-foreground">
                    Applied: {entry.appliedBlocked ? "Blocked" : "Allowed"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>Desired v{entry.desiredVersion}</span>
                  <span>Applied v{entry.appliedVersion}</span>
                  <span className="col-span-2">Last applied: {formatDate(entry.appliedAt)}</span>
                </div>

                {canRetry ? (
                  <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                    <p>{String(command.failureReason || "The device did not apply this control.")}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      disabled={Boolean(updatingKey)}
                      onClick={() => updateControl(key, entry.desiredBlocked, true)}
                    >
                      <RefreshCw aria-hidden="true" />
                      Retry
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

