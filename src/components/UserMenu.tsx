"use client";

import { useState } from "react";
import { Icon } from "./Icon";

/**
 * Signed-in identity + sign out. Also the place an owner generates an invite,
 * since that is the only multi-user action in the product so far.
 */
export function UserMenu({
  name,
  email,
  role,
  agencyName,
}: {
  name: string;
  email: string;
  role: string;
  agencyName: string;
}) {
  const [open, setOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function signOut() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    // Full reload so every server component re-renders without the session.
    window.location.href = "/login";
  }

  async function createInvite() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not create an invite.");
        return;
      }
      // Absolute URL built from the browser's own origin.
      setInviteUrl(`${window.location.origin}${json.path}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-muted transition-colors hover:border-line-strong hover:text-ink"
      >
        <span className="grid size-5 place-items-center rounded-full bg-brand-soft/20 text-[9px] font-semibold text-brand-soft">
          {initials || "?"}
        </span>
        <span className="hidden sm:inline">{agencyName}</span>
        <Icon name="chevronDown" size={12} />
      </button>

      {open && (
        <>
          {/* Click-away layer. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-line-strong bg-surface p-3 shadow-2xl"
          >
            <div className="border-b border-line pb-2.5">
              <div className="text-sm font-medium text-ink">{name}</div>
              <div className="truncate text-xs text-subtle">{email}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-subtle">
                {role} · {agencyName}
              </div>
            </div>

            {role === "owner" && (
              <div className="border-b border-line py-2.5">
                {!inviteUrl ? (
                  <>
                    <button
                      type="button"
                      onClick={createInvite}
                      disabled={busy}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-50"
                    >
                      <Icon name={busy ? "spinner" : "plus"} size={13} className={busy ? "animate-spin" : ""} />
                      Invite a teammate
                    </button>
                    {error && <p className="mt-1 px-2 text-[11px] text-danger">{error}</p>}
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <p className="px-2 text-[10px] uppercase tracking-wider text-subtle">
                      One-time link · expires in 7 days
                    </p>
                    <div className="flex items-center gap-1.5">
                      <input
                        readOnly
                        value={inviteUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className="h-7 min-w-0 flex-1 rounded border border-line bg-canvas px-2 text-[10px] text-muted"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(inviteUrl);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                        className="grid size-7 shrink-0 place-items-center rounded border border-line text-muted hover:text-ink"
                        aria-label="Copy invite link"
                      >
                        <Icon name={copied ? "check" : "copy"} size={12} />
                      </button>
                    </div>
                    <p className="px-2 text-[10px] text-subtle">
                      Shown once — it is stored hashed and cannot be retrieved again.
                    </p>
                  </div>
                )}
              </div>
            )}

            <a
              href="/agency"
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
            >
              <Icon name="layers" size={13} />
              Agency settings
            </a>

            <button
              type="button"
              onClick={signOut}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
            >
              <Icon name="close" size={13} />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
