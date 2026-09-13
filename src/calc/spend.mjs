/**
 * Spend analysis.
 *
 * The strongest existing logic in the product, and until now the only tool
 * producing numbers with floating-point arithmetic and no tests. `CLAUDE.md`
 * forbids floats in this directory for the reason the cost bridge demonstrated:
 * rounding in the wrong place is worth real money, and nobody notices.
 *
 * So money is exact integer minor units throughout, shares are exact ratios,
 * and the concentration index is computed without ever dividing early.
 *
 * One deliberate change of substance. The savings ranges were hard-coded
 * percentages — 5-12% of the largest category, 5-10% of the tail, 2-4% of
 * total — presented alongside measured figures as though they were of the same
 * kind. They are not: they are rules of thumb, and this data cannot evidence
 * them. They are now returned as assumptions, labelled, with their basis
 * stated, so a reader can tell a measurement from a heuristic.
 */

import {
  SCALE, ONE, scaleDiv, money, moneyToDecimalString,
} from "./exact.mjs";

/* ------------------------------------------------------------------ parse */

const AMOUNT_JUNK = /[£$€,\s]/g;

/** Parse one amount to exact minor units. Returns null rather than NaN. */
export function parseAmount(raw) {
  const s = String(raw ?? "").replace(AMOUNT_JUNK, "").trim();
  if (s === "") return null;
  // Accept a leading minus (a credit note is real) but nothing else exotic.
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  const minor = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return sign === "-" ? -minor : minor;
}

/**
 * Read comma-separated spend data, detecting a header row and inferring which
 * column is which. Everything it could not read is counted and reported —
 * silently dropping rows is how a total ends up wrong and confident.
 */
export function parseSpendCsv(text, { currency = "GBP" } = {}) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    return Object.freeze({ rows: [], skipped: 0, skippedExamples: [], header: null, currency });
  }

  let iSupplier = 0, iCategory = 1, iAmount = 2, start = 0, header = null;
  const head = lines[0].toLowerCase();
  if (/supplier|vendor|name|category|amount|value|spend|total|cost/.test(head)) {
    const cols = head.split(",").map((c) => c.trim());
    const find = (words, fallback) => {
      const i = cols.findIndex((c) => words.some((w) => c.includes(w)));
      return i >= 0 ? i : fallback;
    };
    iSupplier = find(["supplier", "vendor", "payee", "name"], 0);
    iCategory = find(["category", "commodity", "group", "type"], 1);
    iAmount = find(["amount", "value", "spend", "total", "cost", "net"], 2);
    start = 1;
    header = Object.freeze({ columns: cols, supplier: iSupplier, category: iCategory, amount: iAmount });
  }

  const rows = [];
  const skippedExamples = [];
  let skipped = 0;

  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const minor = parseAmount(parts[iAmount]);
    if (minor === null) {
      skipped++;
      if (skippedExamples.length < 5) skippedExamples.push({ line: i + 1, text: lines[i].slice(0, 80) });
      continue;
    }
    rows.push(Object.freeze({
      supplier: (parts[iSupplier] ?? "").trim() || "(blank)",
      category: (parts[iCategory] ?? "").trim() || "Uncategorised",
      minor,
      line: i + 1,
    }));
  }

  return Object.freeze({ rows, skipped, skippedExamples, header, currency });
}

/* --------------------------------------------------------------- analysis */

const pct = (part, whole) => (whole === 0n ? 0n : scaleDiv(part * SCALE, whole));

/**
 * @param {object} parsed  a parseSpendCsv result
 */
