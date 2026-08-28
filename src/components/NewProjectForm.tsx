"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icon";
import { Button } from "./ui";

/**
 * Creates a project (and its client, if new) for any niche.
 *
 * The client field is a free-text combobox rather than a strict dropdown so a
 * brand new customer and a brand new project are one action — requiring a
 * client to exist first was the main thing stopping this tool from being
 * usable for arbitrary keywords.
 */

// Markets the mock provider varies data across; a live provider accepts any
// location string its API supports.
const LOCATIONS = [
  "United States", "United Kingdom", "Canada", "Australia", "India",
  "Germany", "France", "Spain", "Netherlands", "United Arab Emirates",
];

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "hi", label: "Hindi" },
  { code: "nl", label: "Dutch" },
];

const FIELD =
  "h-9 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-soft";

const LABEL = "block text-[10px] font-medium uppercase tracking-wider text-subtle";

export function NewProjectForm({
  existingClients,
}: {
  existingClients: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(existingClients.length === 0);
  const [clientName, setClientName] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [location, setLocation] = useState(LOCATIONS[0]);
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          clientName: clientName.trim(),
          domain: domain.trim() || undefined,
          language,
          location,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not create the project.");
        return;
      }
      // Straight into the workspace — the next thing the user wants is to type
      // a seed keyword, not to look at a list again.
      router.push(`/projects/${json.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-2.5 text-xs font-medium text-muted transition-colors hover:border-brand-soft hover:bg-elevated hover:text-ink"
      >
        <Icon name="plus" size={14} />
        New project
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="plus" size={14} className="text-brand-soft" />
          New project
        </h2>
        {existingClients.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cancel"
            className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <Icon name="close" size={15} />
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        Research any niche — the client is created automatically if it does not exist yet.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="np-client" className={LABEL}>Client</label>
          <input
            id="np-client"
            required
            list="kf-clients"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Acme Dental"
            className={FIELD}
          />
          <datalist id="kf-clients">
            {existingClients.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="np-name" className={LABEL}>Project</label>
          <input
            id="np-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Dental — Local SEO"
            className={FIELD}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="np-domain" className={LABEL}>Domain (optional)</label>
          <input
            id="np-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="acmedental.com"
            className={FIELD}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="np-location" className={LABEL}>Location</label>
            <select
              id="np-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={`${FIELD} cursor-pointer`}
            >
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="np-language" className={LABEL}>Language</label>
            <select
              id="np-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={`${FIELD} cursor-pointer`}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          type="submit"
          size="md"
          loading={busy}
          disabled={!name.trim() || !clientName.trim()}
          icon="plus"
        >
          Create project
        </Button>
        {error && (
          <span role="alert" className="inline-flex items-center gap-1.5 text-xs text-danger">
            <Icon name="alert" size={13} />
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
