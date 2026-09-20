/**
 * Cookie policy in one place.
 *
 * Default posture: httpOnly + SameSite=Lax + Secure-when-https. That is correct
 * for a normal same-site app. Set COOKIE_SAMESITE=none ONLY when the app is
 * embedded in a third-party iframe (IDE/preview panes, partner embeds); it
 * forces Secure and drops the CSRF protection that Lax gives you for free,
 * which is why the origin check in security.ts still runs on every mutation.
 */
import type { CookieOptions, Request } from "express";
import { COOKIE_NAME, SESSION_TTL_MS } from "@shared/const";
import { ENV, isProduction } from "./env";

export function isSecureRequest(req: Request): boolean {
  if (req.protocol === "https") return true;
  const forwarded = req.headers["x-forwarded-proto"];
  const list = Array.isArray(forwarded) ? forwarded : (forwarded ?? "").split(",");
  return list.some((proto) => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "httpOnly" | "path" | "sameSite" | "secure"> {
  const sameSite = ENV.COOKIE_SAMESITE;
  return {
    httpOnly: true,
    path: "/",
    sameSite,
    // SameSite=None is only honoured with Secure; and Secure cookies are
    // dropped over plain http, so honour the explicit override for local https.
    secure: sameSite === "none" ? true : isSecureRequest(req) || ENV.COOKIE_SECURE === "true",
  };
}

/**
 * Cookie descriptors. Returned as objects rather than tuples because
 * `res.cookie(name, value, options)` takes three arguments while
 * `res.clearCookie(name, options)` takes two — a tuple spread silently breaks
 * the second one.
 */
export function sessionCookie(req: Request, token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    options: { ...getSessionCookieOptions(req), maxAge: SESSION_TTL_MS } as CookieOptions,
  };
}

export function clearedSessionCookie(req: Request) {
  return {
    name: COOKIE_NAME,
    options: { ...getSessionCookieOptions(req), maxAge: -1 } as CookieOptions,
  };
}

/** Client IP, trusting the first hop proxy header when present. */
export function clientIp(req: Request): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first || req.ip || undefined;
}

/** Best-effort origin for audit records; falls back to configured APP_ORIGIN. */
export function requestOrigin(req: Request): string {
  const proto = isSecureRequest(req) ? "https" : "http";
  const host = req.headers.host ?? new URL(ENV.APP_ORIGIN).host;
  return `${proto}://${host}`;
}

export const cookieFlags = { isProduction } as const;
