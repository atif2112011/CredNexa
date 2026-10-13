"use client";

import { FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { ApiResponse, RecordItem } from "@/types/api";
import type { DeviceTestingAction } from "@/lib/device-provisioning";

export function DeviceTestingPanel({ deviceId, actions, running }: {
  deviceId: string; actions: DeviceTestingAction[]; running: boolean;
}) {
  const router = useRouter();
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [durationHours, setDurationHours] = useState("6");
  const [lastResult, setLastResult] = useState<string | null>(null);
  const groups = [...new Set(actions.map((action) => action.group))];

  async function runAction(action: DeviceTestingAction) {
    if (!action.enabled || submittingAction) return;
    if (!window.confirm(action.label + "?\n\n" + action.description + "\n\nThis changes live EMI/device data and may queue a device command.")) return;
    setSubmittingAction(action.action);
    try {
      const response = await fetch("/api/admin/devices/" + deviceId + "/testing/" + action.action, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.action === "simulate-temp-unlock" ? { durationHours: Number(durationHours) } : {})
      });
      const result = (await response.json().catch(() => null)) as ApiResponse<RecordItem> | null;
      if (!response.ok || !result?.success) {
        toast.error(result?.error || result?.message || "Testing action failed");
        router.refresh();
        return;
      }
      const command = result.data?.command as RecordItem | undefined;
      const message = command ? action.label + ": " + String(command.commandType) + " queued. Check command history for the device acknowledgement."
        : action.label + " completed. Check the updated schedule and command history.";
      setLastResult(message);
      toast.success(message);
      router.refresh();
    } catch {
      toast.error("Unable to reach the server. Refresh the page to check whether the action completed.");
    } finally { setSubmittingAction(null); }
  }

  return <Card className="border-amber-500/30 bg-amber-500/5">
    <CardHeader>
      <CardTitle>Testing Panel</CardTitle>
      <CardDescription>Live simulations for this device's provisioning type and dealer mode. {running ? "Lock tests control the running app overlay." : "Lock tests use managed device controls."}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      {lastResult ? <p role="status" className="rounded-lg border bg-background p-3 text-sm">{lastResult}</p> : null}
      {!actions.length ? <p className="text-sm text-muted-foreground">Testing options are unavailable.</p> : null}
      {groups.map((group) => <section key={group}>
        <h3 className="mb-3 font-semibold">{group}</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {actions.filter((action) => action.group === group).map((action) => <div key={action.action} className="flex flex-col justify-between gap-3 rounded-lg border bg-background/80 p-3">
            <div><p className="font-medium">{action.label}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{action.description}</p></div>
            {action.action === "simulate-temp-unlock" ? <div className="space-y-1">
              <Label htmlFor="test-unlock-duration">Temporary access duration</Label>
              <select id="test-unlock-duration" className="w-full rounded-md border bg-background p-2 text-sm" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} disabled={!action.enabled || Boolean(submittingAction)}>
                {[6, 12, 24, 48, 60, 72, 168].map((hours) => <option key={hours} value={hours}>{hours === 168 ? "7 days" : hours + " hours"}</option>)}
              </select>
            </div> : null}
            {!action.enabled ? <p className="text-xs text-muted-foreground">{action.reason}</p> : null}
            <Button type="button" variant={action.destructive ? "destructive" : "outline"} onClick={() => runAction(action)} disabled={!action.enabled || Boolean(submittingAction)}>
              <FlaskConical aria-hidden="true" />{submittingAction === action.action ? "Running..." : action.label}
            </Button>
          </div>)}
        </div>
      </section>)}
    </CardContent>
  </Card>;
}
