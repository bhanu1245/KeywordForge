"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Button, Pill } from "./ui";

/**
 * AI Keyword Generator (PRD §7 module 17) — seeds from a business description
 * or a website URL.
 *
 * Returns suggestions the user picks from rather than running discovery on all
 * of them: each seed costs a metered provider call (PRD §6), so expanding
 * twelve at once would quietly multiply the cost of one click.
 */
export function SeedGenerator({
  projectId,
  onPick,
  onClose,
}: {
  projectId: string;
  onPick: (seed: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [seeds, setSeeds] = useState<string[]>([]);
  const [source, setSource] = useState<"claude" | "heuristic" | null>(null);
  const [context, setContext] = useState<{ title: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [onClose]);

  async function generate() {
    setBusy(true);
    setError(null);
    setSeeds([]);
    try {
      const res = await fetch("/api/v1/keywords/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          description: description.trim() || undefined,
          url: url.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not generate seeds.");
        return;
      }
      setSeeds(json.seeds as string[]);
      setSource(json.source as "claude" | "heuristic");
      setContext(json.context ? { title: json.context.title, url: json.context.url } : null);
      if ((json.seeds as string[]).length === 0) {
        setError("Nothing usable came back — try adding a description.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Generate seed keywords"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86dvh] w-full max-w-xl overflow-auto rounded-2xl border border-line-strong bg-surface shadow-2xl"
      >
        <div className="flex items-start gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="inline-flex items-center gap-2 text-base font-semibold text-ink">
              <Icon name="sparkles" size={15} className="text-brand-soft" />
              Generate seed keywords
            </h2>
            <p className="mt-1 text-xs text-muted">
              Describe the business, give its website, or both. You pick which seeds to expand.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="space-y-1.5">
            <label htmlFor="sg-url" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
              Website URL
            </label>
            <input
              id="sg-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="acmedental.com"
              className="h-9 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-soft"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="sg-desc" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
              Business description
            </label>
            <textarea
              id="sg-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Family dental practice in Bristol offering implants, whitening and emergency appointments."
              className="w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-soft"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={generate}
              loading={busy}
              icon="sparkles"
              size="md"
              disabled={!description.trim() && !url.trim()}
            >
              Generate
            </Button>
            {error && (
              <span role="alert" className="inline-flex items-center gap-1.5 text-xs text-danger">
                <Icon name="alert" size={13} />
                {error}
              </span>
            )}
          </div>

          {seeds.length > 0 && (
            <div className="rounded-xl border border-line bg-canvas/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold text-ink">Suggested seeds</h3>
                <Pill tone={source === "claude" ? "brand" : "neutral"}>
                  {source === "claude" ? "Claude" : "Rule-based"}
                </Pill>
                {context?.title && (
                  <span className="truncate text-[11px] text-subtle" title={context.url}>
                    from “{context.title}”
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted">
                Click one to run discovery on it.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {seeds.map((seed) => (
                  <button
                    key={seed}
                    type="button"
                    onClick={() => onPick(seed)}
                    className="min-h-7 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink transition-colors hover:border-brand-soft hover:text-brand-soft"
                  >
                    {seed}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
