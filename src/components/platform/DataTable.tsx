import Link from "next/link";
import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { TableParams } from "@/platform/table";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  cell?: (row: T) => ReactNode;
}

export interface Filter {
  name: string;
  label: string;
  options: readonly string[];
}

interface DataTableProps<T> {
  basePath: string;
  columns: Column<T>[];
  rows: T[];
  total: number;
  params: TableParams;
  /** Current extra filter values (e.g. { status: "PENDING" }) to preserve across links. */
  filterValues?: Record<string, string | undefined>;
  filters?: Filter[];
  rowHref?: (row: T) => string;
  searchPlaceholder?: string;
}

/**
 * Server component. All state lives in the URL (?page, pageSize, sort, dir,
 * q, + filters), and the list action does pagination/filter/sort in SQL.
 */
export function DataTable<T extends { id: string }>(props: DataTableProps<T>) {
  const { basePath, columns, rows, total, params, filters = [], filterValues = {}, rowHref } = props;
  const pages = Math.max(1, Math.ceil(total / params.pageSize));

  const href = (overrides: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged: Record<string, string | number | undefined> = {
      q: params.q,
      sort: params.sort,
      dir: params.dir,
      page: params.page,
      pageSize: params.pageSize,
      ...filterValues,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") sp.set(k, String(v));
    return `${basePath}?${sp.toString()}`;
  };

  return (
    <div className="space-y-3">
      <form method="GET" action={basePath} className="flex flex-wrap items-end gap-2">
        <Input name="q" defaultValue={params.q ?? ""} placeholder={props.searchPlaceholder ?? "Search…"} className="w-64" />
        {filters.map((f) => (
          <Select key={f.name} name={f.name} defaultValue={filterValues[f.name] ?? ""} className="w-44" aria-label={f.label}>
            <option value="">All {f.label.toLowerCase()}</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        ))}
        <input type="hidden" name="sort" value={params.sort} />
        <input type="hidden" name="dir" value={params.dir} />
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key}>
                  {c.sortable ? (
                    <Link
                      href={href({ sort: c.key, dir: params.sort === c.key && params.dir === "asc" ? "desc" : "asc", page: 1 })}
                      className="hover:underline"
                    >
                      {c.header}
                      {params.sort === c.key ? (params.dir === "asc" ? " ▲" : " ▼") : ""}
                    </Link>
                  ) : (
                    c.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((c, i) => {
                    const content = c.cell ? c.cell(row) : String((row as Record<string, unknown>)[c.key] ?? "");
                    return (
                      <TableCell key={c.key}>
                        {i === 0 && rowHref ? (
                          <Link href={rowHref(row)} className="font-medium text-blue-700 hover:underline">
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} result{total === 1 ? "" : "s"} · page {params.page} of {pages}
        </span>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm" className={params.page <= 1 ? "pointer-events-none opacity-50" : ""}>
            <Link href={href({ page: Math.max(1, params.page - 1) })}>Previous</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className={params.page >= pages ? "pointer-events-none opacity-50" : ""}>
            <Link href={href({ page: Math.min(pages, params.page + 1) })}>Next</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
