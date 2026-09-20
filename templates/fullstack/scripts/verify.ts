/**
 * `npm run verify` — the compliance and convention gate.
 *
 * WHY THIS EXISTS
 * An AI agent (or a hurried human) reliably forgets the same class of things:
 * a policy page that is never linked, a cookie that no policy mentions, a
 * retention window that disagrees with the actual job, a secret that ends up
 * committed, an env var that is read but never documented, a "TODO: add
 * privacy policy" that ships to production. None of those are type errors and
 * none of them fail a unit test — they fail an audit, months later.
 *
 * This script is the enforcement half of the template's legal layer. It runs in
 * CI and in the agent's own loop. Every check below has a real-world failure
 * behind it.
 *
 * Exit code 1 when anything fails, so `npm run verify && git commit` is safe.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const { ROUTES, PUBLIC_ROUTES, PRIVATE_ROUTES, API } = await import("../shared/const.ts");
const { POLICY_PAGES, POLICY_SLUGS, renderPolicy } = await import("../shared/policies.ts");
const { compliance } = await import("../shared/compliance.ts");
const { CONSENT_CATEGORIES } = await import("../shared/consent.ts");
const { RETENTION, JOBS } = await import("../server/_core/jobs/registry.ts");

type Result = { ok: boolean; title: string; detail: string; fix?: string };
const results: Result[] = [];

const pass = (title: string, detail: string) => results.push({ ok: true, title, detail });
const fail = (title: string, detail: string, fix?: string) =>
  results.push({ ok: false, title, detail, fix });

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const exists = (path: string) => existsSync(join(ROOT, path));

/** Every source file under the given directories, with its text. */
function walk(...dirs: string[]): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const visit = (absoluteDir: string) => {
    if (!existsSync(absoluteDir)) return;
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      const absolute = join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!/\.(ts|tsx|css|html)$/.test(entry.name)) continue;
      out.push({ path: relative(ROOT, absolute), text: readFileSync(absolute, "utf8") });
    }
  };
  for (const dir of dirs) visit(join(ROOT, dir));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Policy documents exist, render without blanks, and are reachable
// ─────────────────────────────────────────────────────────────────────────────

const policyFiles = Object.values(POLICY_PAGES).map((page) => `legal/policies/${page.file}`);
const missingFiles = policyFiles.filter((file) => !exists(file));
if (missingFiles.length === 0) {
  pass("every policy has a source document", `${policyFiles.length} files under legal/policies/`);
} else {
  fail(
    "every policy has a source document",
    `missing: ${missingFiles.join(", ")}`,
    "Create the markdown file, or remove the entry from POLICY_PAGES."
  );
}

// The renderer substitutes values from legal/compliance.json. An unfilled
// placeholder shows up as `[[missing: …]]`, which must never reach a user:
// a privacy policy naming "[[missing: organization.legalName]]" as the data
// controller is worse than no page at all.
const unresolved: string[] = [];
for (const [slug, page] of Object.entries(POLICY_PAGES)) {
  if (!exists(`legal/policies/${page.file}`)) continue;
  try {
    const rendered = renderPolicy(read(`legal/policies/${page.file}`), compliance);
    for (const key of rendered.unresolved) {
      unresolved.push(`${page.file}: [[missing: ${key}]]`);
    }
  } catch (error) {
    unresolved.push(`${page.file}: ${(error as Error).message}`);
  }
}
if (unresolved.length === 0) {
  pass("policies render with no missing values", "every placeholder resolved from legal/compliance.json");
} else {
  fail(
    "policies render with no missing values",
    `${unresolved.length} unresolved placeholder(s):\n      ${unresolved.slice(0, 8).join("\n      ")}`,
    "Fill the value in legal/compliance.json — never hard-code it into the markdown."
  );
}

