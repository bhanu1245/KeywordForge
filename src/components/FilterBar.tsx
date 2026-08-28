"use client";

import { INTENTS } from "@/lib/seo/intent";
import type { Intent, KeywordFilters } from "@/lib/types";
import { Icon } from "./Icon";

/**
 * Filters run client-side against the already-loaded set (PRD §8 flow 2), so
 * the sliders are instant rather than debouncing a round trip per keystroke.
 *
 * Every control carries a visible label — placeholder-only labelling
 * disappears the moment a user types, which is the most common form-a11y bug.
 */
export function FilterBar({
  filters,
  onChange,
  onReset,
  resultCount,
}: {
  filters: KeywordFilters;
  onChange: (next: KeywordFilters) => void;
  onReset: () => void;
  resultCount: number;
}) {
  const set = (patch: Partial<KeywordFilters>) => onChange({ ...filters, ...patch });

  const toggleIntent = (intent: Intent) => {
    const current = filters.intents ?? [];
    const next = current.includes(intent)
      ? current.filter((i) => i !== intent)
      : [...current, intent];
    set({ intents: next.length > 0 ? next : undefined });
  };

  const activeCount =
    (filters.search ? 1 : 0) +
    (filters.minVolume !== undefined ? 1 : 0) +
    (filters.maxDifficulty !== undefined ? 1 : 0) +
    (filters.intents?.length ? 1 : 0) +
    (filters.questionsOnly ? 1 : 0) +
    (filters.minWords ? 1 : 0);

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="space-y-1">
          <label htmlFor="kf-search" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
            Search
          </label>
          <div className="relative">
            <Icon
              name="search"
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle"
            />
            <input
              id="kf-search"
              value={filters.search ?? ""}
              onChange={(e) => set({ search: e.target.value || undefined })}
              placeholder="Filter keywords…"
              className="h-8 w-56 rounded-lg border border-line bg-canvas pl-8 pr-3 text-xs text-ink outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-soft"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="kf-minvol" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
            Min volume
          </label>
          <input
            id="kf-minvol"
            type="number"
            min={0}
            step={100}
            value={filters.minVolume ?? ""}
            onChange={(e) => set({ minVolume: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="0"
            className="nums h-8 w-24 rounded-lg border border-line bg-canvas px-2.5 text-xs text-ink outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-soft"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="kf-kd" className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
            Max difficulty
          </label>
          <div className="flex h-8 items-center gap-2">
            <input
              id="kf-kd"
              type="range"
              min={0}
              max={100}
              value={filters.maxDifficulty ?? 100}
              onChange={(e) => {
                const v = Number(e.target.value);
                set({ maxDifficulty: v === 100 ? undefined : v });
              }}
              className="w-28 cursor-pointer"
            />
            <span className="nums w-7 text-xs font-medium text-ink">
              {filters.maxDifficulty ?? 100}
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
            Intent
          </span>
          <div className="flex h-8 items-center gap-1">
            {INTENTS.map((intent) => {
              const active = filters.intents?.includes(intent) ?? false;
              return (
                <button
                  key={intent}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleIntent(intent)}
                  className={`min-h-6 rounded-md border px-2 py-1 text-[10px] font-medium capitalize transition-colors ${
                    active
                      ? "border-brand-soft/50 bg-brand-soft/15 text-brand-soft"
                      : "border-line text-subtle hover:border-line-strong hover:text-muted"
                  }`}
                >
                  {intent}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
            Type
          </span>
          <div className="flex h-8 items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted hover:text-ink">
              <input
                type="checkbox"
                checked={filters.questionsOnly ?? false}
                onChange={(e) => set({ questionsOnly: e.target.checked || undefined })}
                className="size-3.5 cursor-pointer rounded"
              />
              Questions
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted hover:text-ink">
              <input
                type="checkbox"
                checked={(filters.minWords ?? 0) >= 4}
                onChange={(e) => set({ minWords: e.target.checked ? 4 : undefined })}
                className="size-3.5 cursor-pointer rounded"
              />
              Long-tail
            </label>
          </div>
        </div>

        <div className="ml-auto flex h-8 items-center gap-3">
          <span className="nums text-xs text-subtle" aria-live="polite">
            {resultCount.toLocaleString()} shown
          </span>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex min-h-6 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
            >
              <Icon name="close" size={12} />
              Clear {activeCount}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
