<!-- TEMPLATE, NOT LEGAL ADVICE. This is the customer-facing Data Processing
     Addendum you offer to business customers (GDPR Art. 28). If you are the
     processor, the terms you ACCEPT from your own vendors live in
     legal/compliance.json → subprocessors.dpaUrl instead. -->

# Data Processing Addendum (DPA)

**Effective date:** {{product.effectiveDate}}

This DPA forms part of the agreement between {{organization.legalName}}
("Processor") and the customer ("Controller") for the services described at
{{product.url}}. It applies where the Processor handles personal data on the
Controller's behalf.

## 1. Roles and scope

The Controller determines the purposes and means of processing. The Processor
processes personal data only on documented instructions from the Controller,
including for transfers to a third country, unless required to do otherwise by
law — in which case the Processor informs the Controller first unless the law
prohibits it.

## 2. Subject matter and duration

Processing covers the service described at {{product.url}} for the term of the
agreement, plus the deletion period in section 8. The categories of data
subjects and personal data are those the Controller submits to the service.

## 3. Processor obligations

The Processor:

1. processes personal data only on the Controller's instructions;
2. ensures staff authorised to process it are bound by confidentiality;
3. implements the technical and organisational measures in Annex II;
4. assists the Controller with data-subject requests, DPIAs, and prior
   consultations, taking account of the nature of the processing;
5. notifies the Controller without undue delay, and in any event within 48
   hours, after becoming aware of a personal data breach;
6. makes available the information needed to demonstrate compliance, and allows
   audits as set out in section 7;
7. deletes or returns personal data at the end of the provision of services.

## 4. Sub-processors

The Controller gives general authorisation for the sub-processors listed at
[Sub-processors](/legal/subprocessors). The Processor will give at least 30
days' notice before adding or replacing a sub-processor, during which the
Controller may object. The Processor imposes the same data-protection
obligations on each sub-processor by written contract.

## 5. International transfers

Where processing involves a transfer outside the EEA/UK, the parties rely on
{{transfers.mechanism}}. Additional safeguards: {{transfers.additionalSafeguards}}.

## 6. Security

The Processor implements the measures in Annex II and reviews them regularly.
Security measures are not a guarantee of absolute security, but they must never
be weaker than those the Processor applies to its own data of the same kind.

## 7. Audits

Once per year, and after a documented security incident, the Controller may
audit the Processor's compliance with this DPA on reasonable notice, at the
Controller's cost, during business hours, and without disrupting the service.
The Processor's current security documentation and third-party reports satisfy
this obligation unless the Controller can show a specific gap.

## 8. Deletion and return

On termination the Processor deletes or returns personal data within 30 days,
unless the law requires retention. Deletion is confirmed in writing on request.
Backups are rotated out within 30 days.

## 9. Liability

Liability under this DPA follows the limitation of liability in the main
agreement.

---

## Annex I — Parties and processing detail

- **Controller:** as identified in the main agreement.
- **Processor:** {{organization.legalName}}, {{organization.address}}.
- **Data subjects:** the Controller's end users, employees, and contacts.
- **Categories of personal data:** see the inventory in the
  [Privacy Policy](/legal/privacy).
- **Frequency of processing:** continuous for the term of the agreement.
- **Retention:** as configured in the service and described in the Controller's
  own privacy notice.

## Annex II — Technical and organisational measures

- {{security.encryptionInTransit}} in transit; {{security.encryptionAtRest}} at rest.
- Passwords hashed with {{security.passwordHashing}}.
- Least-privilege access, no shared accounts, MFA on production systems.
- Audit logging of administrative access to production data.
- Backups: {{security.backupFrequency}}, retained {{security.backupRetentionDays}} days.
- Incident response: {{security.incidentResponseCommitment}}
- Personnel: confidentiality undertakings and annual security training.

## Annex III — Transfer mechanism

{{transfers.mechanism}}. The transfer impact assessment was last reviewed on
{{transfers.transferImpactAssessmentDate}}.

## How to sign

Email {{organization.privacyEmail}} with your legal entity name and we will send
a countersigned copy for e-signature.
