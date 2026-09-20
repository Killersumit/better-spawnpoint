/**
 * Plain HTTP endpoints used by infrastructure rather than the app:
 * `/api/health` (load balancers), `/.well-known/security.txt` (researchers),
 * and `<APP_ORIGIN>/robots.txt` + `/sitemap.xml` (crawlers).
 *
 * These live outside tRPC on purpose: probes must not depend on a JSON-RPC
 * envelope, and crawlers must be able to read them without JavaScript.
 */
import type { Express, Request, Response } from "express";
import { API, PRIVATE_ROUTES, PUBLIC_ROUTES, ROUTES } from "@shared/const";
import { compliance } from "@shared/compliance";
import { ENV, BOOTED_AT } from "../env";
import { isDbConfigured } from "../db";
import { storage } from "../storage";

let lastReadiness: { at: number; ok: boolean; detail: string } = {
  at: 0,
  ok: true,
  detail: "not checked yet",
};

/**
 * Readiness runs a real (cheap) query when a database is configured: a health
 * endpoint that only proves the process is alive will happily report green
 * while every request 500s.
 */
async function checkReadiness(): Promise<{ ok: boolean; detail: string }> {
  const now = Date.now();
  if (now - lastReadiness.at < 5_000) {
    return { ok: lastReadiness.ok, detail: lastReadiness.detail };
  }

  if (!isDbConfigured()) {
    // Degraded mode. In development that is a normal way to work (the app
    // boots, pages render, DB-backed routes 503 politely). In production it
    // means users cannot sign in or read their data, so a load balancer must
    // take this instance out of rotation instead of routing real traffic to it.
    lastReadiness = {
      at: now,
      ok: ENV.NODE_ENV !== "production",
      detail: "no database configured (degraded mode)",
    };
    return lastReadiness;
  }

  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = getDb();
    if (!db) throw new Error("db unavailable");
    await db.execute(sql`SELECT 1`);
    lastReadiness = { at: now, ok: true, detail: "database reachable" };
  } catch (error) {
    lastReadiness = { at: now, ok: false, detail: `database error: ${String(error)}`.slice(0, 200) };
  }
  return lastReadiness;
}

export function registerSystemRoutes(app: Express): void {
  app.get("/api/health", async (_req: Request, res: Response) => {
    const readiness = await checkReadiness();
    // 503 when not ready so orchestrators stop routing traffic here.
    res.status(readiness.ok ? 200 : 503).json({
      ok: readiness.ok,
      bootedAt: BOOTED_AT.toISOString(),
      detail: readiness.detail,
      storage: storage().name,
      version: process.env.APP_VERSION ?? "dev",
    });
  });

  /**
   * RFC 9116 security.txt. Include it: it is the first thing a security
   * researcher checks, and its absence pushes reports to Twitter instead of
   * your inbox.
   */
  app.get("/.well-known/security.txt", (_req: Request, res: Response) => {
    const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
    res
      .type("text/plain")
      .send(
        [
          `Contact: mailto:${compliance.organization.securityEmail}`,
          `Expires: ${expires}`,
          `Preferred-Languages: en`,
          `Canonical: ${ENV.APP_ORIGIN}/.well-known/security.txt`,
          `Policy: ${ENV.APP_ORIGIN}${ROUTES.security}`,
          "",
        ].join("\n")
      );
  });

  app.get("/robots.txt", (_req: Request, res: Response) => {
    res
      .type("text/plain")
      .send(
        [
          "User-agent: *",
          "Allow: /",
          // Never let crawlers wander into API or authenticated surface. The
          // list comes from the route table, so a new private page is covered
          // without anyone remembering to edit robots.txt.
          `Disallow: ${API.base}/`,
          ...PRIVATE_ROUTES.map((route) => `Disallow: ${route}`),
          "",
          `Sitemap: ${ENV.APP_ORIGIN}/sitemap.xml`,
          "",
        ].join("\n")
      );
  });

  /**
   * Sitemap of PUBLIC routes only.
   *
   * Derived from the route table so a new page cannot silently go missing — but
   * filtered by `PUBLIC_ROUTES`, because advertising `/dashboard` to a crawler
   * (or to a search engine that will index the redirect to /login) is both
   * useless and a small information leak.
   */
  app.get("/sitemap.xml", (_req: Request, res: Response) => {
    const base = ENV.APP_ORIGIN.replace(/\/$/, "");
    const urls = PUBLIC_ROUTES.map((path) => `  <url><loc>${base}${path === "/" ? "" : path}</loc></url>`).join(
      "\n"
    );

    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
    );
  });
}
