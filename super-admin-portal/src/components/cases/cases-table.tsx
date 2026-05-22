"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye } from "lucide-react";

import { ResolveCaseDialog } from "@/components/cases/resolve-case-dialog";
import { DataTable } from "@/components/data/data-table";
import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate, getNestedValue } from "@/lib/utils";
import type { RecordItem } from "@/types/api";

function text(row: RecordItem, key: string) {
  const value = getNestedValue(row, key);
  return String(value ?? "-");
}

export function CasesTable({ rows }: { rows: RecordItem[] }) {
  const columns: ColumnDef<RecordItem>[] = [
    {
      accessorKey: "caseId",
      header: "Case",
      cell: ({ row }) => <span className="font-medium">{text(row.original, "caseId")}</span>
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge value={row.original.status} />
    },
    {
      accessorKey: "tenant",
      header: "Tenant",
      cell: ({ row }) => text(row.original, "tenantId.name")
    },
    {
      accessorKey: "partner",
      header: "Partner",
      cell: ({ row }) => text(row.original, "channelPartnerId.name")
    },
    {
      accessorKey: "borrower",
      header: "Borrower",
      cell: ({ row }) => text(row.original, "userId.name")
    },
    {
      accessorKey: "imei",
      header: "IMEI",
      cell: ({ row }) => text(row.original, "deviceId.imei")
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => formatDate(row.original.createdAt as string)
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const caseId = String(row.original.caseId || "");
        return (
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/escalations/${caseId}`}>
                <Eye className="h-4 w-4" aria-hidden="true" />
                View
              </Link>
            </Button>
            <ResolveCaseDialog item={row.original} />
          </div>
        );
      }
    }
  ];

  return <DataTable data={rows} columns={columns} />;
}
