/**
 * Signup, login and invites.
 *
 * THE RULE THAT MATTERS: signup never joins an existing agency by name or id.
 * It either creates a brand-new agency (the signer-up becomes its owner) or
 * consumes a one-time invite token an existing owner generated. Anything
 * looser — "type your agency name to join" — is a self-serve path into another
 * tenant's data.
 */

import { prisma } from "../db";
import { hashPassword, verifyPassword } from "./password";
import { generateToken, hashToken } from "./session";
import {
  DEFAULT_CONFIG,
  checkLimit,
  clearKey,
  emailKey,
  ipKey,
  recordFailure,
  type RateLimitConfig,
} from "./rateLimit";

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

const INVITE_TTL_DAYS = 7;

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "agency"
  );
}

/** Slugs are unique; append a counter rather than failing the signup. */
async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 200; i++) {
    const taken = await prisma.agency.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  /** Creates a new agency. Ignored when an invite token is supplied. */
  agencyName?: string;
  /** Joins the invite's agency instead of creating one. */
  inviteToken?: string;
}

/**
 * Creates a user. With an invite: joins that agency. Without: creates a new
 * agency and makes this user its owner.
 */
export async function signup(input: SignupInput) {
  const email = normaliseEmail(input.email);
  const name = input.name.trim();
  if (!email.includes("@")) throw new AuthError("Enter a valid email address.");
  if (!name) throw new AuthError("Enter your name.");

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // Deliberately explicit. Email existence is already discoverable by
    // attempting signup, so hiding it here buys nothing and costs usability.
    throw new AuthError("An account with that email already exists.", 409);
  }

  // Hash before any writes so a weak password fails without leaving a
  // half-created agency behind.
  const passwordHash = await hashPassword(input.password);

  if (input.inviteToken) {
    const invite = await prisma.invite.findUnique({
      where: { tokenHash: hashToken(input.inviteToken) },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= Date.now()) {
      throw new AuthError("That invite link is invalid or has expired.", 403);
    }
    // If the invite named an email, only that address may use it.
    if (invite.email && normaliseEmail(invite.email) !== email) {
      throw new AuthError("That invite was issued for a different email address.", 403);
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          agencyId: invite.agencyId,
          email,
          name,
          role: invite.role,
          passwordHash,
        },
      });
      // Single use: burn the invite in the same transaction that uses it, so
      // two concurrent signups cannot both consume one link.
      await tx.invite.update({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      return user;
    });
  }

  const agencyName = (input.agencyName ?? "").trim() || `${name}'s agency`;
  const slug = await uniqueSlug(slugify(agencyName));

  return prisma.$transaction(async (tx) => {
    const agency = await tx.agency.create({ data: { name: agencyName, slug } });
    return tx.user.create({
      data: { agencyId: agency.id, email, name, role: "owner", passwordHash },
    });
  });
}

/**
 * Verifies credentials. Returns the user or throws.
 *
 * The same message and roughly the same timing for "no such user" and "wrong
 * password" — see verifyPassword, which burns a comparison when there is no
 * hash to check against.
 */
export async function login(emailInput: string, password: string) {
  const email = normaliseEmail(emailInput);
  const user = await prisma.user.findUnique({ where: { email } });

  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) {
    throw new AuthError("Incorrect email or password.", 401);
  }

  await prisma.user
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => null);

  return user;
}

/**
 * Login with brute-force throttling. This is what the route calls; bare
 * `login` stays exported for tests that need the unthrottled primitive.
 *
 * The lockout is checked BEFORE the password is verified, so a locked-out
 * caller is rejected even with correct credentials — otherwise an attacker who
 * eventually guesses right would be waved through, defeating the point.
 */
export async function attemptLogin(
  emailInput: string,
  password: string,
  ip: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
) {
  const email = normaliseEmail(emailInput);
  const keys = [emailKey(email), ipKey(ip)];

  for (const key of keys) {
    const status = checkLimit(key, config, now);
    if (status.limited) {
      throw new AuthError(
        `Too many failed sign-in attempts. Try again in ${Math.ceil(
          status.retryAfterSeconds / 60,
        )} minute(s).`,
        429,
      );
    }
  }

  try {
    const user = await login(email, password);
    // Only the email counter is cleared — see clearKey's note on why the IP
    // budget must survive a successful login.
    clearKey(emailKey(email));
    return user;
  } catch (error) {
    for (const key of keys) recordFailure(key, config, now);
    throw error;
  }
}

/**
 * Owner-only. Returns the plaintext token ONCE — only its hash is stored, so
 * it cannot be shown again.
 */
export async function createInvite(input: {
  agencyId: string;
  createdById: string;
  role?: string;
  email?: string;
}) {
  const creator = await prisma.user.findFirst({
    where: { id: input.createdById, agencyId: input.agencyId },
  });
  if (!creator) throw new AuthError("Not found", 404);
  if (creator.role !== "owner") {
    throw new AuthError("Only an agency owner can invite people.", 403);
  }

  const token = generateToken();
  const invite = await prisma.invite.create({
    data: {
      agencyId: input.agencyId,
      createdById: input.createdById,
      tokenHash: hashToken(token),
      role: input.role === "owner" ? "owner" : "member",
      email: input.email ? normaliseEmail(input.email) : null,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  return { id: invite.id, token, expiresAt: invite.expiresAt };
}

/** Describes an invite for the signup screen without revealing the token. */
export async function peekInvite(token: string) {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { agency: { select: { name: true } } },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return { agencyName: invite.agency.name, role: invite.role, email: invite.email };
}
