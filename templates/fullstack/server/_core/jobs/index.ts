/**
 * In-process scheduler.
 *
 * Design constraints this satisfies:
 *  • Runs with no external dependency (no Redis, no vendor cron service).
 *  • Multi-instance safe: a job claims a lease row in `jobs` before running, so
 *    two replicas never execute the same tick.
 *  • Idempotent-by-requirement handlers: a lease that expires mid-run causes a
 *    retry, and duplicate delivery must not corrupt data.
 *  • Fails loudly in logs, never crashes the process.
 *
 * If your platform provides real cron (Vercel Cron, Cloud Scheduler, k8s
 * CronJob), disable the in-process loop with JOBS_ENABLED=false and call
 * `POST /api/cron/{jobName}` with the `x-cron-secret` header instead. Both
 * paths run the same handlers.
 */
import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import { jobs } from "../../../drizzle/schema";
import { getDb } from "../db";
import { ENV, isProduction, isTest } from "../env";
import { logger } from "../logger";
import { assertValidCron, cronMatches, describeCron } from "./cron";
import { JOBS, jobNames, type JobDefinition } from "./registry";

const TICK_MS = 30_000;
/** A run that takes longer than this is presumed dead and may be retried. */
/**
 * Lease TTL. Just under a minute on purpose:
 *  • longer than the 30s tick interval, so a second tick inside the same minute
 *    cannot re-enter a job that is still running (or just finished);
 *  • shorter than a minute, so a job scheduled `* * * * *` is not starved.
 */
const LEASE_MS = 55_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export type RunResult = {
  name: string;
  status: "ok" | "error" | "skipped" | "locked";
  durationMs: number;
  summary?: string;
  error?: string;
};

/**
 * Run one job, claiming a lease first when a database is available.
 * Without a database the lease is skipped and the job runs on every instance —
 * acceptable for single-instance dev, never for production.
 */
export async function runJob(name: string, options: { force?: boolean } = {}): Promise<RunResult> {
  const job: JobDefinition | undefined = JOBS[name];
  const startedAt = Date.now();

  if (!job) {
    return { name, status: "error", durationMs: 0, error: `Unknown job "${name}"` };
  }

  const db = getDb();
  if (db && !options.force) {
    const claimed = await claimLease(db, name);
    if (!claimed) {
      return { name, status: "locked", durationMs: Date.now() - startedAt };
    }
  }

  try {
    const outcome = await job.handler();
    const durationMs = Date.now() - startedAt;
    await finishRun(name, "ok", durationMs, outcome?.summary, undefined);
    logger.info("job ok", { job: name, durationMs, summary: outcome?.summary });
    return {
      name,
      status: "ok",
      durationMs,
      ...(outcome?.summary ? { summary: outcome.summary } : {}),
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(name, "error", durationMs, undefined, message);
    logger.error("job failed", { job: name, durationMs, error: message });
    return { name, status: "error", durationMs, error: message };
  }
}

/**
 * Atomically claim the lease for a job.
 *
 * Two statements, because MySQL's ON DUPLICATE KEY UPDATE cannot carry a WHERE
 * clause: ensure the row exists, then take the lease with a conditional UPDATE
 * and trust `affectedRows` — that is the compare-and-swap. Two instances racing
 * on the same tick will see exactly one affected row between them.
 */
async function claimLease(
  db: NonNullable<ReturnType<typeof getDb>>,
  name: string
): Promise<boolean> {
  const job = JOBS[name];
  if (!job) return false;

  const now = new Date();
  const holdsUntil = new Date(now.getTime() + LEASE_MS);

  await db
    .insert(jobs)
    .ignore()
    .values({ name, cron: job.cron, enabled: true });

  const result = await db
    .update(jobs)
    .set({ lockUntil: holdsUntil })
    .where(
      and(
        eq(jobs.name, name),
        eq(jobs.enabled, true),
        or(isNull(jobs.lockUntil), lt(jobs.lockUntil, now))
      )
    );

  const affected = Number(
    (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
  );
  return affected === 1;
}

async function finishRun(
  name: string,
  status: "ok" | "error",
  durationMs: number,
  summary?: string,
  error?: string
): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db
      .update(jobs)
      .set({
        lastRunAt: new Date(),
        lastStatus: status,
        lastDurationMs: durationMs,
        lastError: error ? `${error}${summary ? ` — ${summary}` : ""}`.slice(0, 2000) : null,
        // The lease is deliberately NOT cleared here. Releasing it immediately
        // would let the next tick (30 seconds later, same minute) run the job
        // again; leaving it to expire is what makes "once per minute" true.
      })
      .where(eq(jobs.name, name));
  } catch (updateError) {
    logger.warn("could not record job result", { job: name, error: String(updateError) });
  }
}

