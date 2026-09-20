/**
 * Server entry point.
 *
 * Boot order, which the code below follows deliberately:
 *
 *   env → security headers → raw body for webhooks → json parser → rate limits
 *   → API routes → client delivery → error handler → listen
 *
 * Two ordering rules are load-bearing and easy to break:
 *   1. The Stripe webhook's raw body must be captured BEFORE `express.json()`,
 *      or signature verification silently fails.
 *   2. Vite's dev middleware needs the http server instance for its HMR
 *      websocket, so the server is created before client delivery is attached.
 */
import "dotenv/config";
import { createServer, type Server } from "node:http";
import net from "node:net";
import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { ENV, isProduction } from "./env";
import { logger } from "./logger";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { attachClient } from "./vite";
import { applySecurityMiddleware, errorHandler, rateLimiters, requireSameOrigin } from "./security";
import { registerOAuthRoutes } from "./http/auth-routes";
import { registerComplianceRoutes } from "./http/compliance-routes";
import { registerFileRoutes } from "./http/file-routes";
import { registerOpsRoutes } from "./http/ops-routes";
import { registerSystemRoutes } from "./http/health";
import { closeDb } from "./db";
import { startScheduler, stopScheduler } from "./jobs";

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "0.0.0.0");
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No free port in ${startPort}-${startPort + 19}`);
}

/** Everything that is NOT client delivery, so tests can build an API-only app. */
export function buildApi(app: Express): void {
  const limiters = rateLimiters();

  // Behind a load balancer, trust exactly one hop so req.ip is the real client.
  // `true` would let a client spoof X-Forwarded-For and defeat per-IP limiting.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // 1. Security headers on every response, including static assets.
  for (const middleware of applySecurityMiddleware()) app.use(middleware);

  // 2. Webhook bodies must stay raw for signature verification.
  app.use(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json", limit: "1mb" }),
    (req, _res, next) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = req.body as Buffer;
      next();
    }
  );

  // 3. JSON for everything else. 1mb is generous for a JSON API; file uploads
  //    have their own raw route with its own limit.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // 4. Rate limits and same-origin enforcement on the API surface.
  app.use("/api", limiters.api);
  app.use("/api/auth", limiters.auth);
  app.use("/api/trpc", requireSameOrigin());

  // 5. Everything under /api (plus security.txt, robots.txt, and the sitemap).
  registerSystemRoutes(app);
  registerOAuthRoutes(app);
  registerComplianceRoutes(app);
  registerFileRoutes(app, limiters.upload);
  registerOpsRoutes(app, { webhook: limiters.webhook });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, path }) {
        // INTERNAL_SERVER_ERROR is logged in full by the tRPC middleware in
        // server/_core/trpc.ts; other codes are expected behaviour.
        if (error.code === "INTERNAL_SERVER_ERROR") {
          logger.error("trpc internal error", { path, message: error.message });
        }
      },
    })
  );
}

/**
 * Build the application and its http server without listening.
 *
 * Returned separately so tests can drive the app with supertest-style helpers
 * and so `startServer` can attach the HMR websocket to the same server.
 */
export async function createApp(): Promise<{ app: Express; server: Server }> {
  const app = express();
  buildApi(app);

  // Creating the server does not start it, so this is safe before the client
  // middleware exists — and it is required, because Vite's HMR websocket has to
  // share this server's port.
  const server = createServer(app);
  await attachClient(app, server);

  // Terminal error handler: Express 4 identifies it by its four-argument arity.
  app.use(errorHandler());

  return { app, server };
}

export async function startServer(): Promise<Server> {
  const { server } = await createApp();

  const preferredPort = ENV.PORT;
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    logger.warn("preferred port busy, using another", { preferredPort, port });
  }

  // Bind all interfaces so containers, sandboxes, and preview proxies can reach it.
  await new Promise<void>((resolve) => server.listen(port, "0.0.0.0", resolve));

  logger.info("server listening", {
    url: `http://localhost:${port}/`,
    mode: ENV.NODE_ENV,
    appOrigin: ENV.APP_ORIGIN,
  });

  startScheduler();

  const shutdown = async (signal: string) => {
    logger.info("shutting down", { signal });
    stopScheduler();
    server.close();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled promise rejection", { reason: String(reason) });
  });
  process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", { error });
    if (isProduction) process.exit(1);
  });

  return server;
}

// Only start when executed directly, so tests can import `createApp` without
// opening a port.
const isDirectRun = process.argv[1]?.includes("index") || process.env.START_SERVER === "true";

if (isDirectRun) {
  startServer().catch((error) => {
    logger.error("failed to start server", { error });
    process.exit(1);
  });
}
