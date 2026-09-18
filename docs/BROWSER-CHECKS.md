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

## 5 · The Part Builder and its preview — 25 minutes

`acceptance/PART-REVIEW-CHECKS.md`: *"A supported shape updates from numeric
inputs with explicit units and origin; invalid input preserves last valid
geometry."*

**The largest untested surface in the product.** The 16 September update
added an isometric view, rotation, top and front projections, feature
selection and a pending resize preview. None of it has been in a browser,
and a projection that looks plausible and is wrong is worse than no picture —
somebody will trust the picture.

- [ ] A block of 100 × 60 × 10 draws. Try **3D**, **Top** and **Front**, and
      the rotation slider. Front shows the envelope only, which is correct.
- [ ] Add a hole at 15, 20 ⌀8 and a pocket at 40, 10 of 20 × 20 × 3 deep.
      Both appear where the numbers say, and in the right proportion to the
      block. Measure one against the stated size if anything looks off.
- [ ] Select `hole-1`. Its coordinates appear and match what you entered.
- [ ] Change the width to 120. It must say **Preview · not applied** and the
      committed model must not move until **Set the block**.
- [ ] Try width 5. The part stays as it was and an explanation appears —
      the hole would fall outside, and nothing is moved to make it fit.
- [ ] A hole at 900, 25 is refused, the drawing does not change, and **the
      numbers you typed are still in the boxes**.
- [ ] Volume shows a *range* once a hole exists, and a single figure before.
      A bracket displayed as one number is what the engine avoided.
- [ ] Add a tolerance scoped to `hole-1`, then delete `hole-1`. The
      requirement reports **Needs reattaching**.
- [ ] Delete the *highest-numbered* hole, then add another. It must **not**
      reuse that id. This was a real defect — a tolerance written for a
      deleted hole silently attached itself to a new one — and the fix is
      worth confirming by eye as well as by test.
- [ ] Undo, then add a different feature. Again, no id is reused.

## 6 · Describing a change — 10 minutes

- [ ] `add a 6mm hole at 15, 25` shows the step and changes nothing until
      **Make this change**.
- [ ] `make this aerospace grade` asks which specification applies.
- [ ] `remove hole-1` while a tolerance points at it warns *before* the
      button is pressed.
- [ ] Every one of these is read by written rule. **No provider is
      configured**, and the network tab should show nothing leaving the page
      when you describe a change. If it does, something has been wired that
      should not have been.

## 7 · The review package — 10 minutes

`PART-REVIEW-CHECKS.md`: *"Missing artifact or export failure cannot produce a
falsely complete package"*, *"No reviewer email… is sent merely by
exporting."*

- [ ] **Prepare review package** lists five files — including `manifest.json`
      and `part-model.json` — and, above them, the two it does not contain
      with reasons.
- [ ] With a model built, the schedule does **not** say every requirement
      needs reattaching. It did until 16 September: the export passed an
      empty feature list, so it told a reviewer that every requirement had
      lost its target while the part still had the holes.
- [ ] `part-model.json` carries the model revision and the feature ids.
- [ ] With a model built, `drawing.dxf` is offered too, and the package says
      it is 2D geometry rather than a dimensioned drawing.
- [ ] Download it and **open it in a CAD tool**. This is the one check here
      that reaches outside the browser, and it is the only way to know the
      file is readable by the thing it exists for. The outline, the holes
      and the pockets should be on three named layers, in millimetres, with
      the origin at the bottom-left corner.
- [ ] Measure a hole. It must match what you typed exactly — the export
      checks itself before offering the file, so a mismatch here means the
      check is wrong, which is worth knowing.
- [ ] `model.step` and `drawing.pdf` are still listed as absent, each with
      a reason naming what would have to change.
- [ ] Every file downloads and opens. The HTML schedule renders.
- [ ] The word *approved* appears nowhere in any of them.
- [ ] Nothing is sent. Check the network tab if you want to be sure — the
      module has no way to, and a test asserts it never grows one.

