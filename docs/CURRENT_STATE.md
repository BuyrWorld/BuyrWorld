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
| Modules under `src/` | 0 | 76 |
| Test files | 0 | 124 |
| Tests | 0 | 3,573, all passing |
| Inline event handlers | — | 0 — `script-src` no longer allows inline script |
| Verification steps | 0 | 7, all passing |

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

`src/intake/review.mjs` is the confirmation queue — stored with the scenario
at schema 3, so it survives a refresh — and the four answers a
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

`src/intake/read-tolerance.mjs` reads a tolerance off a drawing. The exact
side already existed — `requirements.mjs` reduces three notations to one band
in nanometres, which is why one thou and a tenth of a thou survive in the
last place — so this is only the reading, and mostly the refusing.

Two refusals matter more than the parsing. A general title-block tolerance is
not applied to anything: which dimensions it governs is a question about the
drawing, not about the text, and answering it here would put limits on
features nobody checked. And a class is not a number — "ISO 2768-m" cites a
table this product does not carry, and a deviation remembered from one would
be the most plausible wrong figure it could produce, so the citation is
recorded as unverified and the limits are not. A geometric control is kept as
written rather than read into limits, because the number beside a flatness
symbol is a zone and not a deviation from a nominal.

`src/studio/staleness.mjs` answers whether something worked out earlier
still describes the part in front of you. Two things in the Studio are
derived once and then held — the calculated plan and cost a saved estimate is
built from, and the review package handed to an engineer — and neither was
invalidated when the part changed.

The harm was specific, not theoretical. Calculate a cost, add a pocket, save
the estimate: what is stored is the cost of the part before the pocket, filed
under the part after it. Build a review package, change a tolerance, export:
the engineer receives a package citing a requirement that no longer exists.
Neither said anything was wrong, because from the inside nothing was.

Both refuse now rather than warning, which is what `specs/04` asks for.
Comparison is of exact serialised forms rather than a hash — "almost always
right" is the wrong standard for deciding whether a cost belongs to a part —
and only what a derived thing was actually stamped against is reported, so a
package that never depended on the quantity is not invalidated by the
quantity moving. A warning that cries wolf is one people learn to click
through.

`src/case/narrative.mjs` is what a case says, worked out rather than
written. `specs/05` asks every case to use five headings — what happened, why
it matters, your options, the recommended next step, evidence and missing
information — and five headings like those are exactly the shape of a thing
that wants to be generated. Generated prose with numbers in it is the failure
this codebase is built to prevent, so a narrative is not text: it is a list
of claims, each carrying what it rests on and what it is waiting for, and the
sentence is assembled from them.

One line of the spec decides whether the whole thing is honest — *"show a
numerical impact only after relevant inputs are confirmed"*. A claim that
carries a figure names the inputs it depends on, and if any is unconfirmed
the figure is absent with the reason in its place. Not rounded, not hedged,
not grey with an asterisk. A figure that names no dependency is refused at
construction, and so is a claim whose own sentence already contains its own
figure — withholding the field does nothing about "about £1,250" in the
words, and the words are what a reader sees.

Nothing in it renders. Where and how much of it appears is the projection's
business, which is what makes "all views use the same facts" something a test
can check rather than something a team intends.

`src/case/projection.mjs` is the same case shown to different people, and
it is a selection over the claims and nothing else — it cannot add one,
reword one, or put back a figure that was withheld. That is what makes
`specs/05`'s "all views use the same facts" a property a test can check
rather than an intention a team has: there is one set of facts, and every
view is a subset of it.

Role and depth are separate switches, as the spec requires. Role picks a
starting depth and caps the next actions — a junior buyer is given one,
because three next actions is a list to choose from and that is the thing
somebody new has no basis for doing yet. Depth decides how much detail. The
one rule that holds everywhere is that no role at any depth hides a material
claim, and whether a claim is material is decided by the claim rather than by
the reader.

