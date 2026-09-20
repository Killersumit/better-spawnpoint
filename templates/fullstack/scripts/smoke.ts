/**
 * `npm run smoke` — start the built server and assert the HTTP surface.
 *
 * WHY THIS EXISTS
 * Type checking proves the code compiles; it says nothing about whether the app
 * actually answers a request. The classic escapes are route-registration order
 * (a wildcard swallowing a specific path), a health endpoint that 500s without
 * a database, robots.txt leaking the admin area, or a legal page returning an
 * empty 200. This script boots `dist/` on an ephemeral port and checks the
 * things a user, a crawler, a load balancer and a regulator would each touch.
 *
 * It runs with NO database configured on purpose: "degrades visibly" is a
 * requirement of this template, not an accident.
 *
 * Usage:
 *   npm run build && npm run smoke
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ENTRY = join(ROOT, "dist", "index.js");

const { ROUTES, PRIVATE_ROUTES, POLICY_ROUTES } = await import("../shared/const.ts");

if (!existsSync(ENTRY)) {
  console.error(`dist/index.js not found — run \`npm run build\` first.`);
  process.exit(1);
}

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  const mark = ok ? "\u001b[32m✓\u001b[0m" : "\u001b[31m✗\u001b[0m";
  console.log(`${mark} ${name}${detail ? `  \u001b[2m${detail}\u001b[0m` : ""}`);
};

/** Ask the OS for a free port, then hand it to the server. */
const freePort = (): Promise<number> =>
  new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolvePromise(port));
    });
  });

const port = await freePort();
const base = `http://127.0.0.1:${port}`;

