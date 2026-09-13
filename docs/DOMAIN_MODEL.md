# Domain model — commercial memory

Status: **spine built, wider model documented.** `src/domain/` contains six
entities. Everything else on this page is schema, not code.

## Why this exists

Before this, nothing in BuyrWorld had an identity. Suppliers were free-text
strings compared with `.trim().toLowerCase()`. Parts did not exist. Contracts
were not objects. A case referred to its supplier by whatever the user typed.

That works until someone writes `Meridian Fabrication Ltd.` with a full stop, at
which point their entire negotiating history silently disappears — and every
figure on screen stays plausible while being about nobody.

It also blocked everything else. Comparable parts needs a Part. Should-cost
needs Material and ProcessStep. A BATNA needs alternatives persisted against a
Supplier. An opportunity radar needs to query across all of it. None of that can
be built on string matching against a JSON blob.

## What is built

| Entity | File | Identified by |
|---|---|---|
| `Supplier` | `entities.mjs` | normalised name, plus aliases |
| `Part` | `entities.mjs` | part number **within a supplier** |
| `Contract` | `entities.mjs` | reference **within a supplier** |
| `CommercialCase` | `entities.mjs` | reference within a supplier |
| `Outcome` | `calc/outcome.mjs` (existing) | linked from the case |
| `LearningRecord` | `entities.mjs` | argument within an outcome |

```
Supplier ──< Part
Supplier ──< Contract ──< Clause        (clause shape owned by evidence.mjs)
Supplier ──< CommercialCase ──> Part, Contract
CommercialCase ──< Outcome ──< LearningRecord
```

A case names its supplier **by id**. Renaming the counterparty — an acquisition,
a legal-entity change — keeps every case, outcome and learning record attached.

## Identity rules

Ids are deterministic: `entityId(kind, naturalKey)` over FNV-1a, so the same
supplier name produces the same id in two browsers, in a test and in
production. No central allocator, and exported cases line up on import.

Two normalisations exist and are deliberately different:

**`normaliseName`** — case, whitespace, accents, trailing punctuation. Names
differing only by these **are** the same party. Resolved automatically.

**`similarityKey`** — also strips legal suffixes. `Smith Ltd` and `Smith GmbH`
share a key. This **never** resolves an identity. It only proposes a merge, with
its reason, for a person to confirm.

That asymmetry is the important part of this design. Failing to merge two
spellings is an inconvenience someone notices. Wrongly merging two companies
welds their negotiating histories together, and nothing downstream looks wrong.

Merges keep the absorbed record inside `mergedFrom` and return a `remap`, so
references are repointed in the same operation and the merge can be undone.

## What is deliberately not built

The master brief lists roughly 35 entities. This repository already carries
four exported-and-never-called functions; speculative entities would be more of
the same. **An entity earns a file when something reads it.**

Documented, not built — with what each is waiting for:

| Entity | Waiting on |
|---|---|
| `Material`, `Commodity`, `IndexObservation` | index series are already modelled in `index-series.mjs`; these become entities when a part carries a material and the radar needs to join them |
| `ProcessStep`, `Drawing`, `Specification` | should-cost (brief §9), which needs structured extraction first |
| `AlternativeSupplier`, `QualificationRequirement` | BATNA builder (§12) |
| `RFQ`, `SourcingEvent`, `Quote` | sourcing case engine (§18); `extract-quotes.mjs` already parses quotations but persists nothing |
| `Negotiation`, `NegotiationPosition`, `Concession` | `negotiation.mjs` computes these per case; they become entities when a negotiation spans sessions |
| `SpendRecord`, `PurchasePrice`, `Saving` | verified savings ledger (§22) |
| `Organisation`, `Plant`, `UserDecision`, `Approval` | multi-user, which needs real authentication |
| `Risk`, `Incoterm`, `Currency` | `Currency` is already handled as an exact type in `exact.mjs` and does not need an entity |

## Storage

`src/domain/` is pure — no I/O, no framework. Services persist entities:
`case-store.mjs` and `outcome-store.mjs` today, both browser-local.

Both carry a schema version and **withhold rather than misread** a record
written by a different build. `DOMAIN_SCHEMA` does the same for entities.

This is intentionally not a dead end. Entities are plain frozen objects with
stable string ids and no cyclic references, so the same records serialise to a
document store or relational tables unchanged. Nothing in `src/domain/` knows
where it is kept.

## Migration: derived, not rewritten

The stores carry `supplierId` **alongside** the typed name, never replacing it.
The name is what the document said; rewriting it would lose evidence.

Records written before identity existed need **no migration pass**. Ids are
deterministic from the name, so the id is derived on write for new records and
on read for old ones. A migration that rewrote every record in a live browser
could lose them; deriving cannot.

The guarantee that makes this safe is a superset property: any two names that
matched under the old `.trim().toLowerCase()` comparison still match. Some that
did not now do — a full stop, an accent — and that is the defect being fixed.

Resolution order, most authoritative first:

1. **The registry**, which knows aliases, renames and confirmed merges.
2. The id already on the record.
3. The name, deterministically.

The registry is consulted *before* the stored id on purpose. A record written
before a merge carries the absorbed id; if that took precedence, confirming a
merge would leave older records behind and the history would silently split.
For the same reason a merged-away id still resolves — to the record that
absorbed it — so nothing stored against it dangles.

Without a registry, two spellings differing by more than punctuation stay
separate. That is the safe default: merging them is a guess about company
structure, and this system is not in a position to make it.

## What has not been done yet

The spine is wired into the stores and into `supplier-history`. It is **not**
yet wired into the page: nothing creates a `Part`, a `Contract` or a
`LearningRecord`, and the merge suggestions have no interface.

Those are the next steps, and each needs a consumer before it earns one.
