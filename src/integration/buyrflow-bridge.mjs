/**
 * BuyrFlow <-> BuyrWorld capability bridge protocol.
 *
 * Pure validation/normalisation only. Browser messaging lives in the root
 * adapter so these rules can be tested without a DOM. No external content is
 * ever interpreted as an instruction: the only accepted operation is a
 * versioned Should-Cost handoff between explicitly approved origins.
 */

export const PROTOCOL = "buyrworld-capability/v1";
export const CAPABILITY = "should-cost";
export const TYPE = Object.freeze({
  READY: "buyrworld:capability-ready",
  OPEN: "buyrflow:open-capability",
  RESULT: "buyrworld:capability-result",
  ERROR: "buyrworld:capability-error",
});
export const BRIDGE_VERSION = 1;
export const ENGINE_SOURCE = "BuyrWorld/BuyrWorld@10f6b661bf14304c59a504e2ce1b38a231e31012";

const PROD_BUYRFLOW = "https://buyrflow.vercel.app";
const REVIEW_BUYRFLOW = "https://buyrflow-git-ux-simplification-v091-buyrworlds-projects.vercel.app";
export const ALLOWED_BUYRFLOW_ORIGINS = Object.freeze([PROD_BUYRFLOW, REVIEW_BUYRFLOW]);

const clean = (v, max = 240) => typeof v === "string" ? v.trim().slice(0, max) : "";
const plainId = (v) => /^[A-Za-z0-9._:-]{8,160}$/.test(String(v || ""));

export function allowedBuyrFlowOrigin(origin) {
  return ALLOWED_BUYRFLOW_ORIGINS.includes(String(origin || ""));
}

export function bridgeSessionFromUrl(urlLike) {
  const url = new URL(urlLike, "https://www.buyrworld.com/");
  if (url.searchParams.get("bwBridge") !== CAPABILITY) return null;
  const requestId = url.searchParams.get("requestId") || "";
  const returnOrigin = url.searchParams.get("returnOrigin") || "";
  if (!plainId(requestId)) throw new RangeError("Invalid bridge request id");
  if (!allowedBuyrFlowOrigin(returnOrigin)) throw new RangeError("Unapproved BuyrFlow return origin");
  return Object.freeze({
    protocol: PROTOCOL,
    capability: CAPABILITY,
    requestId,
    returnOrigin,
  });
}

export function readyMessage(session) {
  return Object.freeze({
    protocol: PROTOCOL,
    type: TYPE.READY,
    capability: CAPABILITY,
    requestId: session.requestId,
    bridgeVersion: BRIDGE_VERSION,
    engineSource: ENGINE_SOURCE,
  });
}

export function validateOpenMessage(data, session) {
  if (!data || typeof data !== "object") throw new TypeError("Capability handoff must be an object");
  if (data.protocol !== PROTOCOL || data.type !== TYPE.OPEN || data.capability !== CAPABILITY) {
    throw new RangeError("Unsupported capability message");
  }
  if (data.requestId !== session.requestId) throw new RangeError("Capability request id does not match this session");
  const c = data.case;
  if (!c || typeof c !== "object") throw new TypeError("Capability handoff needs a Case");
  const id = clean(c.id, 160), ref = clean(c.ref, 80), title = clean(c.title, 240);
  if (!plainId(id) || !ref || !title) throw new RangeError("Case id, reference and title are required");
  const r = c.requirement && typeof c.requirement === "object" ? c.requirement : {};
  const quantity = r.quantity === null || r.quantity === undefined ? null : Number(r.quantity);
  if (quantity !== null && (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000_000)) {
    throw new RangeError("Case quantity must be a positive whole number");
  }
  return Object.freeze({
    id,
    ref,
    title,
    objective: clean(c.objective, 1000) || null,
    requirement: Object.freeze({
      quantity,
      unit: clean(r.unit, 32) || null,
      spec: clean(r.spec, 1000) || null,
      needBy: /^\d{4}-\d{2}-\d{2}$/.test(String(r.needBy || "")) ? String(r.needBy) : null,
    }),
  });
}

