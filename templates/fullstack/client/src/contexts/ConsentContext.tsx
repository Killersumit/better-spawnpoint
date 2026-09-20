import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_CONSENT, type ConsentCategory, type ConsentState } from "@shared/consent";
import {
  readConsent,
  recordConsentOnServer,
  writeConsent,
  type StoredConsent,
} from "@/lib/consent";
import { applyConsentToAnalytics } from "@/lib/analytics";

type ConsentContextValue = {
  /** Current decision, or null when the visitor has not decided yet. */
  consent: StoredConsent | null;
  state: ConsentState;
  /** True when a decision has been recorded (banner stays hidden). */
  decided: boolean;
  /** True when the banner should be visible. */
  needsDecision: boolean;
  has: (category: ConsentCategory) => boolean;
  save: (next: ConsentState) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  /** Re-open the banner from the footer's "Cookie settings" link. */
  reopen: () => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [consent, setConsent] = useState<StoredConsent | null>(null);
  const [forcedOpen, setForcedOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Read once on mount. Doing this in an effect (not during render) keeps the
  // server-rendered markup and the first client render identical.
  useEffect(() => {
    setConsent(readConsent());
    setHydrated(true);
  }, []);

  const state = consent?.state ?? DEFAULT_CONSENT;

  // Only analytics reacts to consent; it is the only third-party loader.
  useEffect(() => {
    if (!hydrated) return;
    applyConsentToAnalytics(state);
  }, [hydrated, state]);

  const save = useCallback((next: ConsentState) => {
    const record = writeConsent(next);
    setConsent(record);
    setForcedOpen(false);
    void recordConsentOnServer(record);
  }, []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      consent,
      state,
      decided: consent !== null,
      needsDecision: hydrated && (consent === null || forcedOpen),
      has: (category) => state[category],
      save,
      acceptAll: () =>
        save({
          strictly_necessary: true,
          functional: true,
          analytics: true,
          marketing: true,
        }),
      rejectAll: () => save({ ...DEFAULT_CONSENT }),
      reopen: () => setForcedOpen(true),
    }),
    [consent, forcedOpen, hydrated, save, state]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const context = useContext(ConsentContext);
  if (!context) throw new Error("useConsent must be used inside <ConsentProvider>");
  return context;
}
