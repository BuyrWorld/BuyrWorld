# Competitive capability matrix

Internal analysis. Built from publicly described capabilities only — vendor
websites, public documentation and published material. No competitor source
code, private API, account, screenshot, asset, prompt or marketing copy was
accessed, reused or reproduced.

**Rule for anything in this file:** the capability is a description of a *user
problem and a general workflow pattern*. Implementation, wording, information
architecture, visual design and interaction patterns must be original. Competitor
names appear here and must never appear in customer-facing product copy.

---

## Delivery status

Priorities below are design intent, not progress. What has actually shipped:

| Capability | Priority | Status |
|---|---|---|
| 4. Should-cost and cost-driver decomposition | P0 | **Built and tested.** The cost bridge, index base and lag, currency split. |
| 7. Clause extraction with source references | P1 | **Built.** Contract provisions extract with clause references, become `ContractConstraint` records once confirmed, and feed contradiction detection end to end. |
| 1. Document ingestion and bid normalisation | P1 | **Built** for claim letters, supplier quotations and contracts. One shared grounding check across all three; quote comparison surfaces scope deviations rather than implying like-for-like. |
| 6. Fast, actionable commercial intelligence | P1 | **Built.** One click loads a fully worked synthetic case. |
| 5. Governed data with traceable insight-to-outcome | P2 | **Built.** Outcome capture, aggregation, and per-supplier history close the loop: a second claim from the same supplier is read against what happened to the first. |
| 3. Governed guardrails and human approval | P2 | **Built** for the approval record. Autonomous negotiation remains deliberately unbuilt. |
| 2. Structured negotiation preparation | P2 | **Built.** `negotiation.mjs` derives anchors, a hard line, a priced ladder and ordered rebuttals from the confirmed case. Preparation only — no supplier-facing automation. |

## 1. Document ingestion and bid normalisation

| | |
|---|---|
| **Publicly observed** | Products in the sourcing-analysis space (e.g. Purchaser) ingest supplier documents and normalise differing bid structures into a comparable table, producing a defensible award record. |
| **User job** | "Three suppliers replied in three different shapes. Make them comparable without me rebuilding a spreadsheet." |
| **Generic pattern** | Ingest → extract → map to a common schema → flag deviations → export a record. |
| **BuyrWorld interpretation** | Narrow it to one document class: a supplier *commercial-change request*. Not bids — claims. Extraction populates a typed `SupplierClaim` with per-field provenance, and every extracted field is shown for confirmation before it can be used in a calculation. |
| **Original differentiation** | Extraction is never authoritative. A field is `document-extracted` until a human promotes it to `user-confirmed`, and no calculation consumes an unconfirmed field. Most tools treat extraction as ground truth. |
| **Priority** | P1 — the workflow depends on it. |
| **IP precautions** | Own schema, own field names, own UI. No competitor table layout, terminology or export format. |
| **Acceptance** | 20 synthetic claim documents; every extracted field carries a provenance tag; no calculation runs on an unconfirmed field; the confirmation step is testable. |

## 2. Structured negotiation preparation

| | |
|---|---|
| **Publicly observed** | Negotiation tools (e.g. Negotiations.AI) structure preparation around objectives, BATNA, ZOPA, and offer practice conversations with outcome capture. |
| **User job** | "I know roughly what I want. Turn that into a position I can actually run, and let me rehearse it." |
| **Generic pattern** | Define objectives → establish alternatives → model the zone of agreement → rehearse → record. |
| **BuyrWorld interpretation** | Preparation is *derived from the case*, not entered separately. Opening, target and walk-away are computed from the warranted-change range; BATNA draws on the recorded switching cost and qualification time. The rehearsal may only use confirmed case facts. |
| **Original differentiation** | The simulator cannot invent a fact. It is constrained to the `CommercialCase`, so practice arguments are the ones the supplier can actually make against the evidence on file. A general chatbot rehearsal invents both sides. |
| **Priority** | P2 — valuable, but only after the analysis is trustworthy. |
| **IP precautions** | Own prompts, own coaching framing. Do not reproduce another product's scoring rubric or session structure. |
| **Acceptance** | Simulation answers cite only confirmed case fields; an injected fact in a document cannot enter the rehearsal. |

## 3. Governed negotiation with guardrails and human approval

| | |
|---|---|
| **Publicly observed** | Autonomous negotiation platforms (e.g. Pactum) run supplier interactions inside predefined commercial guardrails with human approval gates. |
| **User job** | "I cannot let software agree terms, but I do want the routine parts handled consistently." |
| **Generic pattern** | Define guardrails → constrain the agent → require approval → record the outcome. |
| **BuyrWorld interpretation** | Take the *guardrail and approval* half and leave the autonomy out entirely. `ContractConstraint` and `Approval` are first-class model objects; no option may be marked accepted without a recorded human decision. |
| **Original differentiation** | Deliberately narrower. No supplier-facing automation at all — the system prepares a position for a person to run. For a research demonstration with no commercial mandate, autonomy would be both unsafe and unnecessary. |
| **Priority** | P2 for the approval record; autonomous negotiation is explicitly **not built**. |
| **IP precautions** | No supplier contact of any kind. |
| **Acceptance** | A decision pack cannot be exported as final without an `Approval` record. |

