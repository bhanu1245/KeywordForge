/**
 * Password hashing.
 *
 * bcryptjs, not a hand-rolled construction. The only decisions made here are
 * cost factor and the timing-safety behaviour below; the primitive itself is
 * the library's.
 *
 * Why bcryptjs over native bcrypt/argon2: both native options need a C++
 * toolchain to install, which this project cannot assume (the machine it was
 * built on has no build tools). A pure-JS bcrypt is slower per hash, but at
 * cost 12 it is still ~250ms — comfortably in the right range for a login
 * endpoint, and correctness beats a dependency that may not install.
 */

import bcrypt from "bcryptjs";

/**
 * Production cost factor. Deliberately slow: this is the whole defence if the
 * database leaks. Raising it later is safe — bcrypt encodes the cost in the
 * hash, so existing hashes keep verifying.
 */
const PRODUCTION_COST = 12;

/**
 * BCRYPT_COST is honoured ONLY when NODE_ENV === "test".
 *
 * The gate is deliberately narrow. An earlier version allowed the override
 * whenever NODE_ENV !== "production", which meant any unset or mistyped
 * NODE_ENV (the default in plenty of deployment setups) would silently accept
 * a cost of 4. Requiring an explicit "test" means the weak path cannot be
 * reached by omission — only by actively declaring a test environment.
 *
 * Rationale for having it at all: at cost 12 the auth suite's ~30 hashes take
 * 40 seconds, and a slow suite is one people stop running.
 */
const COST = (() => {
  if (process.env.NODE_ENV !== "test") return PRODUCTION_COST;
  const override = Number(process.env.BCRYPT_COST);
  // Never below bcrypt's own minimum of 4.
  return Number.isInteger(override) && override >= 4 && override <= 15
    ? override
    : PRODUCTION_COST;
})();

/** Exposed so tests can assert the production cost is what we claim. */
export function activeCost(): number {
  return COST;
}

/** Rejects passwords weak enough to be worth blocking at the door. */
export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return bcrypt.hash(plain, COST);
}

/**
 * A bcrypt hash of a throwaway value, used to burn the same CPU time when no
 * user (or no password) was found.
 *
 * Without this, a missing account returns in ~0ms while a real one takes
 * ~250ms, and that difference is a reliable oracle for enumerating which
 * email addresses have accounts.
 */
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-safety", COST);

/**
 * Verifies a password. `storedHash` may be null for an account that has no
 * password set (future OAuth-only users) — that case must return false, never
 * true. It still burns the comparison time so it is indistinguishable from a
 * wrong password.
 */
export async function verifyPassword(
  plain: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) {
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, storedHash);
}
