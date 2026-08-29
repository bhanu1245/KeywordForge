"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { Button } from "./ui";

const FIELD =
  "h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-soft";
const LABEL = "block text-[10px] font-medium uppercase tracking-wider text-subtle";

/** Step 1 — request a link. */
export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/v1/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      // Always "done", whatever the answer — the response is deliberately
      // identical for a known and an unknown address.
      setDone(true);
      if (json.devLink) setDevLink(json.devLink as string);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-2xl">
      <h1 className="text-lg font-semibold text-ink">Reset your password</h1>

      {done ? (
        <>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
            <Icon name="check" size={13} className="mt-0.5 text-easy" />
            If that email has an account, a reset link has been created.
          </p>
          {devLink && (
            <div className="mt-3 rounded-lg border border-warning/25 bg-warning/10 p-3">
              <p className="text-[11px] text-warning">
                No email provider is configured, so the link is shown here (development only):
              </p>
              <input
                readOnly
                value={devLink}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-1.5 h-8 w-full rounded border border-line bg-canvas px-2 text-[10px] text-muted"
              />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-1.5 text-xs text-muted">
            We&apos;ll create a one-time link valid for an hour.
          </p>
          <div className="mt-4 space-y-1.5">
            <label htmlFor="fp-email" className={LABEL}>Email</label>
            <input
              id="fp-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD}
            />
          </div>
          <Button type="submit" size="md" loading={busy} className="mt-4 w-full">
            Send reset link
          </Button>
        </>
      )}

      <p className="mt-4 text-center text-xs text-muted">
        <Link href="/login" className="rounded font-medium text-brand-soft hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

/** Step 2 — consume the token and set a new password. */
export function ResetForm({ token, email }: { token: string; email: string | null }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not reset the password.");
        return;
      }
      // A reset revokes every session and issues a fresh one; full navigation
      // so the server re-renders with it.
      window.location.href = "/";
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-2xl">
      <h1 className="text-lg font-semibold text-ink">Choose a new password</h1>
      {email && <p className="mt-1.5 text-xs text-muted">for {email}</p>}

      <div className="mt-4 space-y-1.5">
        <label htmlFor="rs-pw" className={LABEL}>New password</label>
        <input
          id="rs-pw"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD}
        />
        <p className="text-[10px] text-subtle">At least 10 characters.</p>
      </div>

      {error && (
        <p role="alert" className="mt-3 flex items-center gap-1.5 text-xs text-danger">
          <Icon name="alert" size={13} />
          {error}
        </p>
      )}

      <Button type="submit" size="md" loading={busy} className="mt-4 w-full">
        Set password and sign in
      </Button>
      <p className="mt-3 text-center text-[10px] text-subtle">
        This signs you out everywhere else.
      </p>
    </form>
  );
}
