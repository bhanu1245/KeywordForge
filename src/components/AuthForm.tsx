"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { Button } from "./ui";

/**
 * Login / signup form.
 *
 * Deliberately plain. The one thing it must get right is not leaking which
 * half of a credential pair was wrong — the server returns a single
 * "Incorrect email or password" and this just renders it.
 */

const FIELD =
  "h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-soft";
const LABEL = "block text-[10px] font-medium uppercase tracking-wider text-subtle";

export function AuthForm({
  mode,
  inviteToken,
  invitedAgency,
  invitedEmail,
}: {
  mode: "login" | "signup";
  inviteToken?: string;
  invitedAgency?: string | null;
  invitedEmail?: string | null;
}) {
  const router = useRouter();
  const isSignup = mode === "signup";

  const [email, setEmail] = useState(invitedEmail ?? "");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/auth/${isSignup ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSignup
            ? { email, password, name, agencyName: agencyName || undefined, inviteToken }
            : { email, password },
        ),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        return;
      }
      // Full navigation, not router.push: the session cookie was just set and
      // every server component needs to re-render with it.
      window.location.href = "/";
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-2xl"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-soft to-brand text-sm font-bold text-white">
          K
        </span>
        <span className="text-base font-semibold tracking-tight text-ink">KeywordForge</span>
      </div>

      <h1 className="mt-5 text-lg font-semibold text-ink">
        {isSignup ? "Create your account" : "Sign in"}
      </h1>

      {isSignup && invitedAgency && (
        <p className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-brand-soft/25 bg-brand-soft/10 px-3 py-2 text-xs text-brand-soft">
          <Icon name="check" size={13} />
          You&apos;ve been invited to join <strong>{invitedAgency}</strong>
        </p>
      )}
      {isSignup && !inviteToken && (
        <p className="mt-1.5 text-xs text-muted">
          This creates a new agency with you as its owner.
        </p>
      )}

      <div className="mt-5 space-y-3">
        {isSignup && (
          <div className="space-y-1.5">
            <label htmlFor="af-name" className={LABEL}>Your name</label>
            <input
              id="af-name"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD}
            />
          </div>
        )}

        {isSignup && !inviteToken && (
          <div className="space-y-1.5">
            <label htmlFor="af-agency" className={LABEL}>Agency name</label>
            <input
              id="af-agency"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              placeholder="Prime Web Media"
              className={FIELD}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="af-email" className={LABEL}>Email</label>
          <input
            id="af-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="af-password" className={LABEL}>Password</label>
          <input
            id="af-password"
            type="password"
            required
            // Tells password managers which flow this is — required for them
            // to offer to save a new password rather than autofill an old one.
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={isSignup ? 10 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={FIELD}
          />
          {isSignup && (
            <p className="text-[10px] text-subtle">At least 10 characters.</p>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 flex items-center gap-1.5 text-xs text-danger">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}

      <Button type="submit" size="md" loading={busy} className="mt-5 w-full">
        {isSignup ? "Create account" : "Sign in"}
      </Button>

      <p className="mt-4 text-center text-xs text-muted">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="rounded font-medium text-brand-soft hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            No account?{" "}
            <Link href="/signup" className="rounded font-medium text-brand-soft hover:underline">
              Create one
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
