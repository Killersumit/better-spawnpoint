/**
 * Client-side consent state.
 *
 * Stored in localStorage (not a cookie) so it can be read before any
 * third-party code loads, and so a server-side cookie banner script is never
 * required. The server keeps the authoritative, append-only record in the
 * `consents` table; this copy exists only to avoid re-prompting the visitor.
 *
 * IMPORTANT: nothing non-essential may load before `hasConsent("analytics")`.
 * `analytics.ts` is the single place that reads this, and it is the only
 * permitted loader for third-party scripts.
 */
import {
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  normalizeConsent,
  type ConsentState,
} from "@shared/consent";

export type StoredConsent = {
  version: string;
  state: ConsentState;
  decidedAt: string;
  /** Random per-browser id so anonymous decisions can be logged server-side. */
  anonId: string;
};

function makeAnonId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `anon-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function readConsent(): StoredConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    return {
      version: typeof parsed.version === "string" ? parsed.version : CONSENT_VERSION,
      state: normalizeConsent(parsed.state),
      decidedAt:
        typeof parsed.decidedAt === "string" ? parsed.decidedAt : new Date().toISOString(),
      anonId: typeof parsed.anonId === "string" ? parsed.anonId : makeAnonId(),
    };
  } catch {
    // Storage can throw in private mode; treat as "no decision yet".
    return null;
  }
}

export function writeConsent(
  state: ConsentState,
  existingAnonId?: string
): StoredConsent {
  const record: StoredConsent = {
    version: CONSENT_VERSION,
    state: normalizeConsent(state),
    decidedAt: new Date().toISOString(),
    anonId: existingAnonId ?? readConsent()?.anonId ?? makeAnonId(),
  };
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Non-fatal: the decision still applies for this page view.
  }
  return record;
}

export function clearConsent(): void {
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Fire-and-forget copy of the decision to the server for the evidence trail. */
export async function recordConsentOnServer(record: StoredConsent): Promise<void> {
  try {
    await fetch("/api/compliance/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        version: record.version,
        anonId: record.anonId,
        state: record.state,
      }),
    });
  } catch {
    // Consent still applies client-side; the server record is best-effort and
    // will be retried on the next decision change.
  }
}
