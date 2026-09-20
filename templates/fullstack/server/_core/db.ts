/**
 * Database access.
 *
 * The pool is created lazily so the app boots (and the UI is fully explorable)
 * before a database exists. DB-backed code paths call `requireDb()`, which
 * throws a `503 SERVICE_UNAVAILABLE` with a sentinel message the client renders
 * as an actionable empty state instead of an unhandled error.
 *
 * Conventions:
 *  • Import table types from `../../drizzle/schema`, never re-declare them.
 *  • Do not call `db.select()` with `*`; select the columns you need.
 *  • Every multi-step write belongs in `withTransaction`.
 */
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { DB_UNAVAILABLE_ERR_MSG } from "@shared/const";
import * as schema from "../../drizzle/schema";
import { ENV } from "./env";
import { logger } from "./logger";
import { ServiceUnavailableError } from "@shared/errors";

export type Database = MySql2Database<typeof schema>;

let pool: mysql.Pool | null = null;
let database: Database | null = null;

function connect(): Database | null {
  if (database) return database;
  if (!ENV.DATABASE_URL) return null;

  try {
    pool = mysql.createPool({
      uri: ENV.DATABASE_URL,
      connectionLimit: 10,
      // TiDB serverless and many managed MySQLs terminate idle connections.
      enableKeepAlive: true,
      waitForConnections: true,
      timezone: "Z",
    });
    database = drizzle(pool, { schema, mode: "default" });
    logger.info("Database pool created", { url: redactUrl(ENV.DATABASE_URL) });
    return database;
  } catch (error) {
    logger.error("Database connection failed", { error: String(error) });
    return null;
  }
}

/** Returns null when no database is configured. Prefer `requireDb()` in routes. */
export function getDb(): Database | null {
  return connect();
}

/** Throws a user-facing 503 when the environment has no database. */
export function requireDb(): Database {
  const db = connect();
  if (!db) throw ServiceUnavailableError(DB_UNAVAILABLE_ERR_MSG);
  return db;
}

export function isDbConfigured(): boolean {
  return Boolean(ENV.DATABASE_URL);
}

/**
 * Run `fn` inside a transaction. All writes that must land together (e.g.
 * create user + create session + append audit log) go through here.
 */
export async function withTransaction<T>(
  fn: (tx: Database) => Promise<T>
): Promise<T> {
  const db = requireDb();
  return db.transaction(async (tx) => fn(tx as unknown as Database));
}

/** Close the pool. Used by tests and graceful shutdown. */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    database = null;
  }
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    if (parsed.username) parsed.username = "***";
    return parsed.toString();
  } catch {
    return "[unparseable-database-url]";
  }
}
