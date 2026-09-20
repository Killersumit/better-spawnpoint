/**
 * `npm run legal:licenses` — regenerate THIRD-PARTY-NOTICES.md.
 *
 * WHY THIS EXISTS
 * Attribution is not optional paperwork. MIT, BSD and Apache-2.0 all require
 * that the copyright notice and licence text travel with the distributed
 * software; Apache-2.0 additionally requires a NOTICE file and a statement of
 * changes. Shipping a bundle built from these dependencies without notices is a
 * licence violation — the kind that, in practice, gets discovered by a lawyer
 * rather than a linter.
 *
 * The script also classifies every dependency by licence family, because the
 * interesting cases are the outliers:
 *   • copyleft (GPL/AGPL/LGPL/SSPL) — can oblige you to publish source
 *   • source-available / non-commercial (BUSL, CC-BY-NC) — usually unusable in
 *     a commercial product without a commercial licence
 *   • unknown / missing — you cannot comply with a licence you cannot find
 *
 * Those are reported loudly at the end. Nothing here is legal advice; it is the
 * inventory a lawyer (or an agent) needs before shipping.
 *
 * Usage:
 *   npm run legal:licenses
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const NODE_MODULES = join(ROOT, "node_modules");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type Entry = {
  name: string;
  version: string;
  license: string;
  homepage: string | null;
  scope: "runtime" | "development";
  licenseText: string | null;
};

const runtime = Object.keys(pkg.dependencies ?? {});
const development = Object.keys(pkg.devDependencies ?? {});

/** Reads one installed package. Missing packages are reported, not skipped. */
function readPackage(name: string, scope: Entry["scope"]): Entry | null {
  const manifestPath = join(NODE_MODULES, ...name.split("/"), "package.json");
  if (!existsSync(manifestPath)) {
    console.warn(`  ! ${name} is declared but not installed — run npm install`);
    return null;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    version?: string;
    license?: string | { type?: string };
    licenses?: { type?: string }[] | { type?: string };
    homepage?: string;
    repository?: string | { url?: string };
  };

  const license =
    typeof manifest.license === "string"
      ? manifest.license
      : typeof manifest.license === "object"
        ? (manifest.license.type ?? "UNKNOWN")
        : Array.isArray(manifest.licenses)
          ? manifest.licenses.map((l) => l.type ?? "UNKNOWN").join(" OR ")
          : typeof manifest.licenses === "object"
            ? (manifest.licenses.type ?? "UNKNOWN")
            : "UNKNOWN";

  const repository =
    typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  const homepage =
    (manifest.homepage ?? repository ?? null)?.replace(/^git\+/, "").replace(/\.git$/, "") ?? null;

  // Bundled licence text, if the package ships one.
  let licenseText: string | null = null;
  for (const candidate of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"]) {
    const path = join(NODE_MODULES, ...name.split("/"), candidate);
    if (existsSync(path)) {
      licenseText = readFileSync(path, "utf8").trim();
      break;
    }
  }

  return {
    name,
    version: manifest.version ?? "unknown",
    license,
    homepage,
    scope,
    licenseText,
  };
}

const entries = [
  ...runtime.map((name) => readPackage(name, "runtime")),
  ...development.map((name) => readPackage(name, "development")),
].filter((entry): entry is Entry => entry !== null);

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

const PERMISSIVE = /^(MIT|ISC|BSD|Apache|0BSD|Unlicense|CC0|Python-2\.0|BlueOak|Zlib|MIT-0)/i;
const COPYLEFT = /(A?GPL|LGPL|SSPL)/i;
const NONCOMMERCIAL = /(BUSL|BSL|CC-BY-NC|Elastic|Commons Clause)/i;

const copyleft = entries.filter((e) => COPYLEFT.test(e.license));
const noncommercial = entries.filter((e) => NONCOMMERCIAL.test(e.license));
const unknown = entries.filter((e) => e.license === "UNKNOWN" && e.licenseText === null);
const permissive = entries.filter((e) => PERMISSIVE.test(e.license));

