/**
 * Server-side sessions.
 *
 * A session is a row in `sessions` plus a cookie holding the opaque token.
 * Revocation is immediate (delete/flag the row) — this is the one thing a
 * purely stateless JWT cannot do, and "log out all devices" is a GDPR-era
 * expectation, not a nice-to-have.
 */
import { SESSION_TTL_MS } from "@shared/const";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { sessions, users, type User } from "../../../drizzle/schema";
import { getDb } from "../db";
import { generateToken, hashToken } from "./tokens";

export type SessionMeta = {
  userAgent?: string | undefined;
  ip?: string | undefined;
};

export type CreatedSession = {
  /** Plaintext token — put this in the cookie and then forget it. */
  token: string;
  sessionId: number;
  expiresAt: Date;
};

export async function createSession(
  userId: number,
  meta: SessionMeta = {}
): Promise<CreatedSession> {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");

  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const [inserted] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ip: meta.ip?.slice(0, 64) ?? null,
      expiresAt,
    })
    .$returningId();

  return { token, sessionId: inserted?.id ?? -1, expiresAt };
}

export type ResolvedSession = {
  sessionId: number;
  user: User;
};

/**
 * Resolve a token to a user. Returns null for unknown, expired, or revoked
 * tokens — the caller must treat all three identically (no oracle).
 */
export async function resolveSession(
  token: string | undefined | null
): Promise<ResolvedSession | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const db = getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          isNull(users.deletedAt)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    if (row.user.status === "suspended") return null;

    return { sessionId: row.session.id, user: row.user };
  } catch {
    // A DB outage must not turn into a 500 on public pages: treat as signed out.
    return null;
  }
}

/** Best-effort "last used" stamp. Never blocks the request path. */
export function touchSession(sessionId: number): void {
  const db = getDb();
  if (!db) return;
  void db
    .update(sessions)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(sessions.id, sessionId),
        // At most one write per hour per session; the column is analytics only.
        lt(sessions.lastUsedAt, new Date(Date.now() - 60 * 60 * 1000))
      )
    )
    .catch(() => undefined);
}

export async function revokeSession(token: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(token)));
}

/** Revoke the session this request is using (sign-out). */
export async function revokeSessionById(sessionId: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** Revoke a specific device from the settings screen, scoped to its owner. */
export async function revokeUserSession(
  userId: number,
  sessionId: number
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const result = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt)
      )
    );
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) === 1;
}

export async function revokeAllSessions(
  userId: number,
  exceptSessionId?: number
): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const where = exceptSessionId
    ? and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        sql`${sessions.id} <> ${exceptSessionId}`
      )
    : and(eq(sessions.userId, userId), isNull(sessions.revokedAt));

  const result = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(where);

  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}

/** Retention job: delete expired/revoked rows after 30 days. */
export async function pruneSessions(olderThanDays = 30): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, cutoff));
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}

/** Active sessions for the "your devices" settings screen. */
export async function listUserSessions(userId: number) {
  const db = getDb();
  if (!db) return [];
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ip: sessions.ip,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    )
    .orderBy(sessions.lastUsedAt);
}
