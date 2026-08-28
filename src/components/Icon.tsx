import type { SVGProps } from "react";

/**
 * Inline SVG icon set (Lucide-derived geometry, 24px grid, 1.75 stroke).
 *
 * Replaces the text glyphs the first pass used ("▾", "▸", "▲", "?"). Those
 * render differently per platform font, cannot be coloured or sized as design
 * tokens, and are announced by screen readers as punctuation. Inlined rather
 * than pulled from a package to keep the bundle free of an icon dependency
 * for the dozen glyphs this app actually needs.
 *
 * Decorative by default (`aria-hidden`), because every icon here sits beside
 * a visible text label. Pass a `title` for the rare standalone case, which
 * switches it to an accessible image role.
 */

export type IconName =
  | "chevronRight"
  | "chevronDown"
  | "arrowUp"
  | "arrowDown"
  | "search"
  | "upload"
  | "download"
  | "sparkles"
  | "close"
  | "plus"
  | "help"
  | "layers"
  | "table"
  | "check"
  | "alert"
  | "external"
  | "copy"
  | "spinner"
  | "inbox"
  | "target"
  | "sun"
  | "moon"
  | "monitor";

const PATHS: Record<IconName, React.ReactNode> = {
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  arrowUp: <path d="M12 19V5m0 0-7 7m7-7 7 7" />,
  arrowDown: <path d="M12 5v14m0 0 7-7m-7 7-7-7" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>
  ),
  upload: <path d="M12 16V4m0 0L7 9m5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  download: <path d="M12 4v12m0 0 5-5m-5 5-5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  sparkles: (
    <>
      <path d="M12 3v4m0 10v4m9-9h-4M7 12H3" />
      <path d="M18.4 5.6 16 8m-8 8-2.4 2.4m0-12.8L8 8m8 8 2.4 2.4" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.3" />
      <path d="M12 17.2h.01" />
    </>
  ),
  layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5" />,
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10" />
    </>
  ),
  check: <path d="m5 13 4 4L19 7" />,
  alert: (
    <>
      <path d="M12 4 2.7 20h18.6L12 4Z" />
      <path d="M12 10v4m0 3h.01" />
    </>
  ),
  external: <path d="M14 4h6v6m0-6L10 14M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2" />
    </>
  ),
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
  inbox: (
    <>
      <path d="M3 12h5l2 3h4l2-3h5" />
      <path d="M5.5 5h13l2.5 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2.5-7Z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  monitor: (
    <>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  /** Supplying a title makes the icon meaningful rather than decorative. */
  title?: string;
}

export function Icon({ name, size = 16, title, className = "", ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
