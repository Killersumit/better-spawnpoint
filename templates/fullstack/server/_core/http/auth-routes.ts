/**
 * OAuth 2.0 REST endpoints (they must be real redirects, so they cannot be
 * tRPC procedures):
 *
 *   GET /api/auth/oauth/:provider/start     → 302 to the provider
 *   GET /api/auth/oauth/callback            → exchange code, set session, 302 home
 *
 * Flow details worth not re-inventing:
 *  • PKCE (S256) for providers that support it; the verifier travels inside the
 *    signed `state`, so nothing needs server-side storage between the two legs.
 *  • The `__Host-oauth_state` cookie carries a nonce that must match the state,
 *    which is the actual CSRF defence. See auth/state.ts.
 *  • Account linking is by verified email. An unverified provider email never
 *    links to an existing account — that is the account-takeover vector.
 *  • New accounts respect AUTH_SIGNUP_MODE, so an invite-only instance stays
 *    invite-only no matter which button someone clicks.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { ROUTES } from "@shared/const";
import { oauthAccounts, users } from "../../../drizzle/schema";
import { getDb, requireDb } from "../db";
import { ENV, isProduction } from "../env";
import { logger } from "../logger";
import { clientIp } from "../cookies";
import { sessionCookie } from "../cookies";
import { audit } from "../audit";
import { createSession } from "../auth/sessions";
import { normalizeEmail, toPublicUser } from "../auth/users";
import {
  buildAuthorizeUrl,
  enabledProviders,
  exchangeCode,
  getProvider,
  redirectUriFor,
  type NormalizedProfile,
  type ProviderId,
} from "../auth/providers";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_VERIFIER_COOKIE } from "@shared/const";
import {
  decodeOAuthState,
  encodeOAuthState,
  readStateCookie,
  safeReturnTo,
  stateCookieOptions,
} from "../auth/state";

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function registerOAuthRoutes(app: Express): void {
  /**
   * Step 1: start the flow. This is a GET so a normal link or button works, but
   * it has side effects (it mints the state cookie), so the UI must only call
   * it from a click handler — never during render.
   */
  app.get("/api/auth/oauth/:provider/start", async (req: Request, res: Response) => {
    const providerId = req.params.provider as ProviderId;

    let provider;
    try {
      provider = getProvider(providerId);
    } catch {
      res.status(404).json({ error: "Unknown or unconfigured sign-in provider." });
      return;
    }

    const returnTo = safeReturnTo(req.query.returnTo);
    const redirectUri = redirectUriFor(originFor(req));
    const nonce = base64Url(randomBytes(16));
    const { verifier, challenge } = pkcePair();

    const state = await encodeOAuthState({
      redirectUri,
      nonce,
      provider: provider.id,
      ...(returnTo ? { returnTo } : {}),
    });

    // The PKCE verifier travels in its own httpOnly cookie rather than inside
    // `state`: a state string that leaks (referrer, logs, shoulder-surf) then
    // still cannot be used to complete the exchange on its own.
    res.cookie(OAUTH_STATE_VERIFIER_COOKIE, verifier, stateCookieOptions());
    res.cookie(OAUTH_STATE_COOKIE, nonce, stateCookieOptions());

    const url = buildAuthorizeUrl(provider, {
      redirectUri,
      state,
      codeChallenge: challenge,
    });

    res.redirect(302, url);
  });

  /**
   * Step 2: the provider redirects back here.
   * Every failure path lands on /login with a reason, never on a JSON error
   * page: a user who just failed to sign in needs a way forward.
   */
  app.get("/api/auth/oauth/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const stateParam = typeof req.query.state === "string" ? req.query.state : undefined;

    if (!code || !stateParam) {
      return failLogin(res, "missing_code");
    }

    const state = await decodeOAuthState(stateParam);
    if (!state) return failLogin(res, "invalid_state");

    // CSRF check: the nonce must match the cookie this browser received.
    const cookieNonce = readStateCookie(req);
    if (!cookieNonce || cookieNonce !== state.nonce) {
      logger.warn("OAuth state/nonce mismatch", { provider: state.provider });
      return failLogin(res, "state_mismatch");
    }

    const verifier = req.cookies?.[OAUTH_STATE_VERIFIER_COOKIE] as string | undefined;
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
    res.clearCookie(OAUTH_STATE_VERIFIER_COOKIE, { path: "/" });

    try {
      const provider = getProvider(state.provider);
      const accessToken = await exchangeCode(provider, {
        code,
        redirectUri: state.redirectUri,
        ...(verifier ? { codeVerifier: verifier } : {}),
      });
      const profile = await provider.fetchProfile(accessToken);

      const db = requireDb();
      const userId = await resolveOAuthUser(db, profile);

      const session = await createSession(userId, {
        userAgent: req.headers["user-agent"]?.slice(0, 500),
        ip: clientIp(req),
      });
      const cookie = sessionCookie(req, session.token);
      res.cookie(cookie.name, cookie.value, cookie.options);

      await audit({
        actorUserId: userId,
        action: "auth.login",
        targetType: "user",
        targetId: String(userId),
        metadata: { provider: profile.provider },
        ip: clientIp(req),
      });

      // Only same-origin paths are honoured (safeReturnTo already checked the
      // value before signing it, but re-check here: the signature protects
      // integrity, not policy).
      const destination = safeReturnTo(state.returnTo) ?? ROUTES.home;
      res.redirect(302, destination);
    } catch (error) {
      logger.error("OAuth callback failed", { error: String(error) });
      return failLogin(res, "provider_error");
    }
  });

  /** Public list so a static page can render the right buttons. */
  app.get("/api/auth/providers", (_req: Request, res: Response) => {
    res.json({ providers: enabledProviders(), signupMode: ENV.AUTH_SIGNUP_MODE });
  });
}

