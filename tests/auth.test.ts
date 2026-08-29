import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * Auth tests run against a THROWAWAY SQLite file, not dev.db.
 *
 * DATABASE_URL is set before any module that constructs a PrismaClient is
 * imported — src/lib/db.ts builds its client at import time, so the modules
 * below are pulled in dynamically after the environment is prepared.
 */
const dir = mkdtempSync(path.join(tmpdir(), "kf-auth-"));
const dbFile = path.join(dir, "auth-test.db");
process.env.DATABASE_URL = `file:${dbFile.split(path.sep).join("/")}`;
// The dev fast path must not mask the "no session" cases.
delete process.env.DEV_AUTO_LOGIN_EMAIL;
// Cheap hashing for speed. The properties under test — round-trip, salting,
// no plaintext, null-hash rejection — hold at any cost factor; production is
// pinned at 12 regardless of this value. NODE_ENV must be "test" for the
// override to be honoured at all.
// Cast: @types/node declares NODE_ENV read-only, but the test runner has to
// set it before the modules under test read it.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.BCRYPT_COST = "4";

// Prisma's JS entrypoint is invoked directly rather than through `npx`:
// Node 24 refuses to spawn a `.cmd` shim without a shell (EINVAL), and going
// through a shell here would be both slower and platform-specific.
execFileSync(
  process.execPath,
  [
    path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
    "db",
    "push",
    "--skip-generate",
    // No --force-reset: the file is freshly minted in a temp dir on every
    // run, so there is nothing to reset, and Prisma refuses destructive flags
    // in non-interactive/agent environments anyway.
  ],
  { env: process.env, stdio: "pipe" },
);

const { prisma } = await import("../src/lib/db.ts");
const { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH, activeCost } = await import(
  "../src/lib/auth/password.ts"
);
const { createSessionRecord, resolveSessionToken, hashToken, safeEqualHex } = await import(
  "../src/lib/auth/session.ts"
);
const { checkLimit, recordFailure, resetAllLimits, emailKey, ipKey } = await import(
  "../src/lib/auth/rateLimit.ts"
);
const { resolveContext, UnauthenticatedError, TenantAccessError } = await import(
  "../src/lib/tenancy.ts"
);
const { signup, login, attemptLogin, createInvite, AuthError } = await import(
  "../src/lib/auth/accounts.ts"
);
const { readFileSync } = await import("node:fs");

/**
 * Source with comments removed.
 *
 * The structural guards below must assert on CODE. Reading the raw file makes
 * them fire on prose — the comments in these modules deliberately quote the
 * very anti-patterns being guarded against ("a refactor to `x === y` would
 * be a regression"), which a naive regex reads as the regression itself.
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/^\s*\/\/.*$/gm, " "); // whole-line comments
}

// Two tenants, so "returns the RIGHT agency" is a real assertion.
let userA: { id: string; agencyId: string };
let userB: { id: string; agencyId: string };

before(async () => {
  const a = await signup({
    email: "a@alpha.test",
    password: "alpha-password-1",
    name: "Alpha Owner",
    agencyName: "Alpha Agency",
  });
  const b = await signup({
    email: "b@beta.test",
    password: "beta-password-1",
    name: "Beta Owner",
    agencyName: "Beta Agency",
  });
  userA = { id: a.id, agencyId: a.agencyId };
  userB = { id: b.id, agencyId: b.agencyId };
  assert.notEqual(userA.agencyId, userB.agencyId);
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("password hashing", () => {
  it("round-trips and rejects the wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    assert.equal(await verifyPassword("correct-horse-battery", hash), true);
    assert.equal(await verifyPassword("wrong-password-here", hash), false);
  });

  it("never stores the plaintext anywhere in the hash", async () => {
    const secret = "super-secret-passphrase";
    const hash = await hashPassword(secret);
    assert.ok(!hash.includes(secret));
    assert.match(hash, /^\$2[aby]\$/); // bcrypt, not something homemade
  });

  it("salts — the same password hashes differently every time", async () => {
    const a = await hashPassword("identical-password");
    const b = await hashPassword("identical-password");
    assert.notEqual(a, b);
    assert.equal(await verifyPassword("identical-password", a), true);
    assert.equal(await verifyPassword("identical-password", b), true);
  });

  it("refuses passwords below the minimum length", async () => {
    await assert.rejects(() => hashPassword("a".repeat(MIN_PASSWORD_LENGTH - 1)));
  });

  /** A null hash must never authenticate — that would be a total bypass. */
  it("returns false for a user with no password set", async () => {
    assert.equal(await verifyPassword("anything", null), false);
    assert.equal(await verifyPassword("anything", undefined), false);
    assert.equal(await verifyPassword("", null), false);
  });

  it("stores only the hash on the user row", async () => {
    const row = await prisma.user.findUnique({ where: { email: "a@alpha.test" } });
    assert.ok(row?.passwordHash);
    assert.ok(!row.passwordHash.includes("alpha-password-1"));
  });
});

