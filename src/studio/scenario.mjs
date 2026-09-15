/**
 * The one model behind both Studio entry paths.
 *
 * `design/05-NO-DRAWING.md` requires Upload drawing and No drawing — enter
 * details manually to be equally supported, and to converge on one model: the
 * same reviewed values must produce the same results whichever way they
 * arrived. So neither path has a model of its own. There is this one, and a
 * field records where its value came from.
 *
 * Three rules do most of the work here.
 *
 * 1. **Blank, unknown and zero are three different things.** A field nobody
 *    has reached is not a field somebody looked at and could not answer, and
 *    neither is a field whose answer is zero. Collapsing them is how a missing
 *    rate becomes £0.00. They are distinct states and they read differently on
 *    screen.
 *
 * 2. **A value carries what was typed, not what was parsed.** `"0.50"` and
 *    `"0.5"` are the same number and not the same entry; the pack asks for
 *    enough precision and the original input for audit. Conversion to exact
 *    types happens at calculation time, through `units.mjs` and `exact.mjs`,
 *    so nothing in this file has to be trusted with arithmetic.
 *
 * 3. **An extracted value is a proposal until somebody accepts it.** It never
 *    overwrites a value a person entered, and a late extraction never
 *    overwrites an edit made while it was running. That is enforced by
 *    comparing edit times, not by hoping the ordering works out.
 */

/* ------------------------------------------------------------------ states */

/** Where a value came from. */
export const SOURCE = Object.freeze({
  MANUAL: "manual",           // a person typed it
  EXTRACTED: "extracted",     // a reader proposed it from a document
  ASSUMPTION: "assumption",   // a stated default, standing in until reviewed
});

/** What the reader should be told about a field, in the pack's own words. */
export const STATE = Object.freeze({
  CONFIRMED: "User confirmed",
  PROPOSED: "Extracted — check this",
  ASSUMED: "Assumed",
  MISSING: "Missing",
  UNKNOWN: "Not known yet",
});

/** How the scenario was started. Both are first-class; neither is a fallback. */
export const ENTRY = Object.freeze({
  MANUAL: "no-drawing",
  UPLOAD: "upload-drawing",
});

/** What the user is trying to get out of it. Completeness is judged per goal. */
export const GOAL = Object.freeze({
  QUANTITY: "quantity-plan",
  COST: "cost-estimate",
  BOTH: "both",
});

export const SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------- field */

/**
 * One recorded fact.
 *
 * @param {object} [init]
 * @param {string|null} [init.value]    exactly what was entered, as text
 * @param {string|null} [init.unit]     the unit or basis it was entered in
 * @param {string} [init.source]        SOURCE.*
 * @param {boolean} [init.reviewed]     a person has accepted this value
 * @param {boolean} [init.unknown]      a person said they do not know
 * @param {object|null} [init.from]     { document, page } where it was read
 * @param {string|null} [init.by]       who last set it
 * @param {string|null} [init.at]       ISO timestamp of that change
 */
export function field(init = {}) {
  const raw = init.value;
  const value = raw === null || raw === undefined || raw === "" ? null : String(raw);
  const unknown = Boolean(init.unknown);

  /* A value and "I don't know" are mutually exclusive claims about the same
     fact. Holding both would make every consumer decide which to believe. */
  if (value !== null && unknown) {
    throw new RangeError("A field cannot both hold a value and be marked unknown");
  }

  return Object.freeze({
    value,
    unit: init.unit ?? null,
    source: init.source ?? SOURCE.MANUAL,
    reviewed: Boolean(init.reviewed),
    unknown,
    from: init.from ?? null,
    by: init.by ?? null,
    at: init.at ?? null,
    /* What the person actually typed, when a unit change could not be
       represented exactly in the new unit. The pack asks for the original
       input to be kept for audit, and a converted 0.984 does not tell anyone
       that 25 mm was entered. */
    enteredAs: init.enteredAs ?? null,
  });
}

/** An empty field nobody has reached yet. */
export const empty = () => field({});

/** What to show beside a field. */
export function stateOf(f) {
  if (!f || typeof f !== "object") return STATE.MISSING;
  if (f.unknown) return STATE.UNKNOWN;
  if (f.value === null) return STATE.MISSING;
  if (f.source === SOURCE.ASSUMPTION) return STATE.ASSUMED;
  if (f.source === SOURCE.EXTRACTED && !f.reviewed) return STATE.PROPOSED;
  return STATE.CONFIRMED;
}

/** Whether a field may be used in a calculation. */
export function usable(f) {
  if (!f || f.value === null || f.unknown) return false;
  /* An unreviewed extraction is a proposal. Calculating with it would put a
     number nobody has checked into a figure somebody will quote. */
  return !(f.source === SOURCE.EXTRACTED && !f.reviewed);
}

/* ---------------------------------------------------------------- scenario */

