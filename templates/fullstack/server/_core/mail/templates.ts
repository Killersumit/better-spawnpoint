/**
 * Message templates. One function per message type, each returning
 * `{ subject, html, text, kind }`.
 *
 * Rules:
 *  • Never interpolate unescaped user input into HTML — use `escapeHtml`.
 *  • Never put promotional content in a transactional template.
 *  • Link targets are built from APP_ORIGIN, never from a request header.
 */
import { ENV } from "../env";
import { escapeHtml, renderEmail } from "./render";

export type RenderedMail = {
  subject: string;
  html: string;
  text: string;
  kind: "transactional" | "marketing";
  unsubscribeUrl?: string;
};

function link(path: string): string {
  return `${ENV.APP_ORIGIN.replace(/\/$/, "")}${path}`;
}

export function verifyEmailTemplate(params: { name?: string | null; url: string }): RenderedMail {
  const greeting = params.name ? `Hi ${params.name},` : "Hi,";
  const body = renderEmail({
    heading: `Confirm your email address`,
    paragraphs: [
      greeting,
      `Please confirm this address so we can reach you about your ${ENV.APP_NAME} account.`,
      "This link expires in 24 hours and can only be used once.",
    ],
    cta: { label: "Confirm email", url: params.url },
    footerNote: "If you did not create an account, you can ignore this message.",
  });
  return { subject: `Confirm your email for ${ENV.APP_NAME}`, kind: "transactional", ...body };
}

export function passwordResetTemplate(params: { name?: string | null; url: string }): RenderedMail {
  const greeting = params.name ? `Hi ${params.name},` : "Hi,";
  const body = renderEmail({
    heading: "Reset your password",
    paragraphs: [
      greeting,
      "Someone asked to reset the password for this account.",
      "The link expires in 60 minutes and can only be used once. Choosing a new password signs you out of every other device.",
    ],
    cta: { label: "Choose a new password", url: params.url },
    footerNote:
      "If this wasn't you, no action is needed — your password has not changed. You can reply to this message to reach a human.",
  });
  return { subject: `Reset your ${ENV.APP_NAME} password`, kind: "transactional", ...body };
}

export function passwordChangedTemplate(params: { name?: string | null }): RenderedMail {
  const greeting = params.name ? `Hi ${params.name},` : "Hi,";
  const body = renderEmail({
    heading: "Your password was changed",
    paragraphs: [
      greeting,
      "Your password was just changed and all other sessions were signed out.",
      "If this wasn't you, reset your password immediately and contact us.",
    ],
    cta: { label: "Review your account", url: link("/settings") },
  });
  return { subject: `Your ${ENV.APP_NAME} password was changed`, kind: "transactional", ...body };
}

export function inviteTemplate(params: { invitedBy?: string | null; url: string }): RenderedMail {
  const body = renderEmail({
    heading: `You've been invited to ${ENV.APP_NAME}`,
    paragraphs: [
      params.invitedBy ? `${params.invitedBy} invited you to join.` : "You have been invited to join.",
      "This invitation expires in 7 days.",
    ],
    cta: { label: "Accept invitation", url: params.url },
  });
  return { subject: `You're invited to ${ENV.APP_NAME}`, kind: "transactional", ...body };
}

export function deletionScheduledTemplate(params: {
  scheduledFor: Date;
  cancelUrl: string;
}): RenderedMail {
  const date = params.scheduledFor.toISOString().slice(0, 10);
  const body = renderEmail({
    heading: "Your account is scheduled for deletion",
    paragraphs: [
      `We received a request to delete your ${ENV.APP_NAME} account.`,
      `Your data will be permanently deleted on ${date}. Until then you can cancel the request.`,
      "Some records (invoices, security audit entries) may be retained where the law requires it; our privacy policy lists exactly which and for how long.",
    ],
    cta: { label: "Cancel deletion", url: params.cancelUrl },
  });
  return { subject: `Account deletion scheduled for ${date}`, kind: "transactional", ...body };
}

export function dataExportReadyTemplate(params: { url: string; expiresInHours: number }): RenderedMail {
  const body = renderEmail({
    heading: "Your data export is ready",
    paragraphs: [
      `The archive of your ${ENV.APP_NAME} account data is ready to download.`,
      `The link expires in ${params.expiresInHours} hours and can only be used by you.`,
      "The archive is a machine-readable JSON file plus any files you uploaded.",
    ],
    cta: { label: "Download your data", url: params.url },
  });
  return { subject: `Your ${ENV.APP_NAME} data export is ready`, kind: "transactional", ...body };
}

export function marketingTemplate(params: {
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  unsubscribeUrl: string;
}): RenderedMail {
  const body = renderEmail(
    { heading: params.heading, paragraphs: params.paragraphs, cta: params.cta },
    { kind: "marketing", unsubscribeUrl: params.unsubscribeUrl }
  );
  return {
    subject: params.heading.slice(0, 120),
    kind: "marketing",
    unsubscribeUrl: params.unsubscribeUrl,
    ...body,
  };
}

/** Exported so a router/test can build the same URL the mail sender uses. */
export const mailLinks = {
  verifyEmail: (token: string) => link(`/verify-email?token=${encodeURIComponent(token)}`),
  resetPassword: (token: string) => link(`/reset-password?token=${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => link(`/signup?invite=${encodeURIComponent(token)}`),
  cancelDeletion: (token: string) =>
    link(`/settings?cancel-deletion=${encodeURIComponent(token)}`),
  dataExport: (token: string) => link(`/api/account/export/download?token=${encodeURIComponent(token)}`),
  unsubscribe: (token: string) => link(`/api/account/unsubscribe?token=${encodeURIComponent(token)}`),
  escapeHtml,
};