Scope reports what is true instead of drawing a control. `specs/05` wants
scope reflecting permitted team, site and region data; there are no accounts
here and one browser's cases, so a scope control would filter nothing — and a
control that appears to restrict what somebody sees while restricting nothing
is a claim about safety that is not true.

`src/case/from-quote.mjs` is the first producer — a supplier's price
increase, said as a case. `cost-bridge.mjs` already decomposed a claimed
increase into the part the drivers warrant and the part nothing supports;
what was missing was anything turning that into the five sections a person
reads. So it arranges and does not calculate: every figure it carries came
out of the bridge in the bridge's own exact types, and a test asserts no
arithmetic helper is even imported.

The rule it exists to enforce is the softer neighbour of one already here.
The bridge refuses to let an `ai-inferred` value into arithmetic at all. This
handles the figure that is arithmetically sound and rests on a share of unit
cost somebody assumed rather than sourced — real, and showing it as settled
is how an assumption becomes a negotiating position. Those figures wait on
every assumption `assumptionsToVerify` found, and partial confirmation is not
confirmation.

Two things are marked material, so no role at any depth can hide them: the
part of the request no driver supports, and any share of unit cost nobody has
attributed to a driver at all — no movement has been claimed against it and
none ruled out either.

The case view on the deflation page is the first Phase 2 surface, and it
decides nothing. Which claims, whether a figure may appear, and what each
sentence says were all settled before it ran; it turns that into markup and
no more, which is what keeps "all views use the same facts" true of the
screen rather than only of the modules. Five lines of `index.html` — one
container — and the rest is generated.

A withheld figure leaves nothing behind. No dash, no greyed number, no
asterisk: a placeholder where a figure would go is a figure as far as a
reader in a hurry is concerned. The sentence beside it already says what is
missing, and each assumption in the evidence section carries the tick that
settles it. Confirming every one brings the figures out; confirming most of
them does not.

Role and depth are the person's, not the case's — `specs/04` says role and
depth preferences are user settings rather than engineering facts, so they
are deliberately not saved with a scenario.

`src/case/brief.mjs` is the last thing the Phase 2 gate asks for — a draft
a junior buyer can send their manager. It composes rather than summarises:
every line comes from a claim already resolved against what is confirmed,
which is the only way to guarantee the thing that matters most here. A figure
withheld on screen cannot reappear in the brief. A brief is the artefact that
leaves the building, and if the rule held everywhere except the document
somebody emails it would hold nowhere that counted.

It leads with what is missing rather than burying it. A case is read top to
bottom and can afford to end with the gaps; a brief is skimmed, and a caveat
at the end of a skimmed document is a caveat nobody read. It says it is a
draft in the opening lines and again at the close, and it separates the
calculation from the judgement — the figures come from a tested engine and
what to do about them does not.

An incomplete brief is still offered, because "here is what I cannot answer"
is a useful thing to tell a manager and refusing to produce one would be the
tool deciding that for somebody.

`src/case/specialists.mjs` decides who has something to say about a case.
`specs/06` leads with the rule that shapes it — *"use an orchestrator to
select relevant specialists, not five verbose chat windows on every task"* —
so the selection is made on evidence: a specialist appears when the case
holds what it needs, and is listed as not consulted, with the reason, when it
does not. Five cards on every case is the failure mode; after the third case
where delivery had nothing, nobody reads any of them.

Consulted-and-found-nothing is reported differently from never-asked. Left
blank they look the same, and they are very different claims.

The findings come from engines already here — the bridge holds the
unsupported share, `negotiation.mjs` builds the ladder and the walk-away,
`batna.mjs` knows whether a supplier could be replaced. Nothing is generated
around them. Two specialists agreeing becomes one line naming both; two
disagreeing stay two findings, because resolving a contradiction by keeping
the more confident one is the invented consensus the spec forbids — and there
is no confidence to compare, deliberately. A number for how sure something is
invites arithmetic on it and there is nothing behind it to divide.

