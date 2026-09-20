/**
 * Environment loading and validation.
 *
 * Server-only. Never import this from client code — it reads secrets.
 *
 * Behaviour:
 *  • In production, invalid or missing required variables throw at boot. A
 *    container that starts with a broken config is worse than one that refuses
 *    to start (it silently 500s for real users).
 *  • In development, problems are collected and printed as warnings so you can
 *    start the app before configuring anything (the DB and mail layers degrade
 *    gracefully).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === "true" || v === "1");

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  APP_ORIGIN: z.string().default("http://localhost:3000"),
  APP_NAME: z.string().default("Your App"),
  OWNER_LEGAL_NAME: z.string().default("Your Company Ltd"),
  OWNER_EMAIL: z.string().default("privacy@example.com"),
  OWNER_ADDRESS: z.string().default(""),

  SESSION_SECRET: optionalString,
  CRON_SECRET: optionalString,

  DATABASE_URL: optionalString,

  AUTH_SIGNUP_MODE: z.enum(["open", "invite", "closed"]).default("open"),
  OAUTH_GOOGLE_CLIENT_ID: optionalString,
  OAUTH_GOOGLE_CLIENT_SECRET: optionalString,
  OAUTH_GITHUB_CLIENT_ID: optionalString,
  OAUTH_GITHUB_CLIENT_SECRET: optionalString,

  MAIL_DRIVER: z.enum(["console", "resend", "webhook"]).default("console"),
  MAIL_FROM: z.string().default("Your App <noreply@example.com>"),
  MAIL_REPLY_TO: optionalString,
  MAIL_API_KEY: optionalString,
  MAIL_WEBHOOK_URL: optionalString,

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/uploads"),
  STORAGE_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: bool.default(false),

  LLM_BASE_URL: optionalString,
  LLM_API_KEY: optionalString,
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  LLM_PROVIDER_LABEL: z.string().default("the model provider"),
  LLM_PROVIDER_URL: optionalString,

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,

  // Cookie posture. `lax` is correct for a same-site app. Switch to `none`
  // (which forces Secure) only when the app is embedded in a third-party
  // iframe, e.g. an IDE preview pane.
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),

  // Set to "true" to mark session cookies Secure on plain-HTTP localhost.
  // Leave unset in development.
  COOKIE_SECURE: optionalString,

  // Emergency hatch for demo and preview deployments that intentionally run
  // without a database or a mail provider. Without it, production refuses to
  // start on any warning — which is the behaviour you want for a real deploy.
  ALLOW_DEGRADED_BOOT: bool.default(false),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  /**
   * Problems are advisory unless marked fatal. Advisory ones are printed
   * everywhere; fatal ones stop a production boot. The distinction matters:
   * "no DATABASE_URL" is a supported degraded mode, while "STORAGE_DRIVER=s3
   * with no bucket" is a contradiction that would fail on the first upload.
   */
  const problems: { message: string; fatalInProduction: boolean }[] = [];

  if (!env.SESSION_SECRET) {
    // Ephemeral, random, and different on every boot. Sessions and one-time
    // tokens stop verifying on restart, which is exactly what should happen
    // when the secret was never configured — better than a fixed default that
    // would be identical on every clone of this template.
    env.SESSION_SECRET = randomBytes(32).toString("base64url");
    problems.push({
      message:
        "SESSION_SECRET is not set — using a random secret for this process only. " +
        "Sessions and email links will not survive a restart. Generate one with: " +
        'node -e "console.log(crypto.randomBytes(32).toString(\'base64url\'))"',
      fatalInProduction: true,
    });
  } else if (env.SESSION_SECRET.length < 32) {
    problems.push({
      message: `SESSION_SECRET is only ${env.SESSION_SECRET.length} characters — use at least 32.`,
      fatalInProduction: true,
    });
  }
  if (!env.DATABASE_URL) {
    problems.push({
      message: "DATABASE_URL is not set — the app will run in degraded mode (DB-backed routes answer 503).",
      fatalInProduction: false,
    });
  }
  if (env.AUTH_SIGNUP_MODE === "invite" && !env.DATABASE_URL) {
    problems.push({
      message: "AUTH_SIGNUP_MODE=invite requires a database — nobody can sign up.",
      fatalInProduction: true,
    });
  }
  if (env.STORAGE_DRIVER === "s3") {
    const missing = (
      ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const
    ).filter((k) => !env[k]);
    if (missing.length) {
      problems.push({
        message: `STORAGE_DRIVER=s3 but ${missing.join(", ")} not set — every upload would fail.`,
        fatalInProduction: true,
      });
    }
  }
  if (env.MAIL_DRIVER === "resend" && !env.MAIL_API_KEY) {
    problems.push({
      message: "MAIL_DRIVER=resend but MAIL_API_KEY is not set — verification email cannot be delivered.",
      fatalInProduction: true,
    });
  }
  if (env.MAIL_DRIVER === "webhook" && !env.MAIL_WEBHOOK_URL) {
    problems.push({
      message: "MAIL_DRIVER=webhook but MAIL_WEBHOOK_URL is not set.",
      fatalInProduction: true,
    });
  }
  if ((env.LLM_API_KEY && !env.LLM_BASE_URL) || (!env.LLM_API_KEY && env.LLM_BASE_URL)) {
    problems.push({
      message: "LLM_BASE_URL and LLM_API_KEY must be set together (or both unset).",
      fatalInProduction: true,
    });
  }
  if (!env.APP_ORIGIN.startsWith("http")) {
    problems.push({
      message: `APP_ORIGIN must be an absolute URL, got "${env.APP_ORIGIN}".`,
      fatalInProduction: true,
    });
  }

  // A production boot fails on contradictions, not on optional-feature notes.
  // Preview/demo deployments that genuinely want to run without a database set
  // ALLOW_DEGRADED_BOOT=true and accept the consequences explicitly.
  const fatal =
    env.NODE_ENV === "production" &&
    !env.ALLOW_DEGRADED_BOOT &&
    problems.some((problem) => problem.fatalInProduction);

  const report = problems.length
    ? `\n[env] configuration warnings:\n${problems.map((p) => `  • ${p.message}`).join("\n")}`
    : "";

  if (fatal) {
    throw new Error(`Refusing to start with this configuration.${report}`);
  }
  if (report && env.NODE_ENV !== "test") {
    console.warn(report);
  }

  return env;
}

export const ENV: Env = load();

/** ISO timestamp of process start — used by /api/health and job leases. */
export const BOOTED_AT = new Date();

export const isProduction = ENV.NODE_ENV === "production";
export const isTest = ENV.NODE_ENV === "test";
