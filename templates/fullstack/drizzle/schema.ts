/**
 * Database schema (MySQL 8 / MariaDB 10.6+ / TiDB).
 *
 * ── Rules for anyone (human or agent) editing this file ─────────────────────
 * 1. Every table has `id` (auto-increment int PK), `createdAt`, `updatedAt`.
 * 2. Column names are camelCase in code and in the database. Always pass the
 *    name explicitly: `varchar("email", { length: 320 })`.
 * 3. Foreign keys declare `onDelete` explicitly. User-owned data cascades;
 *    audit/consent rows use `set null` so history survives account deletion.
 * 4. Soft-delete is `deletedAt` (nullable timestamp), never a boolean.
 * 5. Enums are `mysqlEnum` with the values listed inline — do not use free text
 *    for a status field.
 * 6. Add an index for every column you will filter or join on. Unindexed FKs
 *    are the most common scale bug in this codebase.
 * 7. After editing, run `npm run db:generate && npm run db:migrate`, then
 *    `npm run ai:context` so the AI-facing manifest picks up the new columns.
 *
 * Precise types are inferred from here — `type User = typeof users.$inferSelect`.
 * Never hand-write a duplicate interface for a table row.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type { ConsentState } from "../shared/consent";

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Login identifier. Always stored lower-cased and trimmed. */
    email: varchar("email", { length: 320 }).notNull(),
    /** Set once the address is confirmed. Null means "unverified". */
    emailVerifiedAt: timestamp("emailVerifiedAt"),
    /**
     * scrypt hash in PHC-ish format `scrypt$N$r$p$salt$hash`.
     * NULL for accounts that only ever signed in through an OAuth provider.
     */
    passwordHash: text("passwordHash"),
    name: varchar("name", { length: 200 }),
    /** Avatar URL. Uploaded files use `/api/files/{key}`. */
    image: varchar("image", { length: 500 }),
    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
    status: mysqlEnum("status", ["active", "suspended"])
      .default("active")
      .notNull(),
    /** Explicit double opt-in for product email. Never default to true. */
    marketingOptIn: boolean("marketingOptIn").default(false).notNull(),
    /** Soft delete. Data is hard-deleted by the retention job after 30 days. */
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn"),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_status_idx").on(table.status),
    index("users_deletedAt_idx").on(table.deletedAt),
  ]
);

/**
 * Server-side sessions. The cookie carries an opaque random token; only its
 * SHA-256 hash is stored, so a database leak cannot be replayed as a login.
 * Deleting the row revokes the session immediately ("sign out everywhere").
 */
export const sessions = mysqlTable(
  "sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256(token) as hex. Unique so lookups are a single index hit. */
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    userAgent: varchar("userAgent", { length: 500 }),
    ip: varchar("ip", { length: 64 }),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
    lastUsedAt: timestamp("lastUsedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("sessions_tokenHash_unique").on(table.tokenHash),
    index("sessions_userId_idx").on(table.userId),
    index("sessions_expiresAt_idx").on(table.expiresAt),
  ]
);

