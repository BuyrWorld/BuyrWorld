import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createAdapter, mockTransport } from "../../src/services/ai/adapter.mjs";
import {
  extractContract, validateContract, toConstraints, buildContractPrompt, MECHANISM,
} from "../../src/services/ai/extract-contract.mjs";
import {
  extractQuotes, validateQuotes, compareQuotes, buildQuotePrompt,
} from "../../src/services/ai/extract-quotes.mjs";
import { confirmField, allConfirmed, fieldsOf } from "../../src/services/ai/grounding.mjs";
import { findContradictions, supplierClaim } from "../../src/calc/evidence.mjs";

/* ------------------------------------------------------------- contracts */

const CONTRACT =
  "SUPPLY AGREEMENT\n\n" +
  "7.1 The Price shall be reviewed once per contract year, with effect from 1 April.\n" +
  "7.2 No other price adjustment mechanism shall apply, and quarterly indexation is not permitted.\n" +
  "7.3 Any adjustment shall not exceed 5% in any contract year.\n" +
  "7.4 The Supplier shall give not less than 90 days written notice of any proposed change.\n" +
  "9.1 Payment terms are 60 days from date of invoice.\n";

const contractResponse = (over = {}) => JSON.stringify({
  priceReviewFrequency: { value: "once per contract year", clause: "7.1",
    quote: "The Price shall be reviewed once per contract year" },
  capPercent: { value: "5", clause: "7.3", quote: "shall not exceed 5% in any contract year" },
  noticeDays: { value: "90", clause: "7.4", quote: "not less than 90 days written notice" },
  paymentTermDays: { value: "60", clause: "9.1", quote: "Payment terms are 60 days from date of invoice" },
  mechanisms: [
    { mechanism: "annual-review", permitted: true, clause: "7.1", note: "one review per contract year",
      quote: "The Price shall be reviewed once per contract year" },
    { mechanism: "quarterly-indexation", permitted: false, clause: "7.2",
      note: "clause 7.2 permits no other mechanism",
      quote: "quarterly indexation is not permitted" },
  ],
  ...over,
});

const runContract = (scripted, text = CONTRACT) =>
  extractContract({ text, adapter: createAdapter({ transport: mockTransport(scripted) }) });

describe("contract extraction", () => {
  test("reads the provisions that bear on a price change", async () => {
    const r = await runContract(contractResponse());
    assert.equal(r.ok, true);
    assert.equal(r.provisions.capPercent.value, "5");
    assert.equal(r.provisions.noticeDays.value, "90");
    assert.equal(r.provisions.paymentTermDays.value, "60");
    assert.equal(r.provisions.capPercent.clause, "7.3");
  });

  test("everything arrives unconfirmed", async () => {
    const r = await runContract(contractResponse());
    assert.equal(r.needsConfirmation, true);
    assert.equal(allConfirmed(r.provisions), false);
    for (const f of fieldsOf(r.provisions)) assert.equal(f.confirmedBy, null);
  });

  test("an invented clause is discarded like any other ungrounded value", async () => {
    const r = await runContract(contractResponse({
      floorPercent: { value: "2", clause: "7.5", quote: "adjustments shall not fall below 2%" },
    }));
    assert.equal(r.provisions.floorPercent, undefined);
    assert.match(r.rejected.find((x) => x.field === "floorPercent").reason,
      /do not appear in the supply agreement/);
  });

  test("a mechanism outside the known set is refused", async () => {
    const r = await runContract(contractResponse({
      mechanisms: [{ mechanism: "vibes-based-adjustment", permitted: true, clause: "7.9",
                     quote: "The Price shall be reviewed once per contract year" }],
    }));
    assert.equal(r.mechanisms.length, 0);
    assert.match(r.rejected.find((x) => /mechanism/.test(x.field)).reason, /must be one of/);
  });

  test("saying a mechanism is NOT permitted is recorded, not dropped", async () => {
    const r = await runContract(contractResponse());
    const q = r.mechanisms.find((m) => m.mechanism === MECHANISM.QUARTERLY_INDEXATION);
    assert.ok(q, "an absent mechanism is as useful as a present one");
    assert.equal(q.permitted, false);
    assert.equal(q.clause, "7.2");
  });

  test("the prompt forbids supplying a market-standard figure", () => {
    const p = buildContractPrompt("FENCE");
    assert.match(p, /Do NOT supply a market-standard/);
    assert.match(p, /You are reading, not advising/);
    assert.match(p, /FENCE/);
  });

  test("too little text is refused before a model is called", async () => {
    let called = false;
    const r = await extractContract({
      text: "short", adapter: createAdapter({ transport: async () => { called = true; return "{}"; } }),
    });
    assert.equal(r.ok, false);
    assert.equal(called, false);
  });
});