## 8 · The Python review tool — 10 minutes, and NOT RUN here

`scripts/build_part_review.py` came with the 16 September update. **Python
is not installed on the machine this work was done on**, so its six tests
have never been executed here and neither has the script. The pack reports
them passing in its own environment; that is its evidence, not mine.

- [ ] `python -m unittest discover -s tests/python -v` — six tests.
- [ ] Download `part-model.json` from a real package, then
      `python scripts/build_part_review.py <file> --out my-part-review`.
- [ ] Open `my-part-review/review.html`. The dimensioned view matches the
      part you built.
- [ ] Run it twice with the same output name. It must refuse rather than
      overwrite.

## 9 · The three what-ifs — 15 minutes

`specs/06`: *"'What if?' creates a scenario copy with an explicit badge …
Missing inputs produce questions, not estimated facts disguised as answers."*
The arithmetic and the wiring both have tests; what they cannot see is
whether the block is legible, reachable and obviously not the plan.

Open **Tools → Supplier Claim Review**, calculate an increase, and scroll to
*What if we did it differently?* at the foot of the case.

- [ ] Open **Split the delivery**. Five boxes, each labelled with a question
      rather than a field name. Nothing below them.
- [ ] Press **Work it out** with the boxes empty. Questions appear, no
      figures — and the badge reads *WHAT IF — NOT THE PLAN* in a chip that
      carries its word, not only its colour.
- [ ] Answer four of the five. Still no figures. This is the one to look at
      hardest: a partial comparison is exactly what must not appear.
- [ ] Answer the fifth. Four axes, no total across them.
- [ ] Switch to **Expedite it** and back. What you typed is still there.
- [ ] Type a quantity in words. The refusal names the field; the case around
      it is untouched.
- [ ] Press **Adopt this option** with the name box empty. It says it needs
      one, where you are looking.
- [ ] Adopt it with a role. It appears under *Options taken*, and every
      figure in the calculation above is exactly as it was.
- [ ] Change the unit price and calculate again. The scenario says the plan
      has moved, adopting is refused, and the option already taken is marked
      rather than deleted.
- [ ] At 390px: the boxes stack, the buttons wrap, nothing scrolls sideways.
- [ ] By keyboard alone: tab to a scenario button, open it with Enter, reach
      **Work it out** and **Adopt this option**. The three buttons announce
      their pressed state.

## 10 · The chain — 10 minutes

`specs/06`: *"populated from the case rather than decorative pseudo-data …
Provide an accessible list of the same information."* The module refuses to
invent and the wiring is tested; what neither can see is whether four boxes
and three arrows read as a chain on a screen.

Above the what-ifs, at *Where this sits in the chain*:

- [ ] Four boxes, left to right, with arrows between them. Supplier and
      production carry something; transport and customer say *nothing known*
      and what would fill them.
- [ ] No number appears anywhere in the four boxes. Not after confirming
      every assumption either — check it twice, before and after.
- [ ] The line above names one stage to look at, or says why it names none.
- [ ] **I have checked this** beside an unsourced driver ticks the same
      assumption as the one in *Evidence and missing information* above: tick
      it in one place and the other says *confirmed*.
- [ ] Adopt a split delivery in the what-ifs. Transport and customer fill in,
      each naming the option and who adopted it.
- [ ] Work out a what-if and do **not** adopt it. The chain does not move.
- [ ] At 390px the four boxes stack and the arrows do not strand themselves
      on their own lines.
- [ ] With a screen reader: it is one list of four items in order. The arrows
      are not announced.

## 11 · The call, and practice — 25 minutes

`specs/07` and the Phase 4 gate. The retention rule and the refusals are
tested; what a browser settles is whether the three screens are usable on a
phone, which is where a call actually happens.

At the foot of the case, at *The call*. **Do this one at 390px first**, then
again on the desktop.

- [ ] **Before**: choose a goal, and the three question boxes fill with
      questions rather than statements. Rewrite one — it says *yours* and
      survives every later redraw.
