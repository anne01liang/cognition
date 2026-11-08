import { z } from "zod";

/**
 * Server-side table params shared by every list action + <DataTable>.
 * Build an input schema per list with tableQuery(["createdAt", ...]).
 */
export function tableQuery<const S extends readonly [string, ...string[]]>(sortable: S, defaultSort: S[number] = sortable[0]) {
  return z.object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(sortable).default(defaultSort as S[number] & string),
    dir: z.enum(["asc", "desc"]).default("desc"),
    q: z.string().trim().max(100).optional(),
  });
}

export interface TableParams {
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  q?: string;
}

export interface Page<T> {
  rows: T[];
  total: number;
  params: TableParams;
}

export function paging(p: TableParams) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize, orderBy: { [p.sort]: p.dir } };
}

/** Next.js searchParams -> plain object of first values. */
export function firstValues(searchParams: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(searchParams)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined && value !== "") out[k] = value;
  }
  return out;
}