describe("contract constraints reach contradiction detection", () => {
  test("unconfirmed mechanisms produce no constraints", async () => {
    const r = await runContract(contractResponse());
    const { constraints, skipped } = toConstraints(r);
    assert.equal(constraints.length, 0);
    assert.equal(skipped.length, 2);
    assert.match(skipped[0].reason, /not confirmed by a person/);
  });

  test("once confirmed, they become citable constraints", async () => {
    const r = await runContract(contractResponse());
    const confirmed = {
      ...r,
      mechanisms: r.mechanisms.map((m) => ({ ...m, field: confirmField(m.field, "category owner") })),
    };
    const { constraints } = toConstraints(confirmed);
    assert.equal(constraints.length, 2);
    assert.equal(constraints[0].evidence.kind, "contract-clause");
  });

  test("the whole point: a letter's claim is checked against the extracted clause", async () => {
    const r = await runContract(contractResponse());
    const confirmed = {
      ...r,
      mechanisms: r.mechanisms.map((m) => ({ ...m, field: confirmField(m.field, "category owner") })),
    };
    const { constraints } = toConstraints(confirmed);

    const claims = [supplierClaim({
      id: "q", mechanism: MECHANISM.QUARTERLY_INDEXATION,
      quote: "prices are subject to quarterly indexation",
    })];
    const found = findContradictions(claims, constraints);

    assert.equal(found.length, 1, "the letter relies on something clause 7.2 forbids");
    assert.match(found[0].text, /clause 7\.2 does not permit it/);
    assert.match(found[0].text, /permits no other mechanism/);
  });

  test("a mechanism with no clause reference cannot be cited, so it is skipped", async () => {
    const r = await runContract(contractResponse({
      mechanisms: [{ mechanism: "annual-review", permitted: true,
                     quote: "The Price shall be reviewed once per contract year" }],
    }));
    const confirmed = {
      ...r, mechanisms: r.mechanisms.map((m) => ({ ...m, field: confirmField(m.field, "x") })),
    };
    const { constraints, skipped } = toConstraints(confirmed);
    assert.equal(constraints.length, 0);
    assert.match(skipped[0].reason, /no clause reference/);
  });
});

/* ---------------------------------------------------------------- quotes */

const QUOTES =
  "QUOTATION — Alpha Castings Ltd\nUnit price 12.40 GBP for 50000 pieces, DAP Coventry, " +
  "lead time 8 weeks, payment 60 days, valid 90 days. Tooling 14000.00 one-time.\n\n" +
  "QUOTATION — Bravo Fasteners Ltd\nUnit price 11.95 GBP for 50000 pieces, EXW Krakow, " +
  "lead time 14 weeks, payment 30 days.\n";

const quotesResponse = (over) => JSON.stringify(over ?? {
  quotes: [
    { supplier: "Alpha Castings Ltd", unitPrice: "12.40", currency: "GBP", quantity: "50000",
      incoterm: "DAP", leadTimeWeeks: "8", paymentTermDays: "60", validityDays: "90",
      toolingCost: "14000.00", freightIncluded: true,
      quote: "Unit price 12.40 GBP for 50000 pieces, DAP Coventry, lead time 8 weeks, payment 60 days, valid 90 days. Tooling 14000.00 one-time." },
    { supplier: "Bravo Fasteners Ltd", unitPrice: "11.95", currency: "GBP", quantity: "50000",
      incoterm: "EXW", leadTimeWeeks: "14", paymentTermDays: "30", freightIncluded: false,
      quote: "Unit price 11.95 GBP for 50000 pieces, EXW Krakow, lead time 14 weeks, payment 30 days." },
  ],
});

const runQuotes = (scripted, text = QUOTES) =>
  extractQuotes({ text, adapter: createAdapter({ transport: mockTransport(scripted) }) });

