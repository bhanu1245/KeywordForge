import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in? Nothing to do here.
  if (await getSessionUser()) redirect("/");

  return (
    <main className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-5 py-12">
      <AuthForm mode="login" />
    </main>
  );
}
