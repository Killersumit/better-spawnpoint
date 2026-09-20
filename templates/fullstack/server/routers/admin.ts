/**
 * Admin procedures.
 *
 * Every read of another user's data is audited (`admin.user_read`). That is not
 * decoration: "who looked at this customer's account?" is a question you will
 * be asked, and an unlogged admin panel is the number one finding in SOC 2 and
 * GDPR Art. 32 reviews.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, dataRequests, files, sessions, users } from "../../drizzle/schema";
import { requireDb } from "../_core/db";
import { audit, recentAuditLogs } from "../_core/audit";
import { jobStatus, runJob } from "../_core/jobs";
import { jobNames } from "../_core/jobs/registry";
import { listUsersAdmin, setUserRole, softDeleteUser } from "../_core/auth/users";
import { revokeAllSessions } from "../_core/auth/sessions";
import { adminProcedure, router } from "../_core/trpc";

export const adminRouter = router({
  /**
   * Counts for the console header.
   *
   * `COUNT(*)` on four small tables is fine here. If your user table grows past
   * a few million rows, replace these with cached counters updated by a job —
   * an admin dashboard should never be the reason a query is slow.
   */
  stats: adminProcedure.query(async () => {
    const db = requireDb();

    const [userCount] = await db.select({ total: sql<number>`COUNT(*)` }).from(users);
    const [sessionCount] = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(sessions)
      .where(gt(sessions.expiresAt, new Date()));
    const [fileCount] = await db.select({ total: sql<number>`COUNT(*)` }).from(files);
    const [auditCount] = await db.select({ total: sql<number>`COUNT(*)` }).from(auditLogs);
    const [pending] = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(dataRequests)
      .where(and(eq(dataRequests.kind, "deletion"), eq(dataRequests.status, "pending")));

    return {
      userCount: Number(userCount?.total ?? 0),
      sessionCount: Number(sessionCount?.total ?? 0),
      fileCount: Number(fileCount?.total ?? 0),
      pendingDeletions: Number(pending?.total ?? 0),
      auditEntries: Number(auditCount?.total ?? 0),
      jobs: await jobStatus(),
    };
  }),

  listUsers: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
          includeDeleted: z.boolean().default(false),
          search: z.string().trim().max(200).optional(),
        })
        .default({ limit: 25, offset: 0, includeDeleted: false })
    )
    .query(async ({ ctx, input }) => {
      await audit({
        actorUserId: ctx.user.id,
        action: "admin.user_read",
        metadata: { scope: "list", ...input },
        ip: ctx.ip,
      });
      return listUsersAdmin(input);
    }),

  setRole: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "admin"]) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        // Removing your own admin rights locks you out of fixing it.
        throw new Error("You cannot change your own role.");
      }
      await setUserRole(input.userId, input.role, ctx.user.id);
      return { success: true } as const;
    }),

  suspendUser: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), suspended: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb();
      await db
        .update(users)
        .set({ status: input.suspended ? "suspended" : "active" })
        .where(eq(users.id, input.userId));

      if (input.suspended) await revokeAllSessions(input.userId);

      await audit({
        actorUserId: ctx.user.id,
        action: "user.role_change",
        targetType: "user",
        targetId: String(input.userId),
        metadata: { status: input.suspended ? "suspended" : "active" },
        ip: ctx.ip,
      });
      return { success: true } as const;
    }),

  deleteUser: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) throw new Error("You cannot delete your own account here.");
      await softDeleteUser(input.userId, input.note);
      await revokeAllSessions(input.userId);
      await audit({
        actorUserId: ctx.user.id,
        action: "user.soft_delete",
        targetType: "user",
        targetId: String(input.userId),
        metadata: { by: "admin" },
        ip: ctx.ip,
      });
      return { success: true } as const;
    }),

  auditLog: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          action: z.string().max(64).optional(),
        })
        .default({ limit: 50 })
    )
    .query(async ({ input }) => {
      const rows = await recentAuditLogs(input.limit, input.action as never);
      return rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      }));
    }),

  jobs: adminProcedure.query(async () => jobStatus()),

  runJob: adminProcedure
    .input(z.object({ name: z.enum(jobNames() as [string, ...string[]]) }))
    .mutation(async ({ ctx, input }) => {
      await audit({
        actorUserId: ctx.user.id,
        action: "admin.job_run",
        targetType: "job",
        targetId: input.name,
        ip: ctx.ip,
      });
      return runJob(input.name, { force: true });
    }),
});
