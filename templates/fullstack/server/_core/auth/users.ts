/**
 * User reads/writes. Every function here returns rows whose shape comes from
 * `drizzle/schema.ts`; nothing else in the codebase may hand-build a user
 * object. `toPublicUser()` is the ONLY way a user crosses to the browser.
 */
import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import {
  auditLogs,
  users,
  type PublicUser,
  type User,
} from "../../../drizzle/schema";
import { AppError, ConflictError } from "@shared/errors";
import { getDb, requireDb, withTransaction } from "../db";
import { hashPassword, validatePassword } from "./password";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Strips everything that must not leave the server: passwordHash, status,
 * deletedAt, and any internal counters. Add a field to PublicUser in
 * drizzle/schema.ts before exposing it — never spread a raw row into a response.
 */
export function toPublicUser(row: User): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    role: row.role,
    emailVerified: Boolean(row.emailVerifiedAt),
    marketingOptIn: row.marketingOptIn,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findUserById(id: number): Promise<User | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);
  return rows[0] ?? null;
}

export type CreateUserInput = {
  email: string;
  password?: string;
  name?: string | null;
  image?: string | null;
  role?: "user" | "admin";
  marketingOptIn?: boolean;
  emailVerified?: boolean;
};

/**
 * Create a user. Throws CONFLICT when the email is taken, so callers can return
 * a clear message without a race between the SELECT and the INSERT.
 */
export async function createUser(input: CreateUserInput): Promise<User> {
  const email = normalizeEmail(input.email);

  if (input.password) {
    const problem = validatePassword(input.password);
    if (problem) throw new AppError(422, problem, undefined, "WEAK_PASSWORD");
  }

  const passwordHash = input.password
    ? (await hashPassword(input.password)).encoded
    : null;

  return withTransaction(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing.length > 0) {
      throw ConflictError("An account with that email already exists.");
    }

    const [inserted] = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        name: input.name?.slice(0, 200) ?? null,
        image: input.image ?? null,
        role: input.role ?? "user",
        marketingOptIn: input.marketingOptIn ?? false,
        emailVerifiedAt: input.emailVerified ? new Date() : null,
      })
      .$returningId();

    const id = inserted?.id;
    if (!id) throw new Error("User insert did not return an id");

    const rows = await tx.select().from(users).where(eq(users.id, id)).limit(1);
    const created = rows[0];
    if (!created) throw new Error("User row vanished after insert");

    await tx.insert(auditLogs).values({
      actorUserId: id,
      action: "user.create",
      targetType: "user",
      targetId: String(id),
      metadata: { method: passwordHash ? "password" : "oauth" },
    });

    return created;
  });
}

export async function setPassword(userId: number, password: string): Promise<void> {
  const problem = validatePassword(password);
  if (problem) throw new AppError(422, problem, undefined, "WEAK_PASSWORD");
  const encoded = (await hashPassword(password)).encoded;
  await requireDb()
    .update(users)
    .set({ passwordHash: encoded })
    .where(eq(users.id, userId));
}

export async function markEmailVerified(userId: number): Promise<void> {
  await requireDb()
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function recordSignIn(userId: number): Promise<void> {
  await requireDb()
    .update(users)
    .set({ lastSignedIn: new Date() })
    .where(eq(users.id, userId));
}

export async function setUserRole(
  userId: number,
  role: "user" | "admin",
  actorUserId: number
): Promise<void> {
  await requireDb().update(users).set({ role }).where(eq(users.id, userId));
  await requireDb().insert(auditLogs).values({
    actorUserId,
    action: "user.role_change",
    targetType: "user",
    targetId: String(userId),
    metadata: { role },
  });
}

export async function updateProfile(
  userId: number,
  patch: { name?: string | null; image?: string | null; marketingOptIn?: boolean }
): Promise<User> {
  const db = requireDb();
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name?.slice(0, 200) ?? null;
  if (patch.image !== undefined) set.image = patch.image ?? null;
  if (patch.marketingOptIn !== undefined) set.marketingOptIn = patch.marketingOptIn;

  if (Object.keys(set).length > 0) {
    await db.update(users).set(set).where(eq(users.id, userId));
  }

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const updated = rows[0];
  if (!updated) throw new AppError(404, "Account not found", undefined, "NOT_FOUND");
  return updated;
}

/** Soft delete. The retention job hard-deletes 30 days later (see jobs/registry). */
export async function softDeleteUser(userId: number, note?: string): Promise<void> {
  const db = requireDb();
  await db
    .update(users)
    .set({
      deletedAt: new Date(),
      // Free the email for re-registration while keeping the row for audit.
      email: sql`CONCAT('deleted+', ${users.id}, '+', ${users.email})`,
      passwordHash: null,
      name: null,
      image: null,
      marketingOptIn: false,
    })
    .where(eq(users.id, userId));

  await db.insert(auditLogs).values({
    actorUserId: userId,
    action: "user.soft_delete",
    targetType: "user",
    targetId: String(userId),
    metadata: note ? { note } : null,
  });
}

/** Admin-only listing with a stable, boring shape. */
/**
 * Admin-facing user shape.
 *
 * Deliberately separate from `PublicUser`: `status` and `lastSignedIn` are
 * operational data that the account owner does not need back from
 * `auth.me`, and keeping the two types apart is what stops an admin field
 * from leaking into a user-facing response by accident.
 */
export type AdminUserSummary = PublicUser & {
  status: "active" | "suspended" | "deleted";
  lastSignedIn: string | null;
};

export function toAdminUser(row: User): AdminUserSummary {
  return {
    ...toPublicUser(row),
    status: row.deletedAt ? "deleted" : row.status,
    lastSignedIn: row.lastSignedIn ? row.lastSignedIn.toISOString() : null,
  };
}

/**
 * Shared query for both user lists: same filters, same ordering, same paging,
 * different projection. Keeping one query means "the admin list shows a
 * different set of rows than the public one" cannot happen by accident.
 */
async function queryUsers<T>(
  options: {
    limit?: number;
    offset?: number;
    includeDeleted?: boolean;
    /** Case-insensitive substring match on email or name. */
    search?: string;
  },
  map: (row: User) => T
): Promise<{ items: T[]; total: number }> {
  const db = requireDb();
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const conditions = [];
  if (!options.includeDeleted) conditions.push(isNull(users.deletedAt));

  const term = options.search?.trim();
  if (term) {
    // LIKE with a bound parameter, never concatenated SQL. `%` and `_` are
    // escaped so a search for "a_b" cannot turn into a wildcard.
    const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
    conditions.push(or(like(users.email, `%${escaped}%`), like(users.name, `%${escaped}%`))!);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  const countRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(users)
    .where(where);

  return {
    items: rows.map(map),
    total: Number(countRows[0]?.count ?? 0),
  };
}

export function listUsers(options: {
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  search?: string;
}): Promise<{ items: PublicUser[]; total: number }> {
  return queryUsers(options, toPublicUser);
}

/** Same rows as `listUsers`, plus the operational fields an admin console needs. */
export function listUsersAdmin(options: {
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  search?: string;
}): Promise<{ items: AdminUserSummary[]; total: number }> {
  return queryUsers(options, toAdminUser);
}
