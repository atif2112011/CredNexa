"use client";

import Link from "next/link";
import { ArrowUpDown, Eye } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import type { Pagination, RecordItem } from "@/types/api";

type FcmLogsTableProps = {
  items: RecordItem[];
  pagination: Pagination;
  searchParams: {
    page?: string;
    status?: string;
    targetApp?: string;
    recipientType?: string;
    messageType?: string;
    from?: string;
    to?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  };
};

type DisplayObject = {
  name?: string;
  email?: string;
  role?: string;
  imei?: string;
  deviceModel?: string;
  manufacturer?: string;
  state?: string;
  title?: string;
  commandType?: string;
  status?: string;
  triggeredBy?: string;
  notificationType?: string;
};

type SortableColumn = {
  label: string;
  sortBy?: string;
};

const labelFromObject = (value: unknown, fallback = "-") => {
  if (!value || typeof value !== "object") return fallback;
  const item = value as DisplayObject;
  return item.name || item.email || item.imei || item.title || item.commandType || fallback;
};

const formatDevice = (value: unknown) => {
  if (!value || typeof value !== "object") return "-";
  const device = value as DisplayObject;
  const primary = device.imei || device.deviceModel || device.manufacturer;
  const secondary = [device.deviceModel, device.manufacturer].filter(Boolean).join(" / ");
  if (!primary) return "-";
  return secondary && primary !== secondary ? `${primary} (${secondary})` : primary;
};

const formatCommand = (value: unknown) => {
  if (!value || typeof value !== "object") return "-";
  const command = value as DisplayObject;
  return [command.commandType, command.status, command.triggeredBy].filter(Boolean).join(" / ") || "-";
};

const formatNotificationJob = (value: unknown) => {
  if (!value || typeof value !== "object") return "-";
  const job = value as DisplayObject;
  return [job.title, job.notificationType, job.status].filter(Boolean).join(" / ") || "-";
};

const getPageHref = (params: FcmLogsTableProps["searchParams"], page: number) => {
  const nextParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) nextParams.set(key, value);
  });
  nextParams.set("page", String(page));
  return `/fcm-logs?${nextParams.toString()}`;
};

const getSortHref = (params: FcmLogsTableProps["searchParams"], sortBy: string) => {
  const nextParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value && key !== "page") nextParams.set(key, value);
  });
  const currentSortBy = params.sortBy || "createdAt";
  const currentSortOrder = params.sortOrder || "desc";
  nextParams.set("sortBy", sortBy);
  nextParams.set("sortOrder", currentSortBy === sortBy && currentSortOrder === "asc" ? "desc" : "asc");
  return `/fcm-logs?${nextParams.toString()}`;
};


const getDetailRows = (log: any): [string, unknown, "badge" | "text"][] => [
  ["Status", log.status, "badge"],
  ["Target App", log.targetApp || "borrower_app", "badge"],
  ["Recipient Type", log.recipientType || "device", "badge"],
  ["Message Type", log.messageType, "badge"],
  ["Notification Type", log.notificationType || "-", "badge"],
  ["Notification Title", log?.notificationJobId?.title || "-", "text"],
  ["Tenant", labelFromObject(log.tenantId), "text"],
  ["Partner", labelFromObject(log.channelPartnerId), "text"],
  ["Device", formatDevice(log.deviceId), "text"],
  ["Account", labelFromObject(log.accountId), "text"],
  ["Command", formatCommand(log.commandId), "text"],
  ["Notification Job", formatNotificationJob(log.notificationJobId), "text"],
  ["Provider Message ID", log.providerMessageId || "-", "text"],
  ["Token Hash", log.tokenHash || "-", "text"],
  ["Error", log.error || "-", "text"],
  ["Created At", formatDate(log.createdAt as string), "text"],
  ["Updated At", log.updatedAt ? formatDate(log.updatedAt as string) : "-", "text"]
];

const tableColumns: SortableColumn[] = [
  { label: "Status", sortBy: "status" },
  { label: "Target App", sortBy: "targetApp" },
  { label: "Message Type", sortBy: "messageType" },
  { label: "Device" },
  { label: "Created At", sortBy: "createdAt" }
];

export function FcmLogsTable({ items, pagination, searchParams }: FcmLogsTableProps) {
  const [selectedLog, setSelectedLog] = useState<RecordItem | null>(null);
  const currentSortBy = searchParams.sortBy || "createdAt";
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
                  items.map((log) => (
                    <tr
                      key={String(log._id || log.id)}
                      className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/30"
                      onClick={() => setSelectedLog(log)}
                    >
                      <td className="px-4 py-3.5">
                        <StatusBadge value={log.status} />
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge value={log.targetApp || "borrower_app"} />
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge value={log.messageType} />
                      </td>
                      <td className="max-w-80 truncate px-4 py-3.5" title={formatDevice(log.deviceId)}>
                        {formatDevice(log.deviceId)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5">{formatDate(log.createdAt as string)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-10 text-center text-muted-foreground" colSpan={5}>
                      No FCM logs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.pages || 1} · {pagination.total} logs
            </p>
            <div className="flex items-center gap-2">
              {pagination.page <= 1 ? (
                <Button variant="outline" size="sm" disabled>
                  Previous
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href={getPageHref(searchParams, pagination.page - 1)}>Previous</Link>
                </Button>
              )}
              {pagination.page >= pagination.pages ? (
                <Button variant="outline" size="sm" disabled>
                  Next
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href={getPageHref(searchParams, pagination.page + 1)}>Next</Link>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedLog)} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" aria-hidden="true" />
              FCM Log Details
            </DialogTitle>
            <DialogDescription>Full delivery log details for the selected notification attempt.</DialogDescription>
          </DialogHeader>
          {selectedLog ? (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <tbody>
                  {getDetailRows(selectedLog).map(([label, value, type]) => (
                    <tr key={label} className="border-b last:border-b-0">
                      <th className="w-52 bg-muted/40 px-3 py-2 text-left font-medium text-muted-foreground">{label}</th>
                      <td className="break-all px-3 py-2">
                        {type === "badge" ? <StatusBadge value={value} /> : String(value ?? "-")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
