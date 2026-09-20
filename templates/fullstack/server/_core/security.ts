/**
 * HTTP hardening: headers, rate limits, CSRF, error shaping.
 *
 * Everything here is deliberately boring and explicit. If you are an agent
 * adding a new route, mount it UNDER the middlewares installed by
 * `applySecurityMiddleware()` in `index.ts` — do not create a second express
 * app, and do not disable a middleware to make a test pass.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { AppError } from "@shared/errors";
import { ENV, isProduction } from "./env";
import { logger } from "./logger";

/**
 * Content-Security-Policy.
 *
 * Production is strict: no inline scripts, no eval. Development must relax
 * script-src because Vite's dev server injects inline module preloads and uses
 * eval for HMR — those relaxations are why dev and prod are configured
 * separately instead of "just making it permissive everywhere".
 */
export function contentSecurityPolicy() {
  const analyticsSrc = process.env.VITE_ANALYTICS_SRC ?? "";
  const analyticsOrigin = analyticsSrc
    ? (() => {
        try {
          return new URL(analyticsSrc).origin;
        } catch {
          return "";
        }
      })()
    : "";

  const scriptSrc = ["'self'"];
  if (!isProduction) scriptSrc.push("'unsafe-inline'", "'unsafe-eval'");
  if (analyticsOrigin) scriptSrc.push(analyticsOrigin);

  const connectSrc = ["'self'"];
  if (!isProduction) connectSrc.push("ws:", "wss:");
  if (analyticsOrigin) connectSrc.push(analyticsOrigin);

  // Preview panes and partner embeds run the app in an iframe. Refusing all
  // framing is the secure default; opt in explicitly when you need embedding.
  const frameAncestors = (
    process.env.CSP_FRAME_ANCESTORS ?? (isProduction ? "'none'" : "*")
  )
    .split(/\s+/)
    .filter(Boolean);

  return {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // Tailwind and Radix both emit inline style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connectSrc,
    "frame-ancestors": frameAncestors,
    "frame-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "manifest-src": ["'self'"],
    "upgrade-insecure-requests": !isProduction ? null : [],
  };
}

export function applySecurityMiddleware(): RequestHandler[] {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: contentSecurityPolicy() as Record<string, string[]>,
      },
      // Allow the SPA to load images/iframes it renders from the same origin.
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hsts: isProduction
        ? { maxAge: 63_072_000, includeSubDomains: true, preload: false }
        : false,
    }),
    // The app owns its own CSRF story below; cookie parsing stays manual.
    (req, res, next) => {
      res.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=()"
      );
      req.headers["x-request-id"] ??= crypto.randomUUID();
      res.setHeader("X-Request-Id", String(req.headers["x-request-id"]));
      next();
    },
  ];
}

/**
 * CSRF defence for state-changing requests.
 *
 * For cookie-authenticated apps the combination of SameSite=Lax and this
 * Origin check is sufficient under current browser behaviour, and it costs
 * nothing. `Authorization: Bearer` clients are exempt because they cannot be
 * driven by a cross-site form post (no ambient credential).
 */
export function requireSameOrigin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }
    if (typeof req.headers.authorization === "string") return next();

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // Same-origin fetch from a modern browser always sends Origin.
    if (!origin && !referer) {
      // Non-browser client (curl, server-to-server). Bearer tokens are exempt
      // above; a cookie-bearing request with no Origin is suspicious.
      const hasSessionCookie = (req.headers.cookie ?? "").includes("app_session_id=");
      if (hasSessionCookie) {
        return res.status(403).json({ error: "Cross-site request rejected" });
      }
      return next();
    }

    const expected = new Set<string>([ENV.APP_ORIGIN]);
    const host = req.headers.host;
    if (host) {
      expected.add(`https://${host}`);
      expected.add(`http://${host}`);
    }

    const candidate = origin ?? (referer ? safeOrigin(referer) : undefined);
    if (!candidate || !expected.has(candidate)) {
      logger.warn("Blocked cross-origin mutation", { candidate, path: req.path });
      return res.status(403).json({ error: "Cross-site request rejected" });
    }
    return next();
  };
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * Rate limits. Two tiers:
 *  • api   — generous, protects against runaway clients and scraping.
 *  • auth  — tight, protects credentials from stuffing.
 * Multi-instance deployments must move these to a shared store (Redis) or the
 * effective limit multiplies by the number of instances.
 */
export function rateLimiters() {
  const api = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, slow down." },
  });

  const auth = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many attempts. Try again in a few minutes." },
  });

  const upload = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many uploads, slow down." },
  });

  const webhook = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  return { api, auth, upload, webhook };
}

/**
 * Sliding-window attempt tracker for credential endpoints.
 *
 * In-memory on purpose: it exists to blunt online guessing on a single
 * instance. For horizontal scaling, swap the Map for Redis (`INCR` + `EXPIRE`).
 * Keys are normalised so "  Foo@Example.com " cannot bypass the counter.
 */
export class AttemptTracker {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly options: { max: number; windowMs: number; lockoutMs?: number }
  ) {}

  key(...parts: (string | undefined)[]): string {
    return parts.filter(Boolean).join(":").trim().toLowerCase();
  }

  /** True when the key is currently locked out. */
  isLocked(key: string, now = Date.now()): boolean {
    const times = this.hits.get(key) ?? [];
    const windowStart = now - this.options.windowMs;
    const recent = times.filter((t) => t > windowStart);
    if (recent.length !== times.length) this.hits.set(key, recent);
    if (recent.length < this.options.max) return false;
    const lockoutMs = this.options.lockoutMs ?? this.options.windowMs;
    const newest = recent[recent.length - 1] ?? 0;
    return now - newest < lockoutMs;
  }

  recordFailure(key: string, now = Date.now()): void {
    const times = this.hits.get(key) ?? [];
    times.push(now);
    const windowStart = now - this.options.windowMs;
    this.hits.set(
      key,
      times.filter((t) => t > windowStart)
    );
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Test/maintenance helper: drop every bucket. */
  clear(): void {
    this.hits.clear();
  }

  get size(): number {
    return this.hits.size;
  }
}

/** 5 failed sign-ins per email+IP per 15 minutes, then a 15 minute lockout. */
export const loginAttempts = new AttemptTracker({
  max: 5,
  windowMs: 15 * 60_000,
  lockoutMs: 15 * 60_000,
});

/** Password resets are cheaper to spam than to abuse, but still bounded. */
export const passwordResetAttempts = new AttemptTracker({
  max: 3,
  windowMs: 60 * 60_000,
  lockoutMs: 60 * 60_000,
});

/**
 * Terminal error handler. Shape: `{ error: string, code?: string, requestId }`.
 * Never leaks stack traces or driver errors to the client; full detail goes to
 * the log with the request id so support can correlate.
 */
export function errorHandler(): (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (err, req, res, _next) => {
    const requestId = String(req.headers["x-request-id"] ?? "");
    const isApp = err instanceof AppError;

    if (!isApp) {
      logger.error("Unhandled request error", {
        requestId,
        path: req.path,
        method: req.method,
        error: err instanceof Error ? err : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    const status = isApp ? err.statusCode : 500;
    res.status(status).json({
      error: isApp ? err.message : "Something went wrong on our end.",
      ...(isApp && err.code ? { code: err.code } : {}),
      requestId,
    });
  };
}
