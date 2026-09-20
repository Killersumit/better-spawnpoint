import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { CheckCircle2, XCircle } from "lucide-react";
import { ROUTES } from "@shared/const";
import { AppFooter } from "@/components/AppFooter";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

/**
 * Email confirmation landing page.
 *
 * The mutation runs once (guarded by a ref-like state flag) because the token
 * is single-use: a double-invoked effect in React 18 StrictMode would consume
 * it and show a false failure.
 */
export default function VerifyEmail() {
  const token = new URLSearchParams(useSearch()).get("token") ?? "";
  const [attempted, setAttempted] = useState(false);
  const verify = trpc.auth.verifyEmail.useMutation();

  useEffect(() => {
    if (!token || attempted) return;
    setAttempted(true);
    verify.mutate({ token });
  }, [attempted, token, verify]);

  const state = !token
    ? "missing"
    : verify.isPending || !attempted
      ? "pending"
      : verify.isSuccess
        ? "ok"
        : "failed";

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="container flex-1 py-12">
        <div className="mx-auto w-full max-w-md text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Confirm your email</h1>

          {state === "pending" && (
            <p role="status" className="mt-6 text-sm text-muted-foreground">
              Checking your link…
            </p>
          )}

          {state === "ok" && (
            <div role="status" className="mt-6 space-y-4">
              <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
              <p className="text-sm">
                Thanks — your email address is confirmed. You will now receive account
                notifications.
              </p>
              <Link href={ROUTES.dashboard}>
                <Button>Go to your dashboard</Button>
              </Link>
            </div>
          )}

          {state === "failed" && (
            <div role="status" className="mt-6 space-y-4">
              <XCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
              <p className="text-sm">
                That link is invalid or has already been used. Confirmation links expire
                after 24 hours.
              </p>
              <Link href={ROUTES.login}>
                <Button variant="outline">Sign in and request a new link</Button>
              </Link>
            </div>
          )}

          {state === "missing" && (
            <p role="alert" className="mt-6 text-sm text-destructive">
              This page needs the link from your confirmation email.
            </p>
          )}
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
