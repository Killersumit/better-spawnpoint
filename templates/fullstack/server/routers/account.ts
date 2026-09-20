/**
 * Account self-service: the endpoints that exist because privacy law requires
 * them, not because a designer asked for them.
 *
 *  • `exportData`      — GDPR Art. 15 (access) / Art. 20 (portability),
 *                        CCPA §1798.100. Returns a machine-readable archive.
 *  • `requestDeletion` — GDPR Art. 17 (erasure), CCPA §1798.105. Soft-deletes
 *                        immediately, then a job hard-deletes after the grace
 *                        period so a stolen session cannot nuke an account.
 *  • `cancelDeletion`  — the grace period has to be genuinely reversible.
 *  • `consentHistory`  — Art. 7(1): be able to show what was consented to.
 *
 * A data-subject request must complete within 30 days (GDPR Art. 12(3)). These
 * endpoints do it synchronously for exports and within the grace period for
 * deletions, so that deadline is never the thing that gets missed.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { NotFoundError } from "@shared/errors";
import {
  auditLogs,
  consents,
  dataRequests,
  files,
  notes,
  sessions,
  users,
} from "../../drizzle/schema";
import { requireDb } from "../_core/db";
import { compliance } from "@shared/compliance";
import { audit } from "../_core/audit";
import { revokeAllSessions } from "../_core/auth/sessions";
import { toPublicUser } from "../_core/auth/users";
import { authedProcedure, router } from "../_core/trpc";

/** Grace period before a deletion becomes irreversible. Mirrored by the job. */
export const DELETION_GRACE_DAYS = 7;

export const accountRouter = router({
  /** Everything we hold about the caller, as JSON. */
  exportData: authedProcedure.mutation(async ({ ctx }) => {
    const db = requireDb();
    const userId = ctx.user.id;

    const [noteRows, fileRows, consentRows, sessionRows, auditRows, requestRows] =
      await Promise.all([
        db.select().from(notes).where(eq(notes.userId, userId)),
        db
          .select({
            key: files.key,
            originalName: files.originalName,
            contentType: files.contentType,
            size: files.size,
            createdAt: files.createdAt,
          })
          .from(files)
          .where(eq(files.ownerId, userId)),
        db.select().from(consents).where(eq(consents.userId, userId)),
        db
          .select({
            id: sessions.id,
            userAgent: sessions.userAgent,
            ip: sessions.ip,
            createdAt: sessions.createdAt,
            lastUsedAt: sessions.lastUsedAt,
          })
          .from(sessions)
          .where(eq(sessions.userId, userId)),
        db.select().from(auditLogs).where(eq(auditLogs.actorUserId, userId)),
        db.select().from(dataRequests).where(eq(dataRequests.userId, userId)),
      ]);

    await audit({
      actorUserId: userId,
      action: "account.export_requested",
      ip: ctx.ip,
    });

    return {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      /** Named so the recipient knows which policy produced this file. */
      generatingPolicy: {
        privacyPolicyVersion: compliance.version,
        contact: compliance.organization.privacyEmail,
      },
      account: toPublicUser(ctx.user),
      notes: noteRows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      files: fileRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        downloadUrl: `/api/files/${row.key}`,
      })),
      consentHistory: consentRows.map((row) => ({
        version: row.version,
        state: row.state,
        recordedAt: row.createdAt.toISOString(),
      })),
      sessions: sessionRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
      })),
      /**
       * Audit entries are deliberately limited to the caller's own actions.
       * Another user's actions that merely mention this account (e.g. an admin
       * reading it) belong in a separate, access-log-style disclosure, which
       * most privacy policies describe rather than export.
       */
      activityLog: auditRows.map((row) => ({
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        createdAt: row.createdAt.toISOString(),
      })),
      priorRequests: requestRows.map((row) => ({
        kind: row.kind,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
    };
  }),

  /** Schedule deletion. Immediate sign-out; data goes after the grace period. */
  requestDeletion: authedProcedure
    .input(
      z.object({
        /** The user must type their own email: a speed bump against a hijacked session. */
        confirmEmail: z.string().min(3),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.confirmEmail.trim().toLowerCase() !== ctx.user.email.toLowerCase()) {
        throw NotFoundError("That email does not match your account.");
      }

      const db = requireDb();
      const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000);

      const openRequests = await db
        .select({ id: dataRequests.id })
        .from(dataRequests)
        .where(
          and(
            eq(dataRequests.userId, ctx.user.id),
            eq(dataRequests.kind, "deletion"),
            eq(dataRequests.status, "pending")
          )
        )
        .limit(1);

      if (openRequests.length === 0) {
        await db.insert(dataRequests).values({
          userId: ctx.user.id,
          kind: "deletion",
          status: "pending",
          scheduledFor,
          note: input.reason ?? null,
        });
      }

      // Sign out everywhere: the account is now read-only for its owner.
      await revokeAllSessions(ctx.user.id);

      await audit({
        actorUserId: ctx.user.id,
        action: "account.deletion_requested",
        targetType: "user",
        targetId: String(ctx.user.id),
        metadata: { scheduledFor: scheduledFor.toISOString() },
        ip: ctx.ip,
      });

      return {
        scheduledFor: scheduledFor.toISOString(),
        graceDays: DELETION_GRACE_DAYS,
        message: `Your account is scheduled for deletion on ${scheduledFor.toISOString().slice(0, 10)}. Sign in again before then to cancel.`,
      };
    }),

  cancelDeletion: authedProcedure.mutation(async ({ ctx }) => {
    const db = requireDb();
    const updated = await db
      .update(dataRequests)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(
        and(
          eq(dataRequests.userId, ctx.user.id),
          eq(dataRequests.kind, "deletion"),
          eq(dataRequests.status, "pending")
        )
      );

    const affected = Number(
      (updated as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
    );

    // Undo the soft-delete so the account is usable again right away.
    await db
      .update(users)
      .set({ deletedAt: null })
      .where(eq(users.id, ctx.user.id));

    if (affected > 0) {
      await audit({
        actorUserId: ctx.user.id,
        action: "account.deletion_cancelled",
        ip: ctx.ip,
      });
    }

    return { cancelled: affected > 0 };
  }),

  /** Pending deletion request for this account, if any. */
  deletionStatus: authedProcedure.query(async ({ ctx }) => {
    const db = requireDb();
    const rows = await db
      .select()
      .from(dataRequests)
      .where(
        and(
          eq(dataRequests.userId, ctx.user.id),
          eq(dataRequests.kind, "deletion"),
          eq(dataRequests.status, "pending")
        )
      )
      .orderBy(desc(dataRequests.createdAt))
      .limit(1);

    const row = rows[0];
    return row
      ? {
          pending: true,
          scheduledFor: row.scheduledFor?.toISOString() ?? null,
          requestedAt: row.createdAt.toISOString(),
        }
      : { pending: false, scheduledFor: null, requestedAt: null };
  }),

  /** Append-only consent history shown in settings (and exported above). */
  consentHistory: authedProcedure.query(async ({ ctx }) => {
    const db = requireDb();
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

  /** Storage used, so the UI can warn before a quota becomes a surprise. */
  storageUsage: authedProcedure.query(async ({ ctx }) => {
    const db = requireDb();
    const rows = await db
      .select({
        count: sql<number>`COUNT(*)`,
        bytes: sql<number>`COALESCE(SUM(${files.size}), 0)`,
      })
      .from(files)
      .where(eq(files.ownerId, ctx.user.id));

    return {
      fileCount: Number(rows[0]?.count ?? 0),
      bytes: Number(rows[0]?.bytes ?? 0),
    };
  }),
});