const child: ChildProcess = spawn(process.execPath, [ENTRY], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    APP_ORIGIN: base,
    // Deliberately no DATABASE_URL and a throwaway secret: the point is to prove
    // the app boots and answers usefully when the database is missing.
    SESSION_SECRET: "smoke-test-secret-smoke-test-secret",
    // The whole point of this run is the no-database path, which production
    // normally refuses. Opt in explicitly rather than weakening the check.
    ALLOW_DEGRADED_BOOT: "true",
    DATABASE_URL: "",
    // A cron secret is set so the ops surface is actually exercised: with the
    // secret absent the route 404s and proves nothing about the auth check.
    CRON_SECRET: "smoke-cron-secret",
    MAIL_DRIVER: "console",
    STORAGE_DRIVER: "local",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
child.stdout?.on("data", (chunk: Buffer) => {
  serverLog += chunk.toString();
});
child.stderr?.on("data", (chunk: Buffer) => {
  serverLog += chunk.toString();
});

const stop = () => {
  if (!child.killed) child.kill("SIGTERM");
};
process.on("exit", stop);
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

/** Wait until the server answers or the deadline passes. */
async function waitForServer(timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.status > 0) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function get(path: string): Promise<{ status: number; headers: Headers; body: string }> {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

try {
  if (!(await waitForServer())) {
    console.error("\nserver did not start. Output:\n");
    console.error(serverLog.slice(-4000));
    process.exit(1);
  }
  console.log(`smoke — ${base} (no database configured)\n`);

  // ── Health & readiness ────────────────────────────────────────────────────
  {
    const response = await get("/api/health");
    let payload: { ok?: boolean; detail?: string; storage?: string; bootedAt?: string } = {};
    try {
      payload = JSON.parse(response.body) as typeof payload;
    } catch {
      /* reported below */
    }
    record(
      "GET /api/health answers with the documented JSON shape",
      response.status === 200 || response.status === 503
        ? typeof payload.ok === "boolean" &&
            typeof payload.detail === "string" &&
            typeof payload.bootedAt === "string"
        : false,
      `${response.status} ok=${String(payload.ok)} detail="${payload.detail ?? ""}"`
    );

    // Without a database the app must not claim readiness: a load balancer
    // would keep sending it traffic it cannot serve.
    record(
      "health reports not-ready, not healthy, without a database",
      response.status === 503 && payload.ok === false && /degrad/.test(payload.detail ?? ""),
      `${response.status}, detail="${payload.detail ?? ""}"`
    );
  }

  // ── Machine-readable legal & crawler surface ──────────────────────────────
  {
    const security = await get("/.well-known/security.txt");
    record(
      "GET /.well-known/security.txt",
      security.status === 200 && /Contact:/i.test(security.body),
      `${security.status}`
    );

    const robots = await get("/robots.txt");
    const disallowsPrivate = PRIVATE_ROUTES.some((route) => robots.body.includes(`Disallow: ${route}`));
    record(
      "GET /robots.txt disallows private routes",
      robots.status === 200 && disallowsPrivate,
      `${robots.status}, ${PRIVATE_ROUTES.length} private route(s) checked`
    );

    const sitemap = await get("/sitemap.xml");
    const listsLegal = POLICY_ROUTES.every((route) => sitemap.body.includes(`${route}<`));
    const leaked = PRIVATE_ROUTES.some((route) => sitemap.body.includes(`${route}<`));
    record(
      "GET /sitemap.xml lists public pages only",
      sitemap.status === 200 && listsLegal && !leaked,
      `${sitemap.status}`
    );

    const version = await get("/api/compliance/version");
    let parsed: { consentVersion?: string } = {};
    try {
      parsed = JSON.parse(version.body) as { consentVersion?: string };
    } catch {
      /* reported below */
    }
    record(
      "GET /api/compliance/version returns the consent version",
      version.status === 200 && typeof parsed.consentVersion === "string",
      `${version.status} consentVersion=${parsed.consentVersion ?? "?"}`
    );
  }

  // ── tRPC ──────────────────────────────────────────────────────────────────
  {
    const capabilities = await get("/api/trpc/system.capabilities?input=%7B%7D");
    let features: Record<string, unknown> = {};
    try {
      features = (JSON.parse(capabilities.body) as { result?: { data?: { features?: Record<string, unknown> } } })
        .result?.data?.features ?? {};
    } catch {
      /* reported below */
    }
    record(
      "public tRPC query answers without a session",
      capabilities.status === 200 && typeof features === "object",
      `${capabilities.status}, features=${Object.keys(features).join(",") || "none"}`
    );

    // An authenticated procedure reached without a session must be refused by
    // the middleware. `notes.list` is the canonical example: it belongs to a
    // real user and must never fall back to "all notes".
    const guarded = await fetch(`${base}/api/trpc/notes.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    const guardedBody = await guarded.text();
    record(
      "a session-guarded procedure refuses an anonymous caller",
      guarded.status === 401 || /UNAUTHORIZED/.test(guardedBody),
      `notes.list → ${guarded.status} ${guarded.status === 401 ? "(401)" : ""}`
    );
  }

  // ── Files: the authorisation boundary ────────────────────────────────────
  {
    const download = await get("/api/files/does/not/exist.txt");
    const notFound = download.status === 404;
    const isJson = download.headers.get("content-type")?.includes("application/json") ?? false;
    record(
      "unknown file key is a uniform 404",
      notFound,
      `${download.status} (authorisation failures must not be distinguishable from "no such file")`
    );
    record("file errors are JSON, not an HTML error page", isJson, download.headers.get("content-type") ?? "—");

    const upload = await fetch(`${base}/api/files/upload`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "unauthenticated upload",
      signal: AbortSignal.timeout(5000),
    });
    record("unauthenticated upload is rejected", upload.status === 401, `${upload.status}`);
  }

  // ── Client delivery ───────────────────────────────────────────────────────
  {
    const home = await get(ROUTES.home);
    const html = home.headers.get("content-type")?.includes("text/html") ?? false;
    record(
      "GET / serves the client bundle",
      home.status === 200 && html && home.body.includes("<div id=\"root\""),
      `${home.status} ${home.headers.get("content-type") ?? ""}`
    );

    // A deep link has to reach the SPA too, otherwise a refresh on /dashboard 404s.
    const deepLink = await get(ROUTES.login);
    record(
      "deep links fall back to the SPA",
      deepLink.status === 200 && (deepLink.headers.get("content-type")?.includes("text/html") ?? false),
      `${deepLink.status}`
    );

    // Unknown API paths must not return the HTML app shell.
    const unknownApi = await get("/api/definitely-not-a-route");
    record(
      "unknown API route returns JSON 404, not the app shell",
      unknownApi.status === 404 && (unknownApi.headers.get("content-type")?.includes("application/json") ?? false),
      `${unknownApi.status}`
    );
  }

  // ── Operational endpoints ────────────────────────────────────────────────
  {
    const cronNoSecret = await fetch(`${base}/api/cron/scheduler.heartbeat`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    record(
      "cron endpoint refuses an unauthenticated trigger",
      cronNoSecret.status === 401,
      `POST without x-cron-secret → ${cronNoSecret.status}`
    );

    const cronWithSecret = await fetch(`${base}/api/cron/scheduler.heartbeat`, {
      method: "POST",
      headers: { "x-cron-secret": "smoke-cron-secret" },
      signal: AbortSignal.timeout(5000),
    });
    record(
      "cron endpoint accepts the configured secret and acknowledges immediately",
      cronWithSecret.status === 202,
      `POST with x-cron-secret → ${cronWithSecret.status} (202 = accepted, runs in background)`
    );

    const unknownJob = await fetch(`${base}/api/cron/not-a-real-job`, {
      method: "POST",
      headers: { "x-cron-secret": "smoke-cron-secret" },
      signal: AbortSignal.timeout(5000),
    });
    const unknownBody = await unknownJob.text();
    record(
      "unknown cron job is rejected with the available names",
      unknownJob.status === 404 && /Available:/.test(unknownBody),
      `${unknownJob.status}`
    );
  }
} finally {
  stop();
  await new Promise((r) => setTimeout(r, 300));
}

const failed = checks.filter((check) => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ""}`);
if (failed.length > 0) {
  console.log("\nserver log tail:\n");
  console.log(serverLog.split("\n").slice(-40).join("\n"));
}
process.exit(failed.length === 0 ? 0 : 1);