describe("quote extraction", () => {
  test("reads each quotation as stated", async () => {
    const r = await runQuotes(quotesResponse());
    assert.equal(r.quotes.length, 2);
    assert.equal(r.quotes[0].unitPrice.value, "12.40");
    assert.equal(r.quotes[1].incoterm.value, "EXW");
  });

  test("a quotation with no price is not a quotation", async () => {
    const r = await runQuotes(JSON.stringify({
      quotes: [{ supplier: "Alpha Castings Ltd", leadTimeWeeks: "8", quote: "lead time 8 weeks" }],
    }));
    assert.equal(r.quotes.length, 0);
  });

  test("everything arrives unconfirmed", async () => {
    const r = await runQuotes(quotesResponse());
    assert.equal(allConfirmed(r.quotes), false);
  });
});

describe("comparison refuses to imply like-for-like", () => {
  test("it names the lowest price, never the best", async () => {
    const r = await runQuotes(quotesResponse());
    assert.equal(r.comparison.lowestHeadlinePrice.supplier, "Bravo Fasteners Ltd");
    assert.equal(JSON.stringify(r.comparison).includes('"best"'), false,
      "a ranking by headline price is not a recommendation");
    assert.match(r.comparison.method, /every one of which can reverse it/);
  });

  test("differing Incoterms are flagged as material", async () => {
    const r = await runQuotes(quotesResponse());
    const d = r.comparison.deviations.find((x) => x.field === "incoterm");
    assert.ok(d, "DAP against EXW is not a like-for-like price");
    assert.equal(d.severity, "material");
    assert.match(d.text, /not like-for-like/);
  });

  test("tooling quoted by only one supplier is flagged", async () => {
    const r = await runQuotes(quotesResponse());
    const d = r.comparison.deviations.find((x) => x.field === "toolingCost");
    assert.ok(d);
    assert.match(d.text, /the cheaper unit price may be the dearer order/);
  });

  test("mixed currencies block ranking outright", async () => {
    const text = "Alpha: 12.40 GBP each.\nBravo: 13.10 EUR each.";
    const r = await runQuotes(JSON.stringify({
      quotes: [
        { supplier: "Alpha", unitPrice: "12.40", currency: "GBP", quote: "Alpha: 12.40 GBP each." },
        { supplier: "Bravo", unitPrice: "13.10", currency: "EUR", quote: "Bravo: 13.10 EUR each." },
      ],
    }), text);
    assert.equal(r.comparison.rankable, false);
    assert.equal(r.comparison.lowestHeadlinePrice, null, "ranking across currencies would be nonsense");
    assert.equal(r.comparison.blocking, 1);
    assert.match(r.comparison.deviations[0].text, /cannot be ranked without a dated rate/);
  });

  test("missing terms are reported rather than assumed", async () => {
    const text = "QUOTATION — Alpha Castings Ltd. Alpha: 12.40 GBP each, no other terms stated.";
    const r = await runQuotes(JSON.stringify({
      quotes: [{ supplier: "Alpha", unitPrice: "12.40", currency: "GBP", quote: "Alpha: 12.40 GBP each" }],
    }), text);
    assert.equal(r.ok, true);
    const d = r.comparison.deviations.find((x) => x.field === "completeness");
    assert.ok(d);
    assert.match(d.text, /incoterm/);
    assert.match(d.text, /lead time/);
  });

  test("no quotations is said plainly", () => {
    assert.equal(compareQuotes([]).count, 0);
    assert.match(compareQuotes([]).note, /No quotations were extracted/);
  });

  test("the prompt forbids assuming a standard Incoterm", () => {
    const p = buildQuotePrompt("FENCE");
    assert.match(p, /Do NOT assume a standard\n  Incoterm/);
    assert.match(p, /An assumption here\n  becomes a price comparison somebody acts on/);
    assert.match(p, /Do not convert currencies/);
  });
});

describe("one grounding implementation, three document classes", () => {
  test("the same invented-quote defence applies to quotations", async () => {
    const r = await runQuotes(JSON.stringify({
      quotes: [{ supplier: "Charlie Ltd", unitPrice: "9.99", currency: "GBP",
                 quote: "Charlie Ltd quoted 9.99 GBP each" }],
    }));
    assert.equal(r.quotes.length, 0, "a fabricated quotation must not survive");
    assert.ok(r.rejected.some((x) => /do not appear in the supplier quotation/.test(x.reason)));
  });

  test("and to contracts", async () => {
    const r = await runContract(JSON.stringify({
      capPercent: { value: "10", clause: "7.3", quote: "shall not exceed 10% in any contract year" },
    }));
    assert.equal(r.provisions.capPercent, undefined,
      "a cap the agreement does not state must not become a ceiling somebody relies on");
  });
});
