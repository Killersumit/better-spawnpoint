/**
 * tRPC request context.
 *
 * Everything a procedure may need about the caller. Built once per request by
 * `createContext`; extend it here rather than reaching for `req` inside
 * procedures (except when you genuinely need a header or the raw response).
 */
import { randomUUID } from "node:crypto";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { authenticateRequest } from "./auth";
import { clientIp, requestOrigin } from "./cookies";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  /** Full user row. Public shapes go through `toPublicUser()`. */
  user: User | null;
  sessionId: number | null;
  requestId: string;
  ip: string | undefined;
  userAgent: string | undefined;
  origin: string;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const { req, res } = opts;

  let user: User | null = null;
  let sessionId: number | null = null;

  try {
    const auth = await authenticateRequest(req);
    if (auth) {
      user = auth.user;
      sessionId = auth.sessionId;
    }
  } catch {
    // Authentication is optional for public procedures — a DB outage must not
    // make the marketing site unreachable.
    user = null;
  }

  return {
    req,
    res,
    user,
    sessionId,
    requestId:
      (typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined) ??
      randomUUID(),
    ip: clientIp(req),
    userAgent:
      typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"].slice(0, 500)
        : undefined,
    origin: requestOrigin(req),
  };
}
