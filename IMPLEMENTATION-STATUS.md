# Implementation status — BuyrWorld, packs v4 and v5

**Where this stands is the table below. Everything after it is history.**

## What exists now

| Capability | State | Where |
|---|---|---|
| Should-Cost Studio, three columns | built | `index.html`, `app.js` |
| Upload drawing / No drawing, equally | built | `scEntry` |
| One model behind both routes | built | `src/studio/scenario.mjs` |
| Provenance, "I don't know", field help | built | `SC_FIELD_HELP` |
| Save and reopen a draft | built | `src/services/studio-store.mjs` |
| A late drawing compares, never overwrites | built | `compareExtraction` |
| Engineering requirements (v4 C1) | built | `src/studio/requirements.mjs` |
| Part Builder, bounded (v4 C2) | built | `src/studio/geometry.mjs` |
| Technical-review package (v4 C3) | built, within its limits | `src/studio/review-export.mjs` |
| Described edits, validated (v4 C4) | built | `src/studio/edit-proposal.mjs` |
| Instructions read by rule, no model | built | `src/studio/read-instruction.mjs` |
| Rotatable preview, feature selection | built, unseen in a browser | `src/render/` |
| Offline review dossier | built, unrun here | `scripts/build_part_review.py` |
| **v5 Phase 1** — read a picture of a drawing | built, no provider configured | `src/intake/` |
| A drawing viewer, and a queue somebody reviews | built | `src/intake/viewer.mjs`, `src/intake/review.mjs` |
| Scanned and mixed PDFs, page by page | built, unrun against a provider | `src/intake/vision-read.mjs` |
| **v5 Phase 2** — the same figures, said as a case | built | `src/case/narrative.mjs` |
| Role and depth, which never hide a material risk | built | `src/case/projection.mjs` |
| Specialists, consulted only where the case holds enough | built | `src/case/specialists.mjs` |
| A draft brief for a manager | built | `src/case/brief.mjs` |
| A task-led way in, and what changed since last time | built | `src/case/intake.mjs`, `src/case/briefing.mjs` |
| **v5 Phase 3** — three what-ifs, in exact money | built | `src/calc/scenarios.mjs` |
| The what-ifs on the page, adopted with a name against them | built | `app.js` |
| The chain, as the case knows it | built | `src/case/supply-scene.mjs` |

## What does not exist

| | Why |
|---|---|
| A solid-model or drawing export | No geometry kernel. The package names both as absent, with reasons, and is never marked complete. |
| Curves, fillets, chamfers, freeform | The builder is rectangular blocks, through-holes and rectangular pockets, and says so. |
| A configured AI provider | Instructions are read by written rule — the path that must keep working after one arrives. |
| A configured extraction service | `src/intake/extract-document.mjs` reads by rule, offline, and proposes unconfirmed candidates. |
| Model-to-cost linkage | Deliberate. Using model mass as purchased stock mass would skip the allowances a buyer is answerable for. |
| Any browser verification | See below. |
| Any real case | The corpus is zero. Every engine has only met synthetic fixtures. |

## What to do next

**`docs/BROWSER-CHECKS.md`** — 68 checks in the order worth doing them, each
mapped to the pack acceptance line it closes. **Nothing here has been opened
in a browser**, and v5 Phases 1 to 3 have added a reader, a case view, three
what-ifs and a chain since that list was written. Sections 9 and 10 cover the
last two. About three hours.

Then **v5 Phase 4** — practice and pocket, in `specs/07`: responsive
before/during/after call screens, user-initiated transcription, editable
action extraction and isolated negotiation practice. Its gate is that
practice cannot send or alter live data.

Two things Phase 3 deliberately stopped short of, so they are not mistaken
for oversights. Adopting an option records the decision and does not apply it
to the plan — applying it needs a plan somebody can edit, which this tool
does not yet have. And the chain reads the case; nothing writes back to it.

Then one real case end to end, which would teach more than the next feature.

## Decisions

- **The pack's reference implementations are not adopted.** `material-planning.mjs`
  and `money.mjs` are reference code; the repository's equivalents are verified
  and exact. Adopting the pack's would be a regression.
- **The approved PNG governs composition, not arithmetic.** Its stage prices do
  not reconcile with its headline total, its nesting figure is not a geometric
  result, and its High/Medium confidence chips are explicitly rejected by
  `design/04-APPROVED-STUDIO.md`. None of them enter the code.
- **Provenance vocabulary** follows the pack: *User confirmed*, *Extracted —
  check this*, *Assumed*, *Missing*. The repository's existing `provenance.mjs`
  already distinguishes these; the labels are a presentation mapping onto it.

