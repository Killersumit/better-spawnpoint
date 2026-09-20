/**
 * `npm run ai:context` — regenerate the machine-readable project map.
 *
 * WHY THIS EXISTS
 * An AI coding agent working in this repo has two failure modes that cost more
 * than any bug: inventing an API that does not exist, and "fixing" something
 * that was deliberate. Both come from not knowing the ground truth. This script
 * derives that ground truth FROM THE CODE — routes, procedures, environment
 * variables, tables, policies, files — and writes it to `docs/ai/`.
 *
 * Nothing here is hand-maintained. If the output is wrong, the code changed and
 * the map is stale, which is exactly the signal you want: re-run it. Committing
 * the generated files is intentional, so an agent that cannot run scripts still
 * reads an accurate map (add a CI step that re-runs this and fails on a diff).
 *
 * Usage:
 *   npm run ai:context
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT_DIR = join(ROOT, "docs", "ai");

// ─────────────────────────────────────────────────────────────────────────────
// Facts pulled from the code itself
// ─────────────────────────────────────────────────────────────────────────────

const { ROUTES, PUBLIC_ROUTES, API, COOKIE_NAME, SESSION_TTL_MS } = await import("../shared/const.ts");
const { POLICY_PAGES, POLICY_SLUGS } = await import("../shared/policies.ts");
const { compliance } = await import("../shared/compliance.ts");
const { RETENTION, JOBS } = await import("../server/_core/jobs/registry.ts");

/** All env vars the server reads, taken from the zod schema in env.ts. */
function envVariables(): { name: string; documented: boolean }[] {
  const source = readFileSync(join(ROOT, "server", "_core", "env.ts"), "utf8");
  const schemaStart = source.indexOf("const schema = z.object({");
  const schemaEnd = source.indexOf("});", schemaStart);
  const block = source.slice(schemaStart, schemaEnd);

  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const names = [...block.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);

  return names.map((name) => ({
    name,
    documented: new RegExp(`^#?\\s*${name}=`, "m").test(example),
  }));
}

/**
 * tRPC procedures, parsed from the routers.
 *
 * Parsing rather than importing: importing `server/routers.ts` would boot the
 * whole server graph (env, db pool, schedulers) just to list names. The parse
 * is deliberately simple — top-level `name: accessProcedure` entries — and the
 * count is printed so drift is visible instead of silent.
 */
function trpcProcedures(): { path: string; kind: string; access: string }[] {
  const dir = join(ROOT, "server", "routers");
  const out: { path: string; kind: string; access: string }[] = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const source = readFileSync(join(dir, file), "utf8");
    const routerName = file.replace(/\.ts$/, "");

    const entry =
      /^ {2}([A-Za-z][A-Za-z0-9]*):\s*(publicProcedure|authedProcedure|adminProcedure|rateLimitedProcedure)\b/gm;
    const starts = [...source.matchAll(entry)];

    starts.forEach((match, index) => {
      const bodyStart = match.index + match[0].length;
      const bodyEnd = starts[index + 1]?.index ?? source.length;
      const body = source.slice(bodyStart, bodyEnd);

      // The chain decides the verb; middleware between (`.input`, `.use`) is
      // expected, so scan for the first `.query(` / `.mutation(`.
      const verb = /\.\s*(query|mutation|subscription)\s*\(/.exec(body)?.[1];
      if (!verb) return;

      out.push({ path: `${routerName}.${match[1]}`, kind: verb, access: match[2]! });
    });
  }

  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Table names declared in the Drizzle schema. */
function tables(): string[] {
  const source = readFileSync(join(ROOT, "drizzle", "schema.ts"), "utf8");
  // Table names may be camelCase (they become the SQL name verbatim), so do
  // not restrict the character class to snake_case.
  return [...source.matchAll(/mysqlTable\(\s*"([A-Za-z_]+)"/gs)].map((m) => m[1]!).sort();
}

/** HTTP routes registered outside tRPC (files, auth, compliance, ops). */
function httpRoutes(): string[] {
  const dir = join(ROOT, "server", "_core", "http");
  const out: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(join(dir, file), "utf8");
    const re = /app\.(get|post|put|patch|delete|all)\(\s*[`"]([^`"]+)[`"]/g;
    for (const match of source.matchAll(re)) {
      out.push(`${match[1]!.toUpperCase()} ${match[2]}`);
    }
  }
  return out.sort();
}

/**
 * Source files with a one-line summary from their own leading doc comment.
 *
 * Walks the tree rather than shelling out to `git ls-files`: the template is
 * meant to be used in a fresh directory where files may not be committed yet,
 * and an empty inventory is worse than useless to an agent.
 */
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".data",
  ".dev",
  ".output",
  "migrations",
]);
const SUMMARISED_EXTENSIONS = /\.(ts|tsx|mjs|css)$/;

