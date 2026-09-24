'use client';

// MCPForge — W0-J10: `DataTable` — real `<table>` semantics, one tab stop,
// virtualised past ~200 rows. See 03 §3.4, §12.2, §12.6 (read in full for
// this task; excerpted in the task prompt).
//
// JUDGMENT CALL — reuse of `../ui/table.tsx` vs custom markup: the shadcn
// `Table`/`TableRow`/`TableCell` primitives (W0-J4) wrap plain function
// components with no `forwardRef`, and this component needs a `ref` on
// every `<td>` to drive roving-tabindex focus and on the scroll container
// to drive `@tanstack/react-virtual`'s measurement. Rather than fork or
// modify those primitives (out of this task's `touches:` scope — it may
// only *import* from `../ui`), `DataTable` owns its DOM directly with the
// same Tailwind utility classes `../ui/table.tsx` uses (`w-full text-sm`,
// `border-b`, `h-10 px-2 text-left align-middle font-medium`, ...) so the
// two "look" identical and only their ref-forwarding capability differs.
// The outer `overflow-x-auto` wrapper is copied from `../ui/table.tsx`
// verbatim (03 §12.6: the table scrolls horizontally within its own
// container, never the page body).
//
// JUDGMENT CALL — caption visibility: 03 §12.6 requires "captions" on real
// tables but does not settle whether a visually-hidden caption is
// acceptable when a heading already names the table on the page. This
// component always renders a real `<caption>` in the DOM (never omitted —
// that satisfies the letter of "tables are real tables ... with captions")
// and takes a `captionVisible` prop, default `false` (sr-only), because in
// every consuming route this task can see coming (Catalog, Activity,
// Approvals — 03 §5.3) the table sits directly under a page or section
// `<h1>`/`<h2>` that already names it, and a second visible caption would
// be redundant chrome. A caller that genuinely needs a visible caption
// (no adjacent heading) can pass `captionVisible`.
import * as React from 'react';
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from 'cn';

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Real `<caption>` text — always rendered in the DOM. See judgment call above. */
  caption: string;
  /** Render the caption visibly instead of `sr-only`. Default false. */
  captionVisible?: boolean;
  /** Fired when `Enter` is pressed on a row, or a row is otherwise opened. */
  onRowOpen?: (row: TData, index: number) => void;
  /** Row count past which rows are virtualised. 03 §3.4: "past ~200 items". */
  virtualizeThreshold?: number;
  /** Estimated row height in px, for the virtualizer. */
  estimateRowHeight?: number;
  /** Stable row key extractor; defaults to the row index. */
  getRowId?: (row: TData, index: number) => string;
  /** True while data is loading — suppresses the result-count announcement. */
  isLoading?: boolean;
  className?: string;
}

const DEFAULT_VIRTUALIZE_THRESHOLD = 200;
const DEFAULT_ROW_HEIGHT = 36;

