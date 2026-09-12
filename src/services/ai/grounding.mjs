/**
 * Grounded field extraction.
 *
 * Shared by every document extractor: claim letters, supplier quotes and
 * contracts. One implementation of the rule, so a defence cannot hold in one
 * document class and quietly lapse in another.
 *
 * The rule: a model proposes a value and the verbatim span it read it from.
 * If that span is not in the document, the value is discarded. A model that
 * invents a figure usually invents a quote to go with it, and an invented
 * quote is detectable where an invented figure is not.
 *
 * Nothing here decides what the fields ARE — each extractor brings its own
 * rules — only whether a proposed value may be believed.
 */

import { evidence, EVIDENCE_KIND } from "../../calc/evidence.mjs";

/** The value shapes any extractor may ask for. */
export const CHECK = Object.freeze({
  text:    (v) => (typeof v === "string" && v.trim().length > 0 && v.length <= 400 ? null : "not a short piece of text"),
  ccy:     (v) => (/^[A-Z]{3}$/.test(String(v)) ? null : "not a three-letter currency code"),
  // Two decimals, because that is what moneyFromDecimal accepts. Allowing more
  // here would defer the failure to calculation time, where the cause is far
  // less obvious than it is at the point of extraction.
  money:   (v) => (/^\d+(\.\d{1,2})?$/.test(String(v)) ? null : "not a plain amount like 100.00"),
  percent: (v) => (/^-?\d+(\.\d{1,4})?$/.test(String(v)) ? null : "not a plain number like 9 or 4.5"),
  integer: (v) => (/^\d+$/.test(String(v).replace(/[,\s]/g, "")) ? null : "not a whole number"),
  period:  (v) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v)) ? null : "not a YYYY-MM period"),
  days:    (v) => (/^\d{1,4}$/.test(String(v)) ? null : "not a number of days"),
  weeks:   (v) => (/^\d{1,3}$/.test(String(v)) ? null : "not a number of weeks"),
  bool:    (v) => (typeof v === "boolean" || v === "true" || v === "false" ? null : "not true or false"),
  clause:  (v) => (typeof v === "string" && /\d/.test(v) && v.length <= 40 ? null : "not a clause reference"),
  enum:    () => null, // the extractor checks membership itself
});

/**
 * Build a collector bound to one source document.
 *
 * @param {string} source  the document the model was given
 * @param {string} label   what to call it in evidence, e.g. "supplier letter"
 */
export function grounder(source, label) {
  const haystack = normalise(source);
  const rejected = [];
  let claimed = 0;
  let grounded = 0;

  /**
   * @param {object} entry  { value, quote } as the model returned it
   * @param {object} rule   { type, label, oneOf? }
   * @param {string} where  a path for the rejection report
   */
  function take(entry, rule, where) {
    if (!entry || typeof entry !== "object") return null;
    const { value, quote } = entry;
    // A null is a useful answer: the document does not say. Not a claim, not a failure.
    if (value === null || value === undefined || value === "") return null;
    claimed++;

    const problem = (CHECK[rule.type] ?? CHECK.text)(value);
    if (problem) {
      rejected.push({ field: where, value: String(value), reason: `${rule.label} is ${problem}` });
      return null;
    }
    if (rule.oneOf && !rule.oneOf.includes(String(value))) {
      rejected.push({
        field: where, value: String(value),
        reason: `${rule.label} must be one of: ${rule.oneOf.join(", ")}`,
      });
      return null;
    }
    if (typeof quote !== "string" || quote.trim() === "") {
      rejected.push({ field: where, value: String(value), reason: "no supporting quote was given" });
      return null;
    }
    if (!haystack.includes(normalise(quote))) {
      rejected.push({
        field: where, value: String(value),
        reason: `the quoted words do not appear in the ${label}, so the value is not grounded`,
        quote: quote.slice(0, 120),
      });
      return null;
    }

    grounded++;
    return Object.freeze({
      value: String(value).trim(),
      provenance: "ai-inferred",
      confirmedBy: null,
      evidence: evidence(EVIDENCE_KIND.DOCUMENT, { label, quote: quote.trim() }),
    });
  }

  /** Apply a whole rule set to one object the model returned. */
  function takeAll(obj, rules, prefix = "") {
    const out = {};
    if (!obj || typeof obj !== "object") return out;
    for (const [key, rule] of Object.entries(rules)) {
      const got = take({ value: obj[key], quote: obj.quote ?? obj[`${key}Quote`] }, rule, prefix + key);
      if (got) out[key] = got;
    }
    return out;
  }

  return Object.freeze({
    take, takeAll,
    get rejected() { return rejected; },
    get claimed() { return claimed; },
    get grounded() { return grounded; },
  });
}

/** Mark a field confirmed. Only a confirmed field may enter a calculation. */
export function confirmField(field, by) {
  if (!field) return field;
  if (!by) throw new TypeError("Confirming a field needs to record who confirmed it");
  return Object.freeze({ ...field, confirmedBy: { by, at: new Date().toISOString().slice(0, 10) } });
}

/** Is every field in a structure confirmed? Used to gate anything downstream. */
export function allConfirmed(structure) {
  return fieldsOf(structure).every((f) => f.confirmedBy !== null);
}

/** Walk a nested extraction result and yield its fields. */
export function fieldsOf(structure) {
  const out = [];
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Object.prototype.hasOwnProperty.call(v, "provenance") && Object.prototype.hasOwnProperty.call(v, "value")) {
      out.push(v);
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x);
  };
  walk(structure);
  return out;
}

/** Whitespace, case and curly punctuation are not meaningful when matching a quote. */
export function normalise(s) {
  return String(s)
    .replace(/\s+/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .trim()
    .toLowerCase();
}
