/**
 * Physical units, exactly.
 *
 * A should-cost estimate is arithmetic over lengths, volumes and masses, and
 * the ways it goes wrong are unit ways: a thickness in inches multiplied by a
 * width in millimetres, a density in g/cm³ applied to a volume in mm³, a
 * number with no unit at all treated as whatever the last field used.
 *
 * So a quantity here is never a bare number. It carries the unit it was
 * entered in, and it is converted once, on the way in, to a canonical integer:
 *
 *   length  micrometres (µm)
 *   mass    micrograms (µg)
 *   volume  cubic micrometres (µm³)
 *
 * Those canonical units were chosen because every unit this accepts converts
 * into them exactly, with no remainder: an inch is 25 400 µm, a pound is
 * 453 592 370 µg. Nothing is rounded on the way in, so nothing accumulates.
 *
 * Density is the one conversion worth stating out loud. 1 kg/m³ is 1 µg/mm³
 * exactly — the factors of a thousand cancel — so a density in kg/m³ needs no
 * conversion at all to work against a volume in mm³. It is still scaled by 1e9
 * so that 7.85 g/cm³ survives as 7850 rather than as a float.
 *
 * Nothing in here invents a value. An unknown unit raises; a missing unit
 * raises; a density nobody supplied raises rather than defaulting to steel.
 */

import { SCALE, scaleDiv } from "./exact.mjs";

/* ------------------------------------------------------------------ length */

/**
 * Micrometres per unit. Every one of these is exact.
 *
 * `thou` is absent on purpose: a thousandth of an inch is 25.4µm, which is not
 * an integer number of micrometres, so it cannot join this table without
 * rounding on the way in. A unit that cannot be represented exactly is
 * refused rather than approximated.
 */
export const LENGTH_UNITS = Object.freeze({
  um: 1n,
  mm: 1_000n,
  cm: 10_000n,
  m: 1_000_000n,
  in: 25_400n,
  ft: 304_800n,
});

/** Micrograms per unit. Exact. */
export const MASS_UNITS = Object.freeze({
  ug: 1n,
  mg: 1_000n,
  g: 1_000_000n,
  kg: 1_000_000_000n,
  t: 1_000_000_000_000n,
  lb: 453_592_370n,
});

/**
 * kg/m³ per unit, scaled by 1e9.
 *
 * 1 kg/m³ == 1 µg/mm³, which is why the canonical density here is also the
 * number a materials datasheet prints.
 */
export const DENSITY_UNITS = Object.freeze({
  "kg/m3": SCALE,
  "g/cm3": SCALE * 1_000n,
  "g/mm3": SCALE * 1_000_000n,
});

/* --------------------------------------------------------------- parsing */

/**
 * A plain decimal, as a BigInt scaled by 1e9. Deliberately the same accepted
 * form as ratioFromDecimalString: no exponents, no thousands separators, no
 * silent coercion of an empty string to zero.
 */
function decimalScaled(input, what) {
  if (input === null || input === undefined || String(input).trim() === "") {
    throw new RangeError(`${what} is missing. A quantity nobody entered is not zero.`);
  }
  const s = String(input).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new RangeError(`${what} is not a plain decimal: ${JSON.stringify(input)}`);
  }
  const neg = s.startsWith("-");
  const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
  if (frac.length > 9) throw new RangeError(`${what} has more than 9 decimal places: ${s}`);
  const magnitude = BigInt(whole) * SCALE + BigInt((frac + "000000000").slice(0, 9));
  return neg ? -magnitude : magnitude;
}

function convert(input, unit, table, what) {
  const u = String(unit ?? "").trim();
  if (!u) {
    throw new RangeError(
      `${what} was given as ${JSON.stringify(input)} with no unit. ` +
      `A number without a unit is not a measurement.`);
  }
  const per = table[u];
  if (per === undefined) {
    throw new RangeError(`${what}: ${JSON.stringify(u)} is not a unit this understands. ` +
      `Known: ${Object.keys(table).join(", ")}.`);
  }
  /* scaled value * (canonical per unit) / 1e9. Exact for every unit in the
     tables above, because each factor is an integer and the scale divides out. */
  return scaleDiv(decimalScaled(input, what) * per, SCALE);
}

/* -------------------------------------------------------------- quantities */

