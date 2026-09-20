<!-- TEMPLATE, NOT LEGAL ADVICE. An accessibility statement is legally required
     in the EU (European Accessibility Act, in force since 28 June 2025 for many
     product categories), the UK (Equality Act 2010), and the US (ADA Title III
     for many businesses). It must describe the CURRENT state honestly —
     overclaiming conformance is worse than stating a known gap. -->

# Accessibility Statement

**Last reviewed:** {{product.effectiveDate}}

{{organization.legalName}} wants everyone to be able to use
{{organization.productName}}, including people who use screen readers,
keyboards, magnification, or reduced-motion settings.

## Our target

We aim to meet **{{accessibility.standard}}**.

**Current status: {{accessibility.conformanceStatus}}.**

## Known limitations

{{accessibility.knownLimitations}}

We are actively fixing these. If something blocks you, tell us — it moves up the
list.

## How we test

- Automated checks (axe-core rules) on every pull request.
- Manual keyboard-only pass over the main flows.
- Screen-reader spot checks with NVDA (Windows) and VoiceOver (macOS/iOS).
- Zoom to 200% and 400% reflow checks.

Automated tests catch roughly a third of real issues, which is why the manual
passes above exist. <!-- Do not delete this line when editing: it is the
sentence that keeps this statement honest. -->

## What is built in

- Every interactive element is reachable and operable by keyboard, with a
  visible focus indicator (never `outline: none` without a replacement).
- Colour combinations meet AA contrast (4.5:1 for body text, 3:1 for large text
  and UI boundaries).
- Motion respects `prefers-reduced-motion`.
- Forms label every field, describe errors in text next to the field, and move
  focus to the first error on submit.
- Images carry meaningful alt text; decorative images are marked
  `alt=""` so screen readers skip them.
- Headings are ordered, the page has one `<h1>`, and landmarks are used.
- Status changes are announced through live regions rather than only colour.

## Feedback and enforcement

Email {{accessibility.feedbackEmail}} with the page, what you tried to do, and
what happened. We aim to reply within 5 working days.

If you are not satisfied with our response and you are in the EU, you can
contact the accessibility enforcement body in your country. In the US you may
contact the Department of Justice or file a complaint with the relevant agency.
We would much rather fix it directly.
