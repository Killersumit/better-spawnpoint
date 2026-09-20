/**
 * File REST endpoints.
 *
 *   POST   /api/files/upload   (authenticated) → store a file, return {key,url}
 *   GET    /api/files/{key}    → serve it (authorization enforced HERE)
 *   DELETE /api/files/{key}    (authenticated) → owner or admin only
 *
 * Why raw bodies instead of multipart: `express.raw()` removes a multipart
 * parser from the dependency tree and the attack surface, and browsers can PUT a
 * `File` object straight into the request body.
 *
 * The authorization rule that matters: an object is readable only when its
 * database row says `publicRead`, or when the caller owns it (or is an admin).
 * A key is not a capability — guessing one must not be enough to read it, which
 * is why the download route consults the database on every request instead of
 * trusting the key's unguessability.
 */
import type { Express, Request, RequestHandler, Response } from "express";
import express from "express";
import { and, eq } from "drizzle-orm";
import { API } from "@shared/const";
import { AppError, BadRequestError, NotFoundError } from "@shared/errors";
import { files } from "../../../drizzle/schema";
import { getDb, requireDb } from "../db";
import { ENV } from "../env";
import { logger } from "../logger";
import { audit } from "../audit";
import { authenticateRequest } from "../auth";
import { assertSafeKey, assertUploadAllowed, storage } from "../storage";

