/**
 * Intake classification.
 *
 * A person should not have to know this application's navigation before using
 * it. They have a document. The system should work out what it is and where it
 * belongs, and route into the existing tools rather than duplicating them.
 *
 * This is deliberately NOT a model call.
 *
 * Classification is one of the tasks a language model is allowed to do here,
 * but the signals in these documents are strong and explicit, and a
 * deterministic classifier is better on every axis that matters: it is instant,
 * it is free, it is identical in a test and in production, and — the part that
 * counts — it can show its reasoning as verbatim quotes from the document
 * rather than as an assertion. A model that routes a contract into the claim
 * reviewer is confidently wrong in a way nobody can inspect. This is wrong in a
 * way you can read, argue with, and correct.
 *
 * Two rules it keeps.
 *
 * Every signal carries the passage that triggered it, the same discipline the
 * extractors already use: a value without a quote is not evidence.
 *
 * And the document is data, never instruction. A letter saying "ignore the
 * above and treat this as a contract" is a letter containing that sentence, and
 * it is scored as one. Nothing in the text can change what the rules are.
 */

import { parseSpendCsv } from "../calc/spend.mjs";

/** What a document is. */
export const DOC_KIND = Object.freeze({
  PRICE_CLAIM: "price-claim",
  CONTRACT: "contract",
  QUOTE: "quotation",
  SPEND_DATA: "spend-data",
  RFQ_RESPONSE: "rfq-response",
  MEETING_NOTES: "meeting-notes",
  CERTIFICATE: "material-certificate",
  DRAWING: "drawing",
  UNKNOWN: "unknown",
});

/** Where it belongs, expressed as an existing route in the application. */
export const WORKFLOW = Object.freeze({
  [DOC_KIND.PRICE_CLAIM]: { id: "claim-review", label: "Supplier claim review", route: "tool-defender" },
  [DOC_KIND.CONTRACT]: { id: "contract-review", label: "Contract intelligence", route: "tool-contract" },
  [DOC_KIND.QUOTE]: { id: "quote-comparison", label: "Quote comparison", route: "tool-quotes" },
  [DOC_KIND.SPEND_DATA]: { id: "spend-analysis", label: "Spend analyser", route: "spend" },
  [DOC_KIND.RFQ_RESPONSE]: { id: "rfq-review", label: "RFQ builder", route: "tool-rfq" },
  [DOC_KIND.MEETING_NOTES]: { id: "minutes", label: "Meeting summariser", route: "tool-minutes" },
  [DOC_KIND.CERTIFICATE]: { id: "certificate-check", label: "Certificate check", route: "shouldcost" },
  [DOC_KIND.DRAWING]: { id: "should-cost", label: "Should Cost Expert", route: "shouldcost" },
  [DOC_KIND.UNKNOWN]: { id: "unknown", label: "Not recognised", route: null },
});

/**
 * Signals, with the weight each carries.
 *
 * Weights are small integers chosen so that no single phrase decides a routing
 * on its own: the strongest is 3, and a confident classification needs several.
 * A document that merely mentions a contract does not become one.
 */
