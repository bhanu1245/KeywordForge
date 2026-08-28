import type { ReactNode } from "react";
import { difficultyBand } from "@/lib/seo/scoring";
import { Icon, type IconName } from "./Icon";

/**
 * Shared primitives. Every colour here comes from a `@theme` token so the
 * palette stays swappable, and every interactive element keeps its focus ring
 * (see globals.css) rather than styling it away.
 */

/* -------------------------------------------------------------------------
 * Intent
 * ---------------------------------------------------------------------- */

const INTENT_STYLES: Record<string, string> = {
  transactional: "border-transactional/25 bg-transactional/10 text-transactional",
  commercial: "border-commercial/25 bg-commercial/10 text-commercial",
  informational: "border-informational/25 bg-informational/10 text-informational",
  navigational: "border-navigational/25 bg-navigational/10 text-navigational",
};

/**
 * Intent is carried by the label text, not the colour — colour alone would
 * exclude colour-blind users (WCAG "don't use colour as the only indicator").
 */
export function IntentBadge({ intent }: { intent: string | null }) {
  if (!intent) return <span className="text-subtle">—</span>;
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize leading-none tracking-wide ${
        INTENT_STYLES[intent] ?? INTENT_STYLES.navigational
      }`}
    >
      {intent}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Difficulty
 * ---------------------------------------------------------------------- */

const BAND_TEXT: Record<string, string> = {
  easy: "text-easy",
  medium: "text-medium",
  hard: "text-hard",
  "very hard": "text-extreme",
};

const BAND_BAR: Record<string, string> = {
  easy: "bg-easy",
  medium: "bg-medium",
  hard: "bg-hard",
  "very hard": "bg-extreme",
};

/**
 * Number plus a filled meter. The meter is deliberate: it reads as a relative
 * proxy score rather than a precise measurement, which is exactly what our
 * difficulty is (see the honesty note in lib/seo/scoring.ts).
 */
export function DifficultyCell({ value, showLabel = false }: { value: number; showLabel?: boolean }) {
  const band = difficultyBand(value);
  return (
    <div className="flex items-center gap-2" title={`${band} — ${value}/100`}>
      <span className={`nums w-6 text-right text-xs font-medium ${BAND_TEXT[band]}`}>
        {value}
      </span>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-line">
        <span
          className={`block h-full rounded-full ${BAND_BAR[band]}`}
          style={{ width: `${Math.max(value, 2)}%` }}
        />
      </span>
      {showLabel && <span className="text-[10px] capitalize text-subtle">{band}</span>}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Stats
 * ---------------------------------------------------------------------- */

export function Stat({
  label,
  value,
  hint,
  icon,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: IconName;
  accent?: boolean;
}) {
  return (
    <div
      className="group relative rounded-xl border border-line bg-surface px-3.5 py-3 transition-colors hover:border-line-strong"
      title={hint}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-subtle">
        {icon && <Icon name={icon} size={12} />}
        {label}
        {hint && <Icon name="help" size={11} className="opacity-0 transition-opacity group-hover:opacity-60" />}
      </div>
      <div
        className={`nums mt-1 text-xl font-semibold tracking-tight ${accent ? "text-brand-soft" : "text-ink"}`}
      >
        {value}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Button
 * ---------------------------------------------------------------------- */

const BUTTON_VARIANTS = {
  primary:
    "bg-brand text-white shadow-sm shadow-brand/25 hover:bg-brand-soft hover:text-canvas",
  outline: "border border-line-strong text-ink hover:border-brand-soft hover:bg-elevated",
  ghost: "text-muted hover:bg-elevated hover:text-ink",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
} as const;

const BUTTON_SIZES = {
  // min-h keeps every control at/above the 24px WCAG 2.2 target minimum.
  sm: "min-h-8 px-2.5 py-1.5 text-xs gap-1.5",
  md: "min-h-9 px-3.5 py-2 text-sm gap-2",
} as const;

export function Button({
  children,
  variant = "primary",
  size = "sm",
  icon,
  loading = false,
  className = "",
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  icon?: IconName;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
    >
      {loading ? (
        <Icon name="spinner" size={14} className="animate-spin" />
      ) : icon ? (
        <Icon name={icon} size={14} />
      ) : null}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------
 * Sparkline
 * ---------------------------------------------------------------------- */

/** Compact 12-month trend, rendered inline in the keyword table. */
export function Sparkline({ points }: { points: number[] | null }) {
  if (!points || points.length < 2) return <span className="text-subtle">—</span>;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const w = 52;
  const h = 16;

  const coords = points.map((p, i) => [
    (i / (points.length - 1)) * w,
    h - ((p - min) / range) * h,
  ]);
  const line = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const rising = points[points.length - 1] >= points[0];
  const stroke = rising ? "var(--color-easy)" : "var(--color-hard)";
  const id = `spark-${rising ? "up" : "down"}`;

  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" strokeWidth={1.5} stroke={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------
 * States
 * ---------------------------------------------------------------------- */

/** Empty state: says what happened AND what to do next. */
export function EmptyState({
  icon = "inbox",
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface/50 px-6 py-16 text-center">
      <div className="grid size-10 place-items-center rounded-full border border-line bg-elevated text-subtle">
        <Icon name={icon} size={18} />
      </div>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Skeleton rows — shown instead of a blocking spinner for >1s work. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-px" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <div className="skeleton h-3 flex-1 rounded" style={{ maxWidth: `${45 + ((i * 13) % 30)}%` }} />
          <div className="skeleton h-3 w-14 rounded" />
          <div className="skeleton h-3 w-16 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

/** Small inline pill for counts / meta. */
export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "warn" }) {
  const tones = {
    neutral: "border-line bg-elevated text-muted",
    brand: "border-brand-soft/30 bg-brand-soft/10 text-brand-soft",
    warn: "border-warning/30 bg-warning/10 text-warning",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Formatting
 * ---------------------------------------------------------------------- */

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

/** Compact form for stat tiles, where 72,700 reads better as 72.7K. */
export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) < 10_000) return n.toLocaleString();
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 10_000) {
    return `$${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
  }
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: n < 100 ? 2 : 0,
    maximumFractionDigits: n < 100 ? 2 : 0,
  })}`;
}

export { Icon };
