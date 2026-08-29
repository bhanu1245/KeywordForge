/**
 * Session issuing and verification.
 *
 * DESIGN — opaque server-side tokens, not signed cookies:
 * The cookie holds 32 bytes of CSPRNG output, base64url-encoded. Only its
 * SHA-256 is stored. Verification is a database lookup, so:
 *   - there is nothing in the cookie to forge — a tampered token hashes to a
 *     value no row holds and simply misses;
 *   - no signing key exists to leak or rotate;
 *   - sessions are revocable, which a stateless signed cookie or JWT cannot
 *     be without inventing a denylist.
 *
 * The cost is one indexed lookup per request, which for this app is the same
 * round trip the tenancy check already makes.
 *
 * NOTE: no custom crypto. `randomBytes` and `createHash` are Node's standard
 * primitives; the only choice made here is to store the digest rather than
 * the token.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "../db";
import { isLocalEnv } from "../env";
import { SESSION_COOKIE } from "./cookie";

export { SESSION_COOKIE };

/** 30 days. Long enough not to nag, short enough that a stolen cookie ages out. */
const SESSION_TTL_DAYS = 30;

/** 256 bits of entropy — not guessable, no need for a signature. */
const TOKEN_BYTES = 32;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are guarded
 * first. That guard leaks only the LENGTH of a SHA-256 digest, which is a
 * constant 64 hex chars — nothing an attacker does not already know.
 *
 * Never replace this with `===`. String equality short-circuits at the first
 * differing byte, which turns the comparison into a timing oracle you can walk
 * one character at a time.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export interface SessionUser {
  userId: string;
  agencyId: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Creates the session ROW and returns the plaintext token.
 *
 * Split from `createSession` so the session lifecycle can be tested without a
 * Next.js request context — `cookies()` only exists inside one.
 */
export async function createSessionRecord(
  userId: string,
  userAgent?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent ?? null },
  });

  // Opportunistic housekeeping, fire-and-forget: a slow or failing sweep must
  // never delay or break the login that triggered it.
  void maybePruneExpiredSessions();

  return { token, expiresAt };
}

/** Issues a session and sets the cookie. Returns the plaintext token once. */
export async function createSession(
  userId: string,
  userAgent?: string | null,
): Promise<string> {
  const { token, expiresAt } = await createSessionRecord(userId, userAgent);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true, // never readable by JS — blocks XSS cookie theft
    // Secure by default. Dropped ONLY for a declared local environment, where
    // there is no https to send it over. Phrased as "not local" rather than
    // "is production" so an unset NODE_ENV keeps the cookie https-only rather
    // than quietly allowing it over plain http.
    secure: !isLocalEnv(),
    sameSite: "lax", // survives top-level navigation, blocks cross-site POST
    path: "/",
    expires: expiresAt,
  });

  return token;
}

/**
 * Resolves a raw token to a user, or null.
 *
 * Returns the user's agencyId read FROM THE USER ROW — never from anything the
 * client supplied. This is the property that makes tenant spoofing impossible
 * at this layer: a tampered token hashes to a value no row holds and misses.
 */
export async function resolveSessionToken(
  token: string | undefined | null,
): Promise<SessionUser | null> {
  if (!token) return null;

  // The RAW token is never compared or queried — only its SHA-256. A stolen
  // database therefore yields no usable cookie.
  const presentedHash = hashToken(token);

  const session = await prisma.session
    .findUnique({
      where: { tokenHash: presentedHash },
      include: { user: true },
    })
    .catch(() => null);

  if (!session) return null;

  // Re-verify the digest in constant time.
  //
  // The index lookup above already matched, so this cannot reject a genuine
  // session. It is here because the lookup's own comparison happens inside
  // SQLite's B-tree and is not constant-time, and because it makes the
  // security property explicit in code: a future refactor to
  // `session.tokenHash === presentedHash` would be a silent regression to a
  // short-circuiting comparison.
  if (!safeEqualHex(presentedHash, session.tokenHash)) return null;

  // Expired sessions are deleted on sight rather than left to accumulate.
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => null);
    return null;
  }

  return {
    userId: session.user.id,
    agencyId: session.user.agencyId,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
}

/** Reads the session cookie and resolves it. Requires a request context. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveSessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Deletes the current session server-side and clears the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    // Delete by hash so a logout genuinely revokes it server-side; clearing
    // the cookie alone would leave a working token in anyone's hands.
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => null);
  }

  store.delete(SESSION_COOKIE);
}

/** Housekeeping: drop expired rows. Safe to call from a cron or on boot. */
export async function pruneExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}

/**
 * Roughly 1 in 20 calls actually sweeps.
 *
 * WHY SESSION CREATION AND NOT THE READ PATH: expired rows accumulate in
 * proportion to how many sessions get CREATED, not how many requests are
 * served, so pruning here scales with the thing that causes the problem. The
 * read path (`resolveSessionToken`) runs on every authenticated request, and
 * putting even a 1-in-N `deleteMany` there would add write contention to the
 * hottest query in the app for no extra benefit.
 *
 * Login is also already the slowest endpoint — bcrypt costs ~250ms — so an
 * occasional indexed delete is invisible next to it.
 *
 * This is NOT a substitute for a scheduled job; it is the cheap safe thing
 * until the scheduler decision is made (see the deployment notes).
 */
const PRUNE_PROBABILITY = 0.05;

export async function maybePruneExpiredSessions(
  /** Injectable so the behaviour is testable without relying on chance. */
  roll: number = Math.random(),
): Promise<number | null> {
  if (roll >= PRUNE_PROBABILITY) return null;
  // Never let housekeeping fail the request that triggered it.
  return pruneExpiredSessions().catch(() => null);
}
