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

Slice 6 — the later-upload conflict flow. `compareExtraction` and
`acceptCandidates` are built and tested in the model; the page does not yet
call them, so uploading a drawing after typing does not yet show conflicts.
