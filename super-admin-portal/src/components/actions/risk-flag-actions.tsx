"use client";

import { CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RecordItem } from "@/types/api";

type RiskFlagActionsProps = {
  riskFlag: RecordItem;
  activeCriticalRiskFlags?: RecordItem[];
};

const inactiveStatuses = new Set(["resolved", "cleared", "false_positive"]);
const wipeEligibleRiskTypes = new Set([
  "DEVICE_INTEGRITY_COMPROMISED",
  "ROOT_DETECTED",
  "TAMPER_DETECTED",
  "SYSTEM_TAMPER_DETECTED",
  "CUSTOM_ROM_DETECTED",
  "BOOTLOADER_UNLOCKED"
]);

function isWipeEligibleRisk(riskFlag: RecordItem, isInactive: boolean) {
  const riskType = String(riskFlag.riskType || riskFlag.type || "");
  return (
    !isInactive &&
    String(riskFlag.severity || "").toLowerCase() === "critical" &&
    (String(riskFlag.riskBucket || "") === "device_compromise" ||
      String(riskFlag.status || "") === "compromised_permanent" ||
      wipeEligibleRiskTypes.has(riskType))
  );
}

export function RiskFlagActions({ riskFlag, activeCriticalRiskFlags = [] }: RiskFlagActionsProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null);
  const flagId = String(riskFlag._id || riskFlag.id || "");
  const status = String(riskFlag.status || "").toLowerCase();
  const isInactive = inactiveStatuses.has(status);
  const canWipe = isWipeEligibleRisk(riskFlag, isInactive);

  async function submit(action: string, options: { method?: string; body?: Record<string, unknown>; confirm?: string } = {}) {
    if (options.confirm && !window.confirm(options.confirm)) return;
    if (options.body?.reason === "" || options.body?.note === "") {
      toast.error("Audit note is required");
      return;
    }

    setIsSubmitting(action);
    const response = await fetch(`/api/admin/risk-flags/${flagId}${action}`, {
      method: options.method || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body || {})
    });
    setIsSubmitting(null);

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(result?.error || "Risk action failed");
      return;
    }

    toast.success("Risk action queued");
    setNote("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {activeCriticalRiskFlags.length ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Active critical risk is still present. Admin unlock is allowed, but it does not clear the risk.
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={riskFlag.severity} />
          <StatusBadge value={riskFlag.status} />
          <StatusBadge value={riskFlag.riskBucket || "unknown"} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="risk-action-note">Audit note</Label>
          <Textarea
            id="risk-action-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Required for clear, false positive, and wipe actions"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => submit("/acknowledge", { method: "PATCH", body: { note } })}
            disabled={Boolean(isSubmitting) || isInactive}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Acknowledge
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => submit("/recheck", { body: { reason: note || "Admin requested security recheck" } })}
            disabled={Boolean(isSubmitting) || isInactive}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Recheck
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => submit("/app-update", { body: { reason: note || "Admin pushed trusted app repair" } })}
            disabled={Boolean(isSubmitting) || isInactive}
          >
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            App Update
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => submit("/clear", { body: { reason: note, resolution: "cleared" } })}
            disabled={Boolean(isSubmitting) || isInactive}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Clear
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => submit("/clear", { body: { reason: note, resolution: "false_positive" } })}
            disabled={Boolean(isSubmitting) || isInactive}
          >
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            False Positive
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() =>
              submit("/wipe", {
                body: { reason: note },
                confirm: "Queue admin-only wipe for this device?"
              })
            }
            disabled={Boolean(isSubmitting) || !canWipe}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Wipe
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
