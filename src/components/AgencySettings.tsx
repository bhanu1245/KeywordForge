"use client";

import { useState } from "react";
import Link from "next/link";
import type { Branding } from "@/lib/agency/service";
import { Icon } from "./Icon";
import { Button, Pill, formatCompact, formatNumber } from "./ui";

/**
 * Agency Mode (PRD §7 module 36) — branding + the client roster.
 *
 * Scoped to what running client work actually needs: white-label the reports,
 * see every client in one place, jump to their projects. PRD §5 explicitly
 * rules out a reseller marketplace, so there is none.
 */

interface ClientRow {
  id: string;
  name: string;
  domain: string | null;
  projectCount: number;
  keywordCount: number;
}

interface Member {
  id: string;
  email: string;
  name: string;
  role: string;
  lastLoginAt: string | null;
}

export function AgencySettings({
  agencyName,
  branding: initial,
  clients,
  totals,
  members,
  isOwner,
}: {
  agencyName: string;
  branding: Branding;
  clients: ClientRow[];
  totals: { clients: number; projects: number; keywords: number };
  members: Member[];
  isOwner: boolean;
}) {
  const [branding, setBranding] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ email: string; url: string } | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/v1/agency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(branding),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save branding.");
        return;
      }
      setBranding(json.branding as Branding);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  /** Unblocks members who have no password (e.g. migrated before auth). */
  async function issueReset(userId: string) {
    setError(null);
    const res = await fetch("/api/v1/auth/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Could not create a reset link.");
      return;
    }
    setResetLink({ email: json.email, url: `${window.location.origin}${json.path}` });
  }

  const FIELD =
    "h-9 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none transition-colors hover:border-line-strong focus:border-brand-soft";
  const LABEL = "block text-[10px] font-medium uppercase tracking-wider text-subtle";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{agencyName}</h1>
          <p className="mt-1.5 text-sm text-muted">
            Branding, clients and team for this agency.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-subtle">
          <span className="nums"><strong className="text-ink">{totals.clients}</strong> clients</span>
          <span className="nums"><strong className="text-ink">{totals.projects}</strong> projects</span>
          <span className="nums"><strong className="text-ink">{formatCompact(totals.keywords)}</strong> keywords</span>
        </div>
      </div>

      {/* Branding */}
      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">White-label branding</h2>
        <p className="mt-1 text-xs text-muted">
          Applied to client-facing reports. The app itself keeps its own theme.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="br-color" className={LABEL}>Primary colour</label>
            <div className="flex items-center gap-2">
              <input
                id="br-color"
                type="color"
                value={branding.primaryColor}
                onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                disabled={!isOwner}
                className="h-9 w-12 cursor-pointer rounded border border-line bg-canvas"
              />
              <input
                value={branding.primaryColor}
                onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                disabled={!isOwner}
                className={`${FIELD} nums`}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="br-logo" className={LABEL}>Logo URL</label>
            <input
              id="br-logo"
              value={branding.logoUrl ?? ""}
              onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value || null })}
              placeholder="https://example.com/logo.png"
              disabled={!isOwner}
              className={FIELD}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="br-title" className={LABEL}>Report title</label>
            <input
              id="br-title"
              value={branding.reportTitle ?? ""}
              onChange={(e) => setBranding({ ...branding, reportTitle: e.target.value || null })}
              placeholder={agencyName}
              disabled={!isOwner}
              className={FIELD}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="br-footer" className={LABEL}>Report footer</label>
            <input
              id="br-footer"
              value={branding.footerText ?? ""}
              onChange={(e) => setBranding({ ...branding, footerText: e.target.value || null })}
              placeholder="hello@agency.com · +44 …"
              disabled={!isOwner}
              className={FIELD}
            />
          </div>
        </div>

        {isOwner ? (
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={save} loading={busy} icon={saved ? "check" : "sparkles"}>
              {saved ? "Saved" : "Save branding"}
            </Button>
            {error && (
              <span role="alert" className="inline-flex items-center gap-1.5 text-xs text-danger">
                <Icon name="alert" size={13} />
                {error}
              </span>
            )}
          </div>
        ) : (
          <p className="mt-4 text-xs text-subtle">Only an agency owner can change branding.</p>
        )}
      </section>

      {/* Clients */}
      <section>
        <h2 className="text-sm font-semibold text-ink">Clients</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
          {clients.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 border-b border-line/50 px-4 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{c.name}</div>
                {c.domain && <div className="truncate text-xs text-subtle">{c.domain}</div>}
              </div>
              <Pill>{c.projectCount} project{c.projectCount === 1 ? "" : "s"}</Pill>
              <span className="nums text-xs text-muted">
                {formatNumber(c.keywordCount)} keywords
              </span>
            </div>
          ))}
          {clients.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-subtle">No clients yet.</p>
          )}
        </div>
        <Link
          href="/"
          className="mt-2 inline-flex items-center gap-1 rounded text-xs text-brand-soft hover:underline"
        >
          Manage projects
          <Icon name="chevronRight" size={12} />
        </Link>
      </section>

      {/* Team */}
      <section>
        <h2 className="text-sm font-semibold text-ink">Team</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-3 border-b border-line/50 px-4 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{m.name}</div>
                <div className="truncate text-xs text-subtle">{m.email}</div>
              </div>
              <Pill tone={m.role === "owner" ? "brand" : "neutral"}>{m.role}</Pill>
              <span className="text-[11px] text-subtle">
                {m.lastLoginAt ? `last in ${new Date(m.lastLoginAt).toLocaleDateString()}` : "never signed in"}
              </span>
              {isOwner && (
                <Button variant="outline" onClick={() => issueReset(m.id)}>
                  Reset link
                </Button>
              )}
            </div>
          ))}
        </div>

        {resetLink && (
          <div className="mt-2 rounded-xl border border-brand-soft/25 bg-brand-soft/10 p-3">
            <p className="text-[11px] text-brand-soft">
              One-time reset link for <strong>{resetLink.email}</strong> — expires in 1 hour.
              Send it to them out of band.
            </p>
            <input
              readOnly
              value={resetLink.url}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1.5 h-8 w-full rounded border border-line bg-canvas px-2 text-[10px] text-muted"
            />
          </div>
        )}
      </section>
    </div>
  );
}
