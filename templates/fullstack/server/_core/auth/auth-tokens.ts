/**
 * Single-use auth tokens stored in the `authTokens` table: password reset,
 * email verification, and invitations.
 *
 * Consumption is a compare-and-swap: `UPDATE ... WHERE id = ? AND usedAt IS
 * NULL` and a check on `affectedRows`. Two concurrent requests presenting the
 * same valid token therefore both cannot succeed — the classic bug with
 * "SELECT, then UPDATE" is that both readers see `usedAt = NULL`.
 */
import { and, eq, isNull } from "drizzle-orm";
import { authTokens } from "../../../drizzle/schema";
import type { Database } from "../db";
import { generateToken, hashToken, tokenMatches } from "./tokens";

export type AuthTokenKind = "password_reset" | "email_verify" | "invite";

export type AuthTokenRow = typeof authTokens.$inferSelect;

export async function issueAuthToken(
  db: Database,
  params: {
    userId?: number | null;
    email: string;
    kind: AuthTokenKind;
    ttlMs: number;
  }
): Promise<string> {
  const token = generateToken();
  await db.insert(authTokens).values({
    userId: params.userId ?? null,
    email: params.email.trim().toLowerCase(),
    kind: params.kind,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + params.ttlMs),
  });
  return token;
}

/**
 * Validate and burn a token. Returns the row when this call is the one that
 * consumed it, and null for unknown, expired, or already-used tokens.
 */
export async function consumeAuthToken(
  db: Database,
  token: string,
  kind: AuthTokenKind
): Promise<AuthTokenRow | null> {
  const row = await peekAuthToken(db, token, kind);
  if (!row) return null;

  const updated = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.id, row.id), isNull(authTokens.usedAt)));

  const affected = Number(
    (updated as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
  );
  return affected === 1 ? row : null;
}

/** Read a token without consuming it (used to render "invite is valid"). */
export async function peekAuthToken(
  db: Database,
  token: string,
  kind: AuthTokenKind
): Promise<AuthTokenRow | null> {
  if (!token || token.length < 20 || token.length > 300) return null;

  const rows = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.kind, kind)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  // Belt and braces: the index lookup already matched, but constant-time
  // re-verification keeps this safe if the column is ever shortened or hashed
  // differently.
  if (!tokenMatches(token, row.tokenHash)) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

/** Invalidate every outstanding token of a kind for an address (re-issue path). */
export async function invalidateAuthTokens(
  db: Database,
  email: string,
  kind: AuthTokenKind
): Promise<number> {
  const result = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.email, email.trim().toLowerCase()),
        eq(authTokens.kind, kind),
        isNull(authTokens.usedAt)
      )
    );
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}
