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
 * AUTH SEAM: this is the only file that knows how a caller is identified.
 * `resolveContext` resolves the session -> user -> the user's OWN agencyId.
 * All 26 call sites across 18 files ask it who the caller is and are unchanged
 * by the arrival of real auth, which is what the seam was for.
 *
 * WHAT CHANGED, AND WHY IT MATTERED: the previous version trusted a `kf_agency`
 * cookie holding a raw agency id, and verified only that the agency existed —
 * not that the caller belonged to it. Editing that cookie to any valid agency
 * id granted full access to that tenant. The agency id now comes off the user
 * row reached through a server-side session and is never read from the client.
 */

import { prisma } from "./db";
import { isLocalEnv } from "./env";
import { getSessionUser, type SessionUser } from "./auth/session";

export class TenantAccessError extends Error {
  // Not `readonly status = 404`: subclasses override this, which requires the
  // declared type to be `number` rather than the literal 404.
  readonly status: number = 404;
  constructor(message = "Not found") {
    super(message);
    this.name = "TenantAccessError";
  }
}

/**
 * "You are not signed in" — genuinely different from "this isn't yours".
 *
 * Subclasses TenantAccessError on purpose. `handleError` in lib/api.ts already
 * catches that type and returns `error.status`, so a 401 flows through the
 * existing error path with no change to any route. The 404-vs-403 reasoning
 * below still holds for the parent: we never confirm another tenant's ids
 * exist. Being unauthenticated leaks nothing, so 401 is safe and honest here.
 */
export class UnauthenticatedError extends TenantAccessError {
  readonly status: number = 401;
  constructor(message = "Sign in to continue") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export interface TenantContext {
  agencyId: string;
  userId: string;
  role: string;
}

/**
 * Dev fast path — explicit, opt-in, and impossible in production.
 *
 * Set DEV_AUTO_LOGIN_EMAIL in .env to skip the login form locally. It resolves
 * a NAMED seeded user, so the agency still comes from a real user row; it is
 * not the old "pick whatever agency sorts first" behaviour, which silently
 * chose a tenant nobody had authenticated as.
 */
async function devAutoLogin(): Promise<TenantContext | null> {
  // Allow-list, not `!== "production"`. This branch signs a request in with
  // no credentials at all, so an unset or mistyped NODE_ENV taking it would
  // be a silent full authentication bypass.
  if (!isLocalEnv()) return null;
  const email = process.env.DEV_AUTO_LOGIN_EMAIL;
  if (!email) return null;

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, agencyId: true, role: true },
  });
  if (!user) return null;

  return { agencyId: user.agencyId, userId: user.id, role: user.role };
}

/**
 * Who is the caller? Session -> user -> that user's agency.
 *
 * Throws UnauthenticatedError (401) when there is no valid session. Callers
 * that render pages catch it to redirect to /login; API routes let
 * `handleError` turn it into a 401 JSON response automatically.
 */
export async function resolveContext(
  /**
   * Injectable purely for tests — `cookies()` only exists inside a Next
   * request context. Every one of the 26 call sites calls this with no
   * arguments, so the seam contract is unchanged.
   */
  readSession: () => Promise<SessionUser | null> = getSessionUser,
): Promise<TenantContext> {
  const session = await readSession();
  if (session) {
    return { agencyId: session.agencyId, userId: session.userId, role: session.role };
  }

  const dev = await devAutoLogin();
  if (dev) return dev;

  throw new UnauthenticatedError();
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
