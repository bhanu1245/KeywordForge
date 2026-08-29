import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { peekInvite } from "@/lib/auth/accounts";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  if (await getSessionUser()) redirect("/");

  const { invite } = await searchParams;
  // Resolved server-side so the agency name can be shown without the client
  // ever learning anything about the token beyond what it already holds.
  const details = invite ? await peekInvite(invite) : null;

  return (
    <main className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-5 py-12">
      <AuthForm
        mode="signup"
        // An expired or already-used token is dropped, so the form falls back
        // to creating a new agency rather than silently joining nothing.
        inviteToken={details ? invite : undefined}
        invitedAgency={details?.agencyName ?? null}
        invitedEmail={details?.email ?? null}
      />
    </main>
  );
}
