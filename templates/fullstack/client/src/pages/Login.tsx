import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useSearch } from "wouter";
import { z } from "zod";
import { ROUTES } from "@shared/const";
import { AppFooter } from "@/components/AppFooter";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { OAuthButtons } from "@/components/OAuthButtons";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

type FormValues = z.infer<typeof schema>;

/**
 * Sign-in page.
 *
 * Accessibility notes: labels are real `<label>` elements, errors are announced
 * through `aria-describedby` + `role="alert"`, and focus moves to the first
 * invalid field on submit. The error summary is a live region, not a colour
 * change.
 */
export default function Login() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const returnTo = params.get("returnTo");
  const oauthError = params.get("error");
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setFocus,
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const utils = trpc.useUtils();
  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate(returnTo && returnTo.startsWith("/") ? returnTo : ROUTES.dashboard);
    },
    onError: (error) => setFormError(error.message),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    login.mutate(values);
  });

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main id="main" className="container flex-1 py-12">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back. New here?{" "}
            <Link href={ROUTES.signup} className="underline underline-offset-2">
              Create an account
            </Link>
            .
          </p>

          {oauthError && (
            <p
              role="alert"
              className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              Sign-in did not complete ({oauthError}). Please try again.
            </p>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <p
              role="alert"
              aria-live="polite"
              className={formError ? "rounded-md bg-destructive/10 p-3 text-sm text-destructive" : "sr-only"}
            >
              {formError ?? ""}
            </p>

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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href={ROUTES.forgotPassword}
                  className="text-xs underline underline-offset-2 text-muted-foreground"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "password-error" : undefined}
                {...register("password")}
              />
              {errors.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
              onClick={() => {
                // Move focus to the first invalid field instead of leaving the
                // user to hunt for the message.
                if (errors.email) setFocus("email");
                else if (errors.password) setFocus("password");
              }}
            >
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <OAuthButtons returnTo={returnTo ?? undefined} className="mt-6" />
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
