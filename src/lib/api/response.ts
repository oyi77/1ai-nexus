import { NextResponse } from "next/server";

export interface ApiResponse<T> {
  data: T | null;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    hasMore?: boolean;
    cursor?: string;
  };
  error: string | null;
}

export function apiSuccess<T>(data: T, meta?: ApiResponse<T>["meta"]): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ data, meta, error: null });
}

export function apiError(message: string, status = 400): NextResponse<ApiResponse<null>> {
  return NextResponse.json({ data: null, error: message }, { status });
}

export function apiPaginated<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): NextResponse<ApiResponse<T[]>> {
  return NextResponse.json({
    data,
    meta: { page, pageSize, total, hasMore: page * pageSize < total },
    error: null,
  });
}
export function cacheHeaders<T>(response: NextResponse<T>, maxAge: number): NextResponse<T> {
  response.headers.set("Cache-Control", `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
  return response;
}

/**
 * Unified JSON response — always returns { data, error } envelope.
 * Use this instead of raw NextResponse.json for consistent API responses.
 */
export function apiJson<T>(
  data: T,
  options?: { error?: string; status?: number; headers?: Record<string, string> }
): NextResponse {
  const { error = null, status = 200, headers = {} } = options ?? {}
  const resp = NextResponse.json({ data, error }, { status })
  for (const [key, value] of Object.entries(headers)) {
    resp.headers.set(key, value)
  }
  return resp
}
