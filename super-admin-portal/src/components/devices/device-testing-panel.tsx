"use client";

import {
  BellRing,
  CalendarClock,
  CircleDollarSign,
  ClockAlert,
  LockKeyhole,
  ShieldOff,
  TimerReset
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiResponse, RecordItem } from "@/types/api";

const actions = [
  {
    action: "send-overdue-reminder",
    label: "Send Overdue Reminder",
    description: "Queues an overdue reminder for the most recent overdue installment.",
    icon: BellRing
  },
  {
    action: "send-upcoming-reminder",
    label: "Send Upcoming Reminder",
    description: "Queues a manual reminder for the next future unpaid installment.",
    icon: CalendarClock
  },
  {
    action: "simulate-auto-lock",
    label: "Simulate Auto-lock",
    description: "Moves the next unpaid EMI beyond grace expiry and immediately runs its EMI cron.",
    icon: LockKeyhole
  },
  {
    action: "simulate-payment-unlock",
    label: "Simulate Payment Unlock",
    description: "Marks the most recent overdue EMI paid and queues the normal payment unlock.",
    icon: CircleDollarSign
  },
  {
    action: "simulate-device-grace",
    label: "Simulate Device Grace Period",
    description: "Moves the next unpaid EMI into grace, applies the grace policy, and queues its reminder.",
    icon: TimerReset
  },
  {
    action: "simulate-upcoming-emi",
    label: "Simulate Upcoming EMI Cron",
    description: "Makes the next unpaid EMI due in five days and immediately runs its reminder cron.",
    icon: ClockAlert
  },
  {
    action: "simulate-release",
    label: "Settle & Release Device",
    description: "Marks every remaining installment paid and queues permanent device release.",
    icon: ShieldOff,
    destructive: true
  }
] as const;

export function DeviceTestingPanel({ deviceId }: { deviceId: string }) {
  const router = useRouter();
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);

  async function runAction(action: (typeof actions)[number]) {
    const confirmed = window.confirm(
      `${action.label}?\n\n${action.description}\n\nThis changes live EMI/device data and may queue a command to the device.`
    );
    if (!confirmed) return;

    setSubmittingAction(action.action);
    try {
      const response = await fetch(`/api/admin/devices/${deviceId}/testing/${action.action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const result = (await response.json().catch(() => null)) as ApiResponse<RecordItem> | null;

      if (!response.ok || !result?.success) {
        toast.error(result?.error || result?.message || "Testing action failed");
        return;
      }

      toast.success(`${action.label} completed`);
      router.refresh();
    } finally {
      setSubmittingAction(null);
    }
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <CardTitle>Testing Panel</CardTitle>
        <CardDescription>
          Destructive super-admin simulations for EMI reminders, policy cron transitions, payment unlock, and release.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;
          const isSubmitting = submittingAction === action.action;
          return (
            <div key={action.action} className="flex flex-col justify-between gap-3 rounded-lg border bg-background/80 p-3">
              <div>
                <p className="font-medium">{action.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{action.description}</p>
              </div>
              <Button
                type="button"
                variant={"destructive" in action && action.destructive ? "destructive" : "outline"}
                onClick={() => runAction(action)}
                disabled={Boolean(submittingAction)}
              >
                <Icon aria-hidden="true" />
                {isSubmitting ? "Running..." : action.label}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
