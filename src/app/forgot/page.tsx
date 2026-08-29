import { ForgotForm } from "@/components/ResetForm";

export const dynamic = "force-dynamic";

export default function ForgotPage() {
  return (
    <main className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-5 py-12">
      <ForgotForm />
    </main>
  );
}
