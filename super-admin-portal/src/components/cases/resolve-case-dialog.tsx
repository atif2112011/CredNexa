"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RecordItem } from "@/types/api";

const tempDurations = [
  { label: "6 hours", value: "6" },
  { label: "12 hours", value: "12" },
  { label: "24 hours", value: "24" },
  { label: "48 hours", value: "48" },
  { label: "72 hours", value: "72" }
];

const actions = [
  { label: "Unlock device", value: "unlock" },
  { label: "Unlock device and waive payment", value: "waive" },
  { label: "Temporary unlock", value: "temp-unlock" },
  { label: "Reject case", value: "reject" }
];

function isResolvable(status: unknown) {
  return ["ESCALATED_PARTNER", "ESCALATED_ADMIN", "UNDER_REVIEW"].includes(String(status));
}

export function ResolveCaseDialog({ item }: { item: RecordItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("unlock");
  const [durationHours, setDurationHours] = useState("24");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const caseId = String(item.caseId || item._id || "");
  const canResolve = isResolvable(item.status);

  async function submit() {
    if (!reason.trim()) {
      toast.error("Reason is required");
      return;
    }

    const endpoint =
      action === "temp-unlock"
        ? `/api/admin/escalations/${caseId}/temp-unlock`
        : action === "reject"
          ? `/api/admin/escalations/${caseId}/reject`
          : `/api/admin/escalations/${caseId}/unlock`;
    const body =
      action === "temp-unlock"
        ? { reason, durationHours: Number(durationHours) }
        : action === "waive"
          ? { reason, emiAction: "waive" }
          : { reason };

    setIsSubmitting(true);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setIsSubmitting(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      toast.error(payload?.error || "Unable to resolve case");
      return;
    }

    toast.success("Case action queued");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!canResolve}>
          Resolve
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve {caseId}</DialogTitle>
          <DialogDescription>Choose the final action for this escalated case.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{String(item.userId && typeof item.userId === "object" && "name" in item.userId ? item.userId.name : "Borrower")}</p>
                <p className="text-sm text-muted-foreground">{String(item.reason || item.details || "No reason provided")}</p>
              </div>
              <StatusBadge value={item.status} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`action-${caseId}`}>Action</Label>
            <select
              id={`action-${caseId}`}
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
              <Label htmlFor={`duration-${caseId}`}>Duration</Label>
              <select
                id={`duration-${caseId}`}
                value={durationHours}
                onChange={(event) => setDurationHours(event.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {tempDurations.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor={`reason-${caseId}`}>Reason</Label>
            <Textarea
              id={`reason-${caseId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Add an audit-safe reason"
            />
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Confirm"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
