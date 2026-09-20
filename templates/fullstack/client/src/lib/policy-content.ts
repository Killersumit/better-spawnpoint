/**
 * Loads the policy markdown shipped in `legal/policies/` and renders it with
 * the values from `legal/compliance.json`.
 *
 * Files are inlined at build time by Vite's glob import, so a policy page costs
 * no network round trip and cannot 404 in production. Adding a policy means
 * adding the markdown file, an entry in `shared/policies.ts → POLICY_PAGES`, a
 * route in `shared/const.ts → ROUTES`, and a link in the footer — `npm run
 * verify` fails if any of the four are missing.
 */
import { compliance } from "@shared/compliance";
import { POLICY_PAGES, renderPolicy, type PolicySlug } from "@shared/policies";

const FILES = import.meta.glob("../../../legal/policies/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function lookup(fileName: string): string | null {
  for (const [path, contents] of Object.entries(FILES)) {
    if (path.endsWith(`/${fileName}`)) return contents;
  }
  return null;
}

export type RenderedPolicy = {
  slug: PolicySlug;
  title: string;
  description: string;
  markdown: string;
  /** Placeholder paths that could not be resolved from compliance.json. */
  unresolved: string[];
};

export function getPolicy(slug: PolicySlug): RenderedPolicy {
  const page = POLICY_PAGES[slug];
  const raw = lookup(page.file);

  if (raw === null) {
    return {
      slug,
      title: page.title,
      description: page.description,
      markdown: `# ${page.title}\n\nThis policy file is missing from the build. Restore \`legal/policies/${page.file}\`.`,
      unresolved: [`file:${page.file}`],
    };
  }

  const { markdown, unresolved } = renderPolicy(raw, compliance);
  return { slug, title: page.title, description: page.description, markdown, unresolved };
}
