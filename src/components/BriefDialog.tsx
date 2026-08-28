"use client";

import { useEffect, useRef, useState } from "react";
import type { ContentBriefView } from "@/lib/types";
import { Icon } from "./Icon";
import { Button, IntentBadge, Pill } from "./ui";

/**
 * Content brief viewer (PRD §8 flow 3).
 *
 * Dialog behaviour that has to be right: Escape closes, focus moves into the
 * dialog on open and returns to the trigger on close, and background scroll is
 * locked. A modal you cannot escape by keyboard is a trap.
 *
 * The `generatedBy` badge is prominent on purpose — a strategist needs to know
 * whether they are reading Claude's structuring or the deterministic fallback
 * before handing the brief to a writer.
 */
export function BriefDialog({
  clusterName,
  brief,
  loading,
  onClose,
}: {
  clusterName: string;
  brief: ContentBriefView | null;
  loading: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
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
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  function copyMarkdown() {
    if (!brief) return;
    const md = [
      `# ${brief.title}`,
      "",
      `**Target keyword:** ${brief.targetKeyword}`,
      `**Intent:** ${brief.intent}`,
      `**Target length:** ~${brief.wordCountTarget} words`,
      "",
      brief.summary,
      "",
      "## Outline",
      ...brief.headings.map((h) => `${"#".repeat(h.level)} ${h.text}`),
      "",
      "## Questions to answer",
      ...brief.questionsToAnswer.map((q) => `- ${q}`),
      "",
      "## Secondary keywords",
      ...brief.secondaryKeywords.map((k) => `- ${k}`),
    ].join("\n");

    void navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
        aria-label={`Content brief for ${clusterName}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86dvh] w-full max-w-2xl overflow-auto rounded-2xl border border-line-strong bg-surface shadow-2xl"
      >
        {loading || !brief ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Icon name="spinner" size={22} className="animate-spin text-brand-soft" />
            <p className="text-sm text-muted">
              Generating brief for <span className="text-ink">“{clusterName}”</span>…
            </p>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 flex items-start gap-4 border-b border-line bg-surface/95 px-6 py-4 backdrop-blur">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold tracking-tight text-ink">
                  {brief.title}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <IntentBadge intent={brief.intent} />
                  <Pill>
                    <Icon name="target" size={10} />
                    {brief.targetKeyword}
                  </Pill>
                  <Pill>~{brief.wordCountTarget} words</Pill>
                  <span
                    title={
                      brief.generatedBy === "claude"
                        ? "Structured by the Claude API."
                        : "Built from the cluster's own keywords — set ANTHROPIC_API_KEY for AI-written briefs."
                    }
                  >
                    <Pill tone={brief.generatedBy === "claude" ? "brand" : "neutral"}>
                      <Icon name={brief.generatedBy === "claude" ? "sparkles" : "layers"} size={10} />
                      {brief.generatedBy === "claude" ? "Claude" : "Rule-based"}
                    </Pill>
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close brief"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-ink"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <div className="px-6 py-5">
              <p className="text-sm leading-relaxed text-muted">{brief.summary}</p>

              <section className="mt-6">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                  Outline
                </h3>
                <div className="mt-2.5 space-y-0.5 border-l border-line pl-4">
                  {brief.headings.map((h, i) => (
                    <div
                      key={`${h.text}-${i}`}
                      className={`flex items-baseline gap-2 py-0.5 text-sm ${
                        h.level === 3 ? "pl-4 text-muted" : "font-medium text-ink"
                      }`}
                    >
                      <span className="nums shrink-0 text-[9px] font-semibold text-subtle">
                        H{h.level}
                      </span>
                      <span>{h.text}</span>
                    </div>
                  ))}
                </div>
              </section>

              {brief.questionsToAnswer.length > 0 && (
                <section className="mt-6">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                    Questions to answer
                  </h3>
                  <ul className="mt-2.5 space-y-1.5">
                    {brief.questionsToAnswer.map((q) => (
                      <li key={q} className="flex items-start gap-2 text-sm text-muted">
                        <Icon name="check" size={13} className="mt-0.5 text-easy" />
                        {q}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {brief.secondaryKeywords.length > 0 && (
                <section className="mt-6">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                    Secondary keywords
                  </h3>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {brief.secondaryKeywords.map((k) => (
                      <span
                        key={k}
                        className="rounded-md border border-line bg-canvas px-2 py-1 text-xs text-muted"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-surface/95 px-6 py-3 backdrop-blur">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button onClick={copyMarkdown} icon={copied ? "check" : "copy"}>
                {copied ? "Copied" : "Copy as Markdown"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