---

## How it was built

A record, in the order the work happened, kept because it says *why* each
thing is the way it is and the table above only says *what*.

**Every entry is as-at the moment it was written.** An entry that says
something is not built is reporting the state on that day, not today; the
table above is the only description of now. This document grew as a diary
and read as a description, which is how it came to say C4 was unstarted
two lines above the entry recording it done.

### 16 September — an external audit, applied

A pack built against `27b1196`, supplied as a patch. It found two real
defects, both mine, and both verified here before the patch was accepted.

`nextId()` took the highest existing feature number, so deleting the
*highest* hole and adding another reissued that id — and a tolerance written
for the deleted hole attached itself to the new one. The comment in
`geometry.mjs` names that exact failure; I implemented a defence against the
middle-deletion case and tested precisely the case my defence handled.

And `scExportReview` passed `features:[]`, so every exported package told a
reviewer that every requirement had lost its target while the part still had
the holes.

It also added a rotatable preview, feature selection, a pending resize
preview, `part-model.json`, and an offline Python review generator. Applied
on a branch, because it is a large amount of interactive surface nobody has
seen render.

### One scenario at a time

"Start a new one" cleared four of nine pieces of per-scenario state, so a
new scenario opened carrying the previous project's part, its tolerances,
its undo history and its prepared export. Saving never carried the model or
the requirements at all. Both are fixed; the store is at schema 2 with 1
still readable.

A test now reads the module-level `_sc` declarations and fails if
`scClearSession` misses one. It immediately found `_scLast`, which I had
missed.

### The home page said nothing was stored

It did, while six `localStorage` stores existed — and the site's own legal
page said so accurately two clicks away. "Four ways in" sat above five
pillars. The count is derived from the list now, and
`tests/security/public-claims.test.mjs` checks both.

Neither was caught by anything: every figure in the engine is derived or
ratcheted, and these were prose on the most-read page.

### Slice 1 — a piece count without a thickness · DONE

`planMaterial()` crashed on the manual route the pack requires.
`design/05-NO-DRAWING.md`: *"For geometry-only piece counts, no alloy density
or rate is needed."* The function computed `boughtVolume` unconditionally from
an optional `stockVolumeUm3`, so a plan with no thickness died on
`undefined * BigInt` — while every neighbouring use of volume was already
guarded. No test caught it because the Should Cost form makes thickness
mandatory, so no caller had ever left it out.

Volume and gross mass are now withheld (`null`) rather than fabricated or
fatal, which is the module's existing convention for a missing input.

- `src/calc/should-cost.mjs` — guard `boughtVolume`, `offcutVolume`, `grossUg`
- `tests/unit/quantity-only-plan.test.mjs` — 14 tests, including the pack's
  reference fixture run against this engine. Nine fail with the guard removed.

Checks: `node scripts/verify.mjs` — all 6 passed, 1,931 tests.

### Slice 2 — one model behind both entry paths · DONE

`src/studio/scenario.mjs` and `src/services/studio-store.mjs`, with 61 tests.
Blank / unknown / zero kept distinct; entered text kept beside its conversion;
an extracted value is a proposal until accepted, and a late extraction cannot
overwrite a newer manual edit. Completeness is reported per output, so a
quantity plan can be ready while a cost is blocked.

Checks: all 6 passed, 1,992 tests.

### Slice 3 — the approved layout and the two ways in · DONE

- `index.html` — entry choice; `.bw-studio` grid at the approved 28/42/30;
  the result moved out from under the form into the third column
- `app.js` — `scEntry`, registered in the action table
- `tests/integration/studio-layout.test.mjs` — 24 tests

The drawing reader was panel "0 · Read it off the drawing", above the form
and marked *optional*. That reads as the way in, with typing as what you do
when it fails — the framing `design/05-NO-DRAWING.md` rules out. The two are
now peers of identical size, and the reader lives inside the upload choice.

Checks: all 6 passed, 2,016 tests.

### Slice 4 — provenance, "I don't know", and help on every field · DONE

- `app.js` — `SC_FIELD_HELP` (ten fields mapped to scenario names, each with
  what it means and where to find it), `scFieldState`, `scAnnotate`,
  `scDontKnow`, `scUnknownFields`; `scRun` refuses by name
- `index.html` — styles for the provenance row and the help disclosure
- `tests/integration/studio-fields.test.mjs` — 28 tests
- `tests/integration/should-cost-wiring.test.mjs` — 4 more, end to end

