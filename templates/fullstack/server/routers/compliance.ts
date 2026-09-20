/**
 * Compliance endpoints.
 *
 * `recordConsent` is called by the cookie banner on every decision change. It
 * is the evidence trail: append-only rows recording WHAT was agreed to, WHEN,
 * under WHICH wording version, and from WHICH ip/user agent.
 *
 * Three properties that matter:
 *  • The row is never updated or deleted by application code (only the
 *    retention job prunes anonymised rows).
 *  • A signed-in user's consent is linked to their account; an anonymous
 *    visitor's is linked to a random per-browser id, so it is still
 *    attributable without identifying the person.
 *  • Recording consent must never fail the user's action. A consent write that
 *    throws would leave the banner stuck open — the opposite of compliant.
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CONSENT_CATEGORIES, CONSENT_VERSION, normalizeConsent } from "@shared/consent";
import { compliance } from "@shared/compliance";
import { consents } from "../../drizzle/schema";
import { getDb } from "../_core/db";
import { logger } from "../_core/logger";
import { audit } from "../_core/audit";
import { authedProcedure, publicProcedure, router } from "../_core/trpc";

const consentStateSchema = z.object(
  Object.fromEntries(CONSENT_CATEGORIES.map((category) => [category, z.boolean()])) as Record<
    (typeof CONSENT_CATEGORIES)[number],
    z.ZodBoolean
  >
);

export const complianceRouter = router({
  /**
   * Public config the client needs to render policy-aware UI without shipping
   * the whole compliance file to every visitor.
   */
  config: publicProcedure.query(() => ({
    consentVersion: CONSENT_VERSION,
    regimes: compliance.regimes,
    productName: compliance.organization.productName,
    contact: {
      privacy: compliance.organization.privacyEmail,
      security: compliance.organization.securityEmail,
      support: compliance.organization.supportEmail,
    },
    ai: {
      enabled: compliance.ai.featuresUseAI,
      providerLabel: compliance.ai.providerLabel,
      disclosureText: compliance.ai.disclosureText,
    },
    accessibility: {
      standard: compliance.accessibility.standard,
      conformanceStatus: compliance.accessibility.conformanceStatus,
    },
  })),

  recordConsent: publicProcedure
    .input(
      z.object({
        version: z.string().max(32).default(CONSENT_VERSION),
        anonId: z.string().max(64).optional(),
        state: consentStateSchema,
        /** Where the decision was made, for the audit trail. */
        source: z.enum(["banner", "settings", "api"]).default("banner"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const state = normalizeConsent(input.state);

      if (!db) {
        // No database: the decision still applies client-side for this browser.
        return { recorded: false, reason: "database_unavailable" as const };
      }

      try {
        await db.insert(consents).values({
          userId: ctx.user?.id ?? null,
          anonId: input.anonId ?? null,
          version: input.version,
          state,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
        });

        await audit({
          actorUserId: ctx.user?.id ?? null,
          action: "consent.recorded",
          targetType: "consent",
          metadata: { version: input.version, state, source: input.source },
          ip: ctx.ip,
        });

        // Mirror the marketing choice onto the user record so mail sending has
        // a single source of truth: consent withdrawn => marketingOptIn false.
        if (ctx.user && input.source !== "banner") {
          const { users } = await import("../../drizzle/schema");
          await db
            .update(users)
            .set({ marketingOptIn: state.marketing })
            .where(eq(users.id, ctx.user.id));
        }

        return { recorded: true as const };
      } catch (error) {
        logger.error("consent record failed", { error: String(error) });
        return { recorded: false, reason: "write_failed" as const };
      }
    }),

  /** The caller's own consent history (GDPR Art. 7(1) evidence, user-visible). */
  myConsentHistory: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(consents)
      .where(eq(consents.userId, ctx.user.id))
      .orderBy(desc(consents.createdAt))
      .limit(50);

    return rows.map((row) => ({
      version: row.version,
      state: row.state,
      recordedAt: row.createdAt.toISOString(),
    }));
  }),

  /**
   * What the marketing-email sender must check before sending. Exposed so the
   * rule lives in one place instead of being re-derived at each call site.
   */
  canSendMarketing: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    if (!db) return { allowed: false, reason: "database_unavailable" };

    const rows = await db
      .select()
      .from(consents)
      .where(eq(consents.userId, ctx.user.id))
      .orderBy(desc(consents.createdAt))
      .limit(1);

    const latest = rows[0];
    const allowed = ctx.user.marketingOptIn && (latest?.state.marketing ?? false);

    return {
      allowed,
      reason: allowed
        ? "opted_in"
        : "No active marketing consent: both the account preference and the latest consent record must allow it.",
    };
  }),
});
