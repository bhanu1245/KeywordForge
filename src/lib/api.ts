/**
 * Shared plumbing for the versioned REST API (PRD §11).
 *
 * The route handlers are thin on purpose: parse, authorise, delegate to a
 * service, serialise. All tenant checks go through `lib/tenancy.ts` so the
 * Phase 4 public API can reuse these exact services behind API-key auth
 * without a second, subtly different authorisation path.
 */

import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { TenantAccessError } from "./tenancy";
import { QuotaExceededError } from "./quota/service";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

/**
 * Single place that turns a thrown error into a response. Tenant violations
 * deliberately surface as 404 rather than 403 — a 403 would confirm that
 * another agency's id exists.
 */
export function handleError(error: unknown) {
  // Quota refusals carry their own status (402) and a message that already
  // states usage, cap and what the operation would have cost.
  if (error instanceof QuotaExceededError) {
    return fail(error.message, error.status, {
      pool: error.pool,
      estimate: error.estimate,
      used: error.quota.used,
      limit: error.quota.limit,
      remaining: error.quota.remaining,
      resetsAt: error.quota.windowEnd,
    });
  }
  if (error instanceof TenantAccessError) {
    return fail(error.message, error.status);
  }
  if (error instanceof ZodError) {
    return fail("Invalid request", 422, error.issues);
  }
  console.error("[api]", error);
  const message =
    error instanceof Error ? error.message : "Unexpected server error";
  return fail(message, 500);
}

/** Parses and validates a JSON body, throwing ZodError for `handleError`. */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  return schema.parse(raw);
}

/** Parses query-string params with the same validation path as bodies. */
export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  const url = new URL(request.url);
  const entries: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    entries[key] = all.length > 1 ? all : all[0];
  }
  return schema.parse(entries);
}
