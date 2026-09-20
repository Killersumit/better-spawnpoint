/**
 * HTTP-shaped errors that can cross the tRPC boundary.
 *
 * Rules (see CONVENTIONS.md):
 *  • Never throw a bare `new Error()` from a procedure — the client cannot map
 *    it to an actionable message and it may leak internals.
 *  • Never include stack traces, SQL, or secrets in `message`; `message` is
 *    shown to users. Put diagnostics in `cause` and log them server-side.
 */

export type HttpStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 410
  | 413
  | 422
  | 429
  | 500
  | 502
  | 503;

export class AppError extends Error {
  readonly statusCode: HttpStatus;
  /** Stable machine-readable code for the UI, e.g. "RATE_LIMITED". */
  readonly code?: string;

  constructor(statusCode: HttpStatus, message: string, cause?: unknown, code?: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    if (cause !== undefined) this.cause = cause;
    if (code !== undefined) this.code = code;
  }
}

export const BadRequestError = (message: string, cause?: unknown) =>
  new AppError(400, message, cause, "BAD_REQUEST");

export const UnauthorizedError = (message = "Sign in required", cause?: unknown) =>
  new AppError(401, message, cause, "UNAUTHORIZED");

export const ForbiddenError = (message = "Not allowed", cause?: unknown) =>
  new AppError(403, message, cause, "FORBIDDEN");

export const NotFoundError = (message = "Not found", cause?: unknown) =>
  new AppError(404, message, cause, "NOT_FOUND");

export const ConflictError = (message: string, cause?: unknown) =>
  new AppError(409, message, cause, "CONFLICT");

export const PayloadTooLargeError = (message: string, cause?: unknown) =>
  new AppError(413, message, cause, "PAYLOAD_TOO_LARGE");

export const RateLimitError = (message = "Too many requests", cause?: unknown) =>
  new AppError(429, message, cause, "RATE_LIMITED");

export const ServiceUnavailableError = (message: string, cause?: unknown) =>
  new AppError(503, message, cause, "SERVICE_UNAVAILABLE");
