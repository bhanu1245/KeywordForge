import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Pill } from "@/components/ui";
import { getRawProvider } from "@/lib/providers";
import "./globals.css";

/**
 * Inter, self-hosted through next/font: no render-blocking request to Google,
 * no flash of invisible text, and the metrics are known up front so the
 * header does not shift as the font loads.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "KeywordForge",
  description:
    "Keyword research and SEO intelligence for agencies — discovery, difficulty, intent, clustering and briefs.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Read once per render on the server so the badge reflects the provider that
  // actually resolved, not merely what the env var asked for.
  const provider = getRawProvider();

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
          Applies the stored theme BEFORE first paint. This has to be an
          inline, render-blocking script: doing it in an effect would let the
          browser paint the OS theme first, producing a white flash for a
          pinned-dark user on every navigation. `suppressHydrationWarning`
          above is required because this mutates <html> before React hydrates.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("kf-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        {/* Ambient wash — one subtle brand gradient, fixed so it never
            scrolls or repaints during table virtualisation. Strength is a
            token so light mode can dial it down to a hint. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(60rem_24rem_at_50%_-8rem,var(--color-glow),transparent)]"
        />

        <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-5">
            <Link
              href="/"
              className="group flex items-center gap-2.5 rounded-lg"
              aria-label="KeywordForge home"
            >
              <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-brand-soft to-brand text-[13px] font-bold text-white shadow-sm shadow-brand/40">
                K
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-ink transition-colors group-hover:text-brand-soft">
                KeywordForge
              </span>
            </Link>

            <div className="ml-auto flex items-center gap-3">
              {!provider.isLive && (
                <span
                  title="No live data provider is connected, so every metric on screen is synthetic. Set KEYWORD_PROVIDER and its credentials to use real data."
                  className="hidden sm:inline-flex"
                >
                  <Pill tone="warn">
                    <Icon name="alert" size={11} />
                    Sample data
                  </Pill>
                </span>
              )}
              <span className="hidden text-xs text-subtle sm:inline">
                Prime Web Media
              </span>
              <ThemeToggle />
            </div>
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}
