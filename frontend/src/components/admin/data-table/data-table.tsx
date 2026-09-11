"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DataTableDateFilter } from "./data-table-date-filter";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { DataTableViewOptions } from "./data-table-view-options";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 1000];

/** What a page's bulk-action bar gets to work with. */
export type SelectionContext<TData> = {
  /** Selected rows that are on screen right now. */
  rows: TData[];
  clear: () => void;
  selectAllPage: () => void;
  allPageSelected: boolean;
};

export type DataTableQuery = {
  pagination: PaginationState;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
};

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchColumnId?: string;
  searchPlaceholder?: string;
  facetedFilters?: {
    columnId: string;
    title: string;
    options: { label: string; value: string }[];
  }[];
  dateFilter?: {
    columnId: string;
    title?: string;
  };
  initialColumnFilters?: ColumnFiltersState;
  initialColumnVisibility?: VisibilityState;
  /** Where to remember this table's saved column layout. Omit to disable. */
  storageKey?: string;
  getRowClassName?: (row: TData) => string | undefined;
  /** Stable row identity, so ticks survive a background refetch. */
  getRowId?: (row: TData) => string;
  /**
   * Floating panel shown while rows are ticked — the page's bulk actions.
   * Nothing is rendered when it is omitted or when nothing is selected.
   */
  selectionBar?: (ctx: SelectionContext<TData>) => React.ReactNode;
  /** When set, pagination/filtering/sorting run on the server: the table
   * reports query changes and renders `data` as-is. */
  serverSide?: {
    total: number;
    pages: number;
    loading: boolean;
    onQueryChange: (query: DataTableQuery) => void;
  };
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchColumnId,
  searchPlaceholder = "Search...",
  facetedFilters,
  dateFilter,
  initialColumnFilters,
  initialColumnVisibility,
  storageKey,
  getRowClassName,
  getRowId,
  selectionBar,
  serverSide,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    initialColumnFilters ?? []
  );
  const defaultVisibility = React.useMemo(
    () => initialColumnVisibility ?? {},
    // Pages pass an object literal, so pin the identity to the contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(initialColumnVisibility ?? {})]
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(defaultVisibility);

  // A layout saved earlier in this browser wins over the page defaults. Read
  // after mount so the server and the first client render agree.
  React.useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(`nb.columns.${storageKey}`);
      if (saved) setColumnVisibility({ ...defaultVisibility, ...JSON.parse(saved) });
    } catch {
      // Unreadable or corrupt: the page defaults are a fine fallback.
    }
  }, [storageKey, defaultVisibility]);

  const saveColumnLayout = React.useCallback(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(
        `nb.columns.${storageKey}`,
        JSON.stringify(columnVisibility)
      );
    } catch {
      // Storage full or blocked; the layout still holds for this session.
    }
  }, [storageKey, columnVisibility]);

  const resetColumnLayout = React.useCallback(() => {
    setColumnVisibility(defaultVisibility);
    if (!storageKey) return;
    try {
      localStorage.removeItem(`nb.columns.${storageKey}`);
    } catch {
      // Nothing saved to clear.
    }
  }, [storageKey, defaultVisibility]);
  const [rowSelection, setRowSelection] = React.useState({});
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  const isServer = !!serverSide;

  const table = useReactTable({
    data,
    columns,
    getRowId,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    ...(isServer
      ? {
          manualPagination: true,
          manualFiltering: true,
          manualSorting: true,
          pageCount: serverSide.pages,
        }
      : {
          getPaginationRowModel: getPaginationRowModel(),
          getSortedRowModel: getSortedRowModel(),
          getFilteredRowModel: getFilteredRowModel(),
        }),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination,
    },
  });

  // Server mode: report query changes upward, resetting to page 1 whenever
  // filters or sorting change.
  const onQueryChangeRef = React.useRef(serverSide?.onQueryChange);
  onQueryChangeRef.current = serverSide?.onQueryChange;
  const filterKey = JSON.stringify({ columnFilters, sorting });
  const prevFilterKey = React.useRef(filterKey);

  React.useEffect(() => {
    if (!isServer) return;
    if (prevFilterKey.current !== filterKey && pagination.pageIndex !== 0) {
      prevFilterKey.current = filterKey;
      setPagination((p) => ({ ...p, pageIndex: 0 }));
      return;
    }
    prevFilterKey.current = filterKey;
    onQueryChangeRef.current?.({ pagination, sorting, columnFilters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServer, filterKey, pagination.pageIndex, pagination.pageSize]);

  const searchColumn = searchColumnId
    ? table.getColumn(searchColumnId)
    : undefined;

  const totalRows = serverSide
    ? serverSide.total
    : table.getFilteredRowModel().rows.length;

  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);
  const selectionPanel =
    selectionBar && selectedRows.length > 0
      ? selectionBar({
          rows: selectedRows,
          clear: () => table.resetRowSelection(),
          selectAllPage: () => table.toggleAllPageRowsSelected(true),
          allPageSelected: table.getIsAllPageRowsSelected(),
        })
      : null;

  return (
    <div className="relative flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {searchColumn ? (
          <Input
            placeholder={searchPlaceholder}
            value={(searchColumn.getFilterValue() as string) ?? ""}
            onChange={(event) =>
              searchColumn.setFilterValue(event.target.value)
            }
            className="w-[220px] shrink-0"
          />
        ) : null}
        {facetedFilters?.map((filter) => (
          <DataTableFacetedFilter
            key={filter.columnId}
            column={table.getColumn(filter.columnId)}
            title={filter.title}
            options={filter.options}
          />
        ))}
        {dateFilter ? (
          <DataTableDateFilter
            column={table.getColumn(dateFilter.columnId)}
            title={dateFilter.title}
          />
        ) : null}
        {serverSide?.loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
        <div className="flex-1" />
        <DataTableViewOptions
          table={table}
          canSave={!!storageKey}
          onSave={saveColumnLayout}
          onReset={resetColumnLayout}
        />
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody
            className={cn(
              serverSide?.loading && "opacity-60 transition-opacity"
            )}
          >
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className={cn(getRowClassName?.(row.original))}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {serverSide?.loading ? "Loading…" : "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} of {totalRows}{" "}
          row(s) selected.
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows per page</span>
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger size="sm" className="w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {Math.max(table.getPageCount(), 1)}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {selectionPanel}
    </div>
  );
}
