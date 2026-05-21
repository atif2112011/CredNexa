"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState
} from "@tanstack/react-table";
import { ArrowUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DataTableProps<TData> = {
  data: TData[];
  columns: ColumnDef<TData>[];
  searchPlaceholder?: string;
};

export function DataTable<TData>({ data, columns, searchPlaceholder = "Search records..." }: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel()
  });

  const rows = table.getRowModel().rows;
  const colSpan = useMemo(() => columns.length, [columns.length]);

  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3 border-b bg-muted/30 p-4 md:flex-row md:items-center md:justify-between">
        <label className="relative block w-full md:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Search table</span>
          <Input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
          />
        </label>
        <p className="rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border">
          {data.length} records
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="whitespace-nowrap border-b px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3.5 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-10 text-center text-muted-foreground" colSpan={colSpan}>
                  No records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
