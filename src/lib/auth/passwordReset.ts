/**
 * Password reset.
 *
 * WHY THIS EXISTS NOW: the auth migration backfilled `passwordHash = NULL` for
 * every pre-existing user, which locked them out with no self-service way
 * back in. That was flagged in review and is fixed here rather than deferred
 * again.
 *
 * DELIVERY IS NOT WIRED. There is no SMTP or email provider configured in this
 * project, and inventing one would be pretending. So:
 *   - the token mechanism is real (hashed, single-use, 1-hour expiry);
 *   - `deliverResetLink` is the seam an email provider plugs into;
 *   - with no provider, the link is written to the server log in development
 *     and an owner can generate one for a member from the UI.
 * A production deployment must implement the transport before self-service
 * reset works for someone who cannot read the server log.
 */

import { prisma } from "../db";
import { AuthError } from "./accounts";
import { hashPassword } from "./password";
import { generateToken, hashToken, safeEqualHex } from "./session";

/** One hour. Shorter than an invite: this grants control of an EXISTING account. */
const RESET_TTL_MS = 60 * 60 * 1000;

export interface ResetDelivery {
  /** True when a provider actually sent it. */
  sent: boolean;
  /** Returned only when no provider is configured AND we are not in production. */
  devLink?: string;
}

/**
 * The email seam. Replace the body with a real provider call.
 *
 * Deliberately does NOT throw when unconfigured: a reset request must behave
 * identically whether or not the address exists, and throwing here would turn
 * a missing provider into an account-enumeration oracle.
 */
async function deliverResetLink(email: string, link: string): Promise<ResetDelivery> {
  // if (process.env.EMAIL_PROVIDER_KEY) { await provider.send(...); return { sent: true }; }

  if (process.env.NODE_ENV !== "production") {
    console.log(`[auth] password reset link for ${email}: ${link}`);
    return { sent: false, devLink: link };
  }
  console.warn(
    `[auth] password reset requested for ${email} but no email provider is configured — link not delivered.`,
  );
  return { sent: false };
}

/**
 * Starts a reset. ALWAYS reports success to the caller regardless of whether
 * the address exists — otherwise this endpoint enumerates accounts.
 */
export async function requestPasswordReset(
  emailInput: string,
  origin: string,
): Promise<ResetDelivery> {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { sent: false };

  // Invalidate outstanding tokens so an older link cannot be used after a
  // newer one is issued.
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

  const token = generateToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  return deliverResetLink(email, `${origin}/reset?token=${encodeURIComponent(token)}`);
}

/**
 * Owner-initiated reset for a member of the same agency.
 *
 * This is what unblocks the passwordHash = NULL users today, with no email
 * provider: an owner generates the link and passes it on out of band.
 */
export async function createResetLinkForMember(
  agencyId: string,
  requestedById: string,
  targetUserId: string,
): Promise<{ token: string; expiresAt: Date; email: string }> {
  const requester = await prisma.user.findFirst({ where: { id: requestedById, agencyId } });
  if (!requester) throw new AuthError("Not found", 404);
  if (requester.role !== "owner") {
    throw new AuthError("Only an agency owner can issue reset links.", 403);
  }

  // Scoped to the same agency — an owner cannot reset a stranger's password.
  const target = await prisma.user.findFirst({ where: { id: targetUserId, agencyId } });
  if (!target) throw new AuthError("Not found", 404);

  await prisma.passwordResetToken.deleteMany({ where: { userId: target.id, usedAt: null } });

  const token = generateToken();
  const row = await prisma.passwordResetToken.create({
    data: {
      userId: target.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  return { token, expiresAt: row.expiresAt, email: target.email };
}

/** Describes a token for the reset form without revealing anything sensitive. */
export async function peekResetToken(token: string) {
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { email: true } } },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  return { email: row.user.email };
}

/**
 * Consumes a token and sets the new password.
 *
 * The token is burned with an atomic conditional update — `usedAt: null` in
 * the where clause — for the same reason invites are: two concurrent submits
 * must not both succeed.
 */
export async function completePasswordReset(token: string, newPassword: string) {
  const presented = hashToken(token);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: presented },
    include: { user: true },
  });

  if (
    !row ||
    row.usedAt ||
    row.expiresAt.getTime() <= Date.now() ||
    !safeEqualHex(presented, row.tokenHash)
  ) {
    throw new AuthError("That reset link is invalid or has expired.", 403);
  }

  // Hash before the transaction so a weak password fails without burning the
  // token — otherwise a rejected attempt would consume the user's only link.
  const passwordHash = await hashPassword(newPassword);

  return prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const user = await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    });
    // Every existing session is revoked: a reset usually means the account was
    // compromised, and leaving old cookies alive would defeat the point.
    await tx.session.deleteMany({ where: { userId: row.userId } });
    return user;
  });
}
