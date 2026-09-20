/**
 * Consent collection endpoint.
 *
 *   POST /api/compliance/consent
 *
 * Why this is a plain REST route and not a tRPC procedure: it must work before
 * the visitor has a session and even when every optional feature is switched
 * off. A consent banner that fails to record a refusal because the API client
 * threw is worse than no banner at all.
 *
 * What it records, and why:
 *  • the choices (normalized server-side — a client cannot claim
 *    `strictly_necessary: false`),
 *  • the wording version, so a later change to the categories invalidates old
 *    records instead of silently reinterpreting them,
 *  • a *truncated* IP address and the user agent, which is the minimum evidence
 *    needed to demonstrate that consent was given (GDPR Art. 7(1)) without
 *    keeping a full identifier for the sake of it.
 *
 * Body: { version: string, state: {functional, analytics, marketing}, anonId?: string, source?: string }
 * Response: 204 No Content. The client treats this as fire-and-forget: the
 * choice is already stored locally and takes effect immediately.
 */
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { API } from "@shared/const";
import { compliance } from "@shared/compliance";
import { CONSENT_VERSION, describeConsent, normalizeConsent } from "@shared/consent";
import { consents, users } from "../../../drizzle/schema";
import { getDb } from "../db";
import { logger } from "../logger";
import { audit } from "../audit";
import { authenticateRequest } from "../auth";

const consentBody = z.object({
  /** Optional: a client that has not been updated yet may not send it. */
  version: z.string().max(32).optional(),
  state: z
    .object({
      functional: z.boolean().optional(),
      analytics: z.boolean().optional(),
      marketing: z.boolean().optional(),
    })
    .default({}),
  /** Random per-browser id so anonymous choices are traceable across requests. */
  anonId: z.string().max(64).optional(),
  source: z.enum(["banner", "settings", "withdraw"]).optional(),
});

export function registerComplianceRoutes(app: Express): void {
  app.post(`${API.compliance}/consent`, async (req: Request, res: Response) => {
    const parsed = consentBody.safeParse(req.body);

    if (!parsed.success) {
      // A malformed body is a client bug, not a user problem: log it, then still
      // answer 204 so the banner does not show an error to the visitor.
      logger.warn("malformed consent payload", {
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      res.status(204).end();
      return;
    }

    const state = normalizeConsent(parsed.data.state);
    const version = parsed.data.version ?? CONSENT_VERSION;
    const db = getDb();

    if (!db) {
      // Degraded mode (no database configured — development, typically).
      // In production a missing DATABASE_URL is fatal at boot, so this path
      // cannot silently swallow consent records in a real deployment.
      logger.warn("consent recorded locally only: no database configured", {
        summary: describeConsent(state),
      });
      res.status(204).end();
      return;
    }

    try {
      const auth = await authenticateRequest(req).catch(() => null);

      await db.insert(consents).values({
        userId: auth?.user.id ?? null,
        anonId: parsed.data.anonId ?? null,
        version,
        state,
        ip: truncateIp(req.ip ?? null),
        userAgent: (req.headers["user-agent"] ?? "").slice(0, 500) || null,
      });

      // Keep the account-level marketing flag in step with the banner, so an
      // unsubscribe in Settings and a rejection in the banner cannot disagree.
      if (auth) {
        await db
          .update(users)
          .set({ marketingOptIn: state.marketing })
          .where(eq(users.id, auth.user.id));
      }

      await audit({
        actorUserId: auth?.user.id ?? null,
        action: "consent.recorded",
        targetType: "user",
        targetId: auth ? String(auth.user.id) : null,
        metadata: { summary: describeConsent(state), source: parsed.data.source ?? "unknown" },
        ...(truncateIp(req.ip ?? null) ? { ip: truncateIp(req.ip ?? null)! } : {}),
      });
    } catch (error) {
      // Never surface a storage failure to the consent banner: the visitor's
      // choice has already been honoured client-side, and the failure is ours.
      logger.error("failed to persist consent record", { error: String(error) });
    }

    res.status(204).end();
  });

  /**
   * Which consent wording is currently in force, and how long records are kept.
   * Operators need this when answering a data-protection question; it exposes
   * nothing that is not already published in the cookie policy.
   */
  app.get(`${API.compliance}/version`, (_req: Request, res: Response) => {
    res.json({
      consentVersion: CONSENT_VERSION,
      configuredVersion: compliance.version,
      /** Anonymous consent records are deleted after this many days. */
      anonymousConsentRetentionDays: compliance.retention.anonymousConsent,
      enabledRegimes: Object.entries(compliance.regimes)
        .filter(([key, value]) => !key.startsWith("$") && value === true)
        .map(([key]) => key),
    });
  });
}

/**
 * Data minimization for consent evidence: keep enough of the address to show
 * the request came from a plausible place, drop the part that identifies a
 * household. IPv4 keeps three octets, IPv6 keeps three hextets.
 */
export function truncateIp(ip: string | null): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, "");

  if (clean.includes(".")) {
    const parts = clean.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    return clean;
  }

  const hextets = clean.split(":").filter(Boolean);
  if (hextets.length >= 3) return `${hextets.slice(0, 3).join(":")}::`;
  return clean;
}
