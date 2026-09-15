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
| Spend Analyser | Real deterministic logic — Pareto, concentration, tail, category aggregation, XLSX export. Now extracted into `src/calc/spend.mjs` with exact arithmetic and 35 tests. |
| Quote Comparator | Multi-file ingestion, normalisation, structured report output. |
| Contract Intelligence | Clause-level review and redline generation; three sub-tools through one render path. |
| Price-Increase Defender | The flagship workflow. Decomposes a supplier claim against exact arithmetic, assesses the evidence, carries the case through to a negotiating position (`src/calc/negotiation.mjs`), and opens that position with what the supplier did last time (`src/calc/supplier-history.mjs`). |
| Market Intelligence | Four web-grounded panels, now returning real citations. |
| Report/export shells | jsPDF and XLSX export shared by several tools. |

Thin wrappers over a single prompt, low intrinsic value: Meeting Minutes, RFQ
Generator, Supplier Discovery, Buyr AI chat. The standalone Negotiation Simulator
is now superseded for claim cases by the computed plan on the Defender, and
still does not know a case exists.

Cases are saved locally and can be resumed days later (`src/services/case-store.mjs`),
so a claim no longer has to be finished in one sitting.

A workspace dashboard lives at the `dash` route, separate from the public home
page. It is built only from what the engines can answer: open cases, exposure
still in dispute, the resisted rate with its coverage, supplier records and the
learning patterns with their sample sizes. Cards the reference shows but the
data cannot support — a savings tracker, an opportunity radar, market signals
tied to live positions — are absent rather than filled with plausible figures.

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

## Where it stands now

Phase 1 removed the commercial and personal layers. What followed replaced the
part that mattered most: the tool that asked a language model to invent
`JUSTIFICATION STRENGTH: NN/100` now computes a warranted change from weighted
driver movement, in exact integer arithmetic, with every figure traceable to a
driver, a formula and a source.

| | Baseline | Now |
|---|---|---|
| `index.html` | 522 KB, 20 pages | ~530 KB, 18 pages |
| Tests | none | 360, plus 39 ProcureBench cases |
| CI | none | every push, Node 22 and 24 |
| Calculation modules | none | 7 under `src/`, framework-free |
| Payment links | 8 | 0 |
| Analytics events | 13 | 0 |
| Third-party scripts pinned | 0 of 6 | 6 of 6 |
| Controls without an accessible name | 50 | 0 |
| Click targets unreachable by keyboard | 5 | 0 |

The weaknesses listed above under "Known weaknesses carried forward" are closed
except one: the page still carries 130 inline event handlers, which is why the
CSP cannot yet drop `'unsafe-inline'`. See `IMPLEMENTATION_PLAN.md`.

---

# Where it got to

*Recorded 14 September 2026. The section above describes what was inherited and
what the first phases changed; it knew four modules. Thirty-six more have been
built since, and a state document that describes a different product is worse
than none, because it is believed.*

Every figure below came from the working tree on the date above.

| Thing | Baseline | Now |
|---|---|---|
| `index.html` | 522,447 bytes | 641,283 bytes |
| Tracked files | 18 | 141 |
| Modules under `src/` | 0 | 46 |
| Test files | 0 | 78 |
| Tests | 0 | 1,931, all passing |
| Inline event handlers | — | 0 — `script-src` no longer allows inline script |
| Verification steps | 0 | 6, all passing |

## The calculation layer — `src/calc/`

Exact throughout: money is integer minor units on BigInt, ratios are scaled by
1e9, and `tests/security/no-floats.test.mjs` fails on any floating-point
construct not written down with a reason.

**The arithmetic itself.** `exact.mjs` is the money and ratio primitives.
`index-series.mjs` resolves index movement from a contractual base with a lag.
`fx.mjs` converts only with a dated, sourced rate and splits a currency effect
from a cost effect. `provenance.mjs` labels every figure supplied, derived or
assumed.

**Reviewing a claim.** `cost-bridge.mjs` decomposes what a supplier asks for
into what the evidence warrants and what it does not. `evidence.mjs` grades the
assertions behind it. `negotiation.mjs` turns a finished case into a position,
`batna.mjs` asks whether the supplier could actually be replaced, and
`shadow.mjs` recommends the next move during the conversation itself.
`decision-pack.mjs` assembles all of it into a document somebody can sign, and
`src/render/decision-pack-html.mjs` renders it.

**Looking across cases.** `supplier-history.mjs` reads outcomes back by
supplier, `portfolio.mjs` aggregates them into the resisted rate,
`learning.mjs` derives what has actually worked with its sample size always
attached, and `radar.mjs` reads the whole corpus and says what is worth asking
about — firing only where real data exists and never totalling its findings.

**Sourcing and parts.** `sourcing.mjs` normalises quotes, keeps two rankings
apart and refuses to name a winner. `comparable.mjs` compares parts on what
they are rather than what they are called. `spend.mjs` is the spend analysis;
`shock.mjs` the cost-shock model; `outcome.mjs` the recorded result of a case.

**Should Cost Expert**, the largest single addition. `units.mjs` holds physical
quantities as exact integers and refuses a number with no unit.
`should-cost.mjs` turns a required number of accepted parts into a purchase
quantity and a cost over it. `certificate.mjs` compares a certificate against
requirements from identified documents, treating every reported value as the
range it covers. `mill.mjs` builds a private record of how reviewed lots turned
out, with no composite score anywhere in it.

