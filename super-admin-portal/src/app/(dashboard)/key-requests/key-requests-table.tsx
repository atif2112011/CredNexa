"use client";

import Link from "next/link";
import { ArrowUpDown, CheckCircle2, ChevronLeft, ChevronRight, Loader2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ImageViewerModal } from "@/components/data/image-viewer-modal";
import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import type { Pagination, RecordItem } from "@/types/api";

type KeyRequestsTableProps = {
  items: RecordItem[];
  pagination: Pagination;
  searchParams: {
    page?: string;
    tenantId?: string;
    channelPartnerId?: string;
    status?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  };
};

type DetailPayload = {
  creditPurchaseRequest?: RecordItem;
  tenantCreditLedger?: RecordItem | null;
  partnerCreditLedger?: RecordItem | null;
};

type ActionState = {
  type: "approve" | "reject";
  request: RecordItem;
} | null;

type SortableColumn = {
  label: string;
  sortBy?: string;
};

const rupeeFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});

function getId(item: RecordItem) {
  return String(item._id || item.id || "");
}

function getName(value: unknown, fallback = "-") {
  if (!value || typeof value !== "object") return fallback;
  const item = value as { name?: string; email?: string; mobile?: string };
  return item.name || item.email || item.mobile || fallback;
}

function getAmount(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? rupeeFormatter.format(amount) : "-";
}

function getPageHref(params: KeyRequestsTableProps["searchParams"], page: number) {
  const nextParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) nextParams.set(key, value);
  });
  nextParams.set("page", String(page));
  return `/key-requests?${nextParams.toString()}`;
}

function getSortHref(params: KeyRequestsTableProps["searchParams"], sortBy: string) {
  const nextParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value && key !== "page") nextParams.set(key, value);
  });
  const currentSortBy = params.sortBy || "requestedAt";
  const currentSortOrder = params.sortOrder || "desc";
  nextParams.set("sortBy", sortBy);
  nextParams.set("sortOrder", currentSortBy === sortBy && currentSortOrder === "asc" ? "desc" : "asc");
  return `/key-requests?${nextParams.toString()}`;
}

async function getApiError(response: Response) {
  try {
    const result = (await response.json()) as { error?: string; message?: string };
    return result.error || result.message || "Request failed";
  } catch {
    return "Request failed";
  }
}

function buildDetailRows(detail: DetailPayload): [string, unknown, "badge" | "money" | "date" | "text"][] {
  const request = detail.creditPurchaseRequest || {};
  return [
    ["Tenant", getName(request.tenantId), "text"],
    ["Partner", getName(request.channelPartnerId), "text"],
    ["Status", request.status, "badge"],
    ["Reference Number", request.referenceNumber || "-", "text"],
    ["Requested Credits", request.requestedCredits ?? "-", "text"],
    ["Per Key Price", request.perKeyPrice, "money"],
    ["Gross Amount", request.grossPurchaseAmount ?? request.purchaseAmount, "money"],
    ["Discount Percentage", `${String(request.discountPercentage ?? 0)}%`, "text"],
    ["Discount Amount", request.discountAmount ?? 0, "money"],
    ["Net Purchase Amount", request.purchaseAmount, "money"],
    ["Requested By", getName(request.requestedBy), "text"],
    ["Requested At", request.requestedAt || request.createdAt, "date"],
    ["Payment Proof", (request.paymentProof as { imageUrl?: string } | undefined)?.imageUrl || "-", "text"],
    ["Approved By", getName(request.approvedBy), "text"],
    ["Approved At", request.approvedAt, "date"],
    ["Rejected By", getName(request.rejectedBy), "text"],
    ["Rejected At", request.rejectedAt, "date"],
    ["Rejection Reason", request.rejectionReason || "-", "text"],
    ["Tenant Ledger", detail.tenantCreditLedger?._id || "-", "text"],
    ["Partner Ledger", detail.partnerCreditLedger?._id || "-", "text"]
  ];
}

