import { compliance } from "@shared/compliance";
import { POLICY_PAGES, type PolicySlug } from "@shared/policies";
import { LegalLayout } from "@/components/LegalLayout";
import { Markdown } from "@/lib/markdown";
import { getPolicy } from "@/lib/policy-content";

/**
 * One component renders all eight policy pages. Never create a bespoke policy
 * page by copying markdown into JSX: the words belong in `legal/policies/*.md`
 * so that a lawyer can review a plain-text file and `npm run verify` can check
 * every placeholder resolves.
 */
export default function PolicyPage({ slug }: { slug: PolicySlug }) {
  const policy = getPolicy(slug);
  const page = POLICY_PAGES[slug];

  return (
    <LegalLayout
      title={policy.title}
      description={policy.description}
      lastUpdated={compliance.product.effectiveDate}
      unresolved={policy.unresolved}
    >
      <Markdown source={policy.markdown} />

      <hr />
      <p className="text-sm text-muted-foreground">
        Questions about {page.title.toLowerCase()}? Email{" "}
        <a href={`mailto:${compliance.organization.privacyEmail}`}>
          {compliance.organization.privacyEmail}
        </a>
        . This page is a template starting point and is not legal advice —
        have a qualified lawyer review it before you rely on it.
      </p>
    </LegalLayout>
  );
}
