/**
 * Policy rendering.
 *
 * Legal pages are plain markdown with placeholders that are resolved from
 * `legal/compliance.json` at render time. That is deliberate: a policy is the
 * one document where a stale hard-coded value (an old address, a retention
 * period you stopped honouring) is a compliance finding, so nothing in the
 * markdown is allowed to be a fact you could also change elsewhere.
 *
 * Supported syntax:
 *   {{dot.path}}                  → substituted value
 *   {{table:cookies}}             → generated markdown table
 *   {{table:dataInventory}}
 *   {{table:subprocessors}}
 *   {{#if dot.path}}…{{/if}}      → kept only when the value is truthy
 *
 * Unknown placeholders are left visible as `[[missing: path]]` rather than
 * silently rendering an empty string, and `npm run verify` fails on any
 * unresolved path — an empty space in a privacy policy is how "the address was
 * never filled in" ships to production.
 */
import type { ComplianceConfig } from "./compliance";

export function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Escapes a cell so a stray `|` cannot break the markdown table. */
function cell(value: unknown): string {
  return formatValue(value).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function table(rows: string[][], headers: string[]): string {
  if (rows.length === 0) return "_None currently._";
  const head = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return `${head}\n${divider}\n${body}`;
}

export function buildTable(
  name: string,
  compliance: ComplianceConfig
): string | null {
  switch (name) {
    case "cookies":
      return table(
        compliance.cookies.map((cookie) => [
          `\`${cell(cookie.name)}\``,
          cell(cookie.category.replace(/_/g, " ")),
          cell(cookie.purpose),
          cell(cookie.duration),
          cell(cookie.provider),
        ]),
        ["Name", "Category", "Purpose", "Duration", "Set by"]
      );

    case "dataInventory":
      return table(
        compliance.dataInventory.map((entry) => [
          cell(entry.category),
          cell(entry.examples),
          cell(entry.purpose),
          cell(entry.lawfulBasis),
          cell(entry.retention),
        ]),
        ["Category", "Examples", "Why we use it", "Lawful basis", "Retention"]
      );

    case "subprocessors":
      return table(
        compliance.subprocessors.map((vendor) => [
          `[${cell(vendor.name)}](${cell(vendor.dpaUrl)})`,
          cell(vendor.purpose),
          cell(vendor.location),
          cell(vendor.dataCategories),
          cell(vendor.transferMechanism),
        ]),
        ["Vendor", "Purpose", "Location", "Data", "Transfer mechanism"]
      );

    default:
      return null;
  }
}

const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_.]+)\}\}/g;
const TABLE_RE = /\{\{table:([a-zA-Z]+)\}\}/g;
const IF_RE = /\{\{#if\s+([a-zA-Z0-9_.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

export type RenderResult = {
  markdown: string;
  /** Placeholder paths that could not be resolved. Empty in a healthy build. */
  unresolved: string[];
};

export function renderPolicy(
  markdown: string,
  compliance: ComplianceConfig
): RenderResult {
  const unresolved = new Set<string>();

  // Conditionals first, so a hidden block cannot report a false missing value.
  let output = markdown.replace(IF_RE, (_match, path: string, body: string) => {
    const value = getPath(compliance, path);
    return value ? body : "";
  });

  output = output.replace(TABLE_RE, (match, name: string) => {
    const rendered = buildTable(name, compliance);
    if (rendered === null) {
      unresolved.add(`table:${name}`);
      return `[[unknown table: ${name}]]`;
    }
    return rendered;
  });

  output = output.replace(PLACEHOLDER_RE, (_match, path: string) => {
    const value = getPath(compliance, path);
    if (value === undefined || value === null || value === "") {
      unresolved.add(path);
      return `[[missing: ${path}]]`;
    }
    return formatValue(value);
  });

  return { markdown: output, unresolved: [...unresolved] };
}

/** Human title + description per policy page, used by the router and sitemap. */
export const POLICY_PAGES = {
  privacy: {
    slug: "privacy",
    file: "privacy.md",
    title: "Privacy Policy",
    description: "What data we collect, why, how long we keep it, and your rights.",
  },
  terms: {
    slug: "terms",
    file: "terms.md",
    title: "Terms of Service",
    description: "The agreement between you and us for using the service.",
  },
  cookies: {
    slug: "cookies",
    file: "cookies.md",
    title: "Cookie Policy",
    description: "Every cookie and local-storage key we use, and how to change your choices.",
  },
  dpa: {
    slug: "dpa",
    file: "dpa.md",
    title: "Data Processing Addendum",
    description: "The processor terms we offer business customers under GDPR Art. 28.",
  },
  subprocessors: {
    slug: "subprocessors",
    file: "subprocessors.md",
    title: "Sub-processors",
    description: "The vendors that process personal data on our behalf.",
  },
  accessibility: {
    slug: "accessibility",
    file: "accessibility.md",
    title: "Accessibility Statement",
    description: "Our accessibility target, current conformance, and known limitations.",
  },
  security: {
    slug: "security",
    file: "security.md",
    title: "Security",
    description: "How to report a vulnerability and the controls we run.",
  },
  "ai-disclosure": {
    slug: "ai-disclosure",
    file: "ai-disclosure.md",
    title: "AI Disclosure",
    description: "Where AI is used, what it can get wrong, and how your data is handled.",
  },
} as const;

export type PolicySlug = keyof typeof POLICY_PAGES;

export const POLICY_SLUGS = Object.keys(POLICY_PAGES) as PolicySlug[];

/** Maps a policy slug to the ROUTES key that serves it. */
export const POLICY_ROUTE_KEYS: Record<PolicySlug, string> = {
  privacy: "privacy",
  terms: "terms",
  cookies: "cookies",
  dpa: "dpa",
  subprocessors: "subprocessors",
  accessibility: "accessibility",
  security: "security",
  "ai-disclosure": "aiDisclosure",
};