The technical specialist never signs anything off. A card saying a part is
fine would be the most dangerous sentence this product could produce.

`src/case/intake.mjs` is the five entry routes `specs/05` names, and the
interesting part is not the routing. Four of the five lead somewhere and one
does not: rescuing a late delivery needs an engine this build has not got. A
card offering it anyway would be a door into an empty room, and somebody who
opens one stops trusting the other four — so the route says it is not ready
and describes what is absent rather than promising it soon.

Describing a problem routes by written rule. No model: a router that reads a
sentence with a prompt can be talked into the wrong tool by the sentence, and
the sentence is being typed by somebody who does not yet know which tool they
want, which is exactly when being sent confidently to the wrong one costs
most. The rules are narrow enough that ordinary questions match nothing, and
where two match it offers both — a late delivery and a price increase in one
sentence is one problem with two halves, and picking one is picking wrong
half the time. Nothing is ranked, because a score here would be the
confidence percentage `specs/06` forbids wearing a different hat.

The task band on the home page is where those routes are shown. It sits
after the hero rather than replacing it: `specs/05` asks the page to lead
with "What are we solving today?", and what a public home page opens with is
a decision for whoever owns the site rather than one to take while
implementing a spec. Sixteen lines of markup; everything in it is built in
app.js.

Describing a problem offers buttons rather than navigating. Matching one rule
is not certainty, and sending somebody straight to a page on it is the
confident wrong answer the router exists to avoid. Nothing saved shows
nothing at all — an empty "recent work" heading on a first visit is a product
telling somebody they have forgotten something they never did.

`src/case/briefing.mjs` answers what changed since you were last here.
`specs/05` calls it a daily brief; it is not called that, because "daily"
implies a schedule, somewhere the schedule runs, and a reason to expect
something new each morning — and this build holds cases in one browser with
no accounts and no server. Nothing changes while nobody is here. The smaller
question is real, and answering it honestly beats answering a bigger one by
implying facts that do not exist.

What needs somebody is sorted from what does not, and each list is capped at
three separately — truncating before sorting is how the one thing that
mattered ends up below three that did not. What is not shown is said rather
than implied by a short list. Nothing counts consecutive days, nothing is
overdue, and "nothing changed" is a statement rather than a congratulation
for the absence of work.

The rule with teeth is the money. Estimated opportunity, agreed savings and a
realised outcome are three different things and are never added together.
There is no total field, and the absence is the feature: the three are all
money sitting in one list, summing them is the easiest thing anybody could
add here, and it is how a tool starts reporting savings nobody made.

It is shown on the home band, above the routes, and only when something has
moved. Marking it seen is a deliberate act rather than something loading
does: clearing it on load means a reload loses it, and somebody refreshing to
read it again finds it gone with no way back — the worst possible behaviour
for a list whose whole job is to be read.

`src/calc/scenarios.mjs` is the start of Phase 3 — the three what-ifs
`specs/06` names, in the calculation layer where the no-float rule holds. A
scenario is a copy carrying an explicit badge and the plan revision it was
explored against; nothing about exploring one changes the plan, and adopting
one is a separate act with a name against it.

Missing inputs produce questions rather than figures, and one missing input
withholds everything. Four of five answered is the most tempting moment to
show what can be shown, and a comparison with three of four columns invites
somebody to read the three. Nothing is scored or totalled: a composite would
let a cost saving outvote a missed build date, which is a judgement nobody
asked this to make.

It is on the page now, at the foot of the case: three named options, the
module's own questions as the form's labels, and — once they are all
answered — the four axes in the module's own sentences. The page performs no
arithmetic of its own, which is checked by comparing what it renders against
what the module returns, character for character.

The plan a scenario is an alternative to is built from the calculation on
screen rather than stored beside it, and its revision is the figures
themselves. Recalculate at a different price and every scenario explored
against the old ones says so, refuses to be adopted, and marks the ones
already adopted rather than deleting them. Adopting records who, when and
against what; it does not move a figure, order anything or tell a supplier.
The page says so where the button is, because a button called *Adopt* that
silently did nothing would be worse than either.