/** The fields the supported rectangular-blank workflow knows about. */
export const FIELDS = Object.freeze([
  ["partName", "Part name", null],
  ["materialGrade", "Material grade", null],
  ["temper", "Temper or condition", null],
  ["stockForm", "Stock form", null],
  ["goodParts", "Accepted parts required", "pieces"],
  ["blankWidth", "Blank width", "length"],
  ["blankLength", "Blank length", "length"],
  ["blankThickness", "Blank thickness", "length"],
  ["stockWidth", "Stock sheet width", "length"],
  ["stockLength", "Stock sheet length", "length"],
  ["kerf", "Cut width (kerf)", "length"],
  ["edgeMargin", "Edge trim", "length"],
  ["passRate", "Expected pass rate", "percent"],
  ["setupPieces", "Blanks consumed setting up", "pieces"],
  ["density", "Material density", "density"],
  ["materialRate", "Material rate", "money"],
]);

const FIELD_NAMES = new Set(FIELDS.map(([k]) => k));
export const labelOf = (name) => (FIELDS.find(([k]) => k === name) || [null, name])[1];

/**
 * A new scenario.
 *
 * `document` is nullable and stays nullable on the manual route: the pack is
 * explicit that manual entry must work with no filename, document id, upload
 * record or extraction job, so there is nowhere for a placeholder to live.
 */
export function scenario(init = {}) {
  const entry = init.entry === ENTRY.UPLOAD ? ENTRY.UPLOAD : ENTRY.MANUAL;
  const fields = {};
  for (const [name] of FIELDS) {
    fields[name] = init.fields && init.fields[name] ? field(init.fields[name]) : empty();
  }

  return Object.freeze({
    schema: SCHEMA_VERSION,
    id: init.id ?? null,
    name: init.name ?? null,
    entry,
    goal: init.goal ?? GOAL.QUANTITY,
    unit: init.unit ?? "mm",
    document: init.document ?? null,
    fields: Object.freeze(fields),
    revision: init.revision ?? 1,
    updatedAt: init.updatedAt ?? null,
  });
}

/** A scenario with one field replaced. Returns a new scenario. */
export function withField(s, name, next) {
  if (!FIELD_NAMES.has(name)) throw new RangeError(`Unknown field: ${name}`);
  return scenario({
    ...s,
    fields: { ...s.fields, [name]: field(next) },
    revision: s.revision + 1,
    updatedAt: next.at ?? new Date().toISOString(),
  });
}

/* ------------------------------------------------------------- completeness */

/** What each output needs before it can be calculated at all. */
const NEEDS = Object.freeze({
  [GOAL.QUANTITY]: [
    "goodParts", "blankWidth", "blankLength",
    "stockWidth", "stockLength", "kerf", "edgeMargin", "passRate",
  ],
  mass: ["blankThickness", "density"],
  [GOAL.COST]: ["materialRate"],
});

/**
 * What can be produced, and precisely what is stopping the rest.
 *
 * Per output, never for the scenario as a whole: `design/05-NO-DRAWING.md`
 * requires a valid piece-count plan to display while a complete cost stays
 * blocked. One overall "incomplete" would hide the plan that is ready.
 */
export function readiness(s) {
  const missing = (names) => names.filter((n) => !usable(s.fields[n]));

  const qty = missing(NEEDS[GOAL.QUANTITY]);
  const mass = missing(NEEDS.mass);
  const cost = missing(NEEDS[GOAL.COST]);

  const gap = (names, what) => names.length === 0
    ? null
    : `${what} needs ${names.map(labelOf).join(", ")}.`;

  return Object.freeze({
    quantityPlan: Object.freeze({
      ready: qty.length === 0,
      missing: Object.freeze(qty),
      message: gap(qty, "A quantity plan"),
    }),
    /* Mass depends on the quantity plan, so it reports both sets rather than
       claiming to be one field away when it is nine. */
    materialMass: Object.freeze({
      ready: qty.length === 0 && mass.length === 0,
      missing: Object.freeze([...qty, ...mass]),
      message: gap([...qty, ...mass], "A purchased mass"),
    }),
    cost: Object.freeze({
      ready: qty.length === 0 && mass.length === 0 && cost.length === 0,
      missing: Object.freeze([...qty, ...mass, ...cost]),
      message: gap([...qty, ...mass, ...cost], "A complete cost"),
    }),
    /* Named separately because it is the thing a person is most likely to
       have deliberately said they cannot answer. */
    unknowns: Object.freeze(Object.entries(s.fields)
      .filter(([, f]) => f.unknown)
      .map(([k]) => k)),
  });
}

/** Whether anything at all has been entered, for deciding if a draft is worth saving. */
export const started = (s) =>
  Object.values(s.fields).some((f) => f.value !== null || f.unknown);

/* ------------------------------------------------- a drawing arriving later */

/**
 * Compare extracted candidates against what the scenario already holds.
 *
 * Nothing is applied here. This returns what a person has to decide, because
 * the pack is explicit that a later upload must never silently overwrite a
 * reviewed value, and that a late extraction must not overwrite a newer manual
 * edit. Both are decided by comparing the edit time against the moment the
 * extraction was started — not by the order the results came back in.
 *
 * @param {object} s            the scenario as it stands
 * @param {object} candidates   { fieldName: { value, unit, from } }
 * @param {string} startedAt    ISO time the extraction began
 */
