/**
 * Typed access to `legal/compliance.json`.
 *
 * Imported by the client (policy pages, cookie banner), the server (consent
 * logging, data export), and `scripts/verify.mjs`. One shape, one source.
 *
 * If you change the JSON, TypeScript will point at every consumer that needs
 * updating — which is the point of typing it instead of `JSON.parse`-ing ad hoc.
 */
import raw from "@legal/compliance.json";
import { CONSENT_CATEGORIES, type ConsentCategory } from "./consent";

export type DataInventoryEntry = {
  category: string;
  examples: string;
  purpose: string;
  lawfulBasis: string;
  retention: string;
  recipients: string;
  personalData: boolean;
  sensitive: boolean;
  thirdCountryTransfer: boolean;
};

export type Subprocessor = {
  name: string;
  purpose: string;
  location: string;
  dataCategories: string;
  dpaUrl: string;
  transferMechanism: string;
};

export type CookieEntry = {
  name: string;
  category: ConsentCategory;
  purpose: string;
  duration: string;
  provider: string;
};

export type ComplianceConfig = {
  version: string;
  organization: {
    productName: string;
    legalName: string;
    address: string;
    country: string;
    privacyEmail: string;
    securityEmail: string;
    supportEmail: string;
    dpo: string | null;
    euRepresentative: string | null;
    ukRepresentative: string | null;
  };
  product: {
    description: string;
    url: string;
    effectiveDate: string;
    minimumAge: number;
    governingLaw: string;
    disputeVenue: string;
  };
  regimes: {
    gdpr: boolean;
    ukGdpr: boolean;
    ccpaCpra: boolean;
    coppa: boolean;
    aiActTransparency: boolean;
    pciDss: boolean;
  };
  dataInventory: DataInventoryEntry[];
  subprocessors: Subprocessor[];
  cookies: CookieEntry[];
  retention: {
    sessions: number;
    authTokens: number;
    softDeletedUsers: number;
    auditLogs: number;
    anonymousConsent: number;
  };
  transfers: {
    mechanism: string;
    transferImpactAssessmentDate: string;
    additionalSafeguards: string;
  };
  security: {
    encryptionInTransit: string;
    encryptionAtRest: string;
    passwordHashing: string;
    mfaAvailable: boolean;
    backupFrequency: string;
    backupRetentionDays: number;
    incidentResponseCommitment: string;
    disclosurePolicy: string;
  };
  ai: {
    featuresUseAI: boolean;
    providerLabel: string;
    providerUrl: string;
    humanReview: string;
    trainingOnUserData: boolean;
    disclosureText: string;
  };
  accessibility: {
    standard: string;
    targetDate: string;
    conformanceStatus: string;
    knownLimitations: string;
    feedbackEmail: string;
    euAccessibilityActApplies: boolean;
  };
};

export const compliance = raw as unknown as ComplianceConfig;

/** True when any regime that needs policy pages + DSAR endpoints is on. */
export function requiresPrivacyProgram(): boolean {
  return (
    compliance.regimes.gdpr ||
    compliance.regimes.ukGdpr ||
    compliance.regimes.ccpaCpra ||
    compliance.regimes.coppa
  );
}

/** Data categories that are personal data and leave the region. */
export function crossBorderCategories(): string[] {
  return compliance.dataInventory
    .filter((entry) => entry.thirdCountryTransfer)
    .map((entry) => entry.category);
}

/** Cookies grouped by consent category, for the banner and the policy table. */
export function cookiesByCategory(): Record<ConsentCategory, CookieEntry[]> {
  const out = Object.fromEntries(
    CONSENT_CATEGORIES.map((category) => [category, [] as CookieEntry[]])
  ) as Record<ConsentCategory, CookieEntry[]>;

  for (const cookie of compliance.cookies) {
    out[cookie.category]?.push(cookie);
  }
  return out;
}

export function productName(): string {
  return compliance.organization.productName;
}
