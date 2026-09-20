/**
 * tRPC primitives.
 *
 * Use:
 *   publicProcedure     anything, no session required
 *   authedProcedure     requires a signed-in user; `ctx.user` is non-null
 *   adminProcedure      requires `ctx.user.role === "admin"`
 *
 * Add `.input(zodSchema)` to every procedure that takes arguments, and
 * `.output(zodSchema)` on anything that returns user-visible data you want
 * locked down. Inputs are the security boundary: never read `input` fields the
 * schema does not declare, and never trust a client-supplied `userId`.
 */
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { AppError } from "@shared/errors";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { TrpcContext } from "./context";
import { logger } from "./logger";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        // Only surface validation details and app-level codes to the client.
        zod: error.code === "BAD_REQUEST" && cause instanceof ZodError
          ? cause.flatten()
          : undefined,
        appCode: cause instanceof AppError ? cause.code : undefined,
      },
    };
  },
});

export const router = t.router;
export const middleware = t.middleware;

/** Maps AppError (our HTTP-shaped errors) onto the matching tRPC code. */
const errorMapping = middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof AppError) {
      const code =
        error.statusCode === 400
          ? "BAD_REQUEST"
          : error.statusCode === 401
            ? "UNAUTHORIZED"
            : error.statusCode === 403
              ? "FORBIDDEN"
              : error.statusCode === 404
                ? "NOT_FOUND"
                : error.statusCode === 409
                  ? "CONFLICT"
                  : error.statusCode === 413
                    ? "PAYLOAD_TOO_LARGE"
                    : error.statusCode === 429
                      ? "TOO_MANY_REQUESTS"
                      : error.statusCode === 503
                        ? "SERVICE_UNAVAILABLE"
                        : "INTERNAL_SERVER_ERROR";
      throw new TRPCError({ code, message: error.message, cause: error });
    }
    throw error;
  }
});

/** Adds a request id + duration log line. Cheap, and priceless when debugging. */
const observability = middleware(async ({ ctx, path, type, next }) => {
  const startedAt = Date.now();
  const result = await next();
  const durationMs = Date.now() - startedAt;

  const log = logger.with({ requestId: ctx.requestId, path, type });
  if (!result.ok) {
    log.error("procedure failed", {
      durationMs,
      code: result.error.code,
      message: result.error.message,
      userId: ctx.user?.id,
    });
  } else if (durationMs > 1500) {
    log.warn("slow procedure", { durationMs, userId: ctx.user?.id });
  }

  return result;
});

const requireUser = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (ctx.user.status === "suspended") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This account is suspended.",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const requireAdmin = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * `publicProcedure` still runs error mapping and request logging — a public
 * procedure is not an unobserved one. Build on these three only; adding a raw
 * `t.procedure.use(...)` chain in a router is how error shapes drift.
 */
export const publicProcedure = t.procedure.use(errorMapping).use(observability);
export const authedProcedure = publicProcedure.use(requireUser);
export const adminProcedure = publicProcedure.use(requireAdmin);