function fileInventory(): { path: string; summary: string; lines: number }[] {
  const found: { path: string; summary: string; lines: number }[] = [];

  const walk = (absoluteDir: string): void => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolute = join(absoluteDir, entry.name);
      const relativePath = relative(ROOT, absolute);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(absolute);
        continue;
      }
      if (!SUMMARISED_EXTENSIONS.test(entry.name)) continue;
      if (relativePath.startsWith("docs/ai/")) continue;

      const source = readFileSync(absolute, "utf8");
      const lines = source.split("\n").length;

      // First sentence of the leading block comment, else the first `//` line.
      let summary = "";
      const block = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
      if (block) {
        const text = block[1]!
          .split("\n")
          .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
          .filter((line) => line.length > 0 && !line.startsWith("@") && !line.startsWith("•"))
          .join(" ");
        summary = (text.split(/(?<=\.)\s/)[0] ?? text).slice(0, 200);
      } else {
        const line = source.split("\n").find((l) => l.trim().startsWith("//"));
        summary = line ? line.replace(/^\s*\/\/\s?/, "").slice(0, 200) : "";
      }

      found.push({ path: relativePath, summary, lines });
    }
  };

  walk(ROOT);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

const procedures = trpcProcedures();
const env = envVariables();
const schemaTables = tables();
const http = httpRoutes();
const inventory = fileInventory();

const routeKeyForSlug = (slug: (typeof POLICY_SLUGS)[number]): string =>
  slug === "ai-disclosure" ? "aiDisclosure" : slug;

const manifest = {
  generatedBy: "scripts/ai-context.ts",
  note: "Generated file — do not hand-edit. Run `npm run ai:context` after changing routes, routers, env or schema.",
  routes: ROUTES,
  publicRoutes: PUBLIC_ROUTES,
  apiPrefixes: API,
  cookie: { name: COOKIE_NAME, sessionTtlMs: SESSION_TTL_MS },
  procedures,
  httpRoutes: http,
  tables: schemaTables,
  jobs: Object.entries(JOBS).map(([name, job]) => ({
    name,
    cron: job.cron,
    description: job.description,
    retentionDays: job.retentionDays ?? null,
  })),
  retention: RETENTION,
  env,
  policies: POLICY_SLUGS.map((slug) => ({
    slug,
    title: POLICY_PAGES[slug].title,
    file: `legal/policies/${POLICY_PAGES[slug].file}`,
    route: (ROUTES as Record<string, string>)[routeKeyForSlug(slug)] ?? null,
  })),
  compliance: {
    version: compliance.version,
    regimes: compliance.regimes,
    subprocessors: compliance.subprocessors.length,
    cookies: compliance.cookies.length,
  },
};

const md: string[] = [];
const w = (line = "") => md.push(line);

w("# Project map (generated)");
w();
w("> Generated by `npm run ai:context`. Do not edit by hand — edit the code and re-run.");
w("> Read this before writing code: it is the list of what actually exists.");
w();

