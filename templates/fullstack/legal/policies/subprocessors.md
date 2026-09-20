<!-- TEMPLATE, NOT LEGAL ADVICE. The table is generated from
     legal/compliance.json → subprocessors. Keep that file current: under
     GDPR Art. 28 you must give customers notice before adding one, and
     "we forgot to update the list" is the most common audit finding there is. -->

# Sub-processors

**Last reviewed:** {{product.effectiveDate}}

We use the vendors below to run {{organization.productName}}. Each is bound by a
written data-processing agreement and may use your data only to provide their
service to us.

{{table:subprocessors}}

## Notification of changes

Customers who have signed our [DPA](/legal/dpa) receive email notice at least
30 days before a new sub-processor starts processing personal data, and may
object as described in the DPA.

Subscribe to changes: {{organization.privacyEmail}} with the subject
"subprocessor notifications" and your account email.

<!-- OPERATIONS CHECKLIST for adding a sub-processor:
     1. Review their security posture and sign a DPA (or accept theirs).
     2. Record the transfer mechanism if they are outside the EEA/UK.
     3. Add them to legal/compliance.json → subprocessors.
     4. Run `npm run verify` (fails if the page and the file disagree).
     5. Email customers 30 days before they touch personal data. -->
