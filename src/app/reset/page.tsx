import Link from "next/link";
import { ResetForm } from "@/components/ResetForm";
import { peekResetToken } from "@/lib/auth/passwordReset";

export const dynamic = "force-dynamic";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  // Validated server-side so an expired or spent link says so plainly instead
  // of failing only after the user has typed a new password.
  const details = token ? await peekResetToken(token) : null;

  return (
    <main className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-5 py-12">
      {details && token ? (
        <ResetForm token={token} email={details.email} />
      ) : (
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-2xl">
          <h1 className="text-lg font-semibold text-ink">This link is no longer valid</h1>
          <p className="mt-1.5 text-xs text-muted">
            Reset links last an hour and can be used once. Request a fresh one.
          </p>
          <Link
            href="/forgot"
            className="mt-4 inline-block rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft hover:text-canvas"
          >
            Request a new link
          </Link>
        </div>
      )}
    </main>
  );
}