The controls are attached programmatically rather than written into sixteen
labels: identical markup sixteen times is sixteen chances to get one wrong,
and CLAUDE.md asks for a large `index.html` change to be split instead.

Marking a field unknown clears it as well as disabling it — a disabled input
still hands its old value to anything reading `.value`, which is exactly the
invisible default the pack forbids.

Checks: all 6 passed, 2,048 tests.

### Slice 5 — saving unfinished work, and picking it up again · DONE

- `mount.mjs` — the scenario model and store exposed on `window.BW`
- `app.js` — `scFormScenario`, `scApplyScenario`, `scSaveDraft`,
  `scNewDraft`, `scOpenDraft`, `scDeleteDraft`, `scRenderDrafts`
- `index.html` — a "Your scenarios" panel at the top of the left column
- `tests/integration/studio-drafts.test.mjs` — 24 tests

The form is the source of truth while you type; the scenario is what gets
written down. Nothing keeps a third copy.

Saved work sits at the top of the column rather than the bottom: the opening
question is whether you are starting something or picking something up, and
at the foot of a long form reopening is a thing you find by scrolling past
the work you were trying not to repeat.

Checks: all 6 passed, 2,072 tests.

### Slice 6 — a drawing that arrives after you have typed · DONE

`exApply` overwrote. It walked the confirmed rows and assigned straight into
the inputs, so somebody who typed their dimensions and then found the PDF
lost what they typed, silently. The drawing path now compares.

- `app.js` — `scCompareDrawing`, `scAcceptOne`, `scKeepOne`,
  `scAcceptEmpty`, `scRenderComparison`, `scReadStarted`, `_scEdited`
- `mount.mjs` — `compareExtraction`, `acceptCandidates`, `labelOf`
- `index.html` — the decision panel, under the fields it concerns
- `tests/integration/studio-conflicts.test.mjs` — 30 tests

The certificate reader is deliberately untouched: it fills a different form
with its own review flow.

Checks: all 6 passed, 2,102 tests.

### v4 C1 — engineering requirements · DONE

Roadmap exit gate: "Scoped/versioned records save and reopen." Its stated
value is entering tolerances, finishes and specs **even without geometry**,
and that qualifier is the design — nothing in this module needs a model.

- `src/studio/requirements.mjs` — eight kinds of requirement, four scopes,
  exact tolerances, attachment tracking, conflict detection, a schedule, and
  persistence
- `tests/unit/requirements.test.mjs` — 61 tests

Two findings from the tests. Micrometres cannot hold one thou (0.001 in is
25.4 um), so deviations count in nanometres — units.mjs stays in micrometres,
correctly, because it measures parts rather than deviations. And a record
could not be stored at all, because every limit is a BigInt and
JSON.stringify throws on those; it uses the tagging format
outcome-store.mjs already established.

C2 (parametric builder), C3 (review export) and C4 (AI-assisted edits) are
**not** started. All three need a deterministic geometry kernel, which this
repository does not have and which is not something to improvise.

Checks: all 6 passed, 2,163 tests.

### v4 C1 on the page · DONE

- `mount.mjs` — the requirements module exposed
- `app.js` — `SC_REQ_FORM`, `scReqFromForm`, `scAddRequirement`,
  `scReqKindChanged`, `scRenderRequirements`
- `index.html` — the panel, in the centre column beside the route
- `tests/integration/requirements-wiring.test.mjs` — 31 tests

The panel sits next to the manufacturing route because both answer "what does
this part need doing to it" — one commercially, one technically.

Two deliberate absences, both tested: no list of standards to pick from (it
would imply the tool knows what they contain), and nothing pre-filled.

Checks: all 6 passed, 2,194 tests.

### v4 C3 — the technical-review package · DONE, within its limits

Built under the roadmap condition: a requirements review sheet without a CAD
file is allowed *"but must label that limitation and must not claim the CAD
export feature complete."*

- `src/studio/review-export.mjs` — snapshot, schedule (HTML and JSON),
  review notes, manifest with real SHA-256, and a verifier
- `app.js` / `index.html` — the panel, under the result
- `tests/unit/review-export.test.mjs` — 35 tests
- `tests/integration/review-export-wiring.test.mjs` — 15 tests

Produced: the requirement schedule to read, the same as data, the open
questions, and a manifest whose hashes are checkable against the bytes.

**Not** produced, and named in the package with reasons: `model.step` and
`drawing.pdf`. A package from this build is therefore never "complete", and
says so.

Checks: all 6 passed, 2,244 tests.

### v4 C2 — the bounded Part Builder · DONE