describe("resolveContext", () => {
  it("throws UnauthenticatedError (401) with no session", async () => {
    await assert.rejects(
      () => resolveContext(async () => null),
      (error: unknown) => {
        assert.ok(error instanceof UnauthenticatedError);
        // 401, not 404 — "you are not signed in" is distinct from
        // "this isn't yours".
        assert.equal((error as { status: number }).status, 401);
        // Subclassing keeps the existing handleError path working unchanged.
        assert.ok(error instanceof TenantAccessError);
        return true;
      },
    );
  });

  it("returns the session user's OWN agency", async () => {
    const { token } = await createSessionRecord(userA.id);
    const session = await resolveSessionToken(token);
    const ctx = await resolveContext(async () => session);

    assert.equal(ctx.agencyId, userA.agencyId);
    assert.equal(ctx.userId, userA.id);
    assert.notEqual(ctx.agencyId, userB.agencyId);
  });

  it("cannot be steered to another agency by a guessable id", async () => {
    // The old kf_agency cookie held a raw agency id and trusted it. Nothing in
    // the session carries an agency any more: it is read off the user row.
    const { token } = await createSessionRecord(userB.id);
    const session = await resolveSessionToken(token);
    assert.equal(session?.agencyId, userB.agencyId);

    const ctx = await resolveContext(async () => session);
    assert.equal(ctx.agencyId, userB.agencyId);
    assert.notEqual(ctx.agencyId, userA.agencyId);
  });
});

describe("session tokens", () => {
  it("resolves a valid token to the right user", async () => {
    const { token } = await createSessionRecord(userA.id);
    const session = await resolveSessionToken(token);
    assert.equal(session?.userId, userA.id);
    assert.equal(session?.agencyId, userA.agencyId);
  });

  /** Tamper test: flip one character and confirm rejection, not acceptance. */
  it("rejects a tampered token", async () => {
    const { token } = await createSessionRecord(userA.id);
    assert.ok(await resolveSessionToken(token), "control: original must work");

    for (const index of [0, Math.floor(token.length / 2), token.length - 1]) {
      const original = token[index];
      const replacement = original === "A" ? "B" : "A";
      const tampered = token.slice(0, index) + replacement + token.slice(index + 1);
      assert.notEqual(tampered, token);
      assert.equal(
        await resolveSessionToken(tampered),
        null,
        `tampered token at index ${index} was accepted`,
      );
    }
  });

  it("rejects a token belonging to nobody", async () => {
    assert.equal(await resolveSessionToken("not-a-real-token"), null);
    assert.equal(await resolveSessionToken(""), null);
    assert.equal(await resolveSessionToken(undefined), null);
  });

  it("stores only the hash — the raw token is never persisted", async () => {
    const { token } = await createSessionRecord(userA.id);
    const rows = await prisma.session.findMany({ select: { tokenHash: true } });
    assert.ok(rows.every((r) => r.tokenHash !== token));
    assert.ok(rows.some((r) => r.tokenHash === hashToken(token)));
  });

  it("rejects an expired session and cleans it up", async () => {
    const { token } = await createSessionRecord(userA.id);
    await prisma.session.update({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal(await resolveSessionToken(token), null);
    assert.equal(
      await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } }),
      null,
      "expired session should be deleted on sight",
    );
  });

  it("issues unpredictable tokens", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { token } = await createSessionRecord(userA.id);
      assert.ok(token.length >= 40, `token too short: ${token.length}`);
      assert.ok(!seen.has(token));
      seen.add(token);
    }
  });
});

