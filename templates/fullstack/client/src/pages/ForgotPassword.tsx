import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "wouter";
import { z } from "zod";
import { ROUTES } from "@shared/const";
import { AppFooter } from "@/components/AppFooter";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

const schema = z.object({ email: z.string().trim().email("Enter a valid email address") });
type FormValues = z.infer<typeof schema>;

/**
 * Password reset request.
 *
 * Always reports success, whether or not the address exists — the server does
 * the same, and the two must agree or the page becomes an account-enumeration
 * oracle. The user is told what will happen, not what was found.
 */
export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const request = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setSent(true),
    // Even a transport error should not reveal whether the account exists.
    onError: () => setSent(true),
  });

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="container flex-1 py-12">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>

          {sent ? (
            <div role="status" className="mt-6 space-y-4">
              <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                If an account exists for that address, a reset link is on its way. The link
                expires in 60 minutes and can be used once.
              </p>
              <p className="text-sm text-muted-foreground">
                Nothing arrived? Check your spam folder, then{" "}
                <Link href={ROUTES.login} className="underline underline-offset-2">
                  try signing in
                </Link>{" "}
                — your old password may still work.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit((values) => request.mutate(values))}
              className="mt-6 space-y-4"
              noValidate
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  {...register("email")}
                />
                {errors.email && (
                  <p id="email-error" className="text-sm text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Sending…" : "Send reset link"}
              </Button>

              <p className="text-sm text-muted-foreground">
                <Link href={ROUTES.login} className="underline underline-offset-2">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
