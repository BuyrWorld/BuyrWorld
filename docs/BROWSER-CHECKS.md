# What still needs a browser

Everything in the v4 programme was verified by executing the code — the
repository's own checks, plus running the *served* bytes under `node:vm` and
fetching the deployed modules to drive them directly. That is stronger than
reading, and it is blind to an entire class of fault.

It cannot see a layout collision, a focus trap, a control that is unreachable
by keyboard, text that clips at 200% zoom, or whether the Studio actually
resembles the approved image at 1440px. **No part of this has been opened in a
browser.** This file is the list of what that leaves unverified, in the order
worth doing it.

Each item names the pack's own acceptance line it settles. Sixty-three
acceptance items exist across the three checklists; the ones below are the
ones no amount of executing code can close.

---

## 1 · The approved layout — 20 minutes

`acceptance/STUDIO-V3-CHECKS.md`: *"Existing original logo reused and
unclipped; actual palette verified; approved three-column layout preserved at
desktop."*

Open **Analysis → Should Cost Expert** at 1440px beside
`design-handoff/BuyrWorld-Claude-Pack-v4/references/approved/should-cost-studio.png`.

- [ ] Three columns, roughly 28 / 42 / 30 of the content width.
- [ ] The result sits beside the work, not below it. Change a blank dimension
      and the figure that moves is still on screen.
- [ ] The logo is whole. It was clipped by the sidebar once before, above
      1080px, which is how `tests/integration/shell.test.mjs` came to exist.
- [ ] Nothing scrolls sideways at the page level. A wide table scrolling
      inside its own box is correct; the body doing it is not.

Then **390px**, **768px** and **200% zoom**:

- [ ] At 1200 the result column drops below the two working columns.
- [ ] At 860 everything stacks: enter, route, result — in that order.
- [ ] The two entry choices become one column at 760 and stay the same size
      as each other.

## 2 · The keyboard — 15 minutes

`RELEASE-GATES.md`: *"Keyboard navigation, focus restoration, mobile menu,
labels and chart equivalents verified."*

This is the one I would do first if there were time for only one. The page
lost every inline handler when `script-src` dropped `unsafe-inline`, and one
keyboard path broke silently in that conversion — `cardKey` read
`e.currentTarget`, which under delegation is the document. It was caught, but
by reading, and reading is exactly what missed it the first time.

- [ ] Tab to a card on the home page and press **Enter**. Then **Space**.
- [ ] Tab through the Studio's entry choice. Both options reachable, the
      chosen one announced (they carry `aria-pressed`).
- [ ] Every "What does this mean?" disclosure opens from the keyboard.
- [ ] The "I don't know" control on each field is reachable and toggles.
- [ ] Focus is visible at every stop. Not "mostly".
- [ ] Open a page from the sidebar and check focus moves to `<main>` — a
      screen reader otherwise stays on the old content.

## 3 · The manual route, end to end — 20 minutes

`STUDIO-V3-CHECKS.md`: *"Manual entry succeeds without filename, document ID,
upload record or extraction job"*, and the reference fixture.

Choose **No drawing — enter details manually** and enter the pack's own
figures: 100 good units, stock 1000 × 500 mm, blank 100 × 50 mm, edge 10 mm,
kerf 3 mm, 2 setup blanks, 90% pass rate, no rotation.

- [ ] It produces **81 blanks per sheet, 114 blanks, 2 sheets**. Those are the
      pack's numbers and this engine's numbers; if the screen disagrees with
      them, the wiring is wrong rather than the arithmetic.
- [ ] Mark the kerf **I don't know**. The calculation refuses and names it.
- [ ] Save as a draft. Reload the page. Reopen it. The kerf still reads
      *Not known yet* and not *Missing* — those are different answers and the
      distinction has to survive storage.
- [ ] Leave the material rate empty. A quantity plan appears; a cost does not,
      and says which figures it is waiting on. **No zero total anywhere.**

## 4 · The drawing conflict — 10 minutes

`STUDIO-V3-CHECKS.md`: *"Late extraction cannot overwrite newer manual edits;
later upload shows conflicts and keeps current values until accepted."*

Type a blank width, then switch to **Upload a drawing** and read a PDF that
contains a different width.

- [ ] Your typed value is still in the box.
- [ ] The comparison appears under the fields it concerns, showing both.
- [ ] **Keep mine** leaves it alone; **Use the drawing's** replaces it and the
      field then reads *User confirmed*.
- [ ] Choosing an entry path clears nothing either way.

## 5 · The Part Builder — 15 minutes

`PART-REVIEW-CHECKS.md`: *"A supported shape updates from numeric inputs with
explicit units and origin; invalid input preserves last valid geometry."*

- [ ] A block of 100 × 50 × 10 draws a plan view to scale.
- [ ] A hole at 900, 25 is refused, the drawing does not change, and **the
      numbers you typed are still in the boxes**.
- [ ] Volume shows a *range* once a hole exists, and a single figure before.
      A bracket displayed as one number is the thing the engine avoided.
- [ ] Add a tolerance scoped to `hole-1`, then delete `hole-1`. The
      requirement reports **Needs reattaching** and the builder says one
      requirement now points at nothing.
- [ ] Undo brings the hole back.

## 6 · Describing a change — 10 minutes

- [ ] `add a 6mm hole at 15, 25` shows the step and changes nothing until
      **Make this change**.
- [ ] `make this aerospace grade` asks which specification applies.
- [ ] `remove hole-1` while a tolerance points at it warns *before* the
      button is pressed.

## 7 · The review package — 10 minutes

`PART-REVIEW-CHECKS.md`: *"Missing artifact or export failure cannot produce a
falsely complete package"*, *"No reviewer email… is sent merely by
exporting."*

- [ ] **Prepare review package** lists four files and, above them, the two it
      does not contain with reasons.
- [ ] Every file downloads and opens. The HTML schedule renders.
- [ ] The word *approved* appears nowhere in any of them.
- [ ] Nothing is sent. Check the network tab if you want to be sure — the
      module has no way to, and a test asserts it never grows one.

---

## What executing the code has already settled

Not repeated above, so a browser pass does not spend time on it:

- Every calculation, refusal and provenance rule — 2,399 tests.
- The engine's agreement with the pack's reference fixture, run against the
  deployed modules rather than the local copies.
- That the served `app.js` parses and its dispatch table resolves.
- That `design-handoff/` returns 404 and the strategy pack is unpublished.
- That the export module cannot send anything.

## What nothing here can settle

- **Whether the product is any good to use.** `RELEASE-GATES.md` asks for
  *"Real participant usability testing recorded, or explicitly marked NOT
  RUN."* It is NOT RUN.
- **Whether the numbers are right about the real world.** The corpus is still
  zero: every engine has only met synthetic fixtures. One real case would
  teach more than the next feature.

## A note on what a green test means here

Twice this month a mechanism was documented, tested, and unable to fire in the
product — `assertUsable()` was never handed an ai-inferred value, the
stale-extraction rule was never handed an edit time, and the detached
requirement was never handed a feature list. All three were found by building
the thing that would finally supply the missing input.

A browser pass is the same kind of instrument. It will not tell you the
arithmetic is wrong; it will tell you which of these paths a person cannot
actually reach.
