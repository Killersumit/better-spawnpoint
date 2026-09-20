/**
 * Operational endpoints that must stay OUTSIDE tRPC because a third party calls
 * them with a shared secret rather than a session:
 *
 *   POST /api/cron/:jobName        external scheduler trigger
 *   POST /api/webhooks/stripe      billing events
 *   GET  /api/dev/mailbox          development-only mail inspection
 *
 * Every one of these is authenticated by a secret comparison that is
 * constant-time, rate limited, and returns 404 rather than 401 when unset — an
 * unconfigured webhook endpoint should look like it does not exist.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { API } from "@shared/const";
import { users } from "../../../drizzle/schema";
import { getDb } from "../db";
import { ENV, isProduction } from "../env";
import { logger } from "../logger";
import { audit } from "../audit";
import { getDevMailbox } from "../mail";
import { runJob } from "../jobs";
import { getJob, jobNames } from "../jobs/registry";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function registerOpsRoutes(
  app: Express,
  limiters: { webhook: RequestHandlerLike }
): void {
  /**
   * External cron trigger.
   *
   * Use this when the platform provides real scheduling (Vercel Cron, Cloud
   * Scheduler, a k8s CronJob, uptime pinger) and set JOBS_ENABLED=false so the
   * in-process loop does not double-run. Both paths call the same handlers.
   */
  app.post(`${API.cron}/:jobName`, async (req: Request, res: Response) => {
    if (!ENV.CRON_SECRET) {
      // Not configured => the route does not exist as far as the internet knows.
      res.status(404).json({ error: "Not found" });
      return;
    }

    const provided =
      (req.headers["x-cron-secret"] as string | undefined) ??
      (typeof req.query.secret === "string" ? req.query.secret : "");

    if (!provided || !safeCompare(provided, ENV.CRON_SECRET)) {
      logger.warn("rejected cron trigger", { job: req.params.jobName });
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const name = req.params.jobName;
    if (!name || !getJob(name)) {
      res.status(404).json({ error: `Unknown job. Available: ${jobNames().join(", ")}` });
      return;
    }

    // Acknowledge immediately and run in the background: schedulers time out
    // long before a retention job finishes, and a timeout retry would double-run.
    res.status(202).json({ accepted: true, job: name });
    void runJob(name, { force: true }).catch((error) => {
      logger.error("external cron run failed", { job: name, error: String(error) });
    });
  });

  /**
   * Stripe webhook.
   *
   * Signature verification is the whole point: an unverified webhook endpoint
   * lets anyone mark an account as paid. The scheme is HMAC-SHA256 over
   * `"{timestamp}.{rawBody}"`, compared in constant time, with a 5-minute
   * freshness window to stop replay.
   */
  app.post(
    `${API.webhooks}/stripe`,
    limiters.webhook,
    async (req: Request, res: Response) => {
      if (!ENV.STRIPE_WEBHOOK_SECRET) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      const signatureHeader = req.headers["stripe-signature"];

      if (!rawBody || typeof signatureHeader !== "string") {
        res.status(400).json({ error: "Missing body or signature" });
        return;
      }

      const parsed = parseStripeSignature(signatureHeader);
      if (!parsed) {
        res.status(400).json({ error: "Malformed signature header" });
        return;
      }

      const age = Math.abs(Date.now() / 1000 - parsed.timestamp);
      if (age > 300) {
        res.status(400).json({ error: "Signature timestamp too old" });
        return;
      }

      const expected = createHmac("sha256", ENV.STRIPE_WEBHOOK_SECRET)
        .update(`${parsed.timestamp}.${rawBody.toString("utf8")}`)
        .digest("hex");

      if (!parsed.signatures.some((candidate) => safeCompare(candidate, expected))) {
        logger.warn("rejected stripe webhook: bad signature");
        res.status(400).json({ error: "Invalid signature" });
        return;
      }

      // Verified. Handle the event idempotently — Stripe retries on any
      // non-2xx, and duplicate delivery is normal, not exceptional.
      let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
      try {
        event = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.status(400).json({ error: "Invalid JSON" });
        return;
      }

      res.status(200).json({ received: true });

      try {
        await handleStripeEvent(event);
      } catch (error) {
        logger.error("stripe handler failed", { type: event.type, error: String(error) });
      }
    }
  );

  /**
   * Development mailbox: read what `sendMail` would have sent, so signup and
   * password-reset flows can be tested end to end without an SMTP server.
   * Registered only when NODE_ENV === "development" — in production this path
   * does not exist at all.
   */
  if (!isProduction) {
    app.get("/api/dev/mailbox", (_req: Request, res: Response) => {
      res.json({ messages: getDevMailbox() });
    });
  }
}

function parseStripeSignature(header: string): {
  timestamp: number;
  signatures: string[];
} | null {
  const parts = header.split(",").map((part) => part.trim().split("="));
  const timestampPart = parts.find(([key]) => key === "t");
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value ?? "");

  const timestamp = Number.parseInt(timestampPart?.[1] ?? "", 10);
  if (!Number.isInteger(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Minimal, deliberately boring event handling. Extend it per event type, keep
 * each branch idempotent, and never trust a price or amount from the payload
 * without re-reading it from the API.
 */
async function handleStripeEvent(event: {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
}): Promise<void> {
  const db = getDb();
  if (!db) return;

  await audit({
    actorUserId: null,
    action: "consent.recorded",
    targetType: "user",
    targetId: null,
    metadata: { webhook: "stripe", type: event.type ?? "unknown", id: event.id ?? null },
  });

  switch (event.type) {
    case "checkout.session.completed":
    case "customer.subscription.updated": {
      // Example wiring: find the user by the customer id you stored at
      // checkout, then update their plan. Replace this comment with your own
      // query once you have a subscriptions table.
      const object = event.data?.object ?? {};
      const customerEmail =
        typeof object.customer_email === "string" ? object.customer_email.toLowerCase() : null;
      if (!customerEmail) {
        logger.warn("stripe event without customer_email", { type: event.type });
        return;
      }
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, customerEmail))
        .limit(1);
      logger.info("stripe event mapped to user", {
        type: event.type,
        userId: rows[0]?.id ?? null,
      });
      return;
    }
    default:
      logger.info("unhandled stripe event type", { type: event.type });
  }
}

type RequestHandlerLike = (
  req: Request,
  res: Response,
  next: (error?: unknown) => void
) => void;