w("## Commands");
w();
w("| Command | What it does |");
w("| --- | --- |");
w("| `npm run dev` | Dev server on :3000 with HMR and the dev log collector |");
w("| `npm run check` | TypeScript, no emit |");
w("| `npm test` | Vitest (unit + integration) |");
w("| `npm run verify` | Compliance and convention gate — run before every commit |");
w("| `npm run build` | Client bundle + server bundle into `dist/` |");
w("| `npm run smoke` | Boots the build and asserts the HTTP surface |");
w("| `npm run db:generate` / `db:migrate` / `db:push` | Drizzle migrations |");
w("| `npm run ai:context` | Regenerate this file and `manifest.json` |");
w("| `npm run legal:licenses` | Regenerate `THIRD-PARTY-NOTICES.md` |");
w();

w("## Routes");
w();
w("`shared/const.ts` is the only source of route strings. Never hard-code a path.");
w();
w("| Key | Path | Access |");
w("| --- | --- | --- |");
const publicSet = new Set<string>(PUBLIC_ROUTES as readonly string[]);
for (const [key, path] of Object.entries(ROUTES)) {
  if (key === "notFound") continue;
  w(`| \`${key}\` | \`${path}\` | ${publicSet.has(path) ? "public" : "requires session"} |`);
}
w();

w("## tRPC procedures");
w();
w("`publicProcedure` = no session. `authedProcedure` = session required, `ctx.user` is present.");
w('`adminProcedure` = session + `role === "admin"`.');
w();
if (procedures.length === 0) {
  w("_none detected_");
} else {
  w("| Procedure | Type | Access |");
  w("| --- | --- | --- |");
  for (const procedure of procedures) w(`| \`${procedure.path}\` | ${procedure.kind} | \`${procedure.access}\` |`);
}
w();

w("## HTTP routes (outside tRPC)");
w();
for (const route of http) w(`- \`${route}\``);
w();

w("## Database tables");
w();
w("Schema: `drizzle/schema.ts`. Migrations: `drizzle/migrations/`. Adding a table");
w("without a migration is the most common way to break a deploy.");
w();
for (const table of schemaTables) w(`- \`${table}\``);
w();

w("## Scheduled jobs");
w();
w("| Job | Schedule | Retention | Purpose |");
w("| --- | --- | --- | --- |");
for (const job of manifest.jobs) {
  w(`| \`${job.name}\` | \`${job.cron}\` | ${job.retentionDays ?? "—"} d | ${job.description} |`);
}
w();

w("## Environment variables");
w();
w("Declared in `server/_core/env.ts`, documented in `.env.example`.");
w("`npm run verify` fails when a variable is read but not documented.");
w();
w("| Variable | Documented in `.env.example` |");
w("| --- | --- |");
for (const variable of env) {
  w(`| \`${variable.name}\` | ${variable.documented ? "yes" : "**NO — add it**"} |`);
}
w();

w("## Legal surface");
w();
w(`Compliance manifest version: \`${compliance.version}\`.`);
w(
  `Enabled regimes: ${Object.entries(compliance.regimes)
    .filter(([, on]) => on === true)
    .map(([name]) => name)
    .join(", ")}`
);
w();
w("| Policy | Route | Source |");
w("| --- | --- | --- |");
for (const policy of manifest.policies) {
  w(`| ${policy.title} | \`${policy.route}\` | \`${policy.file}\` |`);
}
w();
w("A policy is rendered from `legal/policies/*.md` with values from");
w("`legal/compliance.json`. Missing values render as `[[missing: …]]` and");
w("`npm run verify` fails — deliberate, so an unfilled template cannot ship quietly.");
w();

w("## File inventory");
w();
w("| Path | Lines | Purpose (from the file's own doc comment) |");
w("| --- | --- | --- |");
for (const file of inventory) {
  w(`| \`${file.path}\` | ${file.lines} | ${file.summary.replace(/\|/g, "\\|")} |`);
}
w();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(OUT_DIR, "PROJECT-MAP.md"), md.join("\n"));

const rel = (p: string) => relative(ROOT, p);
console.log(`wrote ${rel(join(OUT_DIR, "PROJECT-MAP.md"))}`);
console.log(`wrote ${rel(join(OUT_DIR, "manifest.json"))}`);
console.log(
  `${Object.keys(ROUTES).length} routes · ${procedures.length} procedures · ${schemaTables.length} tables · ${http.length} http routes · ${inventory.length} files`
);