const byLicense = new Map<string, Entry[]>();
for (const entry of entries) {
  const list = byLicense.get(entry.license) ?? [];
  list.push(entry);
  byLicense.set(entry.license, list);
}

const sortedLicenses = [...byLicense.entries()].sort((a, b) => b[1].length - a[1].length);

const lines: string[] = [];
const w = (line = "") => lines.push(line);

w("# Third-party notices");
w();
w("This product includes software developed by third parties. The notices below");
w("are generated from the installed dependency tree by");
w("`npm run legal:licenses` — do not edit this file by hand.");
w();
w(`Generated: ${new Date().toISOString().slice(0, 10)}`);
w(`Packages: ${entries.length} (${runtime.length} runtime, ${development.length} development)`);
w();
w("Most of these licences require that the copyright notice and the licence text");
w("accompany any distribution — including a JavaScript bundle served to a");
w("browser. Keep this file in the deployed artifact (for example, served at");
w("`/third-party-notices` and linked from the footer) so the requirement is met");
w("in practice and not just in theory.");
w();

w("## Licence summary");
w();
w("| Licence | Packages |");
w("| --- | --- |");
for (const [license, list] of sortedLicenses) {
  w(`| ${license} | ${list.length} |`);
}
w();

w("## Packages");
w();
w("| Package | Version | Licence | Scope | Source |");
w("| --- | --- | --- | --- | --- |");
for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  const source = entry.homepage
    ? `[${entry.homepage.replace(/^https?:\/\//, "")}](${entry.homepage})`
    : "—";
  w(`| \`${entry.name}\` | ${entry.version} | ${entry.license} | ${entry.scope} | ${source} |`);
}
w();

if (copyleft.length > 0 || noncommercial.length > 0 || unknown.length > 0) {
  w("## Items requiring review");
  w();
  w("These are the licences that are not safe to ship by default:");
  w();

  if (copyleft.length > 0) {
    w("**Copyleft** — may oblige you to release source, or to isolate the library:");
    w();
    for (const entry of copyleft) w(`- \`${entry.name}\` (${entry.license})`);
    w();
  }
  if (noncommercial.length > 0) {
    w("**Source-available / non-commercial** — usually requires a paid licence for production use:");
    w();
    for (const entry of noncommercial) w(`- \`${entry.name}\` (${entry.license})`);
    w();
  }
  if (unknown.length > 0) {
    w("**Unknown** — no licence field and no bundled licence file. Treat as all rights reserved:");
    w();
    for (const entry of unknown) w(`- \`${entry.name}\``);
    w();
  }
}

const withText = entries.filter((entry) => entry.licenseText !== null);
w("## Licence texts");
w();
w(`Bundled texts for ${withText.length} of ${entries.length} packages follow. Packages`);
w("without an inline licence file reference their repository above; the full text");
w("is in `node_modules/<package>/LICENSE` after `npm install`.");
w();
for (const entry of withText) {
  w(`### ${entry.name}@${entry.version} — ${entry.license}`);
  w();
  w("```text");
  w(entry.licenseText!);
  w("```");
  w();
}

writeFileSync(join(ROOT, "THIRD-PARTY-NOTICES.md"), lines.join("\n"));

const c = (n: number, word: string) => `${n} ${word}`;
console.log(`wrote THIRD-PARTY-NOTICES.md (${c(entries.length, "packages")})`);
console.log(`  ${c(permissive.length, "permissive")}, ${c(copyleft.length, "copyleft")}, ${c(noncommercial.length, "non-commercial")}, ${c(unknown.length, "unknown")}`);

if (copyleft.length > 0 || noncommercial.length > 0 || unknown.length > 0) {
  console.log("\nreview required — see THIRD-PARTY-NOTICES.md → Items requiring review");
  process.exitCode = 0; // informative, not fatal: a dev dependency may legitimately be GPL
}
