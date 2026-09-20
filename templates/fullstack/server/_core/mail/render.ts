/**
 * Email rendering primitives: HTML escaping, the shared shell, and the
 * legally-required footer.
 *
 * Kept separate from both the driver (`index.ts`) and the templates
 * (`templates.ts`) so that neither has to import the other — a cycle here would
 * only show up as an `undefined is not a function` at 3am when a password reset
 * fails.
 */
import { ENV } from "../env";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type MailKind = "transactional" | "marketing";

export type EmailBody = {
  heading: string;
  paragraphs?: string[];
  cta?: { label: string; url: string };
  footerNote?: string;
};

/**
 * Footer required by CAN-SPAM §7704(a)(5) (valid physical postal address) and
 * expected under e-Privacy: sender identity plus a working unsubscribe for
 * anything commercial.
 */
function htmlFooter(kind: MailKind, unsubscribeUrl?: string): string {
  const identity = `${escapeHtml(ENV.OWNER_LEGAL_NAME)}${
    ENV.OWNER_ADDRESS ? ` · ${escapeHtml(ENV.OWNER_ADDRESS)}` : ""
  }`;
  const unsubscribe =
    kind === "marketing" && unsubscribeUrl
      ? `<p style="margin:8px 0"><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a> — one click, no sign-in required.</p>`
      : "";

  return `<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0" />
<p style="color:#666;font-size:12px;line-height:1.5;margin:0">
${identity}<br />
${unsubscribe}
You received this because you have an account at ${escapeHtml(ENV.APP_NAME)}.
${kind === "marketing" ? "You opted in to product updates and can opt out at any time." : ""}
</p>`;
}

function textFooter(kind: MailKind, unsubscribeUrl?: string): string {
  const lines = [
    "",
    "—",
    ENV.OWNER_LEGAL_NAME,
    ENV.OWNER_ADDRESS,
    `You received this because you have an account at ${ENV.APP_NAME}.`,
  ];
  if (kind === "marketing" && unsubscribeUrl) {
    lines.push(`Unsubscribe (one click, no sign-in required): ${unsubscribeUrl}`);
  }
  return lines.filter(Boolean).join("\n");
}

export function renderEmail(
  body: EmailBody,
  options: { kind?: MailKind; unsubscribeUrl?: string } = {}
): { html: string; text: string } {
  const kind = options.kind ?? "transactional";
  const paragraphs = body.paragraphs ?? [];

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
  <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(body.heading)}</h1>
  ${paragraphs.map((p) => `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">${escapeHtml(p)}</p>`).join("\n  ")}
  ${
    body.cta
      ? `<p style="margin:24px 0"><a href="${escapeHtml(body.cta.url)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;display:inline-block">${escapeHtml(body.cta.label)}</a></p>
  <p style="font-size:12px;color:#666">If the button does not work, paste this into your browser:<br /><span style="word-break:break-all">${escapeHtml(body.cta.url)}</span></p>`
      : ""
  }
  ${body.footerNote ? `<p style="font-size:12px;color:#666">${escapeHtml(body.footerNote)}</p>` : ""}
  ${htmlFooter(kind, options.unsubscribeUrl)}
</div>`;

  const text = [
    body.heading,
    "",
    ...paragraphs,
    ...(body.cta ? ["", `${body.cta.label}: ${body.cta.url}`] : []),
    ...(body.footerNote ? ["", body.footerNote] : []),
    textFooter(kind, options.unsubscribeUrl),
  ].join("\n");

  return { html, text };
}