Typing into a field records it and redraws nothing — a redraw per keystroke
takes the caret out of the box — so the figures, and the questions, arrive
when somebody asks for them.

`src/case/supply-scene.mjs` is the other half of Phase 3: supplier,
transport, production, customer, as this case actually knows them. A supply
chain diagram is the easiest thing in this product to fake — four boxes,
three arrows, an amber dot on the one that looks interesting — and it would
look like insight while knowing nothing, which is why `specs/06` says
*populated from the case rather than decorative pseudo-data* and why this
module is mostly a set of refusals.

A stage says only what the case holds. A price-increase claim knows a great
deal about a supplier and, usually, nothing whatever about transport, so
transport says that and names what would fill it. No figures appear anywhere
in it: the case above withholds every money and percentage figure until the
assumptions under it are confirmed, and a chain quietly showing the same
numbers would be a second door into what that withholding had just closed.

A bottleneck is named only when the case names one, and only from questions
the figures themselves raise — a driver claimed against no source, or a part
of the unit cost covered by no driver at all. An open question like whether
the annual quantity is a commitment does not nominate a stage; without that
distinction production would be the bottleneck of every case ever opened,
which is a decoration rather than a finding. Where two stages carry something
material, it says which two and declines to choose.

An adopted what-if is a fact about the case and populates transport and
customer. An unadopted one never reaches it: a scenario badged *NOT THE PLAN*
appearing in the plan's own diagram is exactly the disguise `scenarios.mjs`
refuses to wear, and there is a test that holds it out.

On the page it is an ordered list of four boxes with arrows between them,
rather than a picture with an accessible list beside it. `specs/06` asks for
"an accessible list of the same information"; two renderings of one thing
drift, and the one nobody looks at is the one that rots. The tick beside a
question is the case view's own tick, against the same assumption id, so the
two places cannot disagree about what has been checked.

Phase 4 is the call. `src/case/call.mjs` is the sheet somebody takes in,
the notes they write while it is happening, and what those notes propose was
agreed. Everything on the sheet is derived from the case — the questions come
from the negotiation ladder and from the assumptions the provenance layer
found, each of which already knows what would settle it — and a question it
cannot derive is left as an empty slot rather than filled with "ask about
their cost base", which is what makes a sheet look finished when it is not.

Commitments are read out of notes by written rule. A line that commits nobody
to anything produces nothing at all: a reader that finds an action in every
line is one people stop reading. An unknown date stays unknown — "next week"
is not a date and neither is "12 October" in a year nobody wrote down, and
`12/10/2026` is refused outright because it is two different days depending
on where you are. A commitment missing its date cannot be confirmed; it can be
corrected into one, or marked unknown, which is a decision and is recorded as
one.

Nothing in that module writes anywhere, and it imports nothing that can. That
is how *"notes retained only by explicit save"* is kept: not by remembering not
to save, but by having nowhere to save to. `src/services/call-store.mjs` is the
one place a note can be written, it runs when somebody presses the button, and
it drops every commitment nobody has looked at rather than storing a rule's
guess as a record.

`src/services/speech.mjs` is dictation, which is off. The browser has a
recogniser and it is two lines to start; on the common implementation the
audio is sent to the vendor to be transcribed, and this site tells people it
sends nothing anywhere. So what is built is everything except the decision — a
visible state machine with start, pause and stop, a recogniser supplied from
outside rather than reached for, and an unavailable state that says *why*
instead of greying a button out. The module never reads a global, which is
what makes "it cannot start a microphone the page did not hand it" a fact
rather than an intention.

`src/case/practice.mjs` is the other half of Phase 4, and the whole of it is
built around one sentence in the gate: *practice cannot send or alter live
data*. It imports nothing — not a store, not a case module, nothing — so there
is no path out of it. A session says it is synthetic in its own data, carries
the label "Practice — does not change your live case" as a field rather than a
caller's styling, and its id begins PRACTICE- so that a surface reading only
the id already knows.

