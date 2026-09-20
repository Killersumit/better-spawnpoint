import { Link } from "wouter";
import { ROUTES } from "@shared/const";
import { compliance } from "@shared/compliance";
import { POLICY_PAGES, POLICY_SLUGS, POLICY_ROUTE_KEYS, type PolicySlug } from "@shared/policies";
import { useConsent } from "@/contexts/ConsentContext";

/**
 * Site footer.
 *
 * Its real job is making the legal pages reachable from every page. Regulators
 * and payment processors both check that a privacy policy is linked from the
 * footer of the home page — "one click away, anywhere" is the standard. The
 * "Cookie settings" control is what makes withdrawing consent as easy as giving
 * it (GDPR Art. 7(3)).
 *
 * `npm run verify` re-checks that every enabled policy appears here.
 */
export function AppFooter() {
  const { reopen } = useConsent();

  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="container flex flex-col gap-6 py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
          <div className="max-w-sm">
            <p className="text-sm font-semibold">{compliance.organization.productName}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {compliance.product.description}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {compliance.organization.legalName}
              <br />
              {compliance.organization.address}
            </p>
          </div>

          <nav aria-label="Legal and trust" className="text-sm">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Trust
            </h2>
            <ul className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-2">
              {POLICY_SLUGS.map((slug: PolicySlug) => {
                const routeKey = POLICY_ROUTE_KEYS[slug];
                const href = (ROUTES as Record<string, string | undefined>)[routeKey];
                if (!href) return null;
                return (
                  <li key={slug}>
                    <Link href={href} className="text-muted-foreground hover:text-foreground">
                      {POLICY_PAGES[slug].title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {compliance.organization.legalName}. All rights
            reserved.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={reopen}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Cookie settings
            </button>
            <a
              href="/.well-known/security.txt"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Report a vulnerability
            </a>
            <a
              href={`mailto:${compliance.organization.supportEmail}`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {compliance.organization.supportEmail}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