/**
 * A length, canonicalised to micrometres.
 * @returns {{um: bigint, entered: string, unit: string}}
 */
export function length(value, unit, what = "A length") {
  const um = convert(value, unit, LENGTH_UNITS, what);
  if (um < 0n) throw new RangeError(`${what} cannot be negative: ${value}${unit}`);
  return Object.freeze({ um, entered: String(value).trim(), unit: String(unit).trim() });
}

/** A mass, canonicalised to micrograms. */
export function mass(value, unit, what = "A mass") {
  const ug = convert(value, unit, MASS_UNITS, what);
  if (ug < 0n) throw new RangeError(`${what} cannot be negative: ${value}${unit}`);
  return Object.freeze({ ug, entered: String(value).trim(), unit: String(unit).trim() });
}

/**
 * A density, with the source it came from.
 *
 * The source is required, and is not decoration: mass and therefore cost rest
 * on it, and "the density of this alloy" is a fact about a specification and a
 * condition, not about a name. A caller that has no source must say so with
 * one of the provenance words rather than leaving it blank.
 *
 * @param {string} source  where the figure came from — a document, a datasheet
 *                         reference, or the literal "user-entered".
 */
export function density(value, unit, source) {
  const src = String(source ?? "").trim();
  if (!src) {
    throw new RangeError(
      "A density needs a source. Mass and cost rest on it, and it depends on " +
      "grade, condition and specification revision — it is not implied by an alloy name.");
  }
  const u = String(unit ?? "").trim();
  const per = DENSITY_UNITS[u];
  if (per === undefined) {
    throw new RangeError(`Density unit ${JSON.stringify(u)} is not understood. ` +
      `Known: ${Object.keys(DENSITY_UNITS).join(", ")}.`);
  }
  const scaled = scaleDiv(decimalScaled(value, "Density") * per, SCALE);
  if (scaled <= 0n) throw new RangeError(`Density must be positive: ${value} ${u}`);
  /* µg per mm³, scaled by 1e9 — numerically identical to kg/m³. */
  return Object.freeze({ perMm3Scaled: scaled, entered: String(value).trim(), unit: u, source: src });
}

/* ----------------------------------------------------------------- volume */

const UM3_PER_MM3 = 1_000_000_000n; // (1000 µm)³

/** The volume of a rectangular solid, in µm³. No rounding: it is a product. */
export function boxVolume(a, b, c) {
  return a.um * b.um * c.um;
}

/** The volume of a cylinder is not exact, so it is not offered here yet. */

/**
 * Mass of a volume at a density. The single rounding in the chain, named.
 * @returns {bigint} micrograms
 */
export function massOf(volumeUm3, d) {
  if (volumeUm3 < 0n) throw new RangeError("Volume cannot be negative");
  /* µg = µm³ / 1e9 (→ mm³) × µg/mm³, and the density carries its own 1e9. */
  return scaleDiv(volumeUm3 * d.perMm3Scaled, UM3_PER_MM3 * SCALE);
}

/* --------------------------------------------------------------- display */

/** Render a canonical integer in a chosen unit, to `dp` places. Half-up. */
function render(canonical, per, dp) {
  const factor = 10n ** BigInt(dp);
  const scaled = scaleDiv(canonical * factor, per);
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const whole = abs / factor;
  const frac = abs % factor;
  return (neg ? "-" : "") + whole.toString() + (dp > 0 ? "." + frac.toString().padStart(dp, "0") : "");
}

export function formatLength(um, unit = "mm", dp = 2) {
  const per = LENGTH_UNITS[unit];
  if (per === undefined) throw new RangeError(`Unknown length unit ${unit}`);
  return render(um, per, dp);
}

export function formatMass(ug, unit = "kg", dp = 3) {
  const per = MASS_UNITS[unit];
  if (per === undefined) throw new RangeError(`Unknown mass unit ${unit}`);
  return render(ug, per, dp);
}

/** Area in µm², rendered in mm² or m². Used for sheet utilisation. */
export function formatArea(um2, unit = "mm2", dp = 0) {
  const per = unit === "m2" ? 1_000_000_000_000n : unit === "mm2" ? 1_000_000n : null;
  if (per === null) throw new RangeError(`Unknown area unit ${unit}`);
  return render(um2, per, dp);
}
