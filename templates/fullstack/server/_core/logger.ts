/**
 * Structured logging with automatic redaction.
 *
 * Why not `console.log`: logs end up in third-party aggregators, and the most
 * common compliance incident is a password, session token, or email address
 * sitting in plain text in a log line. `redact()` runs on every payload.
 *
 * Emits one JSON object per line in production (parseable by every log
 * shipper), and a readable line in development.
 */
import { isProduction } from "./env";

const REDACT_KEYS = [
  "password",
  "passwordhash",
  "newpassword",
  "currentpassword",
  "token",
  "tokenhash",
  "sessiontoken",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "secret",
  "sessionsecret",
  "crc",
  "cardnumber",
  "cvv",
];

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.replace(EMAIL_RE, "[redacted-email]").replace(BEARER_RE, "Bearer [redacted]");
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEYS.includes(key.toLowerCase().replace(/[_-]/g, ""))
        ? "[redacted]"
        : redactValue(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

type Level = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

function emit(level: Level, message: string, context?: LogContext) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(context ? (redactValue(context) as LogContext) : {}),
  };

  const line = isProduction
    ? JSON.stringify(payload)
    : `[${payload.ts.slice(11, 19)}] ${level.toUpperCase()} ${message}${
        context ? ` ${JSON.stringify(redactValue(context))}` : ""
      }`;

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => {
    if (!isProduction) emit("debug", msg, ctx);
  },
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
  /** Bind a request-scoped prefix, e.g. `logger.with({ requestId })`. */
  with(base: LogContext) {
    return {
      debug: (msg: string, ctx?: LogContext) => logger.debug(msg, { ...base, ...ctx }),
      info: (msg: string, ctx?: LogContext) => logger.info(msg, { ...base, ...ctx }),
      warn: (msg: string, ctx?: LogContext) => logger.warn(msg, { ...base, ...ctx }),
      error: (msg: string, ctx?: LogContext) => logger.error(msg, { ...base, ...ctx }),
    };
  },
};

/** Exported for unit tests. */
export const __test = { redactValue };