const PIECE_UNITS = new Set(["ea", "each", "pc", "pcs", "piece", "pieces"]);
export function isPieceRequirement(caseContext) {
  return PIECE_UNITS.has(String(caseContext?.requirement?.unit || "").trim().toLowerCase());
}

function normaliseLine(line, i) {
  if (!line || typeof line !== "object") throw new TypeError(`Estimate line ${i + 1} is invalid`);
  const id = clean(line.id, 80), label = clean(line.label, 160);
  if (!id || !label) throw new RangeError(`Estimate line ${i + 1} needs an id and label`);
  const minor = line.minor === null ? null : String(line.minor);
  if (minor !== null && !/^-?\d+$/.test(minor)) throw new RangeError(`Estimate line ${label} is not exact minor-unit money`);
  return Object.freeze({
    id, label, minor,
    oneTime: Boolean(line.oneTime),
    credit: Boolean(line.credit),
    quality: clean(line.quality, 80) || null,
    basis: clean(line.basis, 1000) || null,
  });
}

export function normaliseSavedEstimate(record, { openedAt, caseContext } = {}) {
  if (!record || typeof record !== "object") throw new TypeError("No saved Should-Cost build-up was found");
  const savedAt = clean(record.savedAt, 80);
  if (!savedAt || !Number.isFinite(Date.parse(savedAt))) throw new RangeError("Saved build-up has no valid save time");
  if (openedAt && Date.parse(savedAt) < Date.parse(openedAt)) {
    throw new RangeError("Save or resave the build-up during this BuyrFlow session before returning it");
  }
  const id = clean(record.id, 160), name = clean(record.name, 240);
  const currency = clean(record.currency, 8).toUpperCase();
  if (!id || !name || !/^[A-Z]{3}$/.test(currency)) throw new RangeError("Saved build-up identity or currency is invalid");
  const lines = Array.isArray(record.lines) ? record.lines.map(normaliseLine) : null;
  if (!lines || !lines.length || lines.length > 80) throw new RangeError("Saved build-up needs between 1 and 80 cost lines");
  const acceptedParts = record.acceptedParts === null || record.acceptedParts === undefined ? null : String(record.acceptedParts);
  if (acceptedParts !== null && !/^\d+$/.test(acceptedParts)) throw new RangeError("Saved build-up accepted quantity is invalid");
  if (caseContext && isPieceRequirement(caseContext) && caseContext.requirement.quantity !== null && acceptedParts !== null
      && BigInt(acceptedParts) !== BigInt(caseContext.requirement.quantity)) {
    throw new RangeError(`Saved build-up is for ${acceptedParts} accepted parts, but ${caseContext.ref} requires ${caseContext.requirement.quantity}`);
  }
  const missing = Array.isArray(record.missing) ? record.missing.slice(0, 80).map((m) => Object.freeze({
    id: clean(m?.id, 80), label: clean(m?.label, 160),
  })).filter((m) => m.id && m.label) : [];
  return Object.freeze({
    id, name,
    part: clean(record.part, 240) || null,
    supplier: clean(record.supplier, 240) || null,
    currency,
    lines: Object.freeze(lines),
    complete: Boolean(record.complete),
    missing: Object.freeze(missing),
    confidence: clean(record.confidence, 120) || null,
    acceptedParts,
    synthetic: record.synthetic !== false,
    savedAt,
  });
}

export function resultMessage(session, caseContext, estimate) {
  return Object.freeze({
    protocol: PROTOCOL,
    type: TYPE.RESULT,
    capability: CAPABILITY,
    requestId: session.requestId,
    caseId: caseContext.id,
    bridgeVersion: BRIDGE_VERSION,
    engineSource: ENGINE_SOURCE,
    result: estimate,
  });
}

export function errorMessage(session, code, message) {
  return Object.freeze({
    protocol: PROTOCOL,
    type: TYPE.ERROR,
    capability: CAPABILITY,
    requestId: session.requestId,
    code: clean(code, 80) || "bridge-error",
    message: clean(message, 500) || "The capability bridge could not continue.",
  });
}
