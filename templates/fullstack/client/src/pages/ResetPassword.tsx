import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useSearch } from "wouter";
import { z } from "zod";
import { ROUTES } from "@shared/const";
import { AppFooter } from "@/components/AppFooter";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

const schema = z
  .object({
    password: z.string().min(12, "Use at least 12 characters").max(200),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    message: "The two passwords do not match",
    path: ["confirm"],
  });

type FormValues = z.infer<typeof schema>;

/**
 * Reset completion.
 *
 * The token comes from the emailed link, so it is read from the query string
 * and never rendered back to the user. On success we tell the user every other
 * device was signed out — that is a feature, and saying so avoids a support
 * ticket.
 */
export default function ResetPassword() {
  const token = new URLSearchParams(useSearch()).get("token") ?? "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const reset = trpc.auth.resetPassword.useMutation({
    onSuccess: () => setDone(true),
    onError: (mutationError) => setError(mutationError.message),
  });

  useEffect(() => {
    // Strip the token from the address bar so it cannot leak through a
    // screenshot, a shared link, or a referrer header.
    if (token) window.history.replaceState({}, "", ROUTES.resetPassword);
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="container flex-1 py-12">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>

          {!token && !done && (
            <p role="alert" className="mt-6 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              This page needs the link from your reset email.{" "}
              <Link href={ROUTES.forgotPassword} className="underline underline-offset-2">
                Request a new one
              </Link>
              .
            </p>
          )}

          {done ? (
            <div role="status" className="mt-6 space-y-4">
              <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                Your password has been changed and every other device has been signed out.
              </p>
              <Link href={ROUTES.login}>
                <Button className="w-full">Sign in with your new password</Button>
              </Link>
            </div>
          ) : (
            token && (
              <form
                onSubmit={handleSubmit((values) => {
                  setError(null);
                  reset.mutate({ token, password: values.password });
                })}
                className="mt-6 space-y-4"
                noValidate
              >
                <p
                  role="alert"
                  aria-live="polite"
                  className={error ? "rounded-md bg-destructive/10 p-3 text-sm text-destructive" : "sr-only"}
                >
                  {error ?? ""}
                </p>

                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby="password-hint"
                    {...register("password")}
                  />
                  <p id="password-hint" className="text-xs text-muted-foreground">
                    At least 12 characters, including a letter and a number.
                  </p>
                  {errors.password && (
                    <p className="text-sm text-destructive">{errors.password.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm new password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={Boolean(errors.confirm)}
                    aria-describedby={errors.confirm ? "confirm-error" : undefined}
                    {...register("confirm")}
                  />
                  {errors.confirm && (
                    <p id="confirm-error" className="text-sm text-destructive">
                      {errors.confirm.message}
                    </p>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : "Set new password"}
                </Button>
              </form>
            )
          )}
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