The supplier is a table of replies, not a model. Difficulty changes how hard
they are to move, not how honest they are: a partner who lies more at higher
difficulty would be teaching a lesson nobody asked for. Practising on the real
case is a separate button, and what crosses is the shape of the argument —
how many drivers, how many evidenced, whether part of the cost is unexplained.
The supplier's name, the part, the documents and every figure stay behind.

Feedback names what happened and one thing to try next. There is no score, and
the field is present and null rather than absent, because `specs/07` asks for
no arbitrary competency score and an absent field is an invitation to add one.

Phase 5 is the part, connected to the money — carefully, and only when
somebody says so.

`src/studio/model-io.mjs` is the model as a file, and the file back as the
model. The package had written `part-model.json` for a fortnight and nothing
had ever read one, which meant its exactness was a property of the writer
rather than of a pair. Reading is the careful half: a dimension comes back as
an integer number of micrometres or the file does not open. Not rounded, not
coerced — "100.5" is not a micrometre count, and neither is a JSON number,
because 1e5 and 100000.4-rounded-by-whoever-wrote-it are indistinguishable by
the time they arrive. What comes back is checked against `geometry.mjs`'s own
rules, so a corrupt file is refused in the same words somebody typing it would
see. Ids and the revision survive, because a requirement points at `hole-2`
and a rebuilt model would give that name to something else. The review package
writes this format now, and a test opens the file the package actually ships.

**Measured, at last.** `scripts/eval-drawings.mjs` is the report `specs/03`
asks for by name — precision, recall, abstention and coverage by field and by
format, with every critical misread listed separately and a single one failing
the run whatever the percentages say. A wrong dimension is not the same kind of
event as a wrong part number, and one accuracy figure covering both hides the
one that scraps parts.

It runs in `scripts/verify.mjs` as the seventh check, and it ends by saying what it does
not establish: these are synthetic fixtures with recorded replies, `specs/03`
says those test routing and evaluator behaviour only, and the production gate
stays blocked until there are held-out real drawings at several quality levels.
The wrong answers that prove the scorer works live in its test rather than in
the fixture directory, because a report that can only ever say 100% is one
nobody should believe the day it says something else.

`src/studio/from-drawing.mjs` closes Phase 5's first clause from the other
end: the three dimensions somebody confirmed off the drawing fill the Part
Builder's boxes. The word doing the work is *confirmed* — it is handed
`review.confirmedValues`, which contains only what a person confirmed or
corrected, so a proposed reading cannot become a model carrying the same
authority as one somebody checked. Two of three is not a block and the third
is not zero; a value with no unit is refused in `units.mjs`'s own words; and a
drawing giving a diameter is refused as a bar rather than squared off into a
part nobody drew. It fills the boxes and stops there — building is still *Set
the block*, pressed by somebody looking at the numbers.

`src/studio/to-cost.mjs` is the transfer the September audit asked for: *"Do
not silently use model mass as purchased stock mass. A future explicit,
reviewed transfer should explain stock allowances, removed volume and material
evidence."*

The part is not the blank. It was cut from something larger, and how much
larger is a decision about machining and holding rather than a number that can
be derived, so the three allowances are asked for and a missing one withholds
everything — a blank the same size as the part is an allowance of nothing,
which is the single assumption that makes every downstream figure quietly too
low. What crosses into the costing form is the blank's dimensions; purchased
mass is not offered at all, and the field is present and null so that nobody
fills it in later by accident. A part whose volume is a bracket hands over no
single figure for it, and the form's finished-part boxes are filled only when
the part really is a plain rectangle, which is what the form's own note asks
for. The transfer is stamped with the geometry and the material it was made
from: change either and it refuses to be carried over, in `staleness.mjs`'s
words.

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
