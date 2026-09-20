/**
 * Shared constants: routes, cookies, storage keys, error sentinels.
 *
 * This file is imported by BOTH the client bundle and the server, so it must
 * stay free of Node-only and DOM-only APIs.
 */
/** Route table. Client router, footer, sitemap, and `npm run verify` all read this. */
export const ROUTES = {
  home: "/",

  // Auth
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",

  // Authenticated app
  dashboard: "/dashboard",
  settings: "/settings",

  // Admin (registered only when the user has the admin role)
  admin: "/admin",

  // 404 — rendered by the router for any unmatched path, and by the server for
  // unknown API routes (the client shows this page for unknown *page* routes).
  notFound: "/404",

  // Legal — every one of these must exist, be linked in the footer, and render
  // a policy document. `npm run verify` fails the build if one is missing.
  privacy: "/privacy",
  terms: "/terms",
  cookies: "/cookies",
  dpa: "/dpa",
  subprocessors: "/subprocessors",
  accessibility: "/accessibility",
  security: "/security",
  aiDisclosure: "/ai-disclosure",
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteKey];

/**
 * Routes reachable without a session. Everything not listed here is protected:
 * a new page is private by default, and making it public is a deliberate edit
 * (fail-closed, the opposite of the usual "forgot to add a guard" bug).
 */
export const PUBLIC_ROUTES: readonly RoutePath[] = [
  ROUTES.home,
  ROUTES.login,
  ROUTES.signup,
  ROUTES.forgotPassword,
  ROUTES.resetPassword,
  ROUTES.verifyEmail,
  ROUTES.privacy,
  ROUTES.terms,
  ROUTES.cookies,
  ROUTES.dpa,
  ROUTES.subprocessors,
  ROUTES.accessibility,
  ROUTES.security,
  ROUTES.aiDisclosure,
];

/**
 * Policy routes that must be linked from the footer. Kept separate so the
 * footer's link order is explicit rather than derived from object key order.
 */
export const POLICY_ROUTES: readonly RoutePath[] = [
  ROUTES.privacy,
  ROUTES.terms,
  ROUTES.cookies,
  ROUTES.dpa,
  ROUTES.subprocessors,
  ROUTES.accessibility,
  ROUTES.security,
  ROUTES.aiDisclosure,
];

/**
 * Authenticated routes, derived as the complement of `PUBLIC_ROUTES`. Used for
 * robots.txt, the sitemap, and for asserting in tests that no page was left
 * unguarded by accident.
 */
export const PRIVATE_ROUTES: readonly RoutePath[] = (Object.values(ROUTES) as RoutePath[]).filter(
  (route) => route !== ROUTES.notFound && !PUBLIC_ROUTES.includes(route)
);

export function isPublicRoute(path: string): boolean {
  if (path === ROUTES.home) return true;
  return PUBLIC_ROUTES.some((route) => route !== ROUTES.home && path.startsWith(route));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookies & sessions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session cookie.
 *
 * `__Host-` prefix is deliberately NOT used for the session: that prefix forbids
 * the Domain attribute and requires Path=/, which is what we want, but it also
 * makes the cookie unusable in local http development in some browsers' strict
 * modes. The OAuth-state cookie DOES use it, because that one is short-lived,
 * sensitive, and never needed cross-subdomain.
 */
export const COOKIE_NAME = "app_session_id";

/** CSRF nonce + PKCE verifier cookies for the OAuth flow. */
export const OAUTH_STATE_COOKIE = "__Host-oauth_state";
export const OAUTH_STATE_VERIFIER_COOKIE = "__Host-oauth_state_verifier";

/** 30 days. Long enough to be convenient, short enough to be revocable policy. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** OAuth round trip window: a user who wanders off mid-flow starts over. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** One-time tokens (email verification, password reset, invitations). */
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Days between "delete my account" and irreversible erasure. */
export const DELETION_GRACE_DAYS = 7;

/** Refresh the `lastUsedAt` on a session at most this often (avoids a write per request). */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Error sentinels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error messages that the client matches on. Kept as constants so a typo in one
 * place becomes a failing import instead of a silent behaviour difference.
 */
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
export const DB_UNAVAILABLE_ERR_MSG =
  "Database is not configured (10003). Set DATABASE_URL and run `npm run db:push`.";

// ─────────────────────────────────────────────────────────────────────────────
// REST API surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every non-tRPC HTTP endpoint, in one place.
 *
 * tRPC covers the application API; these exist because a third party has to
 * call them (OAuth redirects, cron trigger, webhooks) or because the response is
 * not JSON (file bytes, robots.txt). Server routes and client fetches both read
 * this object, so a path cannot be changed on one side only.
 */
export const API = {
  base: "/api",
  trpc: "/api/trpc",
  health: "/api/health",
  auth: "/api/auth",
  oauth: "/api/auth/oauth",
  providers: "/api/auth/providers",
  files: "/api/files",
  compliance: "/api/compliance",
  cron: "/api/cron",
  jobs: "/api/jobs",
  webhooks: "/api/webhooks",
  metrics: "/api/metrics",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Misc
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Accepted image types for avatar-style uploads. */
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
