# Current state

Factual baseline recorded before Phase 1, and what changed. Every figure came
from inspecting the working tree, not from inference.

## Inherited shape

A single-page application in one `index.html` of ~522 KB, plus one Vercel
serverless function. No build step, no package manifest, no test suite, no
lockfile, no CI. 18 tracked files.

| Thing | Baseline |
|---|---|
| `index.html` | 522,447 bytes — all UI, state, routing, prompts, report generation, blog and academy content |
| `api/chat.js` | the only model endpoint |
| `api/logs.js` | deleted earlier: read stored prompt content back out, gated on a key in the query string |
| Pages | 20 SPA sections toggled by `go(page)` |
| Inline JS blocks | 2 (now 1, after the analytics shim was removed) |
| `div` balance | 607 open / 607 close |

## What was live at baseline

- 8 Stripe payment links behind a `buy()` handler, one per paid template.
- A pricing page with a subscription tier.
- A Formspree waitlist form, plus two further waitlist call-to-action cards.
- An advisory/consulting offer with enquiry links to a personal email address.
- Plausible analytics: one script, one init shim, 12 event calls including
  `Checkout Started`.
- A personal photograph, biography, name and email in five places, plus a named
  person in the schema.org payload.
- `buyrworld-phase2.zip`, tracked and unreferenced but served from the site root.
- A privacy policy describing waitlists, payments, form handling and
  twelve-month conversation retention.

## Capability inventory

Genuinely working, worth preserving:

| Capability | Assessment |
|---|---|
| Spend Analyser | Real deterministic logic — Pareto, concentration, tail, category aggregation, XLSX export. Runs entirely in the browser. The strongest existing code. |
| Quote Comparator | Multi-file ingestion, normalisation, structured report output. |
| Contract Intelligence | Clause-level review and redline generation; three sub-tools through one render path. |
| Price-Increase Defender | The closest existing thing to the target workflow. Decomposes a supplier claim and drafts a rebuttal. |
| Market Intelligence | Four web-grounded panels, now returning real citations. |
| Report/export shells | jsPDF and XLSX export shared by several tools. |

Thin wrappers over a single prompt, low intrinsic value: Meeting Minutes, RFQ
Generator, Negotiation Simulator, Supplier Discovery, Buyr AI chat.

## Known weaknesses carried forward

- The Price-Increase Defender asks the model to invent its own headline score
  (`JUSTIFICATION STRENGTH: NN/100`) and to estimate a justified percentage,
  then regex-scrapes that number back out of the prose. No arithmetic in the
  product is verifiable.
- No domain model. Case state lives in ad-hoc globals (`_cText`, `MI`,
  `window._srcData`).
- No tests of any kind.
- Third-party libraries load from a public CDN without integrity hashes.
- No Content-Security-Policy or related headers.
- No file size or type limits before parsers run.

## After Phase 1

Commercial and personal content removed. `index.html` is now ~505 KB across 18
pages, div balance 587/587, every navigation target resolves to a real page, and
`node scripts/verify-content.mjs` passes. See `SECURITY_REVIEW.md` for the
security position.
