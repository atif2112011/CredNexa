"use client";

import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import type { Pagination, RecordItem } from "@/types/api";

type DiscountSlab = { minKeys: number; maxKeys: number | null; discountPercentage: number };
type DetailPayload = { discountChangeRequest?: RecordItem };
type ActionState = { type: "approve" | "reject"; request: RecordItem } | null;

type Props = {
  items: RecordItem[];
  pagination: Pagination;
  searchParams: { page?: string; tenantId?: string; channelPartnerId?: string; status?: string; search?: string };
};

function getId(item: RecordItem) {
  return String(item._id || item.id || "");
}

function getName(value: unknown, fallback = "-") {
  if (!value || typeof value !== "object") return fallback;
  const item = value as { name?: string; email?: string; mobile?: string };
  return item.name || item.email || item.mobile || fallback;
}

function getSlabs(value: unknown): DiscountSlab[] {
  return Array.isArray(value)
    ? value.map((slab) => {
        const item = slab as Record<string, unknown>;
        return {
          minKeys: Number(item.minKeys),
          maxKeys: item.maxKeys === null || item.maxKeys === undefined ? null : Number(item.maxKeys),
          discountPercentage: Number(item.discountPercentage)
        };
      })
    : [];
}

function getPageHref(params: Props["searchParams"], page: number) {
  const next = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => value && next.set(key, value));
  next.set("page", String(page));
  return `/discount-requests?${next.toString()}`;
}

async function getApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error || payload.message || "Request failed";
  } catch {
    return "Request failed";
  }
}

