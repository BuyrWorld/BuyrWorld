/**
 * A part model, written down and read back exactly.
 *
 * `specs/02`'s Phase 5 gate: *"exact geometry roundtrip and technical-review
 * provenance"*. The package already writes `part-model.json`; until now
 * nothing read one, which meant the exactness was a property of the writer
 * rather than of the pair. A format nobody reads is a format nobody has
 * checked.
 *
 * The whole of the difficulty is one line in the writer:
 *
 *     JSON.stringify(model, (k, v) => typeof v === "bigint" ? v.toString() : v)
 *
 * That is correct, and it is only half of an exchange. Read back with
 * `JSON.parse` the dimensions come home as **strings**, and the first thing
 * that multiplies one produces `"100000100000"` instead of a number ten
 * billion times smaller. Read back with `Number()` they come home as floats,
 * and a part 1.234567 metres long loses the last digit somewhere no test is
 * looking. So reading is the careful half:
 *
 *   - **Every dimension is an integer number of micrometres, or it is
 *     refused.** Not rounded, not coerced: `"100.5"` is not a micrometre count
 *     and neither is `1e5`. A file that cannot be read exactly is a file that
 *     does not open.
 *   - **What comes back is checked against the geometry module's own rules**,
 *     not against a second copy of them here. A hole outside the block, two
 *     features in the same place, a pocket as deep as the part — all of those
 *     are already `whyInvalid`, and the answer to "what does a corrupt file
 *     look like" should be the same sentence a person editing sees.
 *   - **Ids and revision survive.** Rebuilding the model through `addHole`
 *     would produce a correct part with the wrong names on it, and a
 *     requirement written against `hole-2` would point at something else.
 *
 * The test that matters is the round trip: write, read, write again, and the
 * two texts are identical, byte for byte.
 */

import { FEATURE, FRAME, SCHEMA_VERSION, whyInvalid } from "./geometry.mjs";

/** What this writes, so a reader can refuse a file it does not understand. */
export const FORMAT = "buyrworld-part-model/1";

/** The units, said in the file rather than assumed by whoever opens it. */
export const UNITS = "um";

const KINDS = new Set(Object.values(FEATURE));

/**
 * The model as text.
 *
 * Keys are written in a fixed order so two writes of the same model produce
 * the same bytes — which is what lets the manifest's checksum mean anything,
 * and what makes "identical, byte for byte" a test somebody can write.
 */
export function writeModel(model) {
  if (!model || typeof model.widthUm !== "bigint") {
    throw new TypeError("There is no model to write.");
  }

  return JSON.stringify({
    format: FORMAT,
    geometryUnits: UNITS,
    schema: model.schema ?? SCHEMA_VERSION,
    revision: model.revision,
    frame: model.frame ?? FRAME,
    widthUm: String(model.widthUm),
    lengthUm: String(model.lengthUm),
    thicknessUm: String(model.thicknessUm),
    features: model.features.map(writeFeature),
    /* Ids that have been issued and then deleted are part of the record: a
       reopened model must not reissue one, or a requirement written against a
       deleted feature attaches itself to a new one. */
    issuedIds: [...new Set([...(model.issuedIds ?? []), ...model.features.map((f) => f.id)])],
  }, null, 2);
}

function writeFeature(f) {
  if (f.kind === FEATURE.HOLE) {
    return {
      id: f.id, kind: f.kind,
      xUm: String(f.xUm), yUm: String(f.yUm), diameterUm: String(f.diameterUm),
    };
  }
  return {
    id: f.id, kind: f.kind,
    xUm: String(f.xUm), yUm: String(f.yUm),
    widthUm: String(f.widthUm), lengthUm: String(f.lengthUm), depthUm: String(f.depthUm),
  };
}

/**
 * Read one back.
 *
 * Returns `{ model }` or `{ error }`. A file is a thing somebody can hand you
 * that is wrong in ways a form cannot be, so nothing here throws on bad
 * content: the caller has a person to show the sentence to.
 */