/** Linked third-party identities (Google, GitHub, ...). */
export const oauthAccounts = mysqlTable(
  "oauthAccounts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "google" | "github" — see server/_core/auth/providers.ts */
    provider: varchar("provider", { length: 32 }).notNull(),
    /** The provider's immutable subject id (`sub` for OIDC). */
    providerAccountId: varchar("providerAccountId", { length: 191 }).notNull(),
    /** Email as reported by the provider, kept for support/debugging only. */
    providerEmail: varchar("providerEmail", { length: 320 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("oauthAccounts_provider_account_unique").on(
      table.provider,
      table.providerAccountId
    ),
    index("oauthAccounts_userId_idx").on(table.userId),
  ]
);

/**
 * Single-use tokens for password reset, email verification, and invitations.
 * Stored hashed and consumed exactly once (`usedAt`).
 */
export const authTokens = mysqlTable(
  "authTokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").references(() => users.id, { onDelete: "cascade" }),
    /** The email is stored so invite tokens work before a user row exists. */
    email: varchar("email", { length: 320 }),
    kind: mysqlEnum("kind", [
      "password_reset",
      "email_verify",
      "invite",
    ]).notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("authTokens_tokenHash_unique").on(table.tokenHash),
    index("authTokens_userId_kind_idx").on(table.userId, table.kind),
    index("authTokens_email_idx").on(table.email),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Compliance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append-only consent log. One row per (subject, version, decision).
 * This is the evidence trail regulators ask for: what was shown, what was
 * accepted, when, from where. NEVER update or delete rows in this table.
 */
export const consents = mysqlTable(
  "consents",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Null when the visitor has not signed in yet (anonymous visitor). */
    userId: int("userId").references(() => users.id, { onDelete: "set null" }),
    /** Random per-browser id so anonymous consent is still traceable. */
    anonId: varchar("anonId", { length: 64 }),
    /** Consent wording version from shared/const.ts → CONSENT_VERSION. */
    version: varchar("version", { length: 32 }).notNull(),
    state: json("state").$type<ConsentState>().notNull(),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("userAgent", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("consents_userId_idx").on(table.userId),
    index("consents_anonId_idx").on(table.anonId),
  ]
);

/**
 * Append-only audit log for security- and compliance-relevant actions
 * (sign-in, password change, export, deletion request, role change, admin
 * reads of personal data). `action` uses `resource.verb` lower-case strings.
 */
export const auditLogs = mysqlTable(
  "auditLogs",
  {
    id: int("id").autoincrement().primaryKey(),
    actorUserId: int("actorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("targetType", { length: 64 }),
    targetId: varchar("targetId", { length: 191 }),
    /** Structured context. Must not contain secrets or full request bodies. */
    metadata: json("metadata").$type<Record<string, unknown>>(),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("auditLogs_actorUserId_idx").on(table.actorUserId),
    index("auditLogs_action_createdAt_idx").on(table.action, table.createdAt),
  ]
);

/**
 * Data-subject requests (GDPR Art. 15/17, CCPA). Deletions are scheduled with a
 * grace period so a compromised session cannot destroy an account instantly.
 */
export const dataRequests = mysqlTable(
  "dataRequests",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: mysqlEnum("kind", ["export", "deletion"]).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "completed",
      "cancelled",
      "failed",
    ])
      .default("pending")
      .notNull(),
    /** Deletions only: when the grace period ends and data is destroyed. */
    scheduledFor: timestamp("scheduledFor"),
    completedAt: timestamp("completedAt"),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("dataRequests_userId_idx").on(table.userId),
    index("dataRequests_status_kind_idx").on(table.status, table.kind),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Platform
// ─────────────────────────────────────────────────────────────────────────────

/** Uploaded files. Authorization is checked against `ownerId` on read. */
export const files = mysqlTable(
  "files",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Storage key, unique per object. Sanitized by server/_core/storage. */
    key: varchar("key", { length: 500 }).notNull(),
    ownerId: int("ownerId").references(() => users.id, { onDelete: "set null" }),
    originalName: varchar("originalName", { length: 255 }),
    contentType: varchar("contentType", { length: 128 }).notNull(),
    size: int("size").notNull(),
    /** "local" | "s3" — which driver wrote the object. */
    driver: varchar("driver", { length: 16 }).notNull(),
    /** When set, /api/files/{key} is public (avatars, logos, og images). */
    publicRead: boolean("publicRead").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("files_key_unique").on(table.key),
    index("files_ownerId_idx").on(table.ownerId),
  ]
);

/**
 * Scheduler bookkeeping. One row per registered job; the runner uses
 * `lockUntil` as a lease so two instances never run the same job at once.
 */
export const jobs = mysqlTable(
  "jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    cron: varchar("cron", { length: 100 }).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastRunAt: timestamp("lastRunAt"),
    lastStatus: mysqlEnum("lastStatus", ["ok", "error", "skipped"]),
    lastError: text("lastError"),
    lastDurationMs: int("lastDurationMs"),
    lockUntil: timestamp("lockUntil"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [uniqueIndex("jobs_name_unique").on(table.name)]
);

/** Invite-only signup rows (AUTH_SIGNUP_MODE=invite). */
export const invitations = mysqlTable(
  "invitations",
  {
    id: int("id").autoincrement().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
    invitedByUserId: int("invitedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expiresAt").notNull(),
    acceptedAt: timestamp("acceptedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("invitations_email_idx").on(table.email),
    index("invitations_expiresAt_idx").on(table.expiresAt),
  ]
);

/**
 * ── Feature template ────────────────────────────────────────────────────────
 * The canonical "user owns a list of things" table. Copy this shape when you
 * add your first real feature, then delete it (plus its router, page, and
 * test) once your own table exists. Keeping it means every new project starts
 * with one working CRUD path that is already authorized, paginated, and tested.
 */
export const notes = mysqlTable(
  "notes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body"),
    archivedAt: timestamp("archivedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("notes_userId_createdAt_idx").on(table.userId, table.createdAt)]
);

// ─────────────────────────────────────────────────────────────────────────────
// Relations & inferred types
// ─────────────────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  oauthAccounts: many(oauthAccounts),
  notes: many(notes),
  files: many(files),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, { fields: [oauthAccounts.userId], references: [users.id] }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  user: one(users, { fields: [notes.userId], references: [users.id] }),
}));

export const filesRelations = relations(files, ({ one }) => ({
  owner: one(users, { fields: [files.ownerId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type FileRow = typeof files.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type ConsentRow = typeof consents.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type DataRequestRow = typeof dataRequests.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;

/**
 * The user shape that is safe to send to the browser. Anything not listed here
 * (passwordHash, status, deletedAt...) must never appear in an API response.
 * Use `toPublicUser()` in server/_core/auth/users.ts rather than hand-picking
 * fields at each call site.
 */
export type PublicUser = {
  id: number;
  email: string;
  name: string | null;
  image: string | null;
  role: "user" | "admin";
  emailVerified: boolean;
  marketingOptIn: boolean;
  createdAt: string;
};