**The join.** `build-up.mjs` puts a supplier's claimed cost structure beside an
independent build-up and prices the difference in points of the increase being
asked for. It is the first thing here that lets a claim be argued in anything
other than the supplier's own numbers.

## The model layer — `src/services/ai/`

The only part of the product that talks to a language model, kept behind one
interface so the rest never does. `adapter.mjs` has two implementations, a
mock for tests and an HTTP transport for the browser. `grounding.mjs` is the
check every extractor shares: a field arrives with the verbatim span it was
read from, and a span that does not appear in the document is rejected — an
invented quote is detectable where an invented figure is not.
`extract-claim.mjs`, `extract-contract.mjs` and `extract-quotes.mjs` are the
three extractors built on it. Everything they produce is marked `ai-inferred`
and cannot enter arithmetic until a person confirms it.

`src/data/sample-indices.mjs` holds the synthetic index series the
demonstrations use.

## Intake — `src/intake/`

`classify.mjs` routes a pasted or uploaded document to the tool that fits it,
across eight kinds, by rule rather than by model. `extract-document.mjs` reads
drawings and certificates the same way: every value comes back with the page and
the exact characters it was matched from, proposed and unconfirmed.

Neither makes a network call. That is why a document instructing them is just a
document containing that sentence.

## Domain and storage — `src/domain/`, `src/services/`

`ids.mjs`, `entities.mjs` and `registry.mjs` are the commercial memory spine:
stable identity derived on write, explicit and reversible merges, no migration.
See `DOMAIN_MODEL.md`.

`src/studio/requirements.mjs` holds what a part has to satisfy: dimensional
and general tolerances, geometric controls, surface texture, finishes and
their masked areas, edge conditions, processes, and inspection. It needs no
geometry, which is the point — a buyer knows the finish long before anyone
has modelled the part. Limits are exact integer nanometres rather than the
micrometres `units.mjs` uses, because a micrometre cannot hold one thou.
Citing a specification records a citation and nothing more: there is no table
of standards in this repository, so a requirement leaning on a specification
whose clause text nobody supplied stays `unverified`. Conflicting
requirements are reported and never resolved, because choosing between two
tolerances is an engineering decision.

`src/studio/geometry.mjs` is a deliberately small parametric part: a
rectangular block, through-holes and rectangular pockets, and nothing that
would let anyone mistake it for a CAD replacement. Dimensions are integer
micrometres. The block and a rectangular pocket have exact volumes; a round
hole does not, because its volume contains pi — so a part with holes reports
a volume *interval* whose bounds provably contain the truth, rather than a
rounded figure presented as a measurement. Feature ids survive deletion,
which is what lets `requirements.mjs` detect a detached requirement instead
of handing the tolerance written for one hole to a different one.

`src/studio/review-export.mjs` prepares a package to hand to somebody
technical. It contains no solid model and no dimensioned drawing, because
this build has no geometry engine — and both are named in the package with
the reason, rather than quietly absent. What it does contain is real: a
requirement schedule to read, the same schedule as data, the open questions,
and a manifest carrying the actual SHA-256 of the actual bytes. Every
artifact is stamped DRAFT — FOR TECHNICAL REVIEW, wording that would read as
a release is refused rather than trusted, and a package from this build is
never "complete" — which is the honest answer while two formats are
unavailable.

`src/studio/scenario.mjs` is the model behind both Should-Cost Studio entry
paths. Upload drawing and No drawing — enter details manually converge on it,
so the same reviewed values give the same answer whichever way they arrived.
It holds three distinctions the rest of the product depends on: blank is not
the same as "I don't know" is not the same as zero; what somebody typed is
kept beside what it converts to; and a value read from a document is a
proposal until a person accepts it, which is what stops a late extraction
overwriting a newer manual edit.

Six `localStorage` stores: `case-store.mjs`, `outcome-store.mjs`,
`part-store.mjs`, `lot-store.mjs`, `estimate-store.mjs` and
`studio-store.mjs`. Each withholds rather than misreads a record written by
another build.

`studio-store.mjs` is the odd one. Every other store holds finished work;
this one holds unfinished work on purpose, because a buyer who has entered
half a part and does not yet know the pass rate must be able to put it down
and come back. It stores the fields and their provenance and no calculated
result, so a reopened scenario can never show a total its own inputs no
longer support. What they hold
and what that means is documented in `SECURITY_REVIEW.md` under **Data
handling**; that section is the one to read before anything else here.

## What is true of all of it

- **Code calculates, the model explains.** No percentage or money figure shown
  to a user comes from a language model.
- **A value without a quote is not evidence**, and an `ai-inferred` value cannot
  enter arithmetic until a person confirms it.
- **Refusals are load-bearing.** No percentage below an evidence threshold, no
  unit that does not convert exactly, no share of a partial subtotal, no ranking
  across unlike material, no total across radar findings.

## What is still not true

- **Nobody has used it.** One synthetic claim in `fixtures/`, and a portfolio
  that honestly reports a corpus of zero. Every judgement in the list above
  rests on an assumption about what a buyer does that no buyer has tested.
- **Nobody has looked at it in a browser at 360px.** The breakpoint arithmetic
  is checked statically; that is not the same thing.
- **The Upstash purge is outstanding.** See `SECURITY_REVIEW.md`.
- **No scanned document can be read**, and there is no CAD parser. Both are
  stated on the page rather than implied away.
