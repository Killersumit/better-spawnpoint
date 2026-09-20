/**
 * Transactional email with pluggable drivers.
 *
 *   console  → prints the message (dev default; nothing leaves the machine)
 *   resend   → https://resend.com  (REST, no SDK)
 *   webhook  → POST JSON to your own sender/queue
 *
 * Compliance rules baked in (see docs/legal/EMAIL-COMPLIANCE.md):
 *  • Every message carries the sender's legal name and postal address
 *    (CAN-SPAM §7704(a)(5), EU e-Privacy best practice).
 *  • Marketing messages additionally carry a working one-click unsubscribe that
 *    does not require a sign-in.
 *  • Transactional messages (verify, reset, receipt) must never include
 *    promotional content — mixing them is what turns them into "commercial
 *    electronic mail" and drags them into consent scope.
 *  • `sendMail` never throws for a delivery failure on a non-critical path:
 *    it returns `{ delivered: false }` and logs, so a mail outage cannot take
 *    down sign-up. Callers decide whether that matters.
 */
import { randomUUID } from "node:crypto";
import { ENV, isProduction } from "../env";
import { logger } from "../logger";
import type { MailKind } from "./render";

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** "transactional" (default) or "marketing" — controls the footer. */
  kind?: MailKind;
  /** One-click unsubscribe URL. Required for `kind: "marketing"`. */
  unsubscribeUrl?: string;
  replyTo?: string;
};

export type MailResult =
  | { delivered: true; id: string; driver: string }
  | { delivered: false; error: string; driver: string };

export type SentMail = MailMessage & { id: string; sentAt: string; to: string };

// ── Dev mailbox ──────────────────────────────────────────────────────────────
// In-memory ring buffer so tests (and the dev-only GET /api/dev/mailbox route)
// can read what would have been sent. Never populated in production.
const devMailbox: SentMail[] = [];
const DEV_MAILBOX_LIMIT = 50;

export function getDevMailbox(): readonly SentMail[] {
  return devMailbox;
}

export function clearDevMailbox(): void {
  devMailbox.length = 0;
}

function remember(message: MailMessage, id: string): void {
  if (isProduction) return;
  devMailbox.unshift({ ...message, id, sentAt: new Date().toISOString(), to: message.to });
  if (devMailbox.length > DEV_MAILBOX_LIMIT) devMailbox.length = DEV_MAILBOX_LIMIT;
}

// ── Drivers ──────────────────────────────────────────────────────────────────

type Driver = (message: MailMessage) => Promise<{ id: string }>;

function fromAddress(): string {
  return ENV.MAIL_FROM;
}

const consoleDriver: Driver = async (message) => {
  const id = `console-${randomUUID().slice(0, 8)}`;
  logger.info("mail (console driver, not actually sent)", {
    id,
    to: message.to,
    subject: message.subject,
    unsubscribeUrl: message.unsubscribeUrl,
  });
  // Kept visible in dev so the link is one click away in the terminal.
  console.log(`\n─── email ───────────────────────────────────────────────
To:      ${message.to}
From:    ${fromAddress()}
Subject: ${message.subject}
${message.unsubscribeUrl ? `Unsub:   ${message.unsubscribeUrl}\n` : ""}${message.text}
──────────────────────────────────────────────────────────\n`);
  return { id };
};

const resendDriver: Driver = async (message) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ENV.MAIL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ?? ENV.MAIL_REPLY_TO
        ? { reply_to: message.replyTo ?? ENV.MAIL_REPLY_TO }
        : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`resend responded ${response.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as { id?: string };
  return { id: data.id ?? `resend-${randomUUID().slice(0, 8)}` };
};

const webhookDriver: Driver = async (message) => {
  const response = await fetch(ENV.MAIL_WEBHOOK_URL ?? "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromAddress(),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      kind: message.kind ?? "transactional",
      unsubscribeUrl: message.unsubscribeUrl,
    }),
  });
  if (!response.ok) {
    throw new Error(`mail webhook responded ${response.status}`);
  }
  return { id: `webhook-${randomUUID().slice(0, 8)}` };
};

function driver(): Driver {
  if (ENV.MAIL_DRIVER === "resend") return resendDriver;
  if (ENV.MAIL_DRIVER === "webhook") return webhookDriver;
  return consoleDriver;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (message.kind === "marketing" && !message.unsubscribeUrl) {
    // Fail loudly in development; never send non-compliant marketing mail.
    throw new Error(
      "Marketing email requires an unsubscribeUrl (CAN-SPAM / e-Privacy)."
    );
  }

  const active = driver();
  try {
    const { id } = await active(message);
    remember(message, id);
    logger.info("mail sent", { id, driver: active.name || ENV.MAIL_DRIVER, to: message.to });
    return { delivered: true, id, driver: ENV.MAIL_DRIVER };
  } catch (error) {
    logger.error("mail failed", { error: String(error), to: message.to });
    return { delivered: false, error: String(error), driver: ENV.MAIL_DRIVER };
  }
}

export * from "./templates";
export * from "./render";