- [ ] **During**: type a line, press Enter. It appears, the box clears, and
      the caret is still in the box. Do it five times quickly; nothing is lost.
- [ ] The microphone chip says *off*, and the sentence beside it says the
      build does not switch dictation on and why. No greyed-out button with no
      explanation.
- [ ] **After**: *Read my notes*. A line that commits nobody to anything is
      not in the list. One with no date says what it needs.
- [ ] Confirm one without touching the boxes; confirm another after editing
      its date. The first says confirmed, the second corrected.
- [ ] Try to confirm one with no date. The refusal appears where you are
      looking, not in a console.
- [ ] *Copy the follow-up*, paste it somewhere. Only checked commitments are
      under *What we agreed*.
- [ ] Close the tab without saving, reopen: the notes are gone. That is the
      promise, not a bug.
- [ ] Now save, reload, and look in devtools at `bw.calls.v1`: the notes are
      there, and the commitments nobody checked are not.
- [ ] **Practice**: start a session. The label *Practice — does not change
      your live case* is visible without scrolling.
- [ ] Play four or five moves. The supplier's replies differ by difficulty.
- [ ] *Finish and look at it*: what happened, one thing to try next, and no
      number anywhere.
- [ ] *Practise on this case*: the opening line describes the argument. The
      supplier's name and every figure are absent — check by searching the
      page text for the supplier name.
- [ ] Go back to **After**. Nothing from the practice is in the notes.
- [ ] By keyboard alone: reach all four tabs, the note box, every move button
      and *Finish*. The tab buttons announce their pressed state.
- [ ] With a screen reader on the After screen: each commitment reads as its
      own item, and the words it came from are read with it.

## 12 · Carrying the part into the plan — 15 minutes

The audit's second remaining item, built. Under the Part Builder, at *Carry
this part into the plan*.

- [ ] Before a block exists, the panel asks for the allowances and says the
      part is not the blank. It does not show a blank.
- [ ] Build a 100 × 60 × 10 block. Type 2, 2 and 1, then **Work out the
      blank**: 104 × 64 × 11, and what cutting removes.
- [ ] Fill in only two of the three allowances first. Nothing is worked out,
      and the reason says zero is a decision rather than a default.
- [ ] With no density entered, the weight line says why it is withheld. Enter
      one and it appears — and says it is not the purchased weight.
- [ ] **Put this in the costing form** with the name box empty: refused where
      you are looking.
- [ ] With a name: blank 104 / 64 / 11 appear in *Blank*, and the
      finished-part boxes fill too, because this part is a plain rectangle.
- [ ] Add a hole and work it out again. The net volume line says it is a
      bracket. Carry it over: the blank crosses, the finished-part boxes do
      **not**, and the message says why.
- [ ] Change the block width and look at the panel. It says the part has moved
      and offers no button until you work it out again.
- [ ] Nothing about purchase quantity, kerf or minimum order is ever filled in
      by this. Check each field before and after.
- [ ] **Prepare review package**, download `part-model.json`, and open it: it
      says `buyrworld-part-model/1` and every dimension is an integer in
      quotation marks.
- [ ] At 390px the three allowance boxes stack and the buttons wrap.

---

## What executing the code has already settled

Not repeated above, so a browser pass does not spend time on it:

- Every calculation, refusal and provenance rule — 2,407 tests.
- That feature ids are never reused, including after deleting the highest
  and after branching from an Undo.
- The engine's agreement with the pack's reference fixture, run against the
  deployed modules rather than the local copies.
- That the served `app.js` parses and its dispatch table resolves.
- That `design-handoff/` returns 404 and the strategy pack is unpublished.
- That the DXF describes the model it came from, checked by reading it back
  and comparing every coordinate.
- That `initStudio` survives a page missing any of the elements it decorates,
  so a failure there cannot stop the mount.
- That starting a new scenario leaves nothing of the previous one behind.
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
