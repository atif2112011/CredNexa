"use client";

import { LockKeyhole, ShieldCheck, TimerReset } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import type { RecordItem } from "@/types/api";

const actions = [
  { label: "Manual lock", value: "lock", icon: LockKeyhole },
  { label: "Temp unlock", value: "temp-unlock", icon: TimerReset },
  { label: "Full unlock", value: "unlock-waive", icon: ShieldCheck }
];

const emiActions = [
  { label: "All pending paid", value: "mark_paid" },
  { label: "All pending waived", value: "waive" }
];

const durationOptions = [
  { label: "6 hours", value: "6" },
  { label: "12 hours", value: "12" },
  { label: "24 hours", value: "24" },
  { label: "48 hours", value: "48" },
  { label: "60 hours", value: "60" },
  { label: "72 hours", value: "72" },
  { label: "7 days", value: "168" }
];

export function DeviceOverridePanel({ device }: { device: RecordItem }) {
  const router = useRouter();
  const [action, setAction] = useState("temp-unlock");
  const [emiAction, setEmiAction] = useState("mark_paid");
  const [durationHours, setDurationHours] = useState("60");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const deviceId = String(device._id || device.id || "");
  const selectedAction = actions.find((item) => item.value === action) || actions[0];
  const Icon = selectedAction.icon;

  async function submit() {
    if (!reason.trim()) {
      toast.error("Reason is required");
      return;
    }

    const endpoint = `/api/admin/devices/${deviceId}/${action}`;
    const payload =
      action === "temp-unlock"
        ? { reason, durationHours: Number(durationHours) }
        : action === "unlock-waive"
          ? { reason, emiAction }
          : { reason };

    setIsSubmitting(true);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setIsSubmitting(false);

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(result?.error || "Unable to queue override");
      return;
    }

    toast.success("Device override queued");
    setReason("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Override State</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Current state</p>
              <p className="mt-1 text-xl font-semibold">{String(device.state || "-")}</p>
            </div>
            <StatusBadge value={device.state} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Policy</p>
              <p className="mt-1 text-sm font-medium">{String(device.currentPolicyKey || "-")}</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Temp unlock expires</p>
              <p className="mt-1 text-sm font-medium">{device.tempUnlockExpiresAt ? formatDate(device.tempUnlockExpiresAt as string) : "Not active"}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold">Queue device override</p>
              <p className="text-sm text-muted-foreground">Full unlock requires marking all pending EMIs paid or waived.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="device-override-action">Action</Label>
              <select
                id="device-override-action"
                value={action}
                onChange={(event) => setAction(event.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {actions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            {action === "temp-unlock" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="device-override-duration">Duration</Label>
                <select
                  id="device-override-duration"
                  value={durationHours}
                  onChange={(event) => setDurationHours(event.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {durationOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {action === "unlock-waive" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="device-override-emi-action">EMI update</Label>
                <select
                  id="device-override-emi-action"
                  value={emiAction}
                  onChange={(event) => setEmiAction(event.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {emiActions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="device-override-reason">Reason</Label>
            <Textarea
              id="device-override-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Add an audit-safe reason"
            />
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={submit} disabled={isSubmitting}>
              {isSubmitting ? "Queueing..." : "Queue override"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