export function analyseSpend(parsed) {
  const { rows, currency } = parsed;
  const M = (minor) => money(minor, currency, null);

  if (!rows.length) {
    return Object.freeze({
      ok: false,
      reason: "No rows carried a readable amount. Check the data is comma-separated with a numeric amount column.",
      skipped: parsed.skipped,
    });
  }

  const bySupplier = new Map();
  const byCategory = new Map();
  let total = 0n;
  let largestLine = null;

  for (const r of rows) {
    bySupplier.set(r.supplier, (bySupplier.get(r.supplier) ?? 0n) + r.minor);
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0n) + r.minor);
    total += r.minor;
    if (!largestLine || r.minor > largestLine.minor) largestLine = r;
  }

  if (total <= 0n) {
    return Object.freeze({
      ok: false,
      reason: "The amounts sum to zero or less, so shares and concentration cannot be calculated.",
      skipped: parsed.skipped,
    });
  }

  const suppliers = [...bySupplier.entries()]
    .map(([name, minor]) => ({ name, minor, share: pct(minor, total) }))
    .sort((a, b) => (b.minor > a.minor ? 1 : b.minor < a.minor ? -1 : 0));
  const categories = [...byCategory.entries()]
    .map(([name, minor]) => ({ name, minor, share: pct(minor, total) }))
    .sort((a, b) => (b.minor > a.minor ? 1 : b.minor < a.minor ? -1 : 0));

  /* Concentration. HHI is the sum of squared percentage shares, which is
     10000 x sum(v^2) / total^2 — computed without dividing until the end, so
     nothing is lost to intermediate rounding. */
  let sumOfSquares = 0n;
  for (const s of suppliers) sumOfSquares += s.minor * s.minor;
  const hhi = Number(scaleDiv(10_000n * sumOfSquares, total * total));
  const concentration =
    hhi >= 1800 ? { level: "high", label: "High concentration" }
    : hhi >= 1000 ? { level: "moderate", label: "Moderate concentration" }
    : { level: "low", label: "Healthy competition" };

  /* Pareto: how few suppliers account for 80%. */
  let cumulative = 0n;
  let suppliersTo80 = 0;
  for (const s of suppliers) {
    cumulative += s.minor;
    suppliersTo80++;
    if (pct(cumulative, total) >= 800_000_000n) break;   // 80%
  }

  /* What the top fifth of suppliers actually accounts for. */
  const topFifthCount = Math.max(1, Math.ceil(suppliers.length * 0.2));
  let topFifthValue = 0n;
  for (let i = 0; i < topFifthCount; i++) topFifthValue += suppliers[i].minor;

  /* Bands. A supplier sits in exactly one. */
  const TEN = 100_000_000n, ONE_PCT = 10_000_000n;
  const critical = suppliers.filter((s) => s.share >= TEN);
  const core = suppliers.filter((s) => s.share >= ONE_PCT && s.share < TEN);
  const tail = suppliers.filter((s) => s.share < ONE_PCT);
  const band = (label, list) => {
    const value = list.reduce((a, s) => a + s.minor, 0n);
    return Object.freeze({ label, count: list.length, value: M(value), share: pct(value, total), suppliers: list });
  };

  const uncategorised = byCategory.get("Uncategorised") ?? 0n;

  return Object.freeze({
    ok: true,
    currency,
    total: M(total),
    rows: rows.length,
    skipped: parsed.skipped,
    skippedExamples: parsed.skippedExamples,

    suppliers: suppliers.map((s) => Object.freeze({ ...s, value: M(s.minor) })),
    categories: categories.map((c) => Object.freeze({ ...c, value: M(c.minor) })),

    largestSupplierShare: suppliers[0].share,
    largestLine: Object.freeze({ supplier: largestLine.supplier, value: M(largestLine.minor), line: largestLine.line }),
    uncategorisedShare: pct(uncategorised, total),

    concentration: Object.freeze({
      hhi, ...concentration,
      method:
        "Herfindahl-Hirschman Index: the sum of each supplier's squared percentage share. " +
        "1800 and above is conventionally read as high concentration, below 1000 as competitive. " +
        "It describes this data set only.",
    }),

    pareto: Object.freeze({
      suppliersTo80,
      ofSuppliers: suppliers.length,
      topFifthCount,
      topFifthShare: pct(topFifthValue, total),
      topFifthValue: M(topFifthValue),
    }),

    bands: Object.freeze([
      band("Critical (10% or more of spend)", critical),
      band("Core (1% to 10%)", core),
      band("Tail (under 1%)", tail),
    ]),

    measured: true,
  });
}

/**
 * Indicative savings ranges.
 *
 * Returned separately and labelled as assumptions, because that is what they
 * are. The percentages are rules of thumb from procurement practice; this data
 * cannot evidence them, and presenting them beside measured figures as though
 * it could is how an indicative range becomes a number in a board paper.
 */
export function indicativeSavings(analysis) {
  if (!analysis?.ok) return Object.freeze({ ranges: [], note: "No analysis to base a range on." });

  const M = (minor) => money(minor, analysis.currency, null);
  const scale = (minor, ratio) => scaleDiv(minor * ratio, SCALE);
  const ranges = [];

  const topCategory = analysis.categories[0];
  if (topCategory) {
    ranges.push(Object.freeze({
      id: "competitive-tension",
      name: `Competitive tension on ${topCategory.name}`,
      min: M(scale(topCategory.minor, 50_000_000n)),   // 5%
      max: M(scale(topCategory.minor, 120_000_000n)),  // 12%
      basis: `5% to 12% of ${moneyToDecimalString(topCategory.value)} category spend, via a competitive event`,
      assumption: "that this category has not been tested recently and that capable alternatives exist",
    }));
  }

  const tailBand = analysis.bands.find((b) => b.label.startsWith("Tail"));
  if (tailBand && tailBand.count > 3) {
    ranges.push(Object.freeze({
      id: "tail-consolidation",
      name: "Tail consolidation",
      min: M(scale(tailBand.value.minor, 50_000_000n)),
      max: M(scale(tailBand.value.minor, 100_000_000n)),
      basis: `5% to 10% of ${moneyToDecimalString(tailBand.value)} tail spend, plus process cost`,
      assumption: `that the ${tailBand.count} tail suppliers can be consolidated without losing capability`,
    }));
  }

  ranges.push(Object.freeze({
    id: "specification-challenge",
    name: "Specification and demand challenge",
    min: M(scale(analysis.total.minor, 20_000_000n)),
    max: M(scale(analysis.total.minor, 40_000_000n)),
    basis: "2% to 4% of total spend",
    assumption: "a general rule of thumb, not derived from anything in this data",
  }));

  const sum = (k) => ranges.reduce((a, r) => a + r[k].minor, 0n);

  return Object.freeze({
    ranges,
    totalMin: M(sum("min")),
    totalMax: M(sum("max")),
    // Said plainly, because the figure above looks exactly like a measurement.
    label: "assumed",
    note:
      "These are indicative ranges based on procurement rules of thumb, not figures derived " +
      "from this data. Nothing here has been validated against an outcome. Treat them as a " +
      "prompt for where to look, never as a savings forecast.",
  });
}
