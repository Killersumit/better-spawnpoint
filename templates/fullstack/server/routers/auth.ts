/**
 * Authentication procedures.
 *
 * Security properties this file is responsible for:
 *  • No account enumeration: signup on an existing address and password reset
 *    for an unknown address answer the same way they would if the account did
 *    not exist. (Signup is the one exception, because the user must be told to
 *    sign in instead — we return a generic "cannot use that email" and email
 *    the real owner a heads-up.)
 *  • Per-account+IP attempt tracking with lockout, on top of the per-IP HTTP
 *    rate limit in security.ts.
 *  • Password change and reset revoke every session.
 *  • Every credential event lands in the audit log.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { AppError, BadRequestError } from "@shared/errors";
import { invitations, users } from "../../drizzle/schema";
import { getDb, requireDb } from "../_core/db";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";
import { loginAttempts, passwordResetAttempts } from "../_core/security";
import { clearedSessionCookie, sessionCookie } from "../_core/cookies";
import {
  createSession,
  listUserSessions,
  revokeAllSessions,
  revokeSessionById,
} from "../_core/auth/sessions";
import { consumeAuthToken, issueAuthToken } from "../_core/auth/auth-tokens";
import { hashPassword } from "../_core/auth/password";
import {
  createUser,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  normalizeEmail,
  recordSignIn,
  setPassword,
  toPublicUser,
  updateProfile,
} from "../_core/auth/users";
import { validatePassword, verifyPassword } from "../_core/auth/password";
import { mailLinks, passwordChangedTemplate, passwordResetTemplate, verifyEmailTemplate } from "../_core/mail/templates";
import { sendMail } from "../_core/mail";
import { authedProcedure, publicProcedure, router } from "../_core/trpc";
import { audit } from "../_core/audit";

const emailSchema = z
  .string()
  .trim()
  .min(3, "Enter your email address")
  .max(320)
  .email("That does not look like an email address");

const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(200);

/** Used for every reset path so the response never reveals whether the address exists. */
const GENERIC_RESET_MESSAGE =
  "If an account exists for that address, a reset link is on its way.";