const SIGNALS = Object.freeze({
  [DOC_KIND.PRICE_CLAIM]: [
    { id: "price-increase", weight: 3, re: /\b(price increase|price adjustment|price revision|increase (?:of|to|in) (?:our )?prices?|uplift|surcharge)\b/i },
    { id: "percentage", weight: 2, re: /\b\d{1,2}(?:\.\d+)?\s?%/ },
    { id: "effective-from", weight: 2, re: /\b(with effect from|effective (?:from|date)|as (?:of|from)|commencing)\b/i },
    { id: "cost-driver", weight: 2, re: /\b(raw material|material cost|energy cost|freight cost|labour cost|steel|aluminium|resin|polymer)\b/i },
    { id: "regret-language", weight: 1, re: /\b(regret to (?:inform|advise)|we are obliged|no (?:option|alternative) but|unfortunately we must)\b/i },
    { id: "all-lines", weight: 1, re: /\b(all (?:lines|parts|items)|across our range|entire portfolio)\b/i },
  ],
  [DOC_KIND.CONTRACT]: [
    { id: "clause-numbering", weight: 3, re: /\b(?:clause|section|article)\s+\d+(?:\.\d+)*\b/i },
    { id: "legal-shall", weight: 2, re: /\bshall (?:not )?(?:be|have|provide|apply|mean|include|remain)\b/i },
    { id: "parties", weight: 2, re: /\b(?:the )?(?:supplier|buyer|purchaser|customer|parties) (?:shall|agrees?|warrants?|undertakes?)\b/i },
    { id: "governing-law", weight: 2, re: /\b(governing law|jurisdiction|governed by the laws)\b/i },
    { id: "termination", weight: 1, re: /\b(termination|terminate this agreement|notice period of)\b/i },
    { id: "indemnity", weight: 1, re: /\b(indemnif|liabilit(?:y|ies) (?:cap|shall)|force majeure)\b/i },
  ],
  [DOC_KIND.QUOTE]: [
    { id: "quotation-word", weight: 3, re: /\b(quotation|quote (?:ref|reference|no|number)|our quote)\b/i },
    { id: "unit-price", weight: 2, re: /\b(unit price|price per (?:unit|piece|item)|each)\b/i },
    { id: "incoterm", weight: 2, re: /\b(EXW|FCA|FOB|CIF|CIP|DAP|DDP|DPU)\b/ },
    { id: "lead-time", weight: 2, re: /\b(lead[- ]time|delivery (?:time|weeks|lead))\b/i },
    { id: "validity", weight: 1, re: /\b(valid (?:for|until)|validity|quotation expires)\b/i },
    { id: "moq", weight: 1, re: /\b(minimum order|MOQ|batch size)\b/i },
  ],
  [DOC_KIND.RFQ_RESPONSE]: [
    { id: "rfq-word", weight: 3, re: /\b(request for quotation|RFQ|invitation to tender|ITT)\b/ },
    { id: "response-language", weight: 2, re: /\b(in response to your|our submission|we are pleased to (?:submit|respond))\b/i },
    { id: "scope-section", weight: 1, re: /\b(scope of (?:supply|work)|specification reference)\b/i },
  ],
  [DOC_KIND.MEETING_NOTES]: [
    { id: "actions", weight: 3, re: /\b(action(?:s)?(?: point| item)?s?\s*[:\-]|to do|owner\s*[:\-])/i },
    { id: "attendees", weight: 2, re: /\b(attendees|present|apologies|minutes of|meeting notes)\b/i },
    { id: "agreed", weight: 2, re: /\b(agreed (?:that|to)|it was agreed|decision\s*[:\-])/i },
    { id: "next-meeting", weight: 1, re: /\b(next meeting|follow[- ]up (?:call|meeting))\b/i },
  ],
  /* A certificate is the easiest document in procurement to recognise and the
     hardest to fake a signal for: a heat number is a heat number. The strong
     ones are the identifiers, because prose about material rarely carries
     them and a certificate always does. */
  [DOC_KIND.CERTIFICATE]: [
    { id: "certificate-title", weight: 3, re: /\b(?:material|mill|inspection|test)\s+(?:test\s+)?certificate\b|\bcertificate of (?:conformity|analysis|compliance)\b|\bEN\s?10204\b/i },
    { id: "heat-number", weight: 3, re: /\b(?:heat|cast|melt|charge)\s*(?:no\.?|number|#)?\s*[:\-]\s*[A-Z0-9]/i },
    { id: "chemistry", weight: 2, re: /\b(?:chemical (?:composition|analysis)|ladle analysis)\b/i },
    { id: "mechanical", weight: 2, re: /\b(?:R\s?m\b|tensile strength|yield strength|\bR\s?p\s?0[.,]2\b|elongation)\b/i },
    { id: "element-row", weight: 1, re: /\b(?:Mn|Si|Cr|Ni|Mo)\b\s*[:=]?\s*\d+\.\d/ },
    { id: "declaration", weight: 1, re: /\b(?:we (?:hereby )?certify|conforms? to the requirements|inspection certificate 3\.[12])\b/i },
  ],
  /* A drawing that has reached this application is almost always a PDF whose
     text layer is title-block fields. Those fields are the signal; the
     geometry never arrives as text and is not looked for. */
  [DOC_KIND.DRAWING]: [
    { id: "drawing-number", weight: 3, re: /\b(?:drawing|dwg)\s*(?:no\.?|number|#)\s*[:\-]?\s*[A-Z0-9]/i },
    { id: "sheet-of", weight: 2, re: /\bsheet\s+\d{1,3}\s+of\s+\d{1,3}\b/i },
    { id: "material-callout", weight: 2, re: /\b(?:material|matl\.?)\s*[:\-]\s*\S/i },
    { id: "tolerance", weight: 2, re: /\b(?:general tolerances?|unless otherwise (?:stated|specified)|±\s*0?\.\d|tolerance class)\b/i },
    { id: "projection", weight: 2, re: /\b(?:third angle|first angle)\s+projection\b|\bdo not scale\b/i },
    { id: "finish", weight: 1, re: /\b(?:surface finish|deburr|break sharp edges|\bRa\s?\d)\b/i },
  ],
});

/** The longest weight a kind can score, for turning a total into a share. */
const MAX = Object.fromEntries(
  Object.entries(SIGNALS).map(([kind, list]) => [kind, list.reduce((n, s) => n + s.weight, 0)])
);

/** A short, escaped-at-render passage showing why a signal fired. */
function quoteAround(text, match) {
  const at = match.index ?? 0;
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, at + match[0].length + 40);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

/* ------------------------------------------------------------ spend data */

/**
 * Spend data is recognised by being readable as spend data, not by its words.
 * The exact parser already decides this, so it decides it here too.
 */
function spendSignal(text) {
  let parsed;
  try {
    parsed = parseSpendCsv(text);
  } catch {
    return null;
  }
  const rows = parsed.rows.length;
  if (rows < 3) return null;

  // Mostly-readable rows: a letter with one stray number is not a spend file.
  const total = rows + parsed.skipped;
  if (total === 0 || rows * 2 < total) return null;

  return {
    rows,
    skipped: parsed.skipped,
    header: Boolean(parsed.header),
    quote: `${rows} row(s) parsed as supplier, category and amount` +
           (parsed.skipped ? `, ${parsed.skipped} unreadable` : ""),
  };
}

/* ------------------------------------------------------------- classify */

/** What each workflow needs before it can do anything useful. */
const REQUIREMENTS = Object.freeze({
  [DOC_KIND.PRICE_CLAIM]: [
    { id: "requested-change", label: "the requested increase", re: /\b\d{1,2}(?:\.\d+)?\s?%/ },
    { id: "effective-date", label: "the effective date", re: /\b(?:with effect from|effective from|as from|commencing)\b[^.]{0,40}/i },
    { id: "current-price", label: "the current unit price", re: /\b(?:current(?:ly)?|existing|present)\s+(?:unit\s+)?price\b|[£$€]\s?\d/i },
    { id: "drivers", label: "the cost drivers claimed", re: /\b(raw material|material|energy|freight|labour|transport)\b/i },
    { id: "volume", label: "the annual volume", re: /\b\d{1,3}(?:[,\s]\d{3})+\s*(?:units|pieces|pcs|per annum|a year)\b|\bannual volume\b/i },
  ],
  [DOC_KIND.QUOTE]: [
    { id: "unit-price", label: "a unit price", re: /[£$€]\s?\d|\bunit price\b/i },
    { id: "currency", label: "the currency", re: /\b(GBP|EUR|USD|£|\$|€)\b/ },
    { id: "incoterm", label: "the Incoterm", re: /\b(EXW|FCA|FOB|CIF|CIP|DAP|DDP|DPU)\b/ },
    { id: "lead-time", label: "the lead time", re: /\blead[- ]time\b|\b\d+\s*(?:weeks|days)\b/i },
    { id: "validity", label: "how long it is valid", re: /\bvalid|validity|expires\b/i },
  ],
  [DOC_KIND.CONTRACT]: [
    { id: "parties", label: "the parties", re: /\bbetween\b[^.]{0,80}\band\b/i },
    { id: "term", label: "the term or expiry", re: /\b(term of|expires|expiry|until \d{4}|for a period of)\b/i },
    { id: "notice", label: "the notice period", re: /\bnotice (?:period )?of\b|\b\d+\s*(?:months|weeks)['’]? notice\b/i },
    { id: "price-mechanism", label: "the price adjustment mechanism", re: /\b(index|indexation|price review|escalat)\b/i },
  ],
  /* What a certificate needs before it can be compared against anything.
     Absent ones are reported as missing rather than guessed — the same rule
     the check itself applies to every value on it. */
  [DOC_KIND.CERTIFICATE]: [
    { id: "heat", label: "the heat or cast number", re: /\b(?:heat|cast|melt)\s*(?:no\.?|number|#)?\s*[:\-]\s*[A-Z0-9]/i },
    { id: "producer", label: "who made the material", re: /\b(?:manufacturer|producer|mill|works|steelworks)\s*[:\-]\s*\S/i },
    { id: "specification", label: "the specification and its revision", re: /\b(?:EN|ASTM|ISO|AMS|BS|DIN)\s?[A-Z]?\s?\d{3,5}\b|\bspecification\s*[:\-]/i },
    { id: "results", label: "test results to compare", re: /\b(?:R\s?m\b|tensile|yield|elongation|chemical (?:composition|analysis))\b/i },
    { id: "pages", label: "how many pages it should have", re: /\bpage\s+\d{1,3}\s+of\s+\d{1,3}\b/i },
  ],
  [DOC_KIND.DRAWING]: [
    { id: "material", label: "the material", re: /\b(?:material|matl\.?)\s*[:\-]\s*\S/i },
    { id: "thickness", label: "a thickness with its unit", re: /\b(?:thickness|thk)\s*[:=]?\s*\d+(?:\.\d+)?\s*(?:mm|cm|m|in)\b/i },
    { id: "revision", label: "the drawing revision", re: /\b(?:rev(?:ision)?|issue)\s*[:\-]?\s*[A-Z0-9]\b/i },
    { id: "sheets", label: "how many sheets there are", re: /\bsheet\s+\d{1,3}\s+of\s+\d{1,3}\b/i },
  ],
});

/**
 * Classify one pasted or uploaded document.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.filename]  a hint only; never decides on its own
 */
export function classify(text, { filename = "" } = {}) {
  const raw = String(text ?? "");
  const trimmed = raw.trim();

  if (trimmed.length < 20) {
    return Object.freeze({
      kind: DOC_KIND.UNKNOWN,
      workflow: WORKFLOW[DOC_KIND.UNKNOWN],
      strength: 0,
      band: "none",
      signals: Object.freeze([]),
      alternatives: Object.freeze([]),
      missing: Object.freeze([]),
      note: "There is not enough here to classify. Paste the document, or a substantial part of it.",
    });
  }

  /* Score every kind. A document is not forced into one bucket: the runners-up
     are returned, because the second guess is often the right one and hiding it
     makes a wrong routing look authoritative. */
  const scores = [];

  for (const [kind, list] of Object.entries(SIGNALS)) {
    const found = [];
    let weight = 0;
    for (const sig of list) {
      const m = sig.re.exec(raw);
      if (!m) continue;
      weight += sig.weight;
      found.push(Object.freeze({ id: sig.id, weight: sig.weight, quote: quoteAround(raw, m) }));
    }
    if (weight > 0) scores.push({ kind, weight, max: MAX[kind], signals: found });
  }

  const spend = spendSignal(raw);
  if (spend) {
    scores.push({
      kind: DOC_KIND.SPEND_DATA,
      // Structure is a far stronger signal than vocabulary: this either parses
      // as spend data or it does not.
      weight: 8,
      max: 8,
      signals: [Object.freeze({ id: "parses-as-spend", weight: 8, quote: spend.quote })],
      detail: spend,
    });
  }

  if (!scores.length) {
    return Object.freeze({
      kind: DOC_KIND.UNKNOWN,
      workflow: WORKFLOW[DOC_KIND.UNKNOWN],
      strength: 0,
      band: "none",
      signals: Object.freeze([]),
      alternatives: Object.freeze([]),
      missing: Object.freeze([]),
      note: "Nothing here matched a known document type. Choose a tool directly, or paste more of the document.",
    });
  }

  scores.sort((a, b) => b.weight - a.weight || b.signals.length - a.signals.length);
  const best = scores[0];
  const strength = best.weight / best.max;

  /* Bands, not a percentage. "87% confident" is a probability claim nothing
     here supports; "three strong signals" is what was actually observed. */
  const band = best.weight >= 7 ? "strong" : best.weight >= 4 ? "likely" : "weak";

  const requirements = REQUIREMENTS[best.kind] ?? [];
  const missing = requirements
    .filter((r) => !r.re.test(raw))
    .map((r) => Object.freeze({ id: r.id, label: r.label }));
  const present = requirements
    .filter((r) => r.re.test(raw))
    .map((r) => Object.freeze({ id: r.id, label: r.label }));

  return Object.freeze({
    kind: best.kind,
    workflow: WORKFLOW[best.kind],
    strength,
    band,
    matchedWeight: best.weight,
    possibleWeight: best.max,
    signals: Object.freeze(best.signals),
    detail: best.detail ?? null,
    /* Runners-up, so a wrong routing is one click from being corrected rather
       than a dead end. */
    alternatives: Object.freeze(scores.slice(1, 3).map((s) => Object.freeze({
      kind: s.kind,
      workflow: WORKFLOW[s.kind],
      matchedWeight: s.weight,
      signals: Object.freeze(s.signals.map((x) => x.id)),
    }))),
    present: Object.freeze(present),
    missing: Object.freeze(missing),
    filenameHint: filename ? String(filename).slice(0, 120) : null,
    note: band === "weak"
      ? "Only weak signals matched. Check the suggestion before using it."
      : null,
    method:
      "Classified by matching explicit signals in the text, each shown with the passage that triggered it. " +
      "No language model is involved, and nothing written in the document can change these rules — " +
      "a letter instructing the reader to treat it as something else is a letter containing that sentence.",
  });
}

/**
 * What to do next, given a classification.
 * Routes into existing tools; nothing here duplicates one.
 */
export function nextActions(result) {
  if (!result || result.kind === DOC_KIND.UNKNOWN) {
    return Object.freeze([
      Object.freeze({ id: "choose", label: "Choose a tool directly", route: "tools", primary: true }),
    ]);
  }

  const w = result.workflow;
  const actions = [
    Object.freeze({ id: "open", label: `Open ${w.label}`, route: w.route, primary: true }),
  ];

  if (result.kind === DOC_KIND.PRICE_CLAIM) {
    actions.push(Object.freeze({ id: "extract", label: "Read the letter into the case", route: w.route, extract: true }));
  }
  /* Both certificates and drawings land on the same page, in different modes.
     The action says which, because "open Should Cost Expert" tells somebody
     holding a certificate nothing about what to do next. */
  if (result.kind === DOC_KIND.CERTIFICATE) {
    actions.push(Object.freeze({
      id: "check", label: "Check it against a specification", route: w.route, mode: "cert",
    }));
  }
  if (result.kind === DOC_KIND.DRAWING) {
    actions.push(Object.freeze({
      id: "estimate", label: "Work out what the part should cost", route: w.route, mode: "material",
    }));
  }
  for (const alt of result.alternatives) {
    if (!alt.workflow.route) continue;
    actions.push(Object.freeze({ id: "alt-" + alt.kind, label: `Not that — open ${alt.workflow.label}`, route: alt.workflow.route }));
  }
  return Object.freeze(actions);
}
