import { LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Props = { status: "pending" | "rejected" };

/** Shown in place of the chat when a new account is waiting for admin review. */
export function ApplicationGate({ status }: Props) {
  return (
    <main className="standalone-scroll-page relative flex min-h-screen items-center justify-center px-5 py-10">
      <section className="surface-panel w-full max-w-md rounded-3xl p-7 text-center shadow-lift sm:p-9">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck className="size-6" />
        </div>

        {status === "pending" ? (
          <>
            <h1 className="text-2xl font-bold">Application received</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              A ZChat admin needs to approve your account before you can chat.
              Applications are usually reviewed{" "}
              <strong className="text-foreground">3:30pm–7pm on weekdays</strong>.
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              You&rsquo;ll get straight into chat as soon as you&rsquo;re approved — just check back or refresh.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Application not accepted</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              An admin reviewed your account and it wasn&rsquo;t accepted. If you think this is a
              mistake, reach out using the feedback link on the sign-in page.
            </p>
          </>
        )}

        <Button
          variant="outline"
          className="mt-6 w-full"
          onClick={() => void supabase.auth.signOut()}
        >
          <LogOut className="mr-2 size-4" />
          Sign out
        </Button>
      </section>
    </main>
  );
}
