/**
 * Tenant isolation (PRD §12: "client A must never see client B's data,
 * enforced at the query layer, not just the UI").
 *
 * Every read or write that touches tenant data goes through
 * `assertProjectAccess` / `assertClientAccess` first. They resolve the
 * ownership chain Project -> Client -> Agency in the database rather than
 * trusting an id from the request, so a guessed project id from another
 * agency returns 404, not data.
 *
 * AUTH SEAM: MVP has no login (out of Phase 1 scope). `resolveContext` reads
 * the active agency from a cookie and falls back to the single seeded agency
 * in development. When real auth lands, only this function changes — every
 * call site already asks it who the caller is.
 */

import { cookies } from "next/headers";
import { prisma } from "./db";

export const AGENCY_COOKIE = "kf_agency";

export class TenantAccessError extends Error {
  readonly status = 404;
  constructor(message = "Not found") {
    super(message);
    this.name = "TenantAccessError";
  }
}

export interface TenantContext {
  agencyId: string;
}

/**
 * Who is the caller acting as? Cookie first, then the only agency in the
 * database. The fallback is explicitly dev-only: in production an unresolved
 * tenant is an error, never "just pick one".
 */
export async function resolveContext(): Promise<TenantContext> {
  const store = await cookies();
  const fromCookie = store.get(AGENCY_COOKIE)?.value;

  if (fromCookie) {
    const agency = await prisma.agency.findUnique({
      where: { id: fromCookie },
      select: { id: true },
    });
    if (agency) return { agencyId: agency.id };
  }

  if (process.env.NODE_ENV === "production") {
    throw new TenantAccessError("No active agency for this request");
  }

  const first = await prisma.agency.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!first) {
    throw new TenantAccessError(
      "No agency exists yet — run `npm run db:seed` to create the demo tenant.",
    );
  }
  return { agencyId: first.id };
}

/**
 * Confirms the project belongs to this agency and returns it. Throws
 * TenantAccessError (404, not 403 — never confirm that another tenant's id
 * exists) on any mismatch.
 */
export async function assertProjectAccess(agencyId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, client: { agencyId } },
    include: { client: true },
  });
  if (!project) throw new TenantAccessError();
  return project;
}

export async function assertClientAccess(agencyId: string, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId },
  });
  if (!client) throw new TenantAccessError();
  return client;
}

export async function assertClusterAccess(agencyId: string, clusterId: string) {
  const cluster = await prisma.cluster.findFirst({
    where: { id: clusterId, project: { client: { agencyId } } },
    include: { project: true },
  });
  if (!cluster) throw new TenantAccessError();
  return cluster;
}

export async function assertJobAccess(agencyId: string, jobId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, agencyId } });
  if (!job) throw new TenantAccessError();
  return job;
}