function renderDetailValue(value: unknown, type: "badge" | "money" | "date" | "text", onViewProof: (url: string) => void) {
  if (type === "badge") return <StatusBadge value={value} />;
  if (type === "money") return <span className="font-semibold text-emerald-700">{getAmount(value)}</span>;
  if (type === "date") return formatDate(value as string);
  const text = String(value ?? "-");
  if (text.startsWith("http://") || text.startsWith("https://")) {
    return (
      <Button type="button" variant="link" className="h-auto p-0" onClick={() => onViewProof(text)}>
        View proof
      </Button>
    );
  }
  return text;
}

const tableColumns: SortableColumn[] = [
  { label: "Tenant Name", sortBy: "tenantName" },
  { label: "Partner Name", sortBy: "partnerName" },
  { label: "Status", sortBy: "status" },
  { label: "Reference Number" },
  { label: "Requested Credits" },
  { label: "Purchase Amount", sortBy: "purchaseAmount" },
  { label: "Creation Date", sortBy: "createdAt" },
  { label: "Approve" }
];

export function KeyRequestsTable({ items, pagination, searchParams }: KeyRequestsTableProps) {
  const router = useRouter();
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailError, setDetailError] = useState("");
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [action, setAction] = useState<ActionState>(null);
  const [actionNote, setActionNote] = useState("");
  const [actionError, setActionError] = useState("");
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [proofImageUrl, setProofImageUrl] = useState("");

  async function openDetail(request: RecordItem) {
    const requestId = getId(request);
    setIsDetailOpen(true);
    setDetail(null);
    setDetailError("");
    setIsLoadingDetail(true);
    try {
      const response = await fetch(`/api/admin/tenant-credit-purchases/${requestId}`);
      if (!response.ok) throw new Error(await getApiError(response));
      const result = (await response.json()) as { data: DetailPayload };
      setDetail(result.data);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Unable to load key request details");
    } finally {
      setIsLoadingDetail(false);
    }
  }

  function openAction(type: "approve" | "reject", request: RecordItem) {
    setAction({ type, request });
    setActionNote("");
    setActionError("");
  }

  async function submitAction() {
    if (!action) return;
    const note = actionNote.trim();
    if (action.type === "reject" && !note) {
      setActionError("Rejection note is required");
      return;
    }

    const requestId = getId(action.request);
    const endpoint = `/api/admin/tenant-credit-purchases/${requestId}/${action.type}`;
    const body = action.type === "approve" ? { note } : { reason: note };

    setIsSubmittingAction(true);
    setActionError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(await getApiError(response));

      toast.success(action.type === "approve" ? "Key request approved" : "Key request rejected");
      const currentAction = action;
      setAction(null);
      router.refresh();
      if (isDetailOpen) {
        await openDetail(currentAction.request);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update key request";
      setActionError(message);
      toast.error(message);
    } finally {
      setIsSubmittingAction(false);
    }
  }

  const detailRequest = detail?.creditPurchaseRequest;
  const isPendingDetail = detailRequest?.status === "PENDING";
  const currentSortBy = searchParams.sortBy || "requestedAt";
  const currentSortOrder = searchParams.sortOrder || "desc";

  return (
    <>
      <Card className="rounded-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {tableColumns.map((column) => (
                    <th key={column.label} className="whitespace-nowrap border-b px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {column.sortBy ? (
                        <Link href={getSortHref(searchParams, column.sortBy)} className="inline-flex items-center gap-2">
                          {column.label}
                          <ArrowUpDown
                            className={currentSortBy === column.sortBy ? "h-3.5 w-3.5 text-foreground" : "h-3.5 w-3.5 text-muted-foreground"}
                            aria-hidden="true"
                          />
                          <span className="sr-only">
                            Sort {currentSortBy === column.sortBy && currentSortOrder === "asc" ? "descending" : "ascending"}
                          </span>
                        </Link>
                      ) : (
                        column.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.length ? (
                  items.map((request) => {
                    const id = getId(request);
                    const isPending = request.status === "PENDING";
                    return (
                      <tr
                        key={id}
                        className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/30"
                        onClick={() => openDetail(request)}
                      >
                        <td className="max-w-56 truncate px-4 py-3.5 font-medium">{getName(request.tenantId)}</td>
                        <td className="max-w-56 truncate px-4 py-3.5">{getName(request.channelPartnerId)}</td>
                        <td className="px-4 py-3.5">
                          <StatusBadge value={request.status} />
                        </td>
                        <td className="max-w-48 truncate px-4 py-3.5">{String(request.referenceNumber || "-")}</td>
                        <td className="px-4 py-3.5 font-semibold">{String(request.requestedCredits ?? "-")}</td>
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-emerald-700">{getAmount(request.purchaseAmount)}</div>
                          <div className="font-semibold text-emerald-700">{getAmount(request.perKeyPrice)}/key</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5">{formatDate((request.createdAt || request.requestedAt) as string)}</td>
                        <td className="px-4 py-3.5">
                          {isPending ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                openAction("approve", request);
                              }}
                            >
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                              Approve
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="px-4 py-10 text-center text-muted-foreground" colSpan={8}>
                      No key requests found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.pages || 1} · {pagination.total} key requests
            </p>
            <div className="flex items-center gap-2">
              {pagination.page <= 1 ? (
                <Button variant="outline" size="sm" disabled>
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Previous
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href={getPageHref(searchParams, pagination.page - 1)}>
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Previous
                  </Link>
                </Button>
              )}
              {pagination.page >= pagination.pages ? (
                <Button variant="outline" size="sm" disabled>
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href={getPageHref(searchParams, pagination.page + 1)}>
                    Next
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Key Request Details</DialogTitle>
            <DialogDescription>Review the selected tenant key purchase request.</DialogDescription>
          </DialogHeader>
          {isLoadingDetail ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading key request details...
            </div>
          ) : detailError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {detailError}
            </div>
          ) : detail ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <tbody>
                    {buildDetailRows(detail).map(([label, value, type]) => (
                      <tr key={label} className="border-b last:border-b-0">
                        <th className="w-52 bg-muted/40 px-3 py-2 text-left font-medium text-muted-foreground">{label}</th>
                        <td className="break-all px-3 py-2">{renderDetailValue(value, type, setProofImageUrl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isPendingDetail ? (
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => openAction("reject", detailRequest as RecordItem)}>
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    Reject
                  </Button>
                  <Button type="button" onClick={() => openAction("approve", detailRequest as RecordItem)}>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Approve
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(action)} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{action?.type === "approve" ? "Approve Key Request" : "Reject Key Request"}</DialogTitle>
            <DialogDescription>
              {action?.type === "approve"
                ? "Confirm that payment has been verified before approving this request."
                : "Add a rejection note before rejecting this request."}
            </DialogDescription>
          </DialogHeader>
          {action ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{getName(action.request.tenantId)}</div>
                <div className="text-muted-foreground">
                  {String(action.request.requestedCredits ?? "-")} credits · {getAmount(action.request.purchaseAmount)}
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="actionNote">{action.type === "approve" ? "Approval Note (optional)" : "Rejection Note"}</Label>
                <Textarea
                  id="actionNote"
                  value={actionNote}
                  onChange={(event) => setActionNote(event.target.value)}
                  placeholder={action.type === "approve" ? "Payment verified" : "Payment proof could not be verified"}
                />
              </div>
              {actionError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {actionError}
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAction(null)} disabled={isSubmittingAction}>
              Cancel
            </Button>
            <Button type="button" variant={action?.type === "reject" ? "destructive" : "default"} onClick={submitAction} disabled={isSubmittingAction}>
              {isSubmittingAction ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {action?.type === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageViewerModal
        open={Boolean(proofImageUrl)}
        onOpenChange={(open) => !open && setProofImageUrl("")}
        imageUrl={proofImageUrl}
        title="Payment Proof"
        description="Tenant key purchase payment proof"
      />
    </>
  );
}
