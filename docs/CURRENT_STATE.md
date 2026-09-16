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
| Modules under `src/` | 0 | 58 |
| Test files | 0 | 95 |
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

`src/studio/read-instruction.mjs` reads a typed instruction into that
proposal shape, by written rule and with no model — the same reasoning
`extract-document.mjs` gives about drawings, and sharper here because the
sentence is about to become a change to a part. It knows five phrasings and
refuses the rest, showing what it can take. The requests the pack names are
answered by name: "make this aerospace grade" asks which specification
applies, "tighten the tolerance" asks by how much and on what, and a fillet
is refused by saying what this builds. When a real adapter is configured it
produces proposals in the same shape and goes through the same validation;
this stays as the path that works without one.

`src/studio/read-instruction.mjs` reads a typed instruction into that
proposal shape, by written rule and with no model — the same reasoning
`extract-document.mjs` gives about drawings, and sharper here because the
sentence is about to become a change to a part. It knows five phrasings and
refuses the rest, showing what it can take. The requests the pack names are
answered by name: "make this aerospace grade" asks which specification
applies, "tighten the tolerance" asks by how much and on what, and a fillet
is refused by saying what this builds. When a real adapter is configured it
produces proposals in the same shape and goes through the same validation;
this stays as the path that works without one.

`src/studio/edit-proposal.mjs` turns a described change into a proposal and
refuses to turn it into code. Every operation a proposal may contain is on a
closed list checked by name, so nothing is evaluated and an instruction with
nowhere to land is refused rather than attempted. An ambiguous target becomes
a question — two pockets and "this pocket" asks which — because picking one
and being wrong changes the part silently. A proposal worked out against an
older revision is refused, and so is accepting a preview of a part that has
since moved on. What a model is not allowed to decide — a tolerance value, a
specification revision, whether something is confirmed — is held back and
reported rather than quietly dropped.

`src/intake/file-router.mjs` answers what a file actually is, from its
first bytes rather than the end of its name. The drawing reader decides by
filename in two places, and the v5 gap matrix notes that widening the input
alone would not fix it because the handler rejects the file separately.
Deciding by content fixes both. A name that disagrees with the bytes is
reported rather than silently resolved either way — somebody who believes
they uploaded a JPEG and a system that read a PNG will disagree later about
something worse. Formats it knows and cannot use are named with what to do
instead; limits are stated rather than met by surprise.

`src/intake/viewer.mjs` is the other half of reading a picture, and most of
what makes showing one worth doing: zoom, pan, quarter turns, fit and pages,
with two properties it is built around. A region is stored against the
document rather than the screen, so a source crop still marks the same
characters after the drawing has been zoomed, turned and panned — the
coordinate round trip is the thing its tests actually pin down, at every
rotation. And panning stops at the edges, because a viewer that lets the page
slide out of sight reads as a failed upload.

`src/intake/review.mjs` is the confirmation queue, and the four answers a
person can give about a reading rather than two. A tick and an editable box
covered "it says this and it is right" and "it says this and the right value
is that"; neither covered "the drawing does not give this" or "that reading
is not this field at all", and both of those were landing as an untouched
row, indistinguishable from one nobody had looked at.

Correcting used to overwrite the reading in place, so the moment anybody
disagreed with a drawing, what the drawing said was gone. Evidence is frozen
at the point of reading now and never written to again; every decision is a
revision on top of it, carrying who, when, and what it was changed from. A
decision also belongs to the document it was made about: a new revision, or
the same file read as saying something else, sends those rows back for review
and says which ones and why, rather than quietly emptying the ticks. Where a
typed value and a read value disagree, both are shown and neither wins.

`src/intake/page-text.mjs` says which pages were readable, which is a
promise the file router was already making and nothing was keeping. The
extraction counted pages with no text — the right count and the wrong answer,
since working out which three of twelve means opening the file yourself.

It also has the state the count did not: a scan with a stamped reference
number in its text layer *has* text, and reading that page as readable makes
the rules run, find nothing, and the drawing look like one that simply said
nothing. Sparse is named and grouped with the unreadable, because a stamp
over a scan is a scan. The wording never implies a page will be read later,
since there is no reader in this build, and it says plainly that a value
missing from the reading is not missing from the drawing.

`src/intake/extraction-job.mjs` is the adapter for a document worker that
does not exist here, and it is deliberate rather than speculative. The v5
spec wants an isolated Python worker with OCR and PDF rasterisation behind
authenticated endpoints; that needs a binary runtime this repository has not
got, and the roadmap's own instruction for that case is to keep preview and
manual entry usable and mark the gate blocked. So the honest unavailable
state is the one this build actually returns.

