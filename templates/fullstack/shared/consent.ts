/**
 * Consent model: the four categories, their labels, and the normalization rules.
 *
 * Legal basis, because it drives every decision in this file:
 *
 *  • `strictly_necessary` — no consent needed (GDPR Art. 5(3) ePrivacy
 *    exception / "strictly necessary" cookies). Always on, and cannot be turned
 *    off, because without them the service does not work (session cookie, CSRF
 *    nonce).
 *  • `functional`, `analytics`, `marketing` — all require OPT-IN. Off by
 *    default, chosen by an affirmative act, and revocable as easily as they were
 *    given (GDPR Art. 7(3)).
 *
 * Two rules that are easy to get wrong and are enforced here:
 *   1. Rejecting is as easy as accepting. `DEFAULT_CONSENT` is all-off, and the
 *      banner offers "Reject all" with the same prominence as "Accept all".
 *   2. Consent is not a condition of service. Nothing in the app may gate a core
 *      feature on `analytics` or `marketing` being true.
 *
 * Consumers must gate the corresponding code on these categories — add a
 * category here and nothing happens until something reads it:
 *   strictly_necessary → session cookie, CSRF, security headers (always on)
 *   functional         → theme preference in localStorage, remembered sidebar state
 *   analytics          → the analytics script loader in `lib/analytics.ts`
 *   marketing          → ad/retargeting pixels (none are loaded by default)
 */

/**
 * Bump this whenever the categories, their purposes, or the processors involved
 * change. A stored record with a different version is treated as stale by
 * `ConsentContext`, so the user is asked again rather than silently covered by a
 * consent they gave for a different use.
 */
export const CONSENT_VERSION = "2026-09-01";

/** localStorage key holding the consent envelope (version + choices). */
export const CONSENT_STORAGE_KEY = "spawnpoint.consent";

/** Dispatched on `window` to re-open the banner from anywhere in the UI. */
export const OPEN_CONSENT_SETTINGS_EVENT = "spawnpoint:open-consent-settings";

export const CONSENT_CATEGORIES = [
  "strictly_necessary",
  "functional",
  "analytics",
  "marketing",
] as const;

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export type ConsentState = {
  strictly_necessary: true;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
};

/** Everything optional is off. This is the state shown to a first-time visitor. */
export const DEFAULT_CONSENT: ConsentState = {
  strictly_necessary: true,
  functional: false,
  analytics: false,
  marketing: false,
};

export type ConsentLabel = {
  title: string;
  description: string;
  /** True when the category cannot be turned off, so the UI can disable the toggle. */
  locked: boolean;
  /** What the user gets if they enable it — plain language, no dark patterns. */
  benefit: string;
};

export const CONSENT_LABELS: Record<ConsentCategory, ConsentLabel> = {
  strictly_necessary: {
    title: "Strictly necessary",
    description:
      "Required to sign you in, keep your session secure, and remember your privacy choices. These cannot be switched off.",
    locked: true,
    benefit: "The site works and stays secure.",
  },
  functional: {
    title: "Preferences",
    description:
      "Remembers choices you make, such as your theme and which panels you had open. Stored on your device.",
    locked: false,
    benefit: "The site remembers how you left it.",
  },
  analytics: {
    title: "Analytics",
    description:
      "Aggregated, IP-truncated statistics about which pages are used. No cross-site tracking, no advertising profiles.",
    locked: false,
    benefit: "Helps us fix what is broken and improve what works.",
  },
  marketing: {
    title: "Marketing",
    description:
      "Measuring the performance of our own campaigns and showing relevant content on other sites. Off means off — no remarketing pixels are loaded.",
    locked: false,
    benefit: "Might show you things you are actually interested in.",
  },
};

/** Categories the user can actually decline (used for "reject all" and for audit). */
export const OPTIONAL_CONSENT_CATEGORIES = CONSENT_CATEGORIES.filter(
  (category) => !CONSENT_LABELS[category].locked
);

/**
 * Coerce anything (a stale localStorage blob from an older version, a POST body,
 * a database row's JSON column) into a valid `ConsentState`.
 *
 * Unknown categories are dropped and locked ones forced on, so a malicious or
 * broken client cannot persist an invalid posture and cannot claim that
 * `strictly_necessary` was declined.
 */
export function normalizeConsent(input: unknown): ConsentState {
  const source = (input ?? {}) as Record<string, unknown>;

  return {
    strictly_necessary: true,
    functional: source.functional === true,
    analytics: source.analytics === true,
    marketing: source.marketing === true,
  };
}

/** True when nothing optional has been granted. */
export function isMinimalConsent(state: ConsentState): boolean {
  return OPTIONAL_CONSENT_CATEGORIES.every((category) => state[category] === false);
}

/**
 * Stored envelope. `version` is compared against `CONSENT_VERSION`; a mismatch
 * means the model changed, so the stored choice is treated as stale and the
 * banner is shown again instead of being reused.
 */
export type StoredConsent = {
  version: string;
  state: ConsentState;
  /** ISO timestamp of when the user last made, or changed, this choice. */
  updatedAt: string;
};

export function parseStoredConsent(raw: string | null, currentVersion: string): ConsentState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== currentVersion) return null;
    return normalizeConsent(parsed.state);
  } catch {
    return null;
  }
}

export function serializeConsent(state: ConsentState, version: string): string {
  const envelope: StoredConsent = {
    version,
    state: normalizeConsent(state),
    updatedAt: new Date().toISOString(),
  };
  return JSON.stringify(envelope);
}

/**
 * Short, human-readable summary of what was granted, for the audit log.
 * "analytics, functional" reads better in a compliance review than a JSON blob.
 */
export function describeConsent(state: ConsentState): string {
  const granted = OPTIONAL_CONSENT_CATEGORIES.filter((category) => state[category]);
  if (granted.length === 0) return "none (essential only)";
  return granted.map((category) => CONSENT_LABELS[category].title.toLowerCase()).join(", ");
}