export function DataTable<TData>({
  columns,
  data,
  caption,
  captionVisible = false,
  onRowOpen,
  virtualizeThreshold = DEFAULT_VIRTUALIZE_THRESHOLD,
  estimateRowHeight = DEFAULT_ROW_HEIGHT,
  getRowId,
  isLoading = false,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(getRowId ? { getRowId: (row: TData, index: number) => getRowId(row, index) } : {}),
  });

  const rows = table.getRowModel().rows;
  const shouldVirtualize = rows.length > virtualizeThreshold;

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 12,
    enabled: shouldVirtualize,
    // jsdom (unit tests) has no real layout, so the scroll container
    // measures 0x0 and the virtualizer would otherwise render nothing.
    // `initialRect` gives it a plausible viewport before ResizeObserver
    // ever fires — real browsers overwrite this on first measurement, so
    // it is a test/SSR affordance, not a production behaviour. See the
    // component test file for how this is exercised and its documented
    // limitation.
    initialRect: { width: 0, height: 8 * estimateRowHeight },
  });

  const virtualRows = shouldVirtualize ? rowVirtualizer.getVirtualItems() : null;
  const visibleRowIndexes = virtualRows
    ? virtualRows.map((v) => v.index)
    : rows.map((_, i) => i);

  // ---- roving tabindex ------------------------------------------------
  const columnCount = table.getVisibleLeafColumns().length;
  const [active, setActive] = React.useState({ row: 0, col: 0 });
  const cellRefs = React.useRef(new Map<string, HTMLTableCellElement>());
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const insideGrid = React.useRef(false);

  const clampRow = (r: number) => Math.max(0, Math.min(rows.length - 1, r));
  const clampCol = (c: number) => Math.max(0, Math.min(columnCount - 1, c));

  const focusCell = (row: number, col: number) => {
    if (shouldVirtualize) {
      rowVirtualizer.scrollToIndex(row);
    }
    // Deferred so a just-scrolled-into-view row's cell exists in the DOM.
    requestAnimationFrame(() => {
      cellRefs.current.get(`${row}:${col}`)?.focus();
    });
  };

  const handleContainerFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!insideGrid.current) {
      const related = event.relatedTarget as HTMLElement | null;
      previousFocusRef.current = related ?? null;
      insideGrid.current = true;
    }
  };

  const handleContainerBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !event.currentTarget.contains(next)) {
      insideGrid.current = false;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const row = clampRow(active.row + 1);
        setActive({ row, col: active.col });
        focusCell(row, active.col);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const row = clampRow(active.row - 1);
        setActive({ row, col: active.col });
        focusCell(row, active.col);
        break;
      }
      case 'ArrowRight': {
        event.preventDefault();
        const col = clampCol(active.col + 1);
        setActive({ row: active.row, col });
        focusCell(active.row, col);
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        const col = clampCol(active.col - 1);
        setActive({ row: active.row, col });
        focusCell(active.row, col);
        break;
      }
      case 'Enter': {
        const row = rows[active.row];
        if (row) {
          event.preventDefault();
          onRowOpen?.(row.original, active.row);
        }
        break;
      }
      case 'Escape': {
        event.preventDefault();
        insideGrid.current = false;
        previousFocusRef.current?.focus();
        break;
      }
      default:
        break;
    }
  };

  // ---- result-count announcement --------------------------------------
  // Announce once per completed load, not on every render — same
  // "announce on the crossing, not continuously" discipline as
  // `PlanExpiryCountdown` (W0-J7). Here the crossing is `isLoading`
  // true -> false, or the row count changing while already loaded.
  const [announcement, setAnnouncement] = React.useState('');
  const wasLoading = React.useRef(isLoading);
  const lastAnnouncedCount = React.useRef<number | null>(null);

  React.useEffect(() => {
    const justFinishedLoading = wasLoading.current && !isLoading;
    const countChangedWhileIdle =
      !isLoading && !wasLoading.current && lastAnnouncedCount.current !== rows.length;

    if (!isLoading && (justFinishedLoading || countChangedWhileIdle)) {
      lastAnnouncedCount.current = rows.length;
      setAnnouncement(`${rows.length} ${rows.length === 1 ? 'item' : 'items'}.`);
    }
    wasLoading.current = isLoading;
  }, [isLoading, rows.length]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="datatable-announce"
      >
        {announcement}
      </div>

      <div
        ref={scrollRef}
        role="group"
        aria-roledescription="data grid"
        data-testid="datatable-scroll"
        className="relative w-full overflow-x-auto rounded-md border border-line"
        onFocus={handleContainerFocus}
        onBlur={handleContainerBlur}
        onKeyDown={handleKeyDown}
      >
        <table data-slot="table" className="w-full caption-bottom text-sm">
          <caption
            className={cn('mt-4 text-left text-sm text-text-2', !captionVisible && 'sr-only')}
          >
            {caption}
          </caption>
          <thead className="[&_tr]:border-b border-line">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-line">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortState = header.column.getIsSorted();
                  const ariaSort: React.AriaAttributes['aria-sort'] = !canSort
                    ? undefined
                    : sortState === 'asc'
                      ? 'ascending'
                      : sortState === 'desc'
                        ? 'descending'
                        : 'none';

                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={ariaSort}
                      className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-text-1"
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden="true" className="text-text-3">
                            {sortState === 'asc' ? '▲' : sortState === 'desc' ? '▼' : ''}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody
            style={
              shouldVirtualize
                ? { position: 'relative', display: 'block', height: rowVirtualizer.getTotalSize() }
                : undefined
            }
          >
            {visibleRowIndexes.map((rowIndex) => {
              const row = rows[rowIndex];
              if (!row) return null;
              const virtualItem = virtualRows?.find((v) => v.index === rowIndex);

              return (
                <tr
                  key={row.id}
                  data-testid={`datatable-row-${rowIndex}`}
                  className="border-b border-line hover:bg-surface-2"
                  style={
                    virtualItem
                      ? {
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          display: 'table',
                          tableLayout: 'fixed',
                          transform: `translateY(${virtualItem.start}px)`,
                        }
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell, colIndex) => {
                    const isActive = active.row === rowIndex && active.col === colIndex;
                    return (
                      <td
                        key={cell.id}
                        ref={(el) => {
                          if (el) cellRefs.current.set(`${rowIndex}:${colIndex}`, el);
                          else cellRefs.current.delete(`${rowIndex}:${colIndex}`);
                        }}
                        tabIndex={isActive ? 0 : -1}
                        data-testid={`datatable-cell-${rowIndex}-${colIndex}`}
                        className="p-2 align-middle whitespace-nowrap"
                        onFocus={() => setActive({ row: rowIndex, col: colIndex })}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
