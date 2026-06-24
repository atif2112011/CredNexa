"use client";

import { BellRing, Loader2, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type TargetApp = "borrower_app" | "tenant_app" | "partner_app";

type TargetOption = {
  id: string;
  label: string;
};

type TargetResponse = {
  targetApp: TargetApp;
  items: TargetOption[];
};

type SendResponse = {
  targetApp: TargetApp;
  targetId: string;
  targetDeviceCount?: number;
  targetTenantCount?: number;
  targetPartnerCount?: number;
  targetAccountCount?: number;
  queuedCommandCount?: number;
  queuedJobCount?: number;
  deliveryAttempted?: boolean;
  deliverySummary?: Record<string, number>;
};

const targetApps: { label: string; value: TargetApp }[] = [
  { label: "Borrower App", value: "borrower_app" },
  { label: "Tenant App", value: "tenant_app" },
  { label: "Partner App", value: "partner_app" }
];

const getRecipientLabel = (targetApp: TargetApp) => {
  if (targetApp === "borrower_app") return "Borrower";
  if (targetApp === "tenant_app") return "Tenant";
  return "Partner";
};

async function parseApiError(response: Response) {
  try {
    const result = (await response.json()) as { error?: string };
    return result.error || "Request failed";
  } catch {
    return "Request failed";
  }
}

export function PushNotificationForm() {
  const [targetApp, setTargetApp] = useState<TargetApp>("borrower_app");
  const [targetId, setTargetId] = useState("all");
  const [targets, setTargets] = useState<TargetOption[]>([{ id: "all", label: "All" }]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [isLoadingTargets, setIsLoadingTargets] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SendResponse | null>(null);

  const recipientLabel = useMemo(() => getRecipientLabel(targetApp), [targetApp]);

  useEffect(() => {
    let cancelled = false;

    async function loadTargets() {
      setIsLoadingTargets(true);
      setError("");
      setSummary(null);
      try {
        const response = await fetch(`/api/admin/notifications/targets?targetApp=${targetApp}`);
        if (!response.ok) throw new Error(await parseApiError(response));
        const result = (await response.json()) as { data: TargetResponse };
        if (cancelled) return;
        setTargets(result.data.items);
        setTargetId("all");
      } catch (loadError) {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : "Unable to load notification targets";
        setError(message);
        setTargets([{ id: "all", label: "All" }]);
        toast.error(message);
      } finally {
        if (!cancelled) setIsLoadingTargets(false);
      }
    }

    loadTargets();
    return () => {
      cancelled = true;
    };
  }, [targetApp]);

  async function submitNotification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSummary(null);

    const normalizedTitle = title.trim();
    const normalizedText = text.trim();

    if (!normalizedTitle) {
      setError("Notification title is required");
      return;
    }
    if (!normalizedText) {
      setError("Notification text is required");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/notifications/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetApp,
          targetId,
          title: normalizedTitle,
          text: normalizedText
        })
      });

      if (!response.ok) throw new Error(await parseApiError(response));
      const result = (await response.json()) as { data: SendResponse };
      setSummary(result.data);
      toast.success("Notification queued successfully");
      setTitle("");
      setText("");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to queue notification";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,720px)_minmax(320px,1fr)]">
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>Compose Notification</CardTitle>
          <CardDescription>Select the app, choose a recipient scope, and queue a push notification.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={submitNotification}>
            <div className="grid gap-2">
              <Label htmlFor="targetApp">Target App</Label>
              <select
                id="targetApp"
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={targetApp}
                onChange={(event) => setTargetApp(event.target.value as TargetApp)}
              >
                {targetApps.map((app) => (
                  <option key={app.value} value={app.value}>
                    {app.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="targetId">{recipientLabel}</Label>
              <div className="relative">
                <select
                  id="targetId"
                  className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                  disabled={isLoadingTargets}
                >
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </select>
                {isLoadingTargets ? <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="title">Notification Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                placeholder="Payment approval pending"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="text">Notification Text</Label>
              <Textarea
                id="text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={1000}
                placeholder="A borrower payment is waiting for approval."
                className="min-h-32"
              />
            </div>

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="flex justify-end border-t pt-4">
              <Button type="submit" disabled={isSubmitting || isLoadingTargets}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                {isSubmitting ? "Queueing..." : "Queue Notification"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4" aria-hidden="true" />
            Delivery Summary
          </CardTitle>
          <CardDescription>The FCM worker delivers queued notifications. Borrower app sends also attempt immediate delivery.</CardDescription>
        </CardHeader>
        <CardContent>
          {summary ? (
            <dl className="grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-4 border-b pb-2">
                <dt className="text-muted-foreground">Target App</dt>
                <dd className="font-medium">{targetApps.find((app) => app.value === summary.targetApp)?.label || summary.targetApp}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-b pb-2">
                <dt className="text-muted-foreground">Recipient</dt>
                <dd className="text-right font-medium">{targets.find((target) => target.id === summary.targetId)?.label || summary.targetId}</dd>
              </div>
              {summary.targetDeviceCount !== undefined ? (
                <div className="flex items-center justify-between gap-4 border-b pb-2">
                  <dt className="text-muted-foreground">Target Devices</dt>
                  <dd className="font-medium">{summary.targetDeviceCount}</dd>
                </div>
              ) : null}
              {summary.targetAccountCount !== undefined ? (
                <div className="flex items-center justify-between gap-4 border-b pb-2">
                  <dt className="text-muted-foreground">Target Accounts</dt>
                  <dd className="font-medium">{summary.targetAccountCount}</dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-4 border-b pb-2">
                <dt className="text-muted-foreground">Queued</dt>
                <dd className="font-medium">{summary.queuedCommandCount ?? summary.queuedJobCount ?? 0}</dd>
              </div>
              {summary.deliverySummary ? (
                <div className="rounded-lg bg-muted/60 p-3">
                  <dt className="mb-2 text-muted-foreground">Immediate Delivery</dt>
                  <dd className="space-y-1">
                    {Object.entries(summary.deliverySummary).map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between">
                        <span className="capitalize">{status}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              After a notification is queued, the result summary appears here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
