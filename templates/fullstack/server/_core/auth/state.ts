/**
 * OAuth `state` handling — CSRF defense for the callback.
 *
 * Two independent checks must pass:
 *  1. The `state` parameter's HMAC signature must verify (tamper evidence).
 *  2. The nonce inside `state` must equal the value in the `__Host-oauth_state`
 *     cookie that THIS browser received when it started the flow.
 *
 * (2) is the one that actually blocks login CSRF: an attacker can forge a
 * `state` value but cannot plant a matching `__Host-` cookie in the victim's
 * browser. The `__Host-` prefix forbids a Domain attribute, so a sibling
 * subdomain cannot overwrite it either.
 */
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS } from "@shared/const";
import { SignJWT, jwtVerify } from "jose";
import type { Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import { ENV, isProduction } from "../env";

const ISSUER = "spawnpoint-oauth";
const AUDIENCE = "spawnpoint-oauth-state";

export type OAuthState = {
  redirectUri: string;
  nonce: string;
  /** Which provider this flow is for, so the callback cannot be replayed
   *  against a different provider. */
  provider: string;
  /** Deep link to return to after a successful sign-in. */
  returnTo?: string;
};

function secret(): Uint8Array {
  return new TextEncoder().encode(ENV.SESSION_SECRET ?? "");
}

export async function encodeOAuthState(state: OAuthState): Promise<string> {
  return new SignJWT({ ...state })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + OAUTH_STATE_TTL_MS) / 1000))
    .sign(secret());
}

export async function decodeOAuthState(
  token: string
): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    const { redirectUri, nonce, provider, returnTo } = payload as Record<string, unknown>;
    if (
      typeof redirectUri !== "string" ||
      typeof nonce !== "string" ||
      typeof provider !== "string"
    ) {
      return null;
    }
    return {
      redirectUri,
      nonce,
      provider,
      ...(typeof returnTo === "string" ? { returnTo } : {}),
    };
  } catch {
    return null;
  }
}

export function readStateCookie(req: Request): string | undefined {
  return parseCookieHeader(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
}

/**
 * Cookie attributes for the state cookie. Always Secure + Lax so it survives
 * the top-level redirect back from the provider. SameSite=Lax is sufficient
 * here because the cookie is only read on the GET callback.
 */
export function stateCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: isProduction || ENV.COOKIE_SECURE === "true",
    maxAge: OAUTH_STATE_TTL_MS,
  };
}

/**
 * Only allow returning to a same-origin path. Without this check, `returnTo`
 * becomes an open-redirect gadget that phishing campaigns love.
 */
export function safeReturnTo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  if (value.includes("\\") || value.includes("\n") || value.includes("\r")) {
    return undefined;
  }
  return value;
}