function failLogin(res: Response, reason: string): void {
  res.redirect(302, `${ROUTES.login}?error=${encodeURIComponent(reason)}`);
}

/**
 * The origin used to build the redirect URI. It must be the same value at
 * authorize and token time, and it must be OUR origin — never a
 * client-supplied one, which would be an open-redirect plus a token leak.
 */
function originFor(req: Request): string {
  if (isProduction && process.env.TRUST_PROXY_ORIGIN !== "true") {
    return ENV.APP_ORIGIN;
  }
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  if (host) return `${proto ?? req.protocol}://${host}`;
  return ENV.APP_ORIGIN;
}

/**
 * Map a provider profile to a local user id, linking or creating as needed.
 *
 * Order matters:
 *  1. An existing link wins (the provider account id is immutable).
 *  2. Otherwise link by *verified* email to an existing local account.
 *  3. Otherwise create — if and only if the signup mode allows it.
 */
async function resolveOAuthUser(
  db: NonNullable<ReturnType<typeof getDb>>,
  profile: NormalizedProfile
): Promise<number> {
  const linked = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.providerAccountId, profile.providerAccountId))
    .limit(1);

  if (linked[0]) return linked[0].userId;

  const email = profile.email ? normalizeEmail(profile.email) : null;

  if (email) {
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = existing[0];

    if (user) {
      if (user.status === "suspended") {
        throw new Error("Account suspended");
      }
      if (user.deletedAt) {
        // Signing in again within the grace period cancels the deletion, the
        // same way the email link does.
        await db.update(users).set({ deletedAt: null }).where(eq(users.id, user.id));
      }
      await db.insert(oauthAccounts).values({
        userId: user.id,
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
        providerEmail: email,
      });
      return user.id;
    }
  }

  if (ENV.AUTH_SIGNUP_MODE !== "open") {
    throw new Error("Signups are restricted on this instance");
  }

  if (!email) {
    throw new Error("The provider returned no email address");
  }

  const inserted = await db
    .insert(users)
    .values({
      email,
      name: profile.name?.slice(0, 200) ?? null,
      image: profile.image ?? null,
      // Provider-verified email counts as verified, so we never ask twice.
      emailVerifiedAt: profile.emailVerified ? new Date() : null,
    })
    .$returningId();

  const userId = inserted[0]?.id;
  if (!userId) throw new Error("Could not create the account");

  await db.insert(oauthAccounts).values({
    userId,
    provider: profile.provider,
    providerAccountId: profile.providerAccountId,
    providerEmail: email,
  });

  await audit({
    actorUserId: userId,
    action: "user.create",
    targetType: "user",
    targetId: String(userId),
    metadata: { method: "oauth", provider: profile.provider },
  });

  logger.info("account created via OAuth", { userId, provider: profile.provider });
  return userId;
}

export const oauthHelpers = { toPublicUser };
