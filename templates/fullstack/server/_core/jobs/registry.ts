/**
 * Job registry — the single list of everything that runs on a schedule.
 *
 * Adding a job:
 *   1. write an async handler that is IDEMPOTENT (it will be retried),
 *   2. register it here with a 5-field UTC cron expression,
 *   3. run `npm run verify` — it checks every job name is unique and every
 *      expression parses.
 *
 * Handlers receive no arguments: they must be safe to run concurrently across
 * instances, which is why mutating jobs claim a lease through the `jobs` table
 * (see `runWithLease` in ./index.ts).
 *
 * Retention numbers below are the defaults the compliance layer ships with and
 * are mirrored in `legal/compliance.json`. Change them in BOTH places or
 * `npm run verify` fails — that is deliberate: a retention promise in your
 * privacy policy that the code does not implement is a regulatory finding.
 */
import { and, isNull, lt, sql } from "drizzle-orm";
import { authTokens, consents, dataRequests, users } from "../../../drizzle/schema";
import { getDb } from "../db";
import { logger } from "../logger";
import { pruneSessions } from "../auth/sessions";
import { softDeleteUser } from "../auth/users";

export type JobHandler = () => Promise<{ summary: string } | void>;

export type JobDefinition = {
  name: string;
  /** 5-field UTC cron. */
  cron: string;
  description: string;
  handler: JobHandler;
  /** Mirrors a retention value in legal/compliance.json. */
  retentionDays?: number;
};

/** Retention windows, mirrored in legal/compliance.json → retention. */
export const RETENTION = {
  sessions: 30,
  auditLogs: 400,
  softDeletedUsers: 30,
  authTokens: 7,
  anonymousConsent: 400,
} as const;

export const JOBS: Record<string, JobDefinition> = {
  "sessions.prune": {
    name: "sessions.prune",
    cron: "17 * * * *",
    description: "Delete expired and revoked sessions older than the retention window.",
    retentionDays: RETENTION.sessions,
    handler: async () => {
      const count = await pruneSessions(RETENTION.sessions);
      return { summary: `deleted ${count} session(s)` };
    },
  },

  "authTokens.prune": {
    name: "authTokens.prune",
    cron: "23 * * * *",
    description: "Delete used or expired password-reset / verification / invite tokens.",
    retentionDays: RETENTION.authTokens,
    handler: async () => {
      const db = getDb();
      if (!db) return { summary: "database unavailable, skipped" };
      const cutoff = new Date(Date.now() - RETENTION.authTokens * 86_400_000);
      const result = await db.delete(authTokens).where(lt(authTokens.createdAt, cutoff));
      const affected = Number(
        (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
      );
      return { summary: `deleted ${affected} token(s)` };
    },
  },

  "users.purgeDeleted": {
    name: "users.purgeDeleted",
    cron: "41 3 * * *",
    description:
      "Hard-delete accounts whose deletion grace period has elapsed. Dependent rows go with them via ON DELETE CASCADE.",
    retentionDays: RETENTION.softDeletedUsers,
    handler: async () => {
      const db = getDb();
      if (!db) return { summary: "database unavailable, skipped" };
      const cutoff = new Date(Date.now() - RETENTION.softDeletedUsers * 86_400_000);

      // Bounded batch: a big backlog must not hold a transaction for minutes.
      const candidates = await db
        .select({ id: users.id })
        .from(users)
        .where(lt(users.deletedAt, cutoff))
        .limit(500);

      let purged = 0;
      for (const candidate of candidates) {
        if (!candidate) continue;
        await hardDeleteUser(candidate.id);
        purged++;
      }
      return {
        summary: `purged ${purged} account(s)${purged === 500 ? " (batch cap hit, continues next run)" : ""}`,
      };
    },
  },

  "dataRequests.process": {
    name: "dataRequests.process",
    cron: "*/15 * * * *",
    description:
      "Execute deletion requests whose grace period has elapsed; mark finished exports as complete.",
    handler: async () => {
      const db = getDb();
      if (!db) return { summary: "database unavailable, skipped" };
      const due = await db
        .select()
        .from(dataRequests)
        .where(
          and(
            sql`${dataRequests.status} = 'pending'`,
            sql`${dataRequests.kind} = 'deletion'`,
            lt(dataRequests.scheduledFor, new Date())
          )
        )
        .limit(100);

      let processed = 0;
      for (const request of due) {
        if (!request) continue;
        await softDeleteUser(request.userId, `deletion request ${request.id}`);
        await db
          .update(dataRequests)
          .set({ status: "completed", completedAt: new Date() })
          .where(sql`${dataRequests.id} = ${request.id}`);
        processed++;
      }
      return { summary: `processed ${processed} deletion request(s)` };
    },
  },

  /**
   * Retention enforcement for consent records. Consent is evidence: the
   * default is long (400 days, matching the audit window) rather than short.
   * If your policy promises a different number, change both places.
   */
  "consents.prune": {
    name: "consents.prune",
    cron: "5 4 * * 0",
    description: "Delete anonymised consent records past the retention window.",
    retentionDays: RETENTION.anonymousConsent,
    handler: async () => {
      const db = getDb();
      if (!db) return { summary: "database unavailable, skipped" };
      const cutoff = new Date(Date.now() - RETENTION.anonymousConsent * 86_400_000);
      const result = await db
        .delete(consents)
        .where(and(isNull(consents.userId), lt(consents.createdAt, cutoff)));
      const affected = Number(
        (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
      );
      return { summary: `deleted ${affected} anonymous consent record(s)` };
    },
  },

  "scheduler.heartbeat": {
    name: "scheduler.heartbeat",
    cron: "*/30 * * * *",
    description: "No-op heartbeat. Proves the scheduler is alive in logs and /api/health.",
    handler: async () => ({ summary: "alive" }),
  },
};

/** Cascades handle most children; this exists for tables without FK cascades. */
async function hardDeleteUser(userId: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.delete(users).where(sql`${users.id} = ${userId}`);
  logger.info("hard-deleted user", { userId });
}

export function getJob(name: string): JobDefinition | undefined {
  return JOBS[name];
}

export function jobNames(): string[] {
  return Object.keys(JOBS);
}