export const authRouter = router({
  /** The current session's user in the public shape, or null when signed out. */
  me: publicProcedure.query(({ ctx }) => (ctx.user ? toPublicUser(ctx.user) : null)),

  /** Which sign-in methods this deployment offers, so the UI can render them. */
  providers: publicProcedure.query(() => {
    const providers: { id: string; label: string }[] = [];
    if (ENV.OAUTH_GOOGLE_CLIENT_ID && ENV.OAUTH_GOOGLE_CLIENT_SECRET) {
      providers.push({ id: "google", label: "Google" });
    }
    if (ENV.OAUTH_GITHUB_CLIENT_ID && ENV.OAUTH_GITHUB_CLIENT_SECRET) {
      providers.push({ id: "github", label: "GitHub" });
    }
    return { providers, signupMode: ENV.AUTH_SIGNUP_MODE };
  }),

  signup: publicProcedure
    .input(
      z.object({
        email: emailSchema,
        password: passwordSchema,
        name: z.string().trim().max(200).optional(),
        marketingOptIn: z.boolean().default(false),
        inviteToken: z.string().max(300).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ENV.AUTH_SIGNUP_MODE === "closed") {
        throw new AppError(
          403,
          "Signups are closed on this instance. Ask an administrator for an invitation.",
          undefined,
          "SIGNUP_CLOSED"
        );
      }

      const db = requireDb();
      const email = normalizeEmail(input.email);

      const problem = validatePassword(input.password);
      if (problem) throw new AppError(422, problem, undefined, "WEAK_PASSWORD");

      const existing = await findUserByEmail(email);
      if (existing) {
        await sendMail({
          to: email,
          subject: "Someone tried to create an account with your email",
          html: `<p>You already have an account with us, so no new one was created.</p>
<p>If that was you, sign in or reset your password instead. If it wasn't, you can ignore this message.</p>`,
          text: "You already have an account with us, so no new one was created. If that was you, sign in or reset your password instead.",
          kind: "transactional",
        });
        throw new AppError(
          409,
          "That email cannot be used to create a new account. Try signing in or resetting your password.",
          undefined,
          "SIGNUP_UNAVAILABLE"
        );
      }

      const invitation = await consumeInvitation(db, email, input.inviteToken);

      const user = await createUser({
        email,
        password: input.password,
        name: input.name ?? null,
        marketingOptIn: input.marketingOptIn,
        ...(invitation?.role ? { role: invitation.role } : {}),
      });

      const session = await createSession(user.id, {
        userAgent: ctx.userAgent,
        ip: ctx.ip,
      });
      const cookie = sessionCookie(ctx.req, session.token);
      ctx.res.cookie(cookie.name, cookie.value, cookie.options);

      const token = await issueAuthToken(db, {
        userId: user.id,
        email,
        kind: "email_verify",
        ttlMs: 24 * 60 * 60 * 1000,
      });
      await sendMail({
        to: email,
        ...verifyEmailTemplate({ name: user.name, url: mailLinks.verifyEmail(token) }),
      });

      await audit({
        actorUserId: user.id,
        action: "auth.signup",
        targetType: "user",
        targetId: String(user.id),
        metadata: { invited: Boolean(invitation) },
        ip: ctx.ip,
      });

      return { user: toPublicUser(user) };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: emailSchema,
        password: z.string().min(1, "Enter your password").max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const email = normalizeEmail(input.email);
      const key = loginAttempts.key(email, ctx.ip);

      if (loginAttempts.isLocked(key)) {
        throw new AppError(
          429,
          "Too many failed attempts for this account. Try again in a few minutes.",
          undefined,
          "ACCOUNT_LOCKED"
        );
      }

      const user = await findUserByEmail(email);
      const result = await verifyPassword(input.password, user?.passwordHash);

      if (!user || !result.ok) {
        loginAttempts.recordFailure(key);
        await audit({
          actorUserId: user?.id ?? null,
          action: "auth.login_failed",
          targetType: "user",
          targetId: user ? String(user.id) : null,
          ip: ctx.ip,
        });
        // Identical message for "no such user" and "wrong password".
        throw new AppError(
          401,
          "Email or password is incorrect.",
          undefined,
          "INVALID_CREDENTIALS"
        );
      }

      if (user.status === "suspended") {
        throw new AppError(403, "This account is suspended. Contact support.", undefined, "SUSPENDED");
      }
      if (user.deletedAt) {
        throw new AppError(
          403,
          "This account is scheduled for deletion. Contact support to restore it.",
          undefined,
          "PENDING_DELETION"
        );
      }

      loginAttempts.reset(key);

      // Transparent cost upgrade: happens at most once per user per policy change.
      if (result.needsRehash) {
        const { encoded } = await hashPassword(input.password);
        await requireDb().update(users).set({ passwordHash: encoded }).where(eq(users.id, user.id));
      }

      const session = await createSession(user.id, { userAgent: ctx.userAgent, ip: ctx.ip });
      const cookie = sessionCookie(ctx.req, session.token);
      ctx.res.cookie(cookie.name, cookie.value, cookie.options);
      await recordSignIn(user.id);
      await audit({
        actorUserId: user.id,
        action: "auth.login",
        targetType: "user",
        targetId: String(user.id),
        ip: ctx.ip,
      });

      return { user: toPublicUser(user) };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.user && ctx.sessionId) {
      await revokeSessionById(ctx.sessionId);
      await audit({ actorUserId: ctx.user.id, action: "auth.logout", ip: ctx.ip });
    }
    const cleared = clearedSessionCookie(ctx.req);
    ctx.res.clearCookie(cleared.name, cleared.options);
    return { success: true } as const;
  }),

  requestPasswordReset: publicProcedure
    .input(z.object({ email: emailSchema }))
    .mutation(async ({ input, ctx }) => {
      const email = normalizeEmail(input.email);
      const key = passwordResetAttempts.key(email);

      if (passwordResetAttempts.isLocked(key)) {
        // Same response as the success path: the throttle must not become an
        // oracle for which addresses exist.
        return { message: GENERIC_RESET_MESSAGE };
      }
      passwordResetAttempts.recordFailure(key);

      const user = await findUserByEmail(email);
      if (user && !user.deletedAt && user.status === "active") {
        const db = requireDb();
        const token = await issueAuthToken(db, {
          userId: user.id,
          email,
          kind: "password_reset",
          ttlMs: 60 * 60 * 1000,
        });
        await sendMail({
          to: email,
          ...passwordResetTemplate({
            name: user.name,
            url: mailLinks.resetPassword(token),
          }),
        });
        await audit({
          actorUserId: user.id,
          action: "auth.password_reset_requested",
          ip: ctx.ip,
        });
      } else {
        logger.info("password reset requested for unknown or inactive address");
      }

      return { message: GENERIC_RESET_MESSAGE };
    }),

  resetPassword: publicProcedure
    .input(z.object({ token: z.string().min(20).max(300), password: passwordSchema }))
    .mutation(async ({ input, ctx }) => {
      const db = requireDb();
      const problem = validatePassword(input.password);
      if (problem) throw new AppError(422, problem, undefined, "WEAK_PASSWORD");

      const row = await consumeAuthToken(db, input.token, "password_reset");
      if (!row?.userId) {
        throw BadRequestError("That reset link is invalid or has expired.");
      }

      await setPassword(row.userId, input.password);
      // A reset means "I lost control of this account": sign out everything.
      await revokeAllSessions(row.userId);

      const user = await findUserById(row.userId);
      if (user) {
        await sendMail({
          to: user.email,
          ...passwordChangedTemplate({ name: user.name }),
        });
      }

      await audit({
        actorUserId: row.userId,
        action: "auth.password_reset",
        targetType: "user",
        targetId: String(row.userId),
        ip: ctx.ip,
      });

      return { success: true } as const;
    }),

  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(20).max(300) }))
    .mutation(async ({ input }) => {
      const db = requireDb();
      const row = await consumeAuthToken(db, input.token, "email_verify");
      if (!row?.userId) {
        throw BadRequestError("That confirmation link is invalid or has expired.");
      }
      await markEmailVerified(row.userId);
      return { success: true } as const;
    }),

  resendVerification: authedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.emailVerifiedAt) {
      return { message: "Your email address is already confirmed." };
    }
    const db = requireDb();
    const token = await issueAuthToken(db, {
      userId: ctx.user.id,
      email: ctx.user.email,
      kind: "email_verify",
      ttlMs: 24 * 60 * 60 * 1000,
    });
    await sendMail({
      to: ctx.user.email,
      ...verifyEmailTemplate({ name: ctx.user.name, url: mailLinks.verifyEmail(token) }),
    });
    return { message: "Confirmation email sent. Check your inbox." };
  }),

  /** Devices holding an active session. Rendered by the settings page. */
  sessions: authedProcedure.query(async ({ ctx }) => {
    const rows = await listUserSessions(ctx.user.id);
    return rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      current: row.id === ctx.sessionId,
    }));
  }),

  /** "Sign out everywhere else" — the payoff of server-side sessions. */
  revokeOtherSessions: authedProcedure.mutation(async ({ ctx }) => {
    const revoked = await revokeAllSessions(ctx.user.id, ctx.sessionId ?? undefined);
    await audit({
      actorUserId: ctx.user.id,
      action: "auth.sessions_revoked",
      metadata: { count: revoked },
      ip: ctx.ip,
    });
    return { revoked };
  }),

  updateProfile: authedProcedure
    .input(
      z.object({
        name: z.string().trim().max(200).nullable().optional(),
        marketingOptIn: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const updated = await updateProfile(ctx.user.id, input);
      return { user: toPublicUser(updated) };
    }),

  /**
   * Change password while signed in. Requires the current password even though
   * the session is already authenticated: it is what stops a stolen session
   * from locking the real owner out.
   */
  changePassword: authedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1).max(200),
        newPassword: passwordSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const verified = await verifyPassword(input.currentPassword, ctx.user.passwordHash);
      if (!verified.ok) {
        throw new AppError(401, "Your current password is incorrect.", undefined, "INVALID_CREDENTIALS");
      }
      if (input.currentPassword === input.newPassword) {
        throw new AppError(422, "Choose a password you have not used here before.", undefined, "SAME_PASSWORD");
      }

      const problem = validatePassword(input.newPassword);
      if (problem) throw new AppError(422, problem, undefined, "WEAK_PASSWORD");

      await setPassword(ctx.user.id, input.newPassword);
      // Keep this device signed in, sign out the rest.
      await revokeAllSessions(ctx.user.id, ctx.sessionId ?? undefined);

      await sendMail({
        to: ctx.user.email,
        ...passwordChangedTemplate({ name: ctx.user.name }),
      });
      await audit({
        actorUserId: ctx.user.id,
        action: "auth.password_changed",
        ip: ctx.ip,
      });

      return { success: true } as const;
    }),
});

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Invite-only signup gate.
 *
 * An invitation is two rows: an `invitations` row (email + role + expiry, what
 * an admin manages) and an `authTokens` row of kind "invite" (the single-use
 * secret that went into the email link). Both must agree on the address, which
 * is what stops an invited user from inviting themselves as an admin.
 *
 * Returns null when signup is open, so the caller can treat it as optional.
 */
async function consumeInvitation(
  db: NonNullable<ReturnType<typeof getDb>>,
  email: string,
  inviteToken: string | undefined
): Promise<{ role: "user" | "admin" } | null> {
  if (ENV.AUTH_SIGNUP_MODE !== "invite") return null;

  if (!inviteToken) {
    throw new AppError(
      403,
      "This instance is invite-only. Open the link from your invitation email.",
      undefined,
      "INVITE_REQUIRED"
    );
  }

  const tokenRow = await consumeAuthToken(db, inviteToken, "invite");
  if (!tokenRow || (tokenRow.email ?? "").toLowerCase() !== email) {
    throw new AppError(
      403,
      "That invitation is invalid, already used, or was issued to a different address.",
      undefined,
      "INVITE_REQUIRED"
    );
  }

  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.email, email), isNull(invitations.acceptedAt)))
    .limit(1);

  const invitation = rows[0] ?? null;

  await db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(eq(invitations.email, email));

  return { role: invitation?.role ?? "user" };
}