export function readModel(text) {
  let raw;
  try {
    raw = typeof text === "string" ? JSON.parse(text) : text;
  } catch (e) {
    return { error: "That is not a model file — it is not even JSON." };
  }
  if (!raw || typeof raw !== "object") return { error: "That file holds no model." };

  if (raw.format !== FORMAT) {
    return {
      error: `This build reads ${FORMAT}. That file says it is `
           + `${raw.format ? `"${raw.format}"` : "nothing in particular"}, so it is not opened `
           + "rather than guessed at.",
    };
  }
  if (raw.geometryUnits !== UNITS) {
    return {
      error: `The file's dimensions are in "${raw.geometryUnits}" and this reads micrometres. `
           + "Converting would need a rule the file does not carry.",
    };
  }

  const dims = {};
  for (const name of ["widthUm", "lengthUm", "thicknessUm"]) {
    const v = exactUm(raw[name]);
    if (v === null) return { error: whyNotUm(raw[name], name) };
    if (v <= 0n) return { error: `A block's ${name.replace("Um", "")} must be more than nothing.` };
    dims[name] = v;
  }

  const features = [];
  const seen = new Set();
  for (const f of raw.features ?? []) {
    const read = readFeature(f);
    if (read.error) return read;
    if (seen.has(read.feature.id)) {
      return { error: `Two features in that file are both called ${read.feature.id}.` };
    }
    seen.add(read.feature.id);
    features.push(read.feature);
  }

  const revision = Number.isInteger(raw.revision) && raw.revision > 0 ? raw.revision : 1;
  const model = Object.freeze({
    schema: raw.schema ?? SCHEMA_VERSION,
    ...dims,
    features: Object.freeze(features),
    revision,
    frame: raw.frame ?? FRAME,
    issuedIds: Object.freeze([...new Set([
      ...(Array.isArray(raw.issuedIds) ? raw.issuedIds.map(String) : []),
      ...features.map((f) => f.id),
    ])]),
  });

  /* Checked against the rules the editor uses, not against a second set
     written here: a file describing an impossible part should be refused in
     the same words somebody would see for typing it. */
  for (const f of features) {
    const why = whyInvalid(model, f);
    if (why) return { error: `That file describes a part this cannot hold. ${why}` };
  }

  return { model };
}

function readFeature(f) {
  if (!f || !KINDS.has(f.kind)) {
    return { error: `A feature in that file is a "${f?.kind}", which this does not know.` };
  }
  if (!f.id || typeof f.id !== "string") return { error: "A feature in that file has no id." };

  const fields = f.kind === FEATURE.HOLE
    ? ["xUm", "yUm", "diameterUm"]
    : ["xUm", "yUm", "widthUm", "lengthUm", "depthUm"];

  const out = { id: f.id, kind: f.kind };
  for (const name of fields) {
    const v = exactUm(f[name]);
    if (v === null) return { error: `${f.id}: ${whyNotUm(f[name], name)}` };
    out[name] = v;
  }
  return { feature: Object.freeze(out) };
}

/**
 * A whole number of micrometres, or nothing.
 *
 * Accepts the string a file carries and the BigInt an in-memory model carries.
 * Refuses a JavaScript number outright, even an integral one: a file written
 * by something else may have passed a dimension through a float on the way,
 * and 100000 that arrived as 1e5 is indistinguishable here from 100000 that
 * arrived as 100000.4 and was rounded by the writer.
 */
function exactUm(v) {
  if (typeof v === "bigint") return v;
  if (typeof v !== "string") return null;
  if (!/^-?\d+$/.test(v.trim())) return null;
  return BigInt(v.trim());
}

const whyNotUm = (v, name) =>
  `${name} is ${JSON.stringify(v)}, which is not a whole number of micrometres written as text. `
  + "Dimensions are exact integers here; a value that has been through a decimal is not opened.";

/**
 * Write, read, write — and say whether the two texts match.
 *
 * Exported because it is the gate's own sentence, and a caller (an export, a
 * test, a person) should be able to ask it rather than trust it.
 */
export function roundtrips(model) {
  const first = writeModel(model);
  const back = readModel(first);
  if (back.error) return Object.freeze({ ok: false, why: back.error });

  const second = writeModel(back.model);
  return Object.freeze({
    ok: first === second,
    why: first === second
      ? "Written, read and written again: the two are identical."
      : "The model does not survive a round trip unchanged, so the file does not describe it.",
  });
}
