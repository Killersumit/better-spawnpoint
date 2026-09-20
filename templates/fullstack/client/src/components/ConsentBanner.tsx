import { useState } from "react";
import { Cookie, X } from "lucide-react";
import { Link } from "wouter";
import {
  CONSENT_CATEGORIES,
  CONSENT_LABELS,
  DEFAULT_CONSENT,
  type ConsentCategory,
  type ConsentState,
} from "@shared/consent";
import { ROUTES } from "@shared/const";
import { Button } from "@/components/ui/button";
import { useConsent } from "@/contexts/ConsentContext";

/**
 * Cookie consent banner.
 *
 * Compliance requirements this implements (GDPR Art. 4(11) + Art. 7, ePrivacy
 * Art. 5(3), and the EDPB "dark patterns" guidelines of Jan 2023):
 *  • Accept and Reject are equally prominent — same size, same position family,
 *    no colour trick that makes reject look disabled.
 *  • No pre-ticked boxes. Everything optional defaults to off.
 *  • Granular: each category can be toggled independently.
 *  • Nothing non-essential loads before a decision (see lib/analytics.ts).
 *  • "Manage preferences" is reachable later from the footer.
 *
 * Accessibility: labelled region, keyboard reachable, no focus trap, buttons
 * carry explicit text (never an icon-only dismissal for the primary actions).
 */
export function ConsentBanner() {
  const { needsDecision, state, save, acceptAll, rejectAll } = useConsent();
  const [showDetails, setShowDetails] = useState(false);
  const [draft, setDraft] = useState<ConsentState>(state);

  if (!needsDecision) return null;

  const toggle = (category: ConsentCategory) => {
    if (CONSENT_LABELS[category].locked) return;
    setDraft((previous) => ({ ...previous, [category]: !previous[category] }));
  };

  return (
    <section
      aria-labelledby="consent-title"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:p-5"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div className="flex items-start gap-3">
          <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex-1">
            <h2 id="consent-title" className="text-sm font-semibold">
              Cookies and privacy choices
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We use strictly necessary storage to keep you signed in. Everything else —
              analytics and marketing — stays off until you turn it on. Read the{" "}
              <Link href={ROUTES.cookies} className="underline underline-offset-2">
                Cookie Policy
              </Link>{" "}
              for the full list.
            </p>
          </div>
          {showDetails && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowDetails(false)}
              aria-label="Hide cookie details"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        {showDetails && (
          <ul className="ml-8 space-y-3">
            {CONSENT_CATEGORIES.map((category) => {
              const meta = CONSENT_LABELS[category];
              const checkboxId = `consent-${category}`;
              return (
                <li key={category} className="flex items-start gap-3">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={draft[category]}
                    disabled={meta.locked}
                    onChange={() => toggle(category)}
                  />
                  <div>
                    <label htmlFor={checkboxId} className="text-sm font-medium">
                      {meta.title}
                      {meta.locked && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (always on)
                        </span>
                      )}
                    </label>
                    <p className="text-xs text-muted-foreground">{meta.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Accept and Reject have identical prominence on purpose. */}
          <Button onClick={acceptAll} className="sm:w-40">
            Accept all
          </Button>
          <Button onClick={rejectAll} variant="outline" className="sm:w-40">
            Reject all
          </Button>
          {showDetails ? (
            <Button onClick={() => save(draft)} variant="secondary" className="sm:w-48">
              Save my choices
            </Button>
          ) : (
            <Button
              onClick={() => {
                setDraft(state ?? DEFAULT_CONSENT);
                setShowDetails(true);
              }}
              variant="ghost"
            >
              Manage preferences
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