/** Run every job whose expression matches the current minute. */
/**
 * Which minute each job last ran in (epoch minutes), by name.
 *
 * The database lease is the cross-process guard; this is the in-process one. It
 * covers the case where the database is unavailable (no lease to take) and the
 * case where a job legitimately takes longer than its lease: without it, a slow
 * job that finishes in the middle of the same minute could be started again by
 * the following tick.
 */
const lastRunMinute = new Map<string, number>();

/** Run every job whose expression matches the current minute, at most once. */
export async function tick(now = new Date()): Promise<RunResult[]> {
  const results: RunResult[] = [];
  const minute = Math.floor(now.getTime() / 60_000);

  for (const name of jobNames()) {
    const job = JOBS[name];
    if (!job) continue;
    if (!cronMatches(job.cron, now)) continue;
    if (lastRunMinute.get(name) === minute) continue;

    lastRunMinute.set(name, minute);
    results.push(await runJob(name));
  }
  return results;
}

export function startScheduler(): void {
  if (process.env.JOBS_ENABLED === "false") {
    logger.info("scheduler disabled (JOBS_ENABLED=false)");
    return;
  }
  if (timer) return;

  // Validate every expression once, at boot. A typo must not wait until 03:41.
  for (const name of jobNames()) {
    const job = JOBS[name];
    if (!job) continue;
    try {
      assertValidCron(job.cron);
    } catch (error) {
      logger.error("invalid cron expression — job will never run", {
        job: name,
        cron: job.cron,
        error: String(error),
      });
    }
  }

  const tickSafely = async () => {
    if (running) return; // never overlap ticks in one process
    running = true;
    try {
      const results = await tick();
      for (const result of results) {
        if (result.status === "locked") {
          logger.debug("job skipped, lease held elsewhere", { job: result.name });
        }
      }
    } catch (error) {
      logger.error("scheduler tick failed", { error: String(error) });
    } finally {
      running = false;
    }
  };

  // First tick after 10s so startup is not slowed by jobs, then every 30s.
  setTimeout(() => void tickSafely(), 10_000).unref?.();
  timer = setInterval(() => void tickSafely(), TICK_MS);
  timer.unref?.();

  logger.info("scheduler started", {
    jobs: jobNames().length,
    schedule: jobNames().map((n) => `${n} (${describeCron(JOBS[n]!.cron)})`),
  });
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Compact status for `/api/health` and admin dashboards. */
export async function jobStatus(): Promise<
  { name: string; cron: string; description: string; lastRunAt: string | null; lastStatus: string | null }[]
> {
  const db = getDb();
  const rows = db ? await db.select().from(jobs).limit(200) : [];
  const byName = new Map(rows.map((row) => [row.name, row]));

  return jobNames().map((name) => {
    const job = JOBS[name]!;
    const row = byName.get(name);
    return {
      name,
      cron: job.cron,
      description: job.description,
      lastRunAt: row?.lastRunAt ? row.lastRunAt.toISOString() : null,
      lastStatus: row?.lastStatus ?? null,
    };
  });
}

/** Removes stale leases left by a crashed process. */
export async function releaseStaleLeases(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const result = await db
    .update(jobs)
    .set({ lockUntil: null })
    .where(and(lt(jobs.lockUntil, new Date()), sql`${jobs.lockUntil} IS NOT NULL`));
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}

export const schedulerInternals = { isProduction, isTest, LEASE_MS, TICK_MS };
