<!-- TEMPLATE, NOT LEGAL ADVICE. A public security page is expected by
     enterprise buyers and by researchers. Keep it factual: describe what you
     do, never claim a certification you do not hold. -->

# Security

**Last reviewed:** {{product.effectiveDate}}

## Reporting a vulnerability

Email {{organization.securityEmail}}. We acknowledge reports within 2 business
days and aim to resolve confirmed issues within 30 days.

Please include a description, reproduction steps, and the impact you believe it
has. Do not access other users' data, do not run destructive tests, and give us
a reasonable window to fix the issue before publishing.

{{security.disclosurePolicy}}

We do not pursue legal action against researchers who follow this policy.

## What we do

| Control | Implementation |
| --- | --- |
| Encryption in transit | {{security.encryptionInTransit}} |
| Encryption at rest | {{security.encryptionAtRest}} |
| Password storage | {{security.passwordHashing}} |
| Sessions | Server-side records, revocable, {{retention.sessions}}-day lifetime |
| Multi-factor authentication | {{security.mfaAvailable}} |
| Backups | {{security.backupFrequency}}, retained {{security.backupRetentionDays}} days |
| Access control | Least privilege; audited administrative access |
| Rate limiting | Per-IP on every API route and per-account on sign-in |

## Breach notification

{{security.incidentResponseCommitment}}

<!-- REVIEW: GDPR requires supervisory-authority notification within 72 hours
     (Art. 33) and, when the risk is high, notification of individuals without
     undue delay (Art. 34). Your internal runbook must match the sentence
     above — see docs/runbooks/incident-response.md. -->

## Compliance

- Data-processing agreements with every sub-processor: see
  [Sub-processors](/legal/subprocessors).
- Retention windows are enforced in code, not just promised in policy.
- Payments: card data never touches our servers. <!-- Only true while you use a
  hosted checkout. Set regimes.pciDss=true if that changes. -->

## machine-readable

Security researchers and monitoring tools can find our disclosure policy at
`/.well-known/security.txt`.