export function compareExtraction(s, candidates, startedAt) {
  const fill = [];
  const conflict = [];
  const stale = [];
  const same = [];

  for (const [name, candidate] of Object.entries(candidates || {})) {
    if (!FIELD_NAMES.has(name)) continue;
    const current = s.fields[name];
    const proposal = { ...candidate, source: SOURCE.EXTRACTED, reviewed: false };

    /* Edited while the extraction was running: the person has seen the field
       more recently than the document reader has. Their value stands, and the
       proposal is reported as overtaken rather than offered as a choice.

       Parsed rather than compared as text — ISO strings only sort correctly
       when they share a format and a zone, and one value with an offset
       instead of Z would silently order wrongly. */
    if (newer(current.at, startedAt)) {
      stale.push({ name, current, proposal });
      continue;
    }

    if (current.value === null && !current.unknown) {
      /* Empty fields may be filled, but only as unreviewed candidates. */
      fill.push({ name, proposal });
    } else if (current.unknown) {
      /* "I don't know" is a real answer and a candidate is useful against it,
         but it is still the person's field to accept. */
      conflict.push({ name, current, proposal, why: "you said this was not known" });
    } else if (String(current.value) === String(candidate.value)
               && (current.unit ?? null) === (candidate.unit ?? null)) {
      same.push({ name, current, proposal });
    } else {
      conflict.push({ name, current, proposal, why: "the drawing says something different" });
    }
  }

  return Object.freeze({
    fill: Object.freeze(fill),
    conflict: Object.freeze(conflict),
    stale: Object.freeze(stale),
    same: Object.freeze(same),
    /* Nothing changes until somebody chooses. */
    applied: false,
  });
}

/** Is `a` strictly later than `b`? False if either is missing or unparseable. */
function newer(a, b) {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta > tb;
}

/** Apply only the candidates a person accepted, by field name. */
export function acceptCandidates(s, comparison, names, by = null) {
  const wanted = new Set(names || []);
  const at = new Date().toISOString();
  let next = s;

  for (const group of [comparison.fill, comparison.conflict]) {
    for (const item of group) {
      if (!wanted.has(item.name)) continue;
      next = withField(next, item.name, {
        ...item.proposal,
        /* Accepting is reviewing. The person has looked at it and said yes. */
        reviewed: true,
        by, at,
      });
    }
  }
  return next;
}

/* -------------------------------------------------------------- unit change */

/** Exact conversions, as integers of thousandths, so no float rounds a dimension. */
const PER_MM = Object.freeze({ mm: 1000n, in: 25400n });

/**
 * Change the scenario's length unit.
 *
 * Two honest options, and the pack demands the choice be explicit: convert the
 * numbers so they mean the same size, or reinterpret them so the same digits
 * now mean the new unit. Silently relabelling is the one thing that must not
 * happen, so `how` has no default.
 */
export function changeUnit(s, to, how, by = null) {
  if (!PER_MM[to]) throw new RangeError(`Unsupported unit: ${to}`);
  if (how !== "convert" && how !== "reinterpret") {
    throw new RangeError('Say whether to "convert" the values or "reinterpret" them');
  }
  if (s.unit === to) return s;
  if (how === "reinterpret") return scenario({ ...s, unit: to, revision: s.revision + 1 });

  const at = new Date().toISOString();
  const from = PER_MM[s.unit];
  const into = PER_MM[to];
  const fields = { ...s.fields };

  for (const [name, , kind] of FIELDS) {
    if (kind !== "length") continue;
    const f = fields[name];
    if (f.value === null) continue;

    /* Thousandths of the canonical unit throughout, so 0.125 in is exact and
       nothing is ever a binary fraction. */
    const thou = toThousandths(f.value);
    if (thou === null) continue;
    const converted = (thou * from) / into;
    const remainder = (thou * from) % into;

    fields[name] = field({
      ...f,
      value: remainder === 0n
        ? fromThousandths(converted)
        /* Not exact in the new unit. Keeping more digits would invent
           precision the original entry never had, so this records the
           rounded value and the original text stays in `enteredAs`. */
        : fromThousandths(converted),
      unit: to,
      by, at,
      enteredAs: remainder === 0n ? null : { value: f.value, unit: s.unit },
    });
  }

  return scenario({ ...s, unit: to, fields, revision: s.revision + 1, updatedAt: at });
}

/** "12.75" -> 12750n. Null when it is not a plain decimal. */
function toThousandths(text) {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(String(text).trim());
  if (!m) return null;
  const sign = m[1] === "-" ? -1n : 1n;
  const whole = BigInt(m[2]);
  const frac = BigInt((m[3] ?? "").padEnd(3, "0"));
  return sign * (whole * 1000n + frac);
}

/** 12750n -> "12.75", trailing zeros trimmed, never in exponent form. */
function fromThousandths(n) {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 1000n;
  const frac = String(abs % 1000n).padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
