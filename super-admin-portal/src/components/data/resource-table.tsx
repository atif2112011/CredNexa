"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye } from "lucide-react";

import { DataTable } from "@/components/data/data-table";
import { StatusBadge } from "@/components/data/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate, getNestedValue } from "@/lib/utils";
import type { RecordItem } from "@/types/api";

export type ResourceColumn = {
  key: string;
  header: string;
  type?: "text" | "date" | "status" | "boolean";
};

type ResourceTableProps = {
  rows: RecordItem[];
  columns: ResourceColumn[];
  detailBasePath?: string;
};

function renderValue(row: RecordItem, column: ResourceColumn) {
  const value = getNestedValue(row, column.key);
  if (column.type === "date") return formatDate(value as string);
  if (column.type === "status") return <StatusBadge value={value} />;
  if (column.type === "boolean") return <StatusBadge value={value ? "active" : "inactive"} />;
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object" && "name" in value) return String((value as { name?: string }).name || "-");
  return String(value ?? "-");
}

export function ResourceTable({ rows, columns, detailBasePath }: ResourceTableProps) {
  const tableColumns: ColumnDef<RecordItem>[] = [
    ...columns.map((column) => ({
      accessorKey: column.key,
      header: column.header,
            cell: ({ row }: { row: { original: RecordItem } }) => renderValue(row.original, column)
    })),
    ...(detailBasePath
      ? [
          {
            id: "actions",
            header: "Actions",
            cell: ({ row }) => {
              const id = row.original._id || row.original.id || row.original.caseId;
              return (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`${detailBasePath}/${id}`}>
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    View
                  </Link>
                </Button>
              );
            }
          } satisfies ColumnDef<RecordItem>
        ]
      : [])
  ];

  return <DataTable data={rows} columns={tableColumns} />;
}
