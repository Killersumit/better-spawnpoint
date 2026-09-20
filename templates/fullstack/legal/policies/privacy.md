<!--
  TEMPLATE, NOT LEGAL ADVICE. Have a qualified lawyer in your jurisdiction
  review this before you rely on it. The bracketed REVIEW markers show the
  points that most often need local changes.

  Placeholders are filled from legal/compliance.json at render time:
    {{organization.legalName}}      {{organization.privacyEmail}}
    {{product.description}}         {{product.effectiveDate}}
  Generated blocks: {{table:dataInventory}} {{table:subprocessors}}
                    {{table:cookies}} {{transfers.mechanism}}
  Never hard-code a name, address, or retention period in this file.
-->

# Privacy Policy

**Effective date:** {{product.effectiveDate}}
**Controller:** {{organization.legalName}}, {{organization.address}}
**Contact:** {{organization.privacyEmail}}

We are the data controller for the personal data described below. This policy
explains what we collect, why, how long we keep it, and the rights you have.
It is written to be read, not to be impressive.

## 1. What we collect and why

{{table:dataInventory}}

We do not collect special-category data (health, biometric, political, religious
or trade-union data) and we do not ask for it. <!-- REVIEW: if your product does
collect any of this, this sentence must change and an Art. 9 condition applies. -->

## 2. Legal bases

We rely on:

- **Performance of a contract** — to create your account and provide the
  service you asked for.
- **Consent** — for analytics, marketing email, and anything optional. You can
  withdraw consent at any time and it is as easy to withdraw as to give.
- **Legitimate interests** — for security, abuse prevention, and keeping the
  service working. We balance these against your rights and you may object.
- **Legal obligation** — for tax, accounting, and lawful requests from
  authorities.

## 3. Who else sees your data

We use the following sub-processors. Each has a written data-processing
agreement with us and is bound to use your data only to provide their service
to us.

{{table:subprocessors}}

We do not sell your personal data. We do not share it with advertisers. Where
we transfer data outside the EEA/UK, we rely on {{transfers.mechanism}}.
Additional safeguards: {{transfers.additionalSafeguards}}.

## 4. How long we keep it

| Category | Retention |
| --- | --- |
| Account data | While your account exists, plus a 30-day recovery window after deletion |
| Sessions | {{retention.sessions}} days after expiry |
| Security and audit logs | {{retention.auditLogs}} days |
| Consent records | {{retention.anonymousConsent}} days (evidence of compliance) |
| Billing records | 10 years where tax law requires it |
| Support correspondence | 3 years after the last message |

When the window closes we delete or irreversibly anonymise the data.

## 5. Your rights

Depending on where you live you have some or all of these rights. We do not
charge for exercising them and we do not degrade the service if you do.

- **Access** — download a machine-readable copy of everything we hold about you
  from *Settings → Your data*, or email us. We respond within 30 days.
- **Rectification** — correct your details at any time in your account.
- **Erasure** — delete your account and data. Deletion is immediate for your
  profile and scheduled for the rest after a short grace period so an attacker
  cannot destroy your account with a stolen session.
- **Restriction and objection** — ask us to pause or stop particular processing.
- **Portability** — receive your data in a structured JSON export.
- **Withdraw consent** — change cookie choices at any time via *Cookie
  settings* in the footer; unsubscribe links appear in every marketing email.
- **Complain** — to your local supervisory authority. We would appreciate the
  chance to fix it first: {{organization.privacyEmail}}.

If you are in California you also have the right to know the categories of
information we collect and disclose, to request deletion, to opt out of
"sale" or "sharing" (we do neither), and not to be discriminated against for
exercising your rights. We honour these requests for all users, not only
Californians.

## 6. Cookies and similar technologies

We use strictly necessary cookies to keep you signed in and to protect against
cross-site request forgery. These cannot be switched off. Everything else —
functional, analytics, marketing — is off until you turn it on. See the
[Cookie Policy](/legal/cookies) for the full list and how to change your choices.

## 7. Security

{{security.encryptionInTransit}} in transit, {{security.encryptionAtRest}} at
rest, and passwords are stored as {{security.passwordHashing}}. We limit access
to personal data to staff who need it, and we log administrative access. No
system is perfect: if a breach affects you, we will tell you without undue
delay and describe what we know, what we are doing, and what you can do.

## 8. Children

The service is not directed at children under {{product.minimumAge}}. We do not
knowingly collect their data. If you believe a child has given us personal data,
contact {{organization.privacyEmail}} and we will delete it.

<!-- REVIEW: if you target children (or know some users are children) in the US,
COPPA requires verifiable parental consent — set regimes.coppa=true in
legal/compliance.json to unlock the extra checklist. -->

## 9. Changes

We will post any change here with a new effective date. If a change materially
affects you, we will email account holders or show an in-product notice before
it takes effect.

## 10. Contact

{{organization.legalName}}
{{organization.address}}
{{organization.privacyEmail}}
{{#if organization.dpo}}Data Protection Officer: {{organization.dpo}}{{/if}}
{{#if organization.euRepresentative}}EU representative: {{organization.euRepresentative}}{{/if}}