## 4. Should-cost and cost-driver decomposition

| | |
|---|---|
| **Publicly observed** | Should-cost products (e.g. LightSource, GEP) decompose price into cost drivers, model scenarios and pull external market inputs. |
| **User job** | "They say steel went up 14%. What does that actually justify on my part?" |
| **Generic pattern** | Decompose → weight → apply index movement → model scenarios. |
| **BuyrWorld interpretation** | The core calculation engine. `CostDriver` entries carry a weight, an index, a base period, a lag and any cap, collar or floor. A deterministic cost bridge converts a claimed increase into a warranted range. The model decomposes and explains; it never computes. |
| **Original differentiation** | Two things. First, the **unsupported remainder** is an explicit output — the gap between what the evidence justifies and what was asked for is the number the buyer negotiates against, and most tools do not name it. Second, every figure is labelled supplied, derived or assumed. |
| **Priority** | P0 — this is the product. |
| **IP precautions** | Own formulae, derived from public procurement method (weighted index decomposition is standard practice, not proprietary). No licensed index data without permission. |
| **Acceptance** | Every formula unit-tested; a language model given the same inputs cannot change the output; ProcureBench calculation cases pass exactly. |

## 5. Governed data with traceable insight-to-outcome

| | |
|---|---|
| **Publicly observed** | Spend-intelligence products (e.g. Suplari) connect governed procurement data to insights and then to realised financial outcomes. |
| **User job** | "Show me the saving actually landed, not the saving someone claimed in a slide." |
| **Generic pattern** | Ingest → detect opportunity → act → verify the outcome. |
| **BuyrWorld interpretation** | `NegotiatedOutcome` and `LearningRecord` close the loop on a single case: what was asked, what was agreed, what was avoided, what was conceded, and what that teaches the next case in the same category. |
| **Original differentiation** | Case-level rather than portfolio-level, and it records the *reasoning*, not just the number. Over time the outcome corpus — labelled by what actually worked against which supplier argument — becomes the asset. Nobody can copy it by reading the front end. |
| **Priority** | P2, but architecturally P0: the schema must support it from the start or the history is lost. |
| **IP precautions** | Synthetic outcomes only in the public demonstration. |
| **Acceptance** | A completed synthetic case produces a durable outcome record linked to its original claim. |

## 6. Fast, actionable commercial intelligence

| | |
|---|---|
| **Publicly observed** | Commercial-intelligence products (e.g. Tropic) emphasise very short time to first useful answer. |
| **User job** | "I have twenty minutes before the call." |
| **Generic pattern** | Minimal input → immediate partial value → refine later. |
| **BuyrWorld interpretation** | A synthetic worked case opens fully populated, so the workflow can be understood without typing anything. A real case is usable from the baseline plus the claim alone; evidence enriches it rather than gating it. |
| **Original differentiation** | Speed without false confidence — a case with thin evidence shows a *wider* warranted range and a visible evidence gap, rather than a confident answer produced from less. |
| **Priority** | P1. |
| **IP precautions** | Own onboarding, own sample content. |
| **Acceptance** | Time from landing to a comprehensible worked example: one click. |

## 7. Clause extraction with source references

| | |
|---|---|
| **Publicly observed** | Contract-intelligence products extract clauses and link each finding to its exact location in the source. |
| **User job** | "Does the contract actually let them do this?" |
| **Generic pattern** | Parse → locate clause → classify → link to source. |
| **BuyrWorld interpretation** | Scoped to provisions that bear on a commercial change: indexation mechanism, price-review windows, notice periods, caps and collars, pass-through rights, term and exit. Each becomes a `ContractConstraint` linked to a `SourceReference`. |
| **Original differentiation** | Constraints are *binding on the analysis*. If the contract caps indexation at 5%, the scenario engine will not produce a warranted figure above it without flagging the conflict. Extraction feeds the calculation rather than sitting beside it. |
| **Priority** | P1 — existing Contract Intelligence code is the starting point. |
| **IP precautions** | Own clause taxonomy. No competitor clause library. |
| **Acceptance** | Each constraint resolves to a passage; a contradicting scenario is flagged, not silently produced. |

---

## What deliberately is not copied

- Autonomous supplier negotiation.
- Supplier master data or benchmark databases.
- Any form of shared benchmark pool — this needs scale, governance and legal
  design that a research project does not have.
- Broad source-to-pay or contract-lifecycle coverage.
- Any competitor's visual language, layout, iconography or terminology.

## The honest test

For each capability: **what makes this better than pasting the supplier letter
into a general-purpose chatbot?** The answer must be one of —

1. The arithmetic is deterministic and reproducible.
2. Every figure is traceable to a source or labelled as an assumption.
3. Missing evidence is stated rather than smoothed over.
4. The contract constrains the answer.
5. The decision and its rationale are recorded for audit.

If a feature cannot claim at least one of those, it should not be built here.