describe("login", () => {
  it("accepts correct credentials", async () => {
    const user = await login("a@alpha.test", "alpha-password-1");
    assert.equal(user.agencyId, userA.agencyId);
  });

  it("is case-insensitive on the email", async () => {
    const user = await login("A@Alpha.TEST", "alpha-password-1");
    assert.equal(user.id, userA.id);
  });

  it("rejects a wrong password", async () => {
    await assert.rejects(() => login("a@alpha.test", "not-the-password"), AuthError);
  });

  it("gives the same message for unknown user and wrong password", async () => {
    const unknown = await login("nobody@nowhere.test", "whatever-pass").catch((e) => e);
    const wrong = await login("a@alpha.test", "wrong-password-x").catch((e) => e);
    assert.equal(unknown.message, wrong.message);
    assert.equal(unknown.status, 401);
  });
});

describe("bcrypt cost gating", () => {
  it("honours the override only because NODE_ENV is test", () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(activeCost(), 4);
  });

  /**
   * The gate must be "NODE_ENV === test", not "NODE_ENV !== production" —
   * otherwise an unset or mistyped NODE_ENV silently accepts a weak cost.
   */
  it("is pinned to 12 for any NODE_ENV that is not exactly 'test'", async () => {
    const source = codeOf("src/lib/auth/password.ts");
    assert.match(
      source,
      /process\.env\.NODE_ENV\s*!==\s*["']test["']/,
      "cost override must be gated on NODE_ENV === 'test'",
    );
    assert.ok(
      !/NODE_ENV\s*!==\s*["']production["']/.test(source),
      "must not gate the weak path on 'not production' — that is reachable by omission",
    );
    assert.match(source, /PRODUCTION_COST\s*=\s*12/);
  });
});

describe("login rate limiting", () => {
  const config = { maxAttempts: 3, windowMs: 60_000, lockoutMs: 60_000 };
  const ip = "203.0.113.9";

  it("locks a key after the configured number of failures", () => {
    resetAllLimits();
    const key = emailKey("brute@alpha.test");
    let now = 1_000_000;

    for (let i = 0; i < config.maxAttempts - 1; i++) {
      recordFailure(key, config, now++);
      assert.equal(checkLimit(key, config, now).limited, false, `locked early at ${i + 1}`);
    }
    recordFailure(key, config, now++);
    assert.equal(checkLimit(key, config, now).limited, true, "should be locked");
  });

  it("forgets failures older than the window", () => {
    resetAllLimits();
    const key = ipKey(ip);
    recordFailure(key, config, 0);
    recordFailure(key, config, 1);
    // Third failure lands after the window — the first two have aged out.
    recordFailure(key, config, config.windowMs + 10);
    assert.equal(checkLimit(key, config, config.windowMs + 20).limited, false);
  });

  /** The headline: a CORRECT password must still fail while locked out. */
  it("rejects even correct credentials during the lockout, then allows them after", async () => {
    resetAllLimits();
    let now = 5_000_000;

    for (let i = 0; i < config.maxAttempts; i++) {
      await assert.rejects(
        () => attemptLogin("a@alpha.test", "wrong-password", ip, config, now++),
        AuthError,
      );
    }

    // Correct password, but locked.
    const locked = await attemptLogin("a@alpha.test", "alpha-password-1", ip, config, now).catch(
      (e) => e,
    );
    assert.ok(locked instanceof AuthError);
    assert.equal(locked.status, 429);
    assert.match(locked.message, /Too many failed sign-in attempts/);

    // Once the window clears, the same correct password works.
    const after = now + config.lockoutMs + 1;
    const user = await attemptLogin("a@alpha.test", "alpha-password-1", ip, config, after);
    assert.equal(user.agencyId, userA.agencyId);
  });

  it("limits per email as well as per IP", async () => {
    resetAllLimits();
    let now = 9_000_000;
    // Same email, different IPs each time — the per-email counter must trip.
    for (let i = 0; i < config.maxAttempts; i++) {
      await assert.rejects(
        () => attemptLogin("a@alpha.test", "wrong-password", `198.51.100.${i}`, config, now++),
        AuthError,
      );
    }
    const blocked = await attemptLogin(
      "a@alpha.test",
      "alpha-password-1",
      "198.51.100.200",
      config,
      now,
    ).catch((e) => e);
    assert.equal(blocked.status, 429, "per-email limit must survive an IP change");
  });

  it("clears the email counter on a successful login", async () => {
    resetAllLimits();
    let now = 12_000_000;
    await assert.rejects(
      () => attemptLogin("a@alpha.test", "wrong-password", ip, config, now++),
      AuthError,
    );
    await attemptLogin("a@alpha.test", "alpha-password-1", ip, config, now++);
    assert.equal(checkLimit(emailKey("a@alpha.test"), config, now).limited, false);
  });
});

describe("constant-time session comparison", () => {
  it("compares equal digests as equal and unequal as unequal", () => {
    const a = hashToken("token-one");
    const b = hashToken("token-two");
    assert.equal(safeEqualHex(a, a), true);
    assert.equal(safeEqualHex(a, b), false);
  });

  /** timingSafeEqual throws on length mismatch — this must guard, not throw. */
  it("returns false on a length mismatch instead of throwing", () => {
    assert.equal(safeEqualHex("abcd", "abcdef"), false);
    assert.equal(safeEqualHex("", "ab"), false);
  });

  /**
   * Behavioural tests cannot distinguish timingSafeEqual from `===`, so this
   * guards the property at the source level: the comparison must go through
   * crypto.timingSafeEqual, and the session lookup must compare HASHES, never
   * the raw token.
   */
  it("uses crypto.timingSafeEqual and never plain equality on the hash", () => {
    const source = codeOf("src/lib/auth/session.ts");
    assert.match(source, /timingSafeEqual/, "must import and use timingSafeEqual");
    assert.match(
      source,
      /safeEqualHex\(presentedHash,\s*session\.tokenHash\)/,
      "resolveSessionToken must verify the digest in constant time",
    );
    assert.ok(
      !/tokenHash\s*===|===\s*session\.tokenHash/.test(source),
      "regression: plain === comparison on a session hash",
    );
    // The raw token must only ever be hashed, never queried directly.
    assert.ok(
      !/where:\s*\{\s*tokenHash:\s*token\b/.test(source),
      "regression: querying by the raw token instead of its hash",
    );
  });

  it("still resolves a real session end-to-end through the constant-time path", async () => {
    const { token } = await createSessionRecord(userA.id);
    const session = await resolveSessionToken(token);
    assert.equal(session?.userId, userA.id);
  });
});

describe("dev auto-login guard", () => {
  /** (a) unreachable in production even with the variable set. */
  it("is refused when NODE_ENV is production", () => {
    const source = codeOf("src/lib/tenancy.ts");
    assert.match(
      source,
      /if \(process\.env\.NODE_ENV === "production"\) return null;/,
      "devAutoLogin must bail out before reading DEV_AUTO_LOGIN_EMAIL in production",
    );
    // The guard must come BEFORE the env var is read.
    const guardAt = source.indexOf('NODE_ENV === "production"');
    const readAt = source.indexOf("DEV_AUTO_LOGIN_EMAIL");
    assert.ok(guardAt !== -1 && readAt !== -1 && guardAt < readAt);
  });

  /** (b) the shipped template must never carry a working value. */
  it("ships blank in .env.example", () => {
    const example = readFileSync(".env.example", "utf8");
    const match = example.match(/^DEV_AUTO_LOGIN_EMAIL=(.*)$/m);
    assert.ok(match, "DEV_AUTO_LOGIN_EMAIL should be documented in .env.example");
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    assert.equal(value, "", `.env.example must not ship a usable value, got "${value}"`);
  });
});

describe("signup and invites", () => {
  it("refuses a duplicate email", async () => {
    await assert.rejects(
      () =>
        signup({
          email: "a@alpha.test",
          password: "another-password",
          name: "Impostor",
          agencyName: "Fake",
        }),
      AuthError,
    );
  });

  /** The headline rule: no self-serve path into an existing tenant. */
  it("creates a NEW agency when there is no invite", async () => {
    const user = await signup({
      email: "solo@gamma.test",
      password: "gamma-password-1",
      name: "Gamma",
      agencyName: "Gamma Agency",
    });
    assert.notEqual(user.agencyId, userA.agencyId);
    assert.notEqual(user.agencyId, userB.agencyId);
    assert.equal(user.role, "owner");
  });

  it("joins the inviting agency with a valid invite, as a member", async () => {
    const invite = await createInvite({ agencyId: userA.agencyId, createdById: userA.id });
    const joiner = await signup({
      email: "teammate@alpha.test",
      password: "teammate-password",
      name: "Teammate",
      inviteToken: invite.token,
    });
    assert.equal(joiner.agencyId, userA.agencyId);
    assert.equal(joiner.role, "member");
  });

  it("burns the invite — the same link cannot be used twice", async () => {
    const invite = await createInvite({ agencyId: userA.agencyId, createdById: userA.id });
    await signup({
      email: "first@alpha.test",
      password: "first-password-1",
      name: "First",
      inviteToken: invite.token,
    });
    await assert.rejects(
      () =>
        signup({
          email: "second@alpha.test",
          password: "second-password",
          name: "Second",
          inviteToken: invite.token,
        }),
      AuthError,
    );
  });

  /**
   * The race the sequential read-then-write version would lose: two signups
   * hit the same invite at once, both read acceptedAt = null, both proceed.
   * Exactly one must end up with an account.
   */
  it("survives two concurrent signups on the same invite — exactly one wins", async () => {
    const invite = await createInvite({ agencyId: userA.agencyId, createdById: userA.id });

    const results = await Promise.allSettled([
      signup({
        email: `race-a-${Date.now()}@alpha.test`,
        password: "race-password-aa",
        name: "Race A",
        inviteToken: invite.token,
      }),
      signup({
        email: `race-b-${Date.now()}@alpha.test`,
        password: "race-password-bb",
        name: "Race B",
        inviteToken: invite.token,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(
      fulfilled.length,
      1,
      `expected exactly 1 winner, got ${fulfilled.length}: ${JSON.stringify(
        results.map((r) => (r.status === "rejected" ? String(r.reason) : "ok")),
      )}`,
    );
    assert.equal(rejected.length, 1);

    // And the loser must leave no user behind — the whole signup rolls back.
    const consumed = await prisma.invite.findUnique({ where: { id: invite.id } });
    assert.ok(consumed?.acceptedAt, "invite must be marked consumed");
    const raceUsers = await prisma.user.count({ where: { name: { in: ["Race A", "Race B"] } } });
    assert.equal(raceUsers, 1, "a losing signup must not create an orphan user");
  });

  it("rejects a forged invite token", async () => {
    await assert.rejects(
      () =>
        signup({
          email: "forger@evil.test",
          password: "forger-password",
          name: "Forger",
          inviteToken: "totally-made-up-token-value",
        }),
      AuthError,
    );
  });

  it("only an owner can invite", async () => {
    const member = await prisma.user.findUnique({ where: { email: "teammate@alpha.test" } });
    assert.equal(member?.role, "member");
    await assert.rejects(
      () => createInvite({ agencyId: userA.agencyId, createdById: member!.id }),
      AuthError,
    );
  });

  it("an owner cannot invite into an agency they do not belong to", async () => {
    await assert.rejects(
      () => createInvite({ agencyId: userB.agencyId, createdById: userA.id }),
      AuthError,
    );
  });

  it("stores only the invite hash", async () => {
    const invite = await createInvite({ agencyId: userA.agencyId, createdById: userA.id });
    const rows = await prisma.invite.findMany({ select: { tokenHash: true } });
    assert.ok(rows.every((r) => r.tokenHash !== invite.token));
  });
});
