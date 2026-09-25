# BuyrWorld

A non-commercial research demonstration of what procurement software looks like
when every figure it shows can be traced to a rule somebody can argue with.

Live at [buyrworld.com](https://www.buyrworld.com/). Nothing is for sale, there
are no accounts, and no personal data is collected.

## What it does

A buyer receives a letter saying prices are going up nine per cent. The
flagship tool decomposes that claim driver by driver — what the evidence
supports, what it does not, and what the difference is worth over a year — and
then says the same thing as a case a junior buyer can read, with the parts that
rest on assumptions withheld until somebody confirms them.

Around that: reading drawings and certificates, a should-cost engine, a bounded
part builder, three what-ifs, call preparation and notes, and practice against
a supplier played by a table of rules.

## What it is not

- **It has never been opened in a browser.** Everything is verified by
  executing the code, including the served bytes under `node:vm`. That is blind
  to layout, focus and touch. [`docs/BROWSER-CHECKS.md`](docs/BROWSER-CHECKS.md)
  is the list of what that leaves unknown.
- **Every case in it is synthetic.** No real supplier, no real drawing, no real
  price. No real case has been run end to end.
- **It is not accurate at reading documents, and does not claim to be.** Values
  read from a document are proposed, never used, until a person confirms them.
  `scripts/eval-drawings.mjs` measures the reading and prints the production
  gate as blocked, because that is what it is.
- **It is not a CAD tool.** The part builder makes rectangular blocks, through
  holes and rectangular pockets, and refuses to write a STEP file it cannot
  honestly produce.

[`docs/EVIDENCE.md`](docs/EVIDENCE.md) is the full version of both lists: what
is backed by something that runs, and the longer table of what nobody should
say.

## How it is built

One `index.html`, `app.js` and `mount.mjs`, plus ES modules under `src/` and two
Vercel functions. No build step, no framework, no package manifest, nothing to
install.

The rules that matter, in `CLAUDE.md` and enforced by tests:

- **Code calculates, the model explains.** No percentage or money figure shown
  to a person comes from a language model.
- **No floating point in `src/calc/`.** Money is integer minor units on BigInt;
  a ratchet fails on any float construct not written down with a reason.
- **Mixed currencies raise** rather than convert quietly.
- **Never log prompt content, document text or user input.** Metadata only.

```sh
node scripts/verify.mjs      # 3,673 tests, 7 checks — run it before any deploy
```

## Where to look

| | |
|---|---|
| [`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md) | What exists, what does not, what to do next |
| [`docs/EVIDENCE.md`](docs/EVIDENCE.md) | What is evidenced, and what is not |
| [`docs/OPERATING.md`](docs/OPERATING.md) | Running it, the endpoints, keys, retention |
| [`docs/ROLLBACK.md`](docs/ROLLBACK.md) | Undoing a deploy |
| [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) | What was reviewed, and what was not |
| [`docs/HISTORY.md`](docs/HISTORY.md) | How it got here, not edited to agree with today |

## Licence and use

No licence is granted. The code is public so that the claims above can be
checked, not for reuse. The demonstration data is synthetic and labelled as
such throughout.