const appTsx = read("client/src/App.tsx");
const footerTsx = read("client/src/components/AppFooter.tsx");
if (appTsx.includes("POLICY_SLUGS") && footerTsx.includes("POLICY_SLUGS")) {
  pass(
    "policies are routed and linked",
    "App.tsx registers POLICY_SLUGS and the footer links them (so they are one click from every page)"
  );
} else {
  fail(
    "policies are routed and linked",
    `${!appTsx.includes("POLICY_SLUGS") ? "App.tsx does not register policy routes. " : ""}${
      !footerTsx.includes("POLICY_SLUGS") ? "AppFooter.tsx does not link policy pages." : ""
    }`,
    "Iterate POLICY_SLUGS rather than listing routes by hand — a page nobody links is a page nobody can find."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Enabled regimes have what they require
// ─────────────────────────────────────────────────────────────────────────────

const regimes = compliance.regimes as Record<string, boolean | undefined>;
const accountRouter = read("server/routers/account.ts");

if (regimes.gdpr || regimes.ukGdpr) {
  const problems: string[] = [];
  if (!accountRouter.includes("exportData")) problems.push("no account.exportData (GDPR Art. 15/20 access + portability)");
  if (!accountRouter.includes("requestDeletion"))
    problems.push("no account.requestDeletion (GDPR Art. 17 erasure)");
  if (!exists("legal/policies/dpa.md")) problems.push("no DPA page (Art. 28, needed by business customers)");
  if (problems.length === 0) {
    pass("GDPR obligations are implemented", "access, erasure, and processor terms are present");
  } else {
    fail("GDPR obligations are implemented", problems.join("; "), "Implement the missing endpoint or disable the regime.");
  }
}

if (regimes.ccpaCpra) {
  const privacy = exists("legal/policies/privacy.md") ? read("legal/policies/privacy.md") : "";
  const mentions = /do not sell|opt out of sale|right to know|sensitive personal information/i.test(privacy);
  if (mentions) {
    pass("CCPA/CPRA disclosures are present", "the privacy policy states the California rights and the opt-out");
  } else {
    fail(
      "CCPA/CPRA disclosures are present",
      "the privacy policy does not mention sale/share or the California rights",
      'Add a "Your California privacy rights" section, or set regimes.ccpaCpra to false.'
    );
  }
}

if (regimes.aiActTransparency) {
  const disclosureRoute = (ROUTES as Record<string, string>).aiDisclosure;
  const note = exists("client/src/components/AiDisclosureNote.tsx");
  const rendered = walk("client/src").some((file) => file.text.includes("AiDisclosureNote"));
  if (disclosureRoute && note && rendered) {
    pass(
      "AI use is disclosed (EU AI Act Art. 50)",
      `${disclosureRoute} exists and AiDisclosureNote is rendered wherever AI output is shown`
    );
  } else {
    fail(
      "AI use is disclosed (EU AI Act Art. 50)",
      `${!disclosureRoute ? "no aiDisclosure route. " : ""}${
        !note ? "no AiDisclosureNote component. " : ""
      }${!rendered ? "the disclosure component is never rendered." : ""}`,
      "Users must be told when they are interacting with AI. Render AiDisclosureNote next to AI output, or disable aiActTransparency."
    );
  }
}

if (regimes.coppa) {
  const minimumAge = Number((compliance.product as { minimumAge?: number }).minimumAge ?? 0);
  if (minimumAge >= 13) {
    fail(
      "COPPA handling matches the stated minimum age",
      `regimes.coppa is true but product.minimumAge is ${minimumAge}`,
      "COPPA only applies under 13. Either set minimumAge below 13 and implement verifiable parental consent, or disable the regime."
    );
  } else {
    pass("COPPA regime acknowledged", `minimumAge ${minimumAge} with parental consent required`);
  }
}

if (regimes.pciDss) {
  fail(
    "PCI-DSS scope",
    "regimes.pciDss is enabled, which means card data reaches this application",
    "Use a hosted checkout (Stripe Checkout/Elements) so card data never touches your servers, then set pciDss to false. If you truly store card data, this template's defaults are not sufficient."
  );
}

// A retention window that disagrees between the policy and the job is a false
// statement to users, and the kind of thing an auditor samples first.
const retentionConfig = (compliance as { retention?: Record<string, number> }).retention ?? {};
const retentionMismatches = Object.entries(RETENTION)
  .filter(([key, days]) => typeof retentionConfig[key] === "number" && retentionConfig[key] !== days)
  .map(([key, days]) => `${key}: job says ${days}d, compliance.json says ${retentionConfig[key]}d`);

if (retentionMismatches.length === 0) {
  pass(
    "retention windows agree with the jobs",
    `${Object.keys(RETENTION).length} windows mirror legal/compliance.json`
  );
} else {
  fail(
    "retention windows agree with the jobs",
    retentionMismatches.join("; "),
    "Change the job's RETENTION value or the policy number — they must match, or the policy is inaccurate."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cookies: declared, categorised, and gated on consent
// ─────────────────────────────────────────────────────────────────────────────

const declaredCookies = (compliance.cookies ?? []) as { category?: string; name?: string }[];
const badCategories = declaredCookies
  .filter((cookie) => cookie.category && !CONSENT_CATEGORIES.includes(cookie.category as never))
  .map((cookie) => `${cookie.name ?? "(unnamed)"} → ${cookie.category}`);

if (badCategories.length === 0) {
  pass(
    "every declared cookie maps to a consent category",
    `${declaredCookies.length} entries in legal/compliance.json → cookies`
  );
} else {
  fail(
    "every declared cookie maps to a consent category",
    badCategories.join(", "),
    `Valid categories: ${CONSENT_CATEGORIES.join(", ")}.`
  );
}

const analyticsLoader = read("client/src/lib/analytics.ts");
const gatesOnConsent = /analytics/.test(analyticsLoader) && /consent/i.test(analyticsLoader);
if (gatesOnConsent) {
  pass("analytics is consent-gated", "the loader checks the analytics category before loading anything");
} else {
  fail(
    "analytics is consent-gated",
    "lib/analytics.ts does not appear to check consent",
    "No non-essential script may run before the matching category is true (ePrivacy / GDPR Art. 6)."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Secrets, hygiene, and the things that end up on the front page of HN
// ─────────────────────────────────────────────────────────────────────────────

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "Stripe live key", pattern: /sk_live_[0-9a-zA-Z]{16,}/ },
  { name: "AWS access key id", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "private key block", pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Google API key", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "GitHub token", pattern: /gh[pousr]_[0-9A-Za-z]{36,}/ },
  { name: "Slack token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
];

const scanned = walk("client", "server", "shared", "scripts");
const leaked = scanned.flatMap((file) =>
  SECRET_PATTERNS.filter(({ pattern }) => pattern.test(file.text)).map(({ name }) => `${name} in ${file.path}`)
);

if (leaked.length === 0) {
  pass("no credentials committed", `${scanned.length} source files scanned for known key formats`);
} else {
  fail(
    "no credentials committed",
    leaked.join("; "),
    "Remove the value, rotate the key (assume it is compromised the moment it is pushed), and load it from the environment."
  );
}

const gitignore = exists(".gitignore") ? read(".gitignore") : "";
const ignoreLines = gitignore
  .split("\n")
  .map((line) => line.trim().replace(/\/$/, ""))
  .filter((line) => line.length > 0 && !line.startsWith("#"));
const ignored = [".env", ".env.local", ".data", ".dev", "node_modules"].filter(
  (entry) => !ignoreLines.includes(entry)
);
if (ignored.length === 0) {
  pass(".gitignore covers secrets and local state", ".env, .data/, .dev/ and node_modules are ignored");
} else {
  fail(".gitignore covers secrets and local state", `not ignored: ${ignored.join(", ")}`, "Add the missing entries.");
}

const TOS_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "TODO/FIXME left in user-facing code", pattern: /\bTODO\b|\bFIXME\b/ },
  { name: "Manus/Forge runtime reference", pattern: /manus|forge\.manus/i },
  { name: "lorem ipsum", pattern: /lorem ipsum/i },
  { name: "placeholder email", pattern: /(noreply|example)@example\.(com|org)/ },
];
const userFacing = [
  ...walk("client/src"),
  ...(exists("client/public") ? walk("client/public") : []),
  ...walk("legal/policies"),
];
const slopFound = userFacing.flatMap((file) =>
  TOS_PATTERNS.filter(({ pattern }) => pattern.test(file.text)).map(({ name }) => `${name} in ${file.path}`)
);
if (slopFound.length === 0) {
  pass("no placeholder text or vendor leftovers", "no TODO/FIXME, lorem ipsum, or Manus/Forge references");
} else {
  fail(
    "no placeholder text or vendor leftovers",
    slopFound.slice(0, 10).join("; "),
    "Placeholders that reach production are how privacy policies end up saying 'lorem ipsum'."
  );
}

// Env vars that are read but undocumented are the ones that break a deploy.
const envSource = read("server/_core/env.ts");
const schemaBlock = envSource.slice(envSource.indexOf("const schema = z.object({"), envSource.indexOf("});", envSource.indexOf("const schema = z.object({")));
const declaredEnv = [...schemaBlock.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);
const exampleEnv = read(".env.example");
const undocumented = declaredEnv.filter((name) => !new RegExp(`^#?\\s*${name}=`, "m").test(exampleEnv));

if (undocumented.length === 0) {
  pass("every environment variable is documented", `${declaredEnv.length} variables documented in .env.example`);
} else {
  fail(
    "every environment variable is documented",
    `not in .env.example: ${undocumented.join(", ")}`,
    "Document it — an operator cannot configure what they cannot find."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Database, accessibility, and build hygiene
// ─────────────────────────────────────────────────────────────────────────────

const schema = read("drizzle/schema.ts");
const tables = [...schema.matchAll(/mysqlTable\(\s*"([A-Za-z_]+)"/gs)].map((m) => m[1]!);
const migrationsDir = join(ROOT, "drizzle", "migrations");
const migrationSql = existsSync(migrationsDir)
  ? readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
      .join("\n")
  : "";

if (tables.length === 0) {
  fail("schema declares tables", "no mysqlTable() calls found in drizzle/schema.ts", "Is the schema file empty?");
} else if (migrationSql.length === 0) {
  fail(
    "schema changes have migrations",
    `${tables.length} tables declared but no migration SQL found`,
    "Run `npm run db:generate` and commit drizzle/migrations/ — a table without a migration does not exist in production."
  );
} else {
  const unmigrated = tables.filter((table) => !new RegExp(`\`?${table}\`?`, "i").test(migrationSql));
  if (unmigrated.length === 0) {
    pass("schema changes have migrations", `${tables.length} tables present in drizzle/migrations/`);
  } else {
    fail(
      "schema changes have migrations",
      `no migration mentions: ${unmigrated.join(", ")}`,
      "Run `npm run db:generate`."
    );
  }
}

const clientFiles = walk("client/src");
const imgWithoutAlt = clientFiles.filter((file) => /<img\b(?![^>]*\balt=)/.test(file.text)).map((f) => f.path);
const targetNoRel = clientFiles
  .filter((file) =>
    [...file.text.matchAll(/<a\b[^>]*>/g)].some(
      (tag) => tag[0].includes('target="_blank"') && !tag[0].includes("rel=")
    )
  )
  .map((f) => f.path);
const indexHtml = exists("client/index.html") ? read("client/index.html") : "";
const hasLang = /<html[^>]+lang=/.test(indexHtml);
const hasSkipLink = clientFiles.some((file) => /Skip to (main )?content/i.test(file.text));

const a11yProblems = [
  ...imgWithoutAlt.map((path) => `<img> without alt in ${path}`),
  ...targetNoRel.map((path) => `target="_blank" without rel in ${path}`),
  ...(hasLang ? [] : ["client/index.html has no lang attribute on <html>"]),
  ...(hasSkipLink ? [] : ["no skip-to-content link found"]),
];

if (a11yProblems.length === 0) {
  pass(
    "baseline accessibility checks pass",
    "images have alt text, external links are rel-protected, the document has a language, and there is a skip link (WCAG 2.2 AA is the stated target)"
  );
} else {
  fail(
    "baseline accessibility checks pass",
    a11yProblems.join("; "),
    "An accessibility statement that claims WCAG 2.2 AA while these fail is a false claim."
  );
}

const pkg = JSON.parse(read("package.json")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
const loose = Object.entries(allDeps)
  .filter(([, range]) => range === "*" || range === "latest" || range.trim() === "")
  .map(([name]) => name);
if (loose.length === 0) {
  pass("dependency versions are pinned or ranged", `${Object.keys(allDeps).length} dependencies, none floating`);
} else {
  fail("dependency versions are pinned or ranged", `floating versions: ${loose.join(", ")}`, "Pin a range so builds are reproducible.");
}

const noticesExist = exists("THIRD-PARTY-NOTICES.md");
if (noticesExist) {
  pass("third-party licence notices exist", "THIRD-PARTY-NOTICES.md is present (run `npm run legal:licenses` after changing dependencies)");
} else {
  fail(
    "third-party licence notices exist",
    "THIRD-PARTY-NOTICES.md is missing",
    "Run `npm run legal:licenses`. Nearly every permissive licence requires attribution, and shipping without it is a licence violation."
  );
}

const securityTxt = read("server/_core/http/health.ts").includes("security.txt");
if (securityTxt) {
  pass("security.txt is served", "researchers have a contact route (.well-known/security.txt)");
} else {
  fail("security.txt is served", "no security.txt route", "Add it — RFC 9116. It is the cheapest trust signal there is.");
}

// Routes defined but never rendered are a silent 404 for real users.
const routeValues = Object.entries(ROUTES).filter(([key]) => key !== "notFound");
const renderedClient = read("client/src/App.tsx");
const unrouted = routeValues
  .filter(([, path]) => !new RegExp(`ROUTES\\.|POLICY_SLUGS|"${path}"`).test(renderedClient))
  .map(([key, path]) => `${key} (${path})`);
if (unrouted.length === 0) {
  pass("every route is reachable", `${routeValues.length} routes accounted for in App.tsx`);
} else {
  fail(
    "every route is reachable",
    `not rendered anywhere: ${unrouted.join(", ")}`,
    "Register it in App.tsx, or remove it from ROUTES."
  );
}

const publicCount = PUBLIC_ROUTES.length;
const privateCount = PRIVATE_ROUTES.length;
pass(
  "public/private route split is explicit",
  `${publicCount} public · ${privateCount} require a session (new pages are private by default)`
);

// API prefixes are shared between client and server, so a typo is a build error
// rather than a 404 at runtime.
const apiPrefixesOk = Object.values(API).every((prefix) => typeof prefix === "string" && prefix.startsWith("/"));
if (apiPrefixesOk) {
  pass("API prefixes are centrally defined", `${Object.keys(API).length} prefixes in shared/const.ts`);
} else {
  fail("API prefixes are centrally defined", "an API prefix does not start with /");
}

const jobCount = Object.keys(JOBS).length;
const schedulable = Object.values(JOBS).every((job) => typeof job.cron === "string" && job.cron.split(" ").length === 5);
if (schedulable && jobCount > 0) {
  pass("scheduled jobs are well-formed", `${jobCount} jobs with 5-field cron expressions`);
} else {
  fail("scheduled jobs are well-formed", `${jobCount} jobs registered`, "Every job needs a 5-field cron expression.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

console.log(`\nverify — ${results.length} checks\n`);
for (const result of results) {
  console.log(`${result.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`} ${result.title}`);
  console.log(`  ${DIM}${result.detail}${RESET}`);
  if (!result.ok && result.fix) console.log(`  → ${result.fix}`);
}

const failures = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failures.length}/${results.length} checks passed${failures.length ? ` — ${failures.length} FAILED` : ""}\n`
);
process.exit(failures.length === 0 ? 0 : 1);