function SlabComparison({ request }: { request: RecordItem }) {
  const current = getSlabs(request.currentSlabs);
  const requested = getSlabs(request.requestedSlabs);

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Key slab</th>
            <th className="px-3 py-2">Current</th>
            <th className="px-3 py-2">Requested</th>
          </tr>
        </thead>
        <tbody>
          {requested.map((slab, index) => {
            const previous = current[index]?.discountPercentage;
            const changed = previous !== slab.discountPercentage;
            return (
              <tr key={`${slab.minKeys}-${slab.maxKeys}`} className="border-t">
                <td className="px-3 py-2 font-medium">{slab.minKeys}–{slab.maxKeys ?? "unlimited"} keys</td>
                <td className="px-3 py-2">{previous ?? "-"}%</td>
                <td className={changed ? "px-3 py-2 font-semibold text-primary" : "px-3 py-2"}>{slab.discountPercentage}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DiscountRequestsTable({ items, pagination, searchParams }: Props) {
  const router = useRouter();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailError, setDetailError] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [action, setAction] = useState<ActionState>(null);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function openDetail(request: RecordItem) {
    setDetailOpen(true);
    setDetail(null);
    setDetailError("");
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/admin/tenant-credit-discount-changes/${getId(request)}`);
      if (!response.ok) throw new Error(await getApiError(response));
      const payload = (await response.json()) as { data: DetailPayload };
      setDetail(payload.data);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Unable to load discount request");
    } finally {
      setLoadingDetail(false);
    }
  }

  function openAction(type: "approve" | "reject", request: RecordItem) {
    setAction({ type, request });
    setNote("");
    setActionError("");
  }

  async function submitAction() {
    if (!action) return;
    const cleanNote = note.trim();
    if (action.type === "reject" && !cleanNote) {
      setActionError("Rejection reason is required");
      return;
    }

    setSubmitting(true);
    setActionError("");
    try {
      const response = await fetch(`/api/admin/tenant-credit-discount-changes/${getId(action.request)}/${action.type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.type === "approve" ? { note: cleanNote } : { reason: cleanNote })
      });
      if (!response.ok) throw new Error(await getApiError(response));
      toast.success(action.type === "approve" ? "Discount request approved" : "Discount request rejected");
      setAction(null);
      setDetailOpen(false);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update discount request";
      setActionError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  const detailRequest = detail?.discountChangeRequest;

  return (
    <>
      <Card className="rounded-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="border-b px-4 py-3">Tenant</th>
                  <th className="border-b px-4 py-3">Partner</th>
                  <th className="border-b px-4 py-3">Base version</th>
                  <th className="border-b px-4 py-3">Status</th>
                  <th className="border-b px-4 py-3">Requested at</th>
                  <th className="border-b px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? items.map((request) => (
                  <tr key={getId(request)} className="cursor-pointer border-b last:border-0 hover:bg-muted/30" onClick={() => openDetail(request)}>
                    <td className="px-4 py-3.5 font-medium">{getName(request.tenantId)}</td>
                    <td className="px-4 py-3.5">{getName(request.channelPartnerId)}</td>
                    <td className="px-4 py-3.5">v{String(request.baseConfigVersion || "-")}</td>
                    <td className="px-4 py-3.5"><StatusBadge value={request.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3.5">{formatDate((request.requestedAt || request.createdAt) as string)}</td>
                    <td className="px-4 py-3.5">
                      {request.status === "PENDING" ? (
                        <Button size="sm" onClick={(event) => { event.stopPropagation(); openAction("approve", request); }}>
                          <CheckCircle2 className="h-4 w-4" />Approve
                        </Button>
                      ) : <span className="text-muted-foreground">-</span>}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No discount requests found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t bg-muted/20 p-4">
            <p className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.pages || 1} · {pagination.total} requests</p>
            <div className="flex gap-2">
              {pagination.page <= 1 ? <Button variant="outline" size="sm" disabled><ChevronLeft className="h-4 w-4" />Previous</Button> : <Button asChild variant="outline" size="sm"><Link href={getPageHref(searchParams, pagination.page - 1)}><ChevronLeft className="h-4 w-4" />Previous</Link></Button>}
              {pagination.page >= pagination.pages ? <Button variant="outline" size="sm" disabled>Next<ChevronRight className="h-4 w-4" /></Button> : <Button asChild variant="outline" size="sm"><Link href={getPageHref(searchParams, pagination.page + 1)}>Next<ChevronRight className="h-4 w-4" /></Link></Button>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Discount Request Details</DialogTitle><DialogDescription>Compare the tenant&apos;s current discounts with the partner&apos;s requested values.</DialogDescription></DialogHeader>
          {loadingDetail ? <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading...</div> : detailError ? <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{detailError}</div> : detailRequest ? (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
                <div><div className="text-xs text-muted-foreground">Tenant</div><div className="font-medium">{getName(detailRequest.tenantId)}</div></div>
                <div><div className="text-xs text-muted-foreground">Partner</div><div className="font-medium">{getName(detailRequest.channelPartnerId)}</div></div>
                <div><div className="text-xs text-muted-foreground">Status</div><StatusBadge value={detailRequest.status} /></div>
                <div><div className="text-xs text-muted-foreground">Requested by</div><div className="font-medium">{getName(detailRequest.requestedBy)}</div></div>
                <div><div className="text-xs text-muted-foreground">Base version</div><div className="font-medium">v{String(detailRequest.baseConfigVersion)}</div></div>
                <div><div className="text-xs text-muted-foreground">Requested at</div><div className="font-medium">{formatDate((detailRequest.requestedAt || detailRequest.createdAt) as string)}</div></div>
              </div>
              <SlabComparison request={detailRequest} />
              {detailRequest.rejectionReason ? <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"><strong>Rejection reason:</strong> {String(detailRequest.rejectionReason)}</div> : null}
              {detailRequest.status === "PENDING" ? <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => openAction("reject", detailRequest)}><XCircle className="h-4 w-4" />Reject</Button><Button onClick={() => openAction("approve", detailRequest)}><CheckCircle2 className="h-4 w-4" />Approve</Button></div> : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(action)} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{action?.type === "approve" ? "Approve Discount Request" : "Reject Discount Request"}</DialogTitle><DialogDescription>{action?.type === "approve" ? "Approval immediately applies the requested slabs to the tenant." : "The tenant configuration will remain unchanged."}</DialogDescription></DialogHeader>
          {action ? <div className="space-y-4"><div className="rounded-lg border bg-muted/30 p-3 text-sm"><div className="font-medium">{getName(action.request.tenantId)}</div><div className="text-muted-foreground">Requested by {getName(action.request.channelPartnerId)}</div></div><div className="grid gap-2"><Label htmlFor="discount-action-note">{action.type === "approve" ? "Approval note (optional)" : "Rejection reason"}</Label><Textarea id="discount-action-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>{actionError ? <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{actionError}</div> : null}</div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setAction(null)} disabled={submitting}>Cancel</Button><Button variant={action?.type === "reject" ? "destructive" : "default"} onClick={submitAction} disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{action?.type === "approve" ? "Approve" : "Reject"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
