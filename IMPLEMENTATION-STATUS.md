# Implementation status — BuyrWorld Claude Pack v4

Maintained so work can resume without repeating what is done. Newest first.

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

## Slices

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

### v4 C2 — the bounded Part Builder · engine DONE, UI not yet

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

Still to do: the Part Builder interface, and passing the real feature list to
`scRenderRequirements`. C4 (AI-assisted edits) remains unstarted.

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

## Limitations

- No extraction service is configured. `src/intake/extract-document.mjs` reads
  by written rule, offline, and proposes unconfirmed candidates — which
  satisfies the pack's "manual completion honestly" requirement without
  pretending an AI service exists.
- No browser testing has been performed in this programme. Verification so far
  is the repository's own checks plus execution of served bytes under `node:vm`.
- No CAD kernel, geometry engine or export service exists yet. Part Builder
  (v4 C2/C3/C4) is specified, not built.

## Next slice

The pack's v3 Studio requirements are now implemented end to end. Next is
either the v4 Part Builder (C1: requirements — tolerances, finishes and
specification revisions — which needs no geometry engine), or a browser pass
over the six slices, which nothing so far has had.