- `src/studio/geometry.mjs` — block, through-holes, rectangular pockets,
  validation, stable ids, bounded volume, mass, undo
- `tests/unit/geometry.test.mjs` — 39 tests

Scope is deliberately small and the module says so: no freeform surface, no
fillet, no revolve. What it does have is exact integer dimensions, volume
that is exact for rectangular features and a provable interval where a hole
puts pi into the arithmetic, and feature ids that survive deletion.

That last one is why this was worth building now. C1 attaches requirements to
feature ids and detects a detached one — but the page passed an empty feature
list, so DETACHED had tests and could never occur in the product. The third
instance of that pattern this month.

The interface is built: a plan view drawn to scale from the model, features
listed and removable, undo, and volume and weight shown as a range wherever a
round feature puts pi in the arithmetic.

`scRenderRequirements` now receives the real feature list, so a deleted hole
detaches its requirement **in the product** rather than only in the module.

Wiring it found a modelling error in C1. `attachments()` decided a part had
been modelled by asking whether the feature list was empty — so deleting the
only hole on a block made the requirement that just lost its target report as
waiting for a model sitting right there. The caller now says which: null for
no model, an array (empty or not) for a model carrying those features.

*(At the time: C4 was not yet started. It is now — see the table above.)*

### v4 C4 — AI-assisted edits · DONE

- `src/studio/edit-proposal.mjs` — a closed list of operations, target
  resolution, staleness, preview through the real geometry, acceptance
- `tests/unit/edit-proposal.test.mjs` — 38 tests

A proposal is data checked against a closed list, not code. Nothing is
evaluated; an operation the list does not hold cannot be expressed. Ambiguity
becomes a question. A stale proposal is refused, and so is accepting a
preview of a part that has since changed. What a model may not decide is held
back and reported.

Nothing here calls a model: a proposal arrives as an object from wherever and
is validated the same way, which is what keeps the manual path working with
no AI service configured.

Mutation-checked five refusals; all five are caught.

`src/studio/read-instruction.mjs` reads a typed sentence into that proposal
shape by written rule, with no model — so the feature works with no AI
service configured, which the pack requires twice. It knows five phrasings
and refuses the rest, showing what it can take. The requests the pack names
are answered by name.

The panel is built: type, see the steps in plain words and what the change
would cost in requirements, then accept or leave it.

Still to do when a provider is configured: an adapter prompt producing
proposals in this same shape. It goes through the same validation, and the
rule-based reader stays as the path that works without one.

---

## Baseline

| | |
|---|---|
| Commit at start | `a464b60` |
| Branch | `main`, clean |
| Runtime | Node 24.18.0. No `package.json`, no build step, no framework. |
| Hosting | Vercel, `framework: null`. Push to `main` deploys production. |
| Entry point | `index.html` (133KB markup) + `app.js` (507KB) + `mount.mjs`, which mounts `window.BW` |
| Router | `go(page)` over `.page` sections; no hash routing |
| Persistence | `localStorage` via `src/services/*-store.mjs` |
| Auth | None. Single-user browser application. |
| Money | `src/calc/exact.mjs` — BigInt minor units, ratios scaled 1e9. No floats in `src/calc/`. |
| Checks | `node scripts/verify.mjs` — 6 checks, 1,931 tests |
| Pre-existing failures | None. All six checks passed at baseline. |

## What the pack asks for that already exists

The repository is further along than the pack assumes. Before building anything
new I checked the pack's own acceptance fixture
(`acceptance/STUDIO-V3-CHECKS.md`) against `src/calc/should-cost.mjs`:

| Pack figure | This engine | |
|---|---|---|
| 81 blanks per sheet | 81 | agrees |
| 114 blanks required | 114 | agrees |
| 2 sheets | 2 | agrees |
| 144 expected good units | 144 | agrees |

So `engineering/material-planning.mjs` in the pack is **not** being adopted.
`engineering/01-INTEGRATION.md` says to "prefer a verified existing
equivalent", and this one is verified, exact-integer and already covered by
tests. The same applies to `money.mjs`: `src/calc/exact.mjs` supersedes it.

Also already built, from earlier work: certificate checking (`certificate.mjs`),
mill performance (`mill.mjs`), quote comparison (`sourcing.mjs`), negotiation
(`negotiation.mjs`), supplier history, portfolio reporting, the radar, rule-based
document extraction (`src/intake/`) and the Inbox routing. Pack sections 11's
"remaining supported improvements" are largely present; what they lack is the
approved Studio shell, not the domain logic.
