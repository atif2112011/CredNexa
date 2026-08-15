"use client";

import { Camera, Loader2, Phone, RefreshCw, ShieldBan, ShoppingBag, Youtube } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import type { ApiResponse, RecordItem } from "@/types/api";

const restrictionOptions = [
  { key: "dialer", label: "Dialer", description: "Suspend the device's active dialer app.", icon: Phone },
  { key: "camera", label: "Camera", description: "Disable camera access through DevicePolicyManager.", icon: Camera },
  { key: "whatsapp", label: "WhatsApp", description: "Suspend the standard WhatsApp application.", icon: ShieldBan },
  { key: "youtube", label: "YouTube", description: "Suspend the standard YouTube application.", icon: Youtube },
  { key: "playStore", label: "Play Store", description: "Suspend the Google Play Store application.", icon: ShoppingBag }
] as const;

type RestrictionKey = (typeof restrictionOptions)[number]["key"];
type RestrictionValues = Record<RestrictionKey, boolean>;

const disabledRestrictionKeys = new Set<RestrictionKey>(["camera", "playStore"]);

type RestrictionState = {
  desired: RestrictionValues;
  applied: RestrictionValues;
  desiredVersion: number;
  appliedVersion: number;
  updatedAt?: string | null;
  appliedAt?: string | null;
};

type RestrictionUpdateResult = {
  restrictionState?: unknown;
  command?: RecordItem;
};

const unlockedValues = (): RestrictionValues => ({
  dialer: false,
  camera: false,
  whatsapp: false,
  youtube: false,
  playStore: false
});

function asRecord(value: unknown): RecordItem {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordItem)
    : {};
}

function normalizeValues(value: unknown): RestrictionValues {
  const record = asRecord(value);
  return restrictionOptions.reduce<RestrictionValues>((result, option) => {
    result[option.key] = Boolean(record[option.key]);
    return result;
  }, unlockedValues());
}

function normalizeState(value: unknown): RestrictionState {
  const record = asRecord(value);
  return {
    desired: normalizeValues(record.desired),
    applied: normalizeValues(record.applied),
    desiredVersion: Math.max(Number(record.desiredVersion || 0), 0),
    appliedVersion: Math.max(Number(record.appliedVersion || 0), 0),
    updatedAt: record.updatedAt ? String(record.updatedAt) : null,
    appliedAt: record.appliedAt ? String(record.appliedAt) : null
  };
}

function findLatestRestrictionCommand(commands: RecordItem[]) {
  return commands.find((command) => command.commandType === "RESTRICTIONS_UPDATE") || null;
}

