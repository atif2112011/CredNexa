"use client";

import { ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { ApiResponse, RecordItem } from "@/types/api";

export function DeviceReleasePanel({
  deviceId,
  schedule,
  release
}: {
  deviceId: string;
  schedule?: RecordItem | null;
  release?: RecordItem | null;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const latestCommand = (release?.latestCommand as RecordItem | null) || null;
  const latestStatus = String(latestCommand?.status || "");
  const settled = Boolean(release?.settled);
  const released = String(release?.deviceState || "") === "RELEASED";
  const pending = ["pending", "sent"].includes(latestStatus.toLowerCase());
  const retry = ["failed", "expired"].includes(latestStatus.toLowerCase());
  const showAction = settled && !released;
  const canQueue = Boolean(release?.canQueue);
  const buttonLabel = pending
    ? "Release pending"
    : retry
      ? "Retry Release"
      : "Release Device";

  async function queueRelease() {
    setIsSubmitting(true);
    const response = await fetch(`/api/admin/devices/${deviceId}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const result = (await response.json().catch(() => null)) as ApiResponse<RecordItem> | null;
    setIsSubmitting(false);

    if (!response.ok || !result?.success) {
      toast.error(result?.error || result?.message || "Unable to queue device release");
      return;
    }

    toast.success(retry ? "Device release requeued" : "Device release queued");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>EMI Settlement & Device Release</CardTitle>
            <CardDescription className="mt-1">
              Permanent device release is available only after every installment is paid or waived.
            </CardDescription>
          </div>
          <StatusBadge value={released ? "RELEASED" : String(release?.deviceState || schedule?.status || "active")} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Schedule</p>
            <p className="mt-1 font-medium">{String(schedule?.status || "active")}</p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Installments</p>
            <p className="mt-1 font-medium">
              {Number(release?.completedInstallments || 0)} / {Number(release?.totalInstallments || 0)} completed
            </p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Settled at</p>
            <p className="mt-1 font-medium">{formatDate(schedule?.settlementTime as string | undefined)}</p>
          </div>
        </div>
        {showAction ? (
          <Button type="button" onClick={queueRelease} disabled={!canQueue || isSubmitting}>
            <ShieldOff aria-hidden="true" />
            {isSubmitting ? "Queueing..." : buttonLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
