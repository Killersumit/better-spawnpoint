/**
 * Audit log.
 *
 * Every security- or compliance-relevant action goes through `audit()`:
 * sign-in, password change, role change, data export, deletion request, admin
 * access to personal data. The table is append-only — no UPDATE, no DELETE
 * except by the retention job, and never from a request handler.
 *
 * `action` naming: `resource.verb` in lower snake case, e.g. `auth.login`,
 * `user.role_change`, `account.export_requested`. Keep it to a fixed vocabulary;
 * a free-text action column is useless for the "show me every admin read of
 * personal data in Q3" question an auditor will ask.
 *
 * Never put secrets, tokens, or full request bodies in `metadata`.
 */
import { desc, eq, sql } from "drizzle-orm";
import { auditLogs } from "../../drizzle/schema";
import { getDb } from "./db";
import { logger } from "./logger";

export const AUDIT_ACTIONS = [
  "auth.signup",
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "auth.password_reset_requested",
  "auth.password_reset",
  "auth.password_changed",
  "auth.sessions_revoked",
  "user.create",
  "user.role_change",
  "user.soft_delete",
  "user.profile_updated",
  "account.export_requested",
  "account.export_downloaded",
  "account.deletion_requested",
  "account.deletion_cancelled",
  "admin.user_read",
  "admin.job_run",
  "consent.recorded",
  "file.uploaded",
  "file.deleted",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntry = {
  actorUserId?: number | null;
  action: AuditAction;
  targetType?: "user" | "file" | "note" | "job" | "consent" | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | undefined;
};

export async function audit(entry: AuditEntry): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(auditLogs).values({
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
    });
  } catch (error) {
    // A failed audit write must never roll back the user's action, but it must
    // be loud: silent audit gaps are how compliance evidence disappears.
    logger.error("audit write failed", {
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      error: String(error),
    });
  }
}

/** Recent entries for the admin dashboard. */
export async function recentAuditLogs(limit = 50, action?: AuditAction) {
  const db = getDb();
  if (!db) return [];

  const query = db
    .select({
      id: auditLogs.id,
      actorUserId: auditLogs.actorUserId,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  if (action) return query.where(eq(auditLogs.action, action));
  return query;
}

/** Count per action, for a compliance summary. */
export async function auditCountsByAction(since: Date) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({ action: auditLogs.action, count: sql<number>`COUNT(*)` })
    .from(auditLogs)
    .where(sql`${auditLogs.createdAt} >= ${since}`)
    .groupBy(auditLogs.action);
}