export function registerFileRoutes(app: Express, uploadLimiter: RequestHandler): void {
  app.post(
    `${API.files}/upload`,
    uploadLimiter,
    // `type: "*/*"` so any content type reaches the handler, which then decides
    // whether it is allowed. Rejecting here would produce a confusing
    // body-parse error instead of a clear message.
    express.raw({ type: "*/*", limit: ENV.STORAGE_MAX_UPLOAD_BYTES }),
    async (req: Request, res: Response) => {
      try {
        const auth = await authenticateRequest(req);
        if (!auth) {
          res.status(401).json({ error: "Sign in to upload files." });
          return;
        }

        enforcePerUserUploadRate(auth.user.id);

        const contentType = normalizeContentType(req.headers["content-type"]);
        const body = req.body as unknown;

        if (!Buffer.isBuffer(body) || body.byteLength === 0) {
          throw BadRequestError("The request body was empty.");
        }
        assertUploadAllowed(contentType, body.byteLength);

        const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "uploads";
        const originalName =
          typeof req.query.name === "string" ? req.query.name.slice(0, 255) : undefined;
        // Public files are an explicit opt-in, never the default: a public
        // object is readable by anyone who has (or guesses) its URL.
        const publicRead = req.query.public === "true" && auth.user.role === "admin";

        const object = await storage().putObject(body, {
          contentType,
          prefix,
          ...(originalName ? { originalName } : {}),
        });

        const db = requireDb();
        await db.insert(files).values({
          key: object.key,
          ownerId: auth.user.id,
          originalName: originalName ?? null,
          contentType,
          size: object.size,
          driver: storage().name,
          publicRead,
        });

        await audit({
          actorUserId: auth.user.id,
          action: "file.uploaded",
          targetType: "file",
          targetId: object.key,
          metadata: { size: object.size, contentType, publicRead },
        });

        res.status(201).json({
          key: object.key,
          url: `${API.files}/${object.key}`,
          size: object.size,
          contentType,
        });
      } catch (error) {
        sendRouteError(res, error, "upload a file");
      }
    }
  );

  /**
   * Bytes for a single account export file. Owner only, always an attachment.
   *
   * Order matters: Express matches routes in registration order, so this
   * specific path MUST stay above the `/files/*` wildcard below. When the
   * wildcard came first it swallowed every export download and answered
   * "file not found" for a key that existed.
   */
  app.get(
    `${API.files}/export/:exportId`,
    async (req: Request, res: Response) => {
      try {
        const auth = await authenticateRequest(req);
        if (!auth) {
          res.status(401).json({ error: "Sign in first." });
          return;
        }

        const db = requireDb();
        const exportId = req.params.exportId ?? "";
        const rows = await db
          .select()
          .from(files)
          .where(and(eq(files.key, exportId), eq(files.ownerId, auth.user.id)))
          .limit(1);

        const row = rows[0];
        if (!row) throw NotFoundError("Export not found");

        const object = await storage().getObject(row.key);
        if (!object) throw NotFoundError("Export not found");

        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="${row.originalName ?? "export.json"}"`);
        res.setHeader("Cache-Control", "private, no-store");
        res.send(object.data);
      } catch (error) {
        sendRouteError(res, error, "read that export");
      }
    }
  );

  /**
   * Download any file by key. The key arrives as a wildcard path, is
   * validated, and is then checked against the database before any bytes move.
   * Local storage streams from disk; S3 hands the browser a short-lived
   * presigned redirect (307 preserves the method, so HEAD keeps working).
   */
  app.get(`${API.files}/*`, async (req: Request, res: Response) => {
    try {
      const key = readWildcardKey(req);
      assertSafeKey(key);

      const db = getDb();
      const rows = db ? await db.select().from(files).where(eq(files.key, key)).limit(1) : [];
      const row = rows[0];

      // One indistinguishable 404 for "no such file" and "not yours": the
      // difference is itself information about what exists.
      if (!row) throw NotFoundError("File not found");

      if (!row.publicRead) {
        const auth = await authenticateRequest(req);
        const isOwner = auth !== null && row.ownerId === auth.user.id;
        const isAdmin = auth !== null && auth.user.role === "admin";
        if (!isOwner && !isAdmin) throw NotFoundError("File not found");
      }

      const filename = (row.originalName ?? key.split("/").pop() ?? "file").replace(/["\r\n]/g, "");
      const isSvg = row.contentType.includes("svg") || key.toLowerCase().endsWith(".svg");

      // Defence in depth, on both delivery paths.
      res.setHeader("X-Content-Type-Options", "nosniff");
      // An inline SVG can execute script in this origin, so SVG is always an
      // attachment regardless of how it was stored.
      res.setHeader(
        "Content-Disposition",
        isSvg ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`
      );

      if (storage().name === "s3") {
        const signed = storage().presignGet(key, 300);
        if (signed) {
          res.redirect(307, signed);
          return;
        }
      }

      const object = await storage().getObject(key);
      if (!object) throw NotFoundError("File not found");

      res.setHeader("Content-Type", object.contentType);
      res.setHeader(
        "Cache-Control",
        row.publicRead ? "public, max-age=31536000, immutable" : "private, no-store"
      );
      res.send(object.data);
    } catch (error) {
      sendRouteError(res, error, "read that file");
    }
  });

  app.delete(`${API.files}/*`, async (req: Request, res: Response) => {
    try {
      const auth = await authenticateRequest(req);
      if (!auth) {
        res.status(401).json({ error: "Sign in first." });
        return;
      }

      const key = readWildcardKey(req);
      assertSafeKey(key);

      const db = requireDb();
      const rows = await db.select().from(files).where(eq(files.key, key)).limit(1);
      const row = rows[0];

      if (!row || (row.ownerId !== auth.user.id && auth.user.role !== "admin")) {
        throw NotFoundError("File not found");
      }

      await storage().deleteObject(key);
      // The row goes even if the object was already gone from the bucket: a
      // dangling row is worse than a dangling object.
      await db.delete(files).where(eq(files.key, key));

      await audit({
        actorUserId: auth.user.id,
        action: "file.deleted",
        targetType: "file",
        targetId: key,
      });

      res.status(204).end();
    } catch (error) {
      sendRouteError(res, error, "delete that file");
    }
  });

}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readWildcardKey(req: Request): string {
  // Express populates positional captures for `/files/*`; handle both the
  // array form and a string route param.
  const captured = (req.params as Record<string, string | string[] | undefined>)[0];
  const raw = Array.isArray(captured)
    ? captured.join("/")
    : (captured ?? (req.params as Record<string, string>)["*"] ?? "");
  try {
    return decodeURIComponent(raw);
  } catch {
    throw BadRequestError("Invalid file key");
  }
}

function normalizeContentType(header: string | undefined): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * Per-user upload rate limit, layered on top of the per-IP limiter.
 *
 * In-memory on purpose: it is a courtesy brake against a runaway client, and a
 * per-instance count is enough for that. A real quota belongs in the database
 * (sum of `files.size` for the user) so it survives restarts and instances.
 */
const uploadWindows = new Map<number, number[]>();
const UPLOAD_WINDOW_MS = 60_000;
const UPLOAD_LIMIT_PER_WINDOW = 20;

function enforcePerUserUploadRate(userId: number): void {
  const now = Date.now();
  const recent = (uploadWindows.get(userId) ?? []).filter((time) => now - time < UPLOAD_WINDOW_MS);

  if (recent.length >= UPLOAD_LIMIT_PER_WINDOW) {
    throw new AppError(429, "Too many uploads in a row. Wait a moment and try again.", undefined, "RATE_LIMITED");
  }

  recent.push(now);
  uploadWindows.set(userId, recent);

  // Keep the map from growing without bound in a long-lived process.
  if (uploadWindows.size > 10_000) {
    for (const [id, times] of uploadWindows) {
      if (times.every((time) => now - time >= UPLOAD_WINDOW_MS)) uploadWindows.delete(id);
    }
  }
}

/**
 * Route-level error rendering. These are plain Express handlers rather than tRPC
 * procedures, so the tRPC error formatter never sees them.
 */
export function sendRouteError(res: Response, error: unknown, action: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
    return;
  }

  logger.error("file route failed", { action, error: String(error) });
  res.status(500).json({ error: `Something went wrong trying to ${action}.` });
}
