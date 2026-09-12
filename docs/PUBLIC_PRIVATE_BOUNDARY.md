# Public / private boundary

## The uncomfortable fact

This repository is **public**. Everything in it — including everything removed
in Phase 1 — remains readable in the git history, because history was not
rewritten. A public front end is not a moat. Anyone can read the interface, copy
the layout, lift the prompts and rebuild the screens in a weekend.

So the question is not "how do I stop people copying the code". It is **"what is
valuable that isn't in the code"**.

## What is genuinely hard to copy

In rough order of durability:

1. **The evaluation corpus.** A body of cases with known-correct answers,
   including adversarial ones, is months of procurement judgement. It is the
   hardest thing here to reproduce and the easiest to give away by accident.

   Twenty-one cases exist today and all pass. One of them earned its place on
   the first run: a case built from an awkward unit price and a large volume
   exposed a rounding defect worth £12,600 a year that every unit test had
   missed, because the unit tests used round numbers where it is invisible.
   That is the argument for the corpus in one example — and the reason it is
   worth more than the code that passes it.
2. **Outcome records.** What was claimed, what was agreed, what argument worked
   against which supplier position. This compounds with use and cannot be
   derived from reading anything.
3. **Calibrated cost models.** Driver weightings that reflect how a category
   actually behaves — as opposed to plausible-looking percentages.
4. **Index and lag heuristics.** Which index genuinely governs a part, how long
   movement takes to reach a price, when a supplier has picked a flattering base
   period.
5. **Evidence-source adapters and normalisation rules.** The unglamorous work of
   making messy real inputs comparable.

The interface, the prompts and the general workflow shape are **not** on that
list. Treating them as secrets would be self-deception.

## Recommended division

**Public demonstration** — the original interface; synthetic example cases; a
representative subset of calculations; the published methodology; a handful of
ProcureBench samples; the architecture documentation. Enough to show the thinking
is real and to serve as a portfolio artefact.

**Private core, if and when it is legally permissible to develop** — the full
rule library; the complete evaluation corpus; category mappings; production
prompts; evidence-source adapters; normalisation heuristics; outcome
aggregation; any organisation-specific playbooks; production security
configuration.

## Important qualifications

- **Do not move code to another repository automatically.** That is an owner
  decision with employment and IP implications, and it should follow the
  independent advice the strategic audit recommends — not precede it.
- **Obfuscation is not a substitute for architecture.** Minifying a public
  bundle protects nothing. The boundary has to be about *what is never
  published*, not about making published things harder to read.
- **Publishing the methodology is a feature, not a leak.** A system whose claim
  is "you can check my working" cannot hide its working. Publish the method;
  keep the calibration and the corpus.
- **The corpus is the thing to be careful with.** If only one item on this page
  is kept private, make it the evaluation cases and the outcome records.

## Licensing

**No licence file has been added**, because that requires explicit owner
approval. The options, briefly:

| Option | Effect |
|---|---|
| **No licence** (current) | Default copyright. Others may read the public repository but have no right to use, copy or modify it. Most restrictive. |
| **Permissive** (MIT, Apache-2.0) | Anyone may use and commercialise it. Apache-2.0 adds an explicit patent grant. Good for portfolio credibility; gives away any code-based advantage. |
| **Copyleft** (AGPL-3.0) | Derivatives — including hosted services — must publish their source. Deters commercial copying, but complicates any future commercial licensing. |
| **Source-available** (BSL and similar) | Readable and non-commercially usable, converting to open after a set period. Preserves optionality; not an OSI-approved open-source licence, which some readers hold against it. |

Given the project is currently non-commercial and the near-term value is career
and portfolio evidence rather than revenue, **no licence or Apache-2.0** are the
two sensible positions. Decide it deliberately rather than by omission — but
decide it after the employment and IP position is clear, not before.
