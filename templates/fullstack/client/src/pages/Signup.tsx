import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useSearch } from "wouter";
import { z } from "zod";
import { ROUTES } from "@shared/const";
import { compliance } from "@shared/compliance";
import { AppFooter } from "@/components/AppFooter";
import { AppHeader } from "@/components/AppHeader";
import { OAuthButtons } from "@/components/OAuthButtons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z
    .string()
    .min(12, "Use at least 12 characters")
    .max(200)
    .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
      message: "Include at least one letter and one number",
    }),
  name: z.string().trim().max(200).optional(),
  marketingOptIn: z.boolean(),
  acceptedTerms: z.literal(true, {
    message: "You must accept the terms to create an account",
  }),
});

type FormValues = z.infer<typeof schema>;

export default function Signup() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const inviteToken = new URLSearchParams(search).get("invite") ?? undefined;
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { marketingOptIn: false, acceptedTerms: undefined as never },
  });

  const marketingOptIn = watch("marketingOptIn");
  const acceptedTerms = watch("acceptedTerms");

  const utils = trpc.useUtils();
  const signup = trpc.auth.signup.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate(ROUTES.dashboard);
    },
    onError: (error) => setFormError(error.message),
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    signup.mutate({
      email: values.email,
      password: values.password,
      ...(values.name ? { name: values.name } : {}),
      marketingOptIn: values.marketingOptIn,
      ...(inviteToken ? { inviteToken } : {}),
    });
  });

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main id="main" className="container flex-1 py-12">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Already have one?{" "}
            <Link href={ROUTES.login} className="underline underline-offset-2">
              Sign in
            </Link>
            .
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <p
              role="alert"
              aria-live="polite"
              className={formError ? "rounded-md bg-destructive/10 p-3 text-sm text-destructive" : "sr-only"}
            >
              {formError ?? ""}
            </p>

            <div className="space-y-2">
              <Label htmlFor="name">Name (optional)</Label>
              <Input id="name" autoComplete="name" {...register("name")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby="password-hint"
                {...register("password")}
              />
              <p id="password-hint" className="text-xs text-muted-foreground">
                At least 12 characters, including a letter and a number. Length matters
                more than symbols.
              </p>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            {/* Marketing consent: unticked, separate from the terms, and never
                bundled — bundling it is what regulators call invalid consent. */}
            <div className="flex items-start gap-3">
              <Checkbox
                id="marketingOptIn"
                checked={marketingOptIn}
                onCheckedChange={(checked) => setValue("marketingOptIn", checked === true)}
              />
              <Label htmlFor="marketingOptIn" className="text-sm font-normal leading-snug">
                Send me occasional product news. You can unsubscribe from any email, and
                this is not required to use the service.
              </Label>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="acceptedTerms"
                checked={acceptedTerms === true}
                aria-invalid={Boolean(errors.acceptedTerms)}
                aria-describedby={errors.acceptedTerms ? "terms-error" : undefined}
                onCheckedChange={(checked) => setValue("acceptedTerms", (checked === true) as never)}
              />
              <Label htmlFor="acceptedTerms" className="text-sm font-normal leading-snug">
                I agree to the{" "}
                <Link href={ROUTES.terms} className="underline underline-offset-2">
                  Terms of Service
                </Link>{" "}
                and the{" "}
                <Link href={ROUTES.privacy} className="underline underline-offset-2">
                  Privacy Policy
                </Link>
                .
              </Label>
            </div>
            {errors.acceptedTerms && (
              <p id="terms-error" className="text-sm text-destructive">
                {errors.acceptedTerms.message}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Creating your account…" : "Create account"}
            </Button>

            <p className="text-xs text-muted-foreground">
              You must be at least {compliance.product.minimumAge} years old to use this
              service.
            </p>
          </form>

          <OAuthButtons className="mt-6" />
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