export function DeviceRestrictionsPanel({
  device,
  commands
}: {
  device: RecordItem;
  commands: RecordItem[];
}) {
  const router = useRouter();
  const deviceId = String(device._id || device.id || "");
  const incomingState = useMemo(() => normalizeState(device.restrictionState), [device.restrictionState]);
  const incomingCommand = useMemo(() => findLatestRestrictionCommand(commands), [commands]);
  const [restrictionState, setRestrictionState] = useState(incomingState);
  const [latestCommand, setLatestCommand] = useState<RecordItem | null>(incomingCommand);
  const [updatingKey, setUpdatingKey] = useState<RestrictionKey | null>(null);
  const hasPendingApplication = restrictionState.desiredVersion > restrictionState.appliedVersion;
  const latestStatus = String(latestCommand?.status || (hasPendingApplication ? "pending" : "acknowledged"));
  const retryableMismatch = restrictionOptions.find(
    ({ key }) =>
      !disabledRestrictionKeys.has(key) &&
      restrictionState.desired[key] !== restrictionState.applied[key]
  );
  const canRetry = Boolean(retryableMismatch) && ["failed", "expired"].includes(latestStatus.toLowerCase());

  useEffect(() => {
    setRestrictionState(incomingState);
    setLatestCommand(incomingCommand);
  }, [incomingCommand, incomingState]);

  async function updateRestriction(key: RestrictionKey, locked: boolean, retry = false) {
    const previousState = restrictionState;
    if (!retry) {
      setRestrictionState((current) => ({
        ...current,
        desired: { ...current.desired, [key]: locked }
      }));
    }
    setUpdatingKey(key);

    const response = await fetch(`/api/admin/devices/${deviceId}/restrictions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restriction: key, locked, retry })
    });
    const result = (await response.json().catch(() => null)) as ApiResponse<RestrictionUpdateResult> | null;
    setUpdatingKey(null);

    if (!response.ok || !result?.success || !result.data?.restrictionState) {
      setRestrictionState(previousState);
      toast.error(result?.error || "Unable to update device restriction");
      return;
    }

    setRestrictionState(normalizeState(result.data.restrictionState));
    setLatestCommand(result.data.command || null);
    toast.success(retry ? "Restriction command requeued" : `${restrictionOptions.find((item) => item.key === key)?.label} restriction queued`);
    router.refresh();
  }

  function retryLatest() {
    if (!retryableMismatch) return;
    updateRestriction(
      retryableMismatch.key,
      restrictionState.desired[retryableMismatch.key],
      true
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Per-device Restrictions</CardTitle>
            <CardDescription className="mt-1">
              Each switch immediately queues a persistent Device Owner restriction.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge value={latestStatus} />
            {canRetry ? (
              <Button type="button" variant="outline" size="sm" onClick={retryLatest} disabled={Boolean(updatingKey)}>
                <RefreshCw aria-hidden="true" />
                Retry
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {canRetry ? (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p className="font-medium">The device did not apply the latest restriction state.</p>
            <p className="mt-0.5 text-xs">
              {String(latestCommand?.failureReason || "The command failed or expired before acknowledgement.")}
            </p>
          </div>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-2">
          {restrictionOptions.map(({ key, label, description, icon: Icon }) => {
            const desiredLocked = restrictionState.desired[key];
            const appliedLocked = restrictionState.applied[key];
            const isUpdating = updatingKey === key;
            const isWaiting = desiredLocked !== appliedLocked;
            const isDisabled = disabledRestrictionKeys.has(key);

            return (
              <div
                key={key}
                aria-disabled={isDisabled}
                className={cn(
                  "flex items-center justify-between gap-4 rounded-xl border bg-muted/20 p-4",
                  isDisabled && "cursor-not-allowed bg-muted/50 text-muted-foreground opacity-60 grayscale"
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", isDisabled ? "bg-muted text-muted-foreground" : desiredLocked ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
                    <Icon className="size-4" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{label}</p>
                      {isDisabled ? <span className="text-xs font-medium text-muted-foreground">Unavailable</span> : null}
                      {isWaiting ? <span className="text-xs font-medium text-amber-700">Awaiting device</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Applied: {appliedLocked ? "Locked" : "Allowed"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={desiredLocked}
                  aria-label={`${desiredLocked ? "Allow" : "Lock"} ${label}`}
                  disabled={isDisabled || Boolean(updatingKey)}
                  onClick={() => updateRestriction(key, !desiredLocked)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                    desiredLocked ? "bg-destructive" : "bg-input"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full bg-background shadow-sm transition-transform",
                      desiredLocked ? "translate-x-[22px]" : "translate-x-0.5"
                    )}
                  >
                    {isUpdating ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid gap-3 rounded-xl border bg-muted/20 p-4 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <span className="font-semibold text-foreground">Desired version</span>
            <p className="mt-1">{restrictionState.desiredVersion}</p>
          </div>
          <div>
            <span className="font-semibold text-foreground">Applied version</span>
            <p className="mt-1">{restrictionState.appliedVersion}</p>
          </div>
          <div>
            <span className="font-semibold text-foreground">Last applied</span>
            <p className="mt-1">{formatDate(restrictionState.appliedAt)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