The part that is not plumbing is the rule about a result that finally
arrives. A reading that comes back for a case nobody is looking at, or for a
drawing since replaced, or against fields somebody has typed into since, is
not a slow success — it is a wrong answer arriving quietly, and the seam
where it lands is the only place to stop it. A refused reading is kept and
offered as a comparison rather than discarded, because somebody waited for
it. A failure says whether trying again is worth anything: offering a retry
on a format that will never work wastes an afternoon politely.

`src/intake/vision-read.mjs` and `api/read-document.js` are the cloud
reading route, and they are the riskiest thing in the product. Not because a
model is often wrong about a drawing, but because when it is wrong it
produces a plausible number rather than a gap. The rule reader fails by
finding nothing, which is visible; this fails by finding something, which is
not.

So nothing rests on the model behaving. A proposal must name a field from the
same closed list the rule reader uses, must carry the printed text it was
read from, and that text must actually contain the value — which is what
separates "I read this here" from "this is what I think it says". Anything
describing itself as measured or scaled is dropped outright, because no
dimension may come from pixels. Drops are reported rather than filtered: a
reply where six of eight readings were discarded is the shape of a model that
has started inventing, and keeping the two that passed would hide it.

The endpoint cannot be used as a general model. The instruction is built
server-side from the same module the browser checks the answer against, and
only three things are read off the request — the image, its type, and whether
it is a drawing or a certificate. Nothing else the caller sends reaches the
model. Telemetry is counts and statuses only; the payload is somebody's
drawing, and the audit's critical finding was logged prompt content.

`src/services/ai/propose-edit.mjs` is the provider-backed twin of the rule
reader. It asks a model and then refuses most of what comes back: the reply
must name an operation from the closed list, only the fields an operation may
carry survive, and everything else — the numbers, the targets, the staleness —
is checked by the same validator that checks a typed instruction. With no
transport it reports that no provider is configured and the rule reader
carries on, which is the ordinary state of this build. It cannot reach a
network on its own; every call goes through a transport it is handed.

`src/studio/dxf-export.mjs` writes the top view as DXF, which is the one CAD
format this can be exactly right about: the supported geometry is rectangles
and circles, and both are DXF primitives at integer micrometre precision. It
reads its own output back and checks every coordinate against the model before
the file is offered, so a package never carries a drawing that disagrees with
its own schedule. It is geometry, not a dimensioned drawing, and says so.
There is no STEP: a block with through-holes could be an extruded profile, but
a blind pocket needs a boolean subtraction and that needs a kernel — emitting
STEP for the expressible part would describe a different part.

`src/studio/geometry.mjs` is a deliberately small parametric part: a
rectangular block, through-holes and rectangular pockets, and nothing that
would let anyone mistake it for a CAD replacement. Dimensions are integer
micrometres. The block and a rectangular pocket have exact volumes; a round
hole does not, because its volume contains pi — so a part with holes reports
a volume *interval* whose bounds provably contain the truth, rather than a
rounded figure presented as a measurement. Feature ids survive deletion,
which is what lets `requirements.mjs` detect a detached requirement instead
of handing the tolerance written for one hole to a different one.

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

## Studio visual and review update — 15 September 2026

`src/render/part-view.mjs` projects the existing block, holes and pockets into
rotatable SVG views. `src/render/studio-view.mjs` connects those views to the
existing form, with feature selection and a clearly marked resize preview.
Neither renderer computes commercial quantities or costs.

Review exports now pass the actual model revision and active feature ids.
When a model exists, part-model.json carries exact micrometre dimensions, the
material as entered, requirement records and display rows from one snapshot.
The manifest is now downloadable. scripts/build_part_review.py uses that JSON
offline to produce dimensioned review illustrations, HTML and a hashed ZIP.
It does not provide STEP, a CAD kernel, manufacturing approval or standards
verification. Saved scenarios still preserve core fields only, not the full
model, requirements and route. Download the review snapshot to retain these
engineering records. A later complete persistence increment is still needed.

Feature identities now survive deletion of the last hole and branching after
undo; a new feature cannot inherit a requirement from a discarded feature id.
The live baseline was inspected in a browser. Local browser preview was blocked
by the environment, so the supplied generated images are visual targets only.
Check the Vercel preview at desktop and mobile widths before deployment.
