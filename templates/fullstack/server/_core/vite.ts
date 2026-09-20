/**
 * Client delivery.
 *
 * Development: Vite runs in middleware mode on the SAME http server as the API.
 * One origin means the session cookie is first-party, there is no CORS to
 * configure, and HMR rides the same port that a proxy or tunnel already
 * forwards — which is why `attachClient` is given the http server rather than
 * creating its own listener.
 *
 * Production: `dist/public` is served statically with hashed assets cached
 * forever and `index.html` never cached, so a deploy is picked up immediately.
 */
import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { createServer as createViteServer } from "vite";
import { isProduction } from "./env";
import { logger } from "./logger";

export async function attachClient(app: Express, httpServer: Server): Promise<void> {
  if (isProduction) {
    serveStatic(app);
    return;
  }
  await setupVite(app, httpServer);
}

async function setupVite(app: Express, httpServer: Server): Promise<void> {
  const projectRoot = path.resolve(import.meta.dirname, "..", "..");

  const vite = await createViteServer({
    root: path.resolve(projectRoot, "client"),
    configFile: path.resolve(projectRoot, "vite.config.ts"),
    appType: "custom",
    server: {
      middlewareMode: true,
      // Reuse the http server that is already listening, so the HMR websocket
      // shares the app's port. Creating a second port here is the classic
      // "works locally, no hot reload behind a proxy" bug.
      hmr: { server: httpServer },
    },
  });

  app.use(vite.middlewares);

  // SPA fallback: anything not matched by an API route or an asset gets
  // index.html, which is what makes client-side routing survive a refresh.
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    // Never fall back for API paths: a typo in a fetch URL should be a 404, not
    // a silent HTML response the client then tries to parse as JSON.
    if (url.startsWith("/api/") || url.startsWith("/.well-known/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    try {
      const templatePath = path.resolve(projectRoot, "client", "index.html");
      const template = await fs.promises.readFile(templatePath, "utf-8");
      const html = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });

  logger.info("vite middleware attached", { root: projectRoot });
}

export function serveStatic(app: Express): void {
  // dist/index.js → dist/public
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    logger.error("client build not found — run `npm run build` first", { distPath });
    app.use("*", (_req, res) => {
      res
        .status(503)
        .type("text/plain")
        .send("The client bundle has not been built. Run `npm run build`.");
    });
    return;
  }

  // Hashed assets are immutable; index.html must never be cached or users keep
  // loading a deleted JS bundle after a deploy.
  const setHeaders = (res: express.Response, filePath: string) => {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      return;
    }
    if (/\.(?:js|css|woff2?|svg|png|jpg|jpeg|webp|avif|ico)$/.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  };

  app.use(express.static(distPath, { index: false, setHeaders }));

  app.use("*", (req, res) => {
    if (req.originalUrl.startsWith("/api/") || req.originalUrl.startsWith("/.well-known/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });

  logger.info("serving static client", { distPath });
}
