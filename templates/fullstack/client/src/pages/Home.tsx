import { ArrowRight, Check, Lock, ScrollText, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { ROUTES } from "@shared/const";
import { compliance } from "@shared/compliance";
import { AppFooter } from "@/components/AppFooter";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

/**
 * Landing page.
 *
 * Replace the copy, keep the structure: header → hero → value props → a
 * verifiable "what's already done" list → footer with legal links. The list is
 * generated from `legal/compliance.json`, so it stays true as you change the
 * config instead of turning into marketing fiction.
 */
export default function Home() {
  const { user } = useAuth();

  const done = [
    `Privacy policy, terms, cookie policy and DPA published from one config file`,
    `${Object.keys(compliance.regimes).length} regulatory regimes tracked, with the ones that apply switched on`,
    `Consent banner with accept / reject of equal prominence, and a consent log`,
    `One-click data export and account deletion (GDPR Art. 15/17, CCPA)`,
    `Password hashing with ${compliance.security.passwordHashing}`,
    `Accessibility target: ${compliance.accessibility.standard}`,
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <main id="main" className="flex-1">
        <section className="container py-16 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Built on a starter that ships with its compliance layer
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              {compliance.organization.productName}
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              {compliance.product.description}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {user ? (
                <Link href={ROUTES.dashboard}>
                  <Button size="lg">
                    Open the dashboard
                    <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link href={ROUTES.signup}>
                    <Button size="lg">
                      Create an account
                      <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                    </Button>
                  </Link>
                  <Link href={ROUTES.login}>
                    <Button size="lg" variant="outline">
                      Sign in
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="container pb-16" aria-labelledby="why">
          <h2 id="why" className="sr-only">
            Why this starter
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <CardHeader>
                <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
                <CardTitle className="mt-2">Sessions you can revoke</CardTitle>
                <CardDescription>
                  Server-side sessions with a "sign out everywhere" control, because a
                  stateless token cannot be un-issued.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <ScrollText className="h-6 w-6 text-primary" aria-hidden="true" />
                <CardTitle className="mt-2">Policies that cannot drift</CardTitle>
                <CardDescription>
                  Legal pages are generated from one JSON file, and the build fails if the
                  code and the promises disagree.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Lock className="h-6 w-6 text-primary" aria-hidden="true" />
                <CardTitle className="mt-2">Data rights that work</CardTitle>
                <CardDescription>
                  Export and deletion are real endpoints with tests, not a paragraph
                  promising to answer an email eventually.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </section>

        <section className="border-y border-border bg-muted/30 py-16" aria-labelledby="done">
          <div className="container max-w-3xl">
            <h2 id="done" className="text-2xl font-semibold tracking-tight">
              What is already handled
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Everything below is implemented and covered by tests in this repository.
              Nothing here is a promise for later.
            </p>
            <ul className="mt-6 space-y-3">
              {done.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-muted-foreground">
              Read the{" "}
              <Link href={ROUTES.privacy} className="underline underline-offset-2">
                privacy policy
              </Link>{" "}
              and the{" "}
              <Link href={ROUTES.security} className="underline underline-offset-2">
                security page
              </Link>{" "}
              for the detail.
            </p>
          </div>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
