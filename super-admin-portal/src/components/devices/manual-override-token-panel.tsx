"use client";

import { Clock3, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ImageViewerModal } from "@/components/data/image-viewer-modal";
import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import type { ApiResponse, RecordItem } from "@/types/api";

const ACTIVE_TOKEN_STATUSES = new Set(["GENERATED", "DOWNLOADED"]);

function getValidity(token?: RecordItem) {
  if (!token) return { label: "Not generated", detail: "Generate a token to enable offline recovery.", valid: false };

  const status = String(token.status || "").toUpperCase();
  const expiresAt = token.expiresAt ? new Date(String(token.expiresAt)) : null;
  const hasValidExpiry = Boolean(expiresAt && !Number.isNaN(expiresAt.getTime()));
  const valid = ACTIVE_TOKEN_STATUSES.has(status) && Boolean(expiresAt && expiresAt.getTime() > Date.now());

  if (!hasValidExpiry) return { label: "Validity unavailable", detail: "No expiry date is available.", valid: false };
  if (valid) return { label: "Currently valid", detail: `Valid until ${formatDate(String(token.expiresAt))}`, valid: true };
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return { label: "Expired", detail: `Expired on ${formatDate(String(token.expiresAt))}`, valid: false };
  }
  return { label: "Not valid", detail: `Validity ended by status change · Expires ${formatDate(String(token.expiresAt))}`, valid: false };
}

async function readApiResponse<T>(response: Response): Promise<ApiResponse<T> | null> {
  return response.json().catch(() => null) as Promise<ApiResponse<T> | null>;
}

export function ManualOverrideTokenPanel({
  deviceId,
  initialTokens
}: {
  deviceId: string;
  initialTokens: RecordItem[];
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [selectedToken, setSelectedToken] = useState<RecordItem | null>(null);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isLoadingQr, setIsLoadingQr] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const currentToken = tokens[0];
  const validity = getValidity(currentToken);

  async function viewQr() {
    if (!currentToken?.tokenId) {
      toast.error("No manual override token is available");
      return;
    }

    if (currentToken.qrDataUrl) {
      setSelectedToken(currentToken);
      setIsQrOpen(true);
      return;
    }

    setIsLoadingQr(true);
    const response = await fetch(`/api/admin/manual-override-tokens/${String(currentToken.tokenId)}`);
    const result = await readApiResponse<RecordItem>(response);
    setIsLoadingQr(false);

    if (!response.ok || !result?.success || !result.data?.qrDataUrl) {
      toast.error(result?.error || "Unable to load the manual override QR");
      return;
    }

    setTokens((items) => [result.data, ...items.filter((item) => item.tokenId !== result.data.tokenId)]);
    setSelectedToken(result.data);
    setIsQrOpen(true);
  }

  async function regenerateToken() {
    setIsRegenerating(true);
    const response = await fetch(`/api/admin/devices/${deviceId}/manual-override-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() || "Regenerated from device details" })
    });
    const result = await readApiResponse<RecordItem>(response);
    setIsRegenerating(false);

    if (!response.ok || !result?.success || !result.data) {
      toast.error(result?.error || "Unable to regenerate the manual override token");
      return;
    }

    setTokens((items) => [
      result.data,
      ...items.map((item) =>
        ACTIVE_TOKEN_STATUSES.has(String(item.status || "").toUpperCase())
          ? { ...item, status: "SUPERSEDED" }
          : item
      )
    ]);
    setReason("");
    setIsRegenerateOpen(false);
    toast.success("Manual override token regenerated");
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Manual Override Token</CardTitle>
              <CardDescription className="mt-1">Offline recovery QR for this registered device.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={viewQr} disabled={!currentToken || isLoadingQr}>
                <QrCode aria-hidden="true" />
                {isLoadingQr ? "Loading QR..." : "View QR"}
              </Button>
              <Button type="button" onClick={() => setIsRegenerateOpen(true)}>
                <RefreshCw aria-hidden="true" />
                {currentToken ? "Regenerate token" : "Generate token"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {currentToken ? (
            <div className="grid gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
                <div className="mt-2"><StatusBadge value={currentToken.status} /></div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Validity</p>
                <div className="mt-2 flex items-start gap-2">
                  {validity.valid ? <ShieldCheck className="mt-0.5 size-4 text-emerald-600" /> : <Clock3 className="mt-0.5 size-4 text-muted-foreground" />}
                  <div>
                    <p className="font-medium">{validity.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{validity.detail}</p>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Issued</p>
                <p className="mt-2 font-medium">{formatDate(currentToken.issuedAt as string)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Token ID</p>
                <p className="mt-2 break-all font-mono text-xs">{String(currentToken.tokenId || "-")}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-8 text-center">
              <QrCode className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 font-medium">No manual override token</p>
              <p className="mt-1 text-sm text-muted-foreground">Generate a token to make an offline recovery QR available.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isRegenerateOpen} onOpenChange={setIsRegenerateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{currentToken ? "Regenerate manual override token?" : "Generate manual override token?"}</DialogTitle>
            <DialogDescription>
              {currentToken
                ? "The current active token will be superseded and can no longer be used."
                : "A signed offline recovery token and QR will be generated for this device."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="manual-override-reason">Reason</Label>
            <Textarea
              id="manual-override-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional audit reason"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsRegenerateOpen(false)} disabled={isRegenerating}>Cancel</Button>
            <Button type="button" onClick={regenerateToken} disabled={isRegenerating}>
              {isRegenerating ? "Generating..." : currentToken ? "Regenerate token" : "Generate token"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageViewerModal
        open={isQrOpen}
        onOpenChange={setIsQrOpen}
        imageUrl={selectedToken?.qrDataUrl as string | undefined}
        title="Manual Override QR"
        description={`Token ${String(selectedToken?.tokenId || "")} · ${selectedToken?.expiresAt ? `Valid until ${formatDate(String(selectedToken.expiresAt))}` : "Expiry unavailable"}`}
      />
    </>
  );
}
