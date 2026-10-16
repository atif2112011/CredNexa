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
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Pagination } from "@/types/api";
import { tableHref } from "@/lib/table-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ServerTableProps = {
  pagination?: Pagination;
  sortFields?: Record<string, string>;
  queryPrefix?: string;
};

type DataTableProps<TData> = ServerTableProps & {
  data: TData[];
  columns: ColumnDef<TData>[];
  searchPlaceholder?: string;
  onRowClick?: (row: TData) => void;
};

export function DataTable<TData>({
  data,
  columns,
  searchPlaceholder = "Search records...",
  onRowClick,
  pagination,
  sortFields = {},
  queryPrefix = ""
}: DataTableProps<TData>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [searchInput, setSearchInput] = useState(searchParams.get(`${queryPrefix}search`) || "");
  const remote = Boolean(pagination);
  const serverSearch = searchParams.get(`${queryPrefix}search`) || "";
  useEffect(() => { setSearchInput(serverSearch); }, [serverSearch]);

  function navigate(updates: Record<string, string | undefined>) {
    const href = tableHref(pathname, new URLSearchParams(searchParams), updates, queryPrefix);
    startTransition(() => router.push(href, { scroll: false }));
  }

  const sortId = Object.keys(sortFields).find((key) => sortFields[key] === searchParams.get(`${queryPrefix}sortBy`));
  const serverSorting: SortingState = sortId ? [{ id: sortId, desc: searchParams.get(`${queryPrefix}sortOrder`) !== "asc" }] : [];

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting: remote ? serverSorting : sorting,
      globalFilter: remote ? serverSearch : globalFilter,
      ...(pagination ? { pagination: { pageIndex: pagination.page - 1, pageSize: pagination.limit } } : {})
    },
    manualPagination: remote,
    manualFiltering: remote,
    manualSorting: remote,
    pageCount: pagination ? Math.max(1, pagination.pages) : undefined,
    onSortingChange: (updater) => {
      if (!remote) { setSorting(updater); return; }
      const next = typeof updater === "function" ? updater(serverSorting) : updater;
      navigate({ page: "1", sortBy: next[0] ? sortFields[next[0].id] : undefined, sortOrder: next[0] ? (next[0].desc ? "desc" : "asc") : undefined });
    },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel()
  });

  const rows = table.getRowModel().rows;
  const colSpan = useMemo(() => columns.length, [columns.length]);

  return (
    <div aria-busy={pending} className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3 border-b bg-muted/30 p-4 md:flex-row md:items-center md:justify-between">
        <form className="flex w-full gap-2 md:max-w-lg" onSubmit={(event) => { event.preventDefault(); if (remote) navigate({ search: searchInput.trim(), page: "1" }); }}>
        <label className="relative block w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Search table</span>
          <Input
            value={remote ? searchInput : globalFilter}
            onChange={(event) => remote ? setSearchInput(event.target.value) : setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
          />
        </label>
        {remote ? <Button type="submit" variant="outline" disabled={pending}>Search</Button> : null}
        </form>
        <p className="rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border">
          {pagination ? pagination.total : table.getFilteredRowModel().rows.length} records
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : undefined} className="whitespace-nowrap border-b px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        disabled={pending || (remote && !sortFields[header.column.id]) || !header.column.getCanSort()}
                        className="inline-flex items-center gap-2"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (!remote || sortFields[header.column.id]) ? <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : null}
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
                <tr
                  key={row.id}
                  className={`border-b transition-colors last:border-b-0 hover:bg-muted/30 ${onRowClick ? "cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none" : ""}`}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={onRowClick ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row.original);
                    }
                  } : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick ? "View record details" : undefined}
                >
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
          {pagination ? <label className="flex items-center gap-2 text-sm">Rows
            <select aria-label="Rows per page" value={pagination.limit} disabled={pending} onChange={(event) => navigate({ limit: event.target.value, page: "1" })} className="h-9 rounded-lg border bg-background px-2">
              {[20, 50, 100].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
            </select>
          </label> : null}
          <Button variant="outline" size="sm" onClick={() => pagination ? navigate({ page: String(pagination.page - 1) }) : table.previousPage()} disabled={pending || !table.getCanPreviousPage()}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => pagination ? navigate({ page: String(pagination.page + 1) }) : table.nextPage()} disabled={pending || !table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
