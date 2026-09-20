/**
 * Request authentication.
 *
 * Two accepted credential forms:
 *  1. `app_session_id` cookie — what the browser uses.
 *  2. `Authorization: Bearer <token>` — for CLI/native/API clients.
 *
 * Deliberately NOT accepted: tokens read out of `localStorage`/`sessionStorage`.
 * A browser-stored bearer token is reachable by any XSS payload; the httpOnly
 * cookie is not. Do not add that shortcut back.
 */
import type { Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import type { User } from "../../../drizzle/schema";
import { resolveSession, touchSession } from "./sessions";

export type Auth = {
  user: User;
  sessionId: number;
};

export function readSessionToken(req: Request): string | undefined {
  const fromCookie = parseCookieHeader(req.headers.cookie ?? "")[COOKIE_NAME];
  if (fromCookie) return fromCookie;

  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    return token.length > 0 ? token : undefined;
  }
  return undefined;
}

/** Returns null (never throws) when the request has no valid session. */
export async function authenticateRequest(req: Request): Promise<Auth | null> {
  const token = readSessionToken(req);
  if (!token) return null;

  const resolved = await resolveSession(token);
  if (!resolved) return null;

  touchSession(resolved.sessionId);
  return resolved;
}

export * from "./password";
export * from "./sessions";
export * from "./tokens";
export * from "./auth-tokens";
export * from "./users";
export * from "./providers";
export * from "./state";
