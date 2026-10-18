import test from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL, CAPABILITY, TYPE, ENGINE_SOURCE,
  allowedBuyrFlowOrigin, bridgeSessionFromUrl, readyMessage,
  validateOpenMessage, normaliseSavedEstimate, resultMessage,
} from "../../src/integration/buyrflow-bridge.mjs";

const ORIGIN = "https://buyrflow-git-ux-simplification-v091-buyrworlds-projects.vercel.app";
const REQUEST = "request-306c8b26-753e-43dc-a6ed-38a9943c2bc0";
const sessionUrl = `https://review.buyrworld.test/?bwBridge=should-cost&requestId=${encodeURIComponent(REQUEST)}&returnOrigin=${encodeURIComponent(ORIGIN)}`;
const caseContext = {
  id: "306c8b26-753e-43dc-a6ed-38a9943c2bc0",
  ref: "MACH204",
  title: "Dual-source actuator housings",
  objective: "Reduce single-source exposure",
  requirement: { quantity: 1400, unit: "ea", spec: "Rev F, FAI required", needBy: null },
};

function saved(overrides = {}) {
  return {
    id: "EST-001",
    name: "MACH204 housing build-up",
    part: "Actuator housing",
    supplier: null,
    currency: "GBP",
    lines: [
      { id: "material", label: "Material", minor: "1250000", oneTime: false, credit: false, quality: "supported", basis: "Reviewed stock plan" },
      { id: "machining", label: "Machining", minor: "900000", oneTime: false, credit: false, quality: "supported", basis: "Quoted route" },
    ],
    complete: true,
    missing: [],
    confidence: "evidenced",
    acceptedParts: "1400",
    synthetic: false,
    savedAt: "2026-10-18T16:00:00.000Z",
    ...overrides,
  };
}

test("only explicit BuyrFlow origins are accepted", () => {
  assert.equal(allowedBuyrFlowOrigin(ORIGIN), true);
  assert.equal(allowedBuyrFlowOrigin("https://buyrflow.vercel.app"), true);
  assert.equal(allowedBuyrFlowOrigin("https://evil.example"), false);
  assert.equal(allowedBuyrFlowOrigin("https://buyrflow.vercel.app.evil.example"), false);
});

test("bridge URL carries no Case content", () => {
  const s = bridgeSessionFromUrl(sessionUrl);
  assert.equal(s.requestId, REQUEST);
  assert.equal(s.returnOrigin, ORIGIN);
  assert.equal(new URL(sessionUrl).searchParams.has("caseId"), false);
  assert.equal(new URL(sessionUrl).searchParams.has("spec"), false);
  assert.deepEqual(readyMessage(s), {
    protocol: PROTOCOL,
    type: TYPE.READY,
    capability: CAPABILITY,
    requestId: REQUEST,
    bridgeVersion: 1,
    engineSource: ENGINE_SOURCE,
  });
});

test("unapproved return origins are refused before a bridge session exists", () => {
  assert.throws(() => bridgeSessionFromUrl(`https://x.test/?bwBridge=should-cost&requestId=${REQUEST}&returnOrigin=${encodeURIComponent("https://evil.example")}`), /Unapproved/);
});

test("Case context is validated only after the exact request handshake", () => {
  const s = bridgeSessionFromUrl(sessionUrl);
  const out = validateOpenMessage({
    protocol: PROTOCOL,
    type: TYPE.OPEN,
    capability: CAPABILITY,
    requestId: REQUEST,
    case: caseContext,
  }, s);
  assert.equal(out.id, caseContext.id);
  assert.equal(out.requirement.quantity, 1400);
  assert.equal(out.requirement.spec, "Rev F, FAI required");
  assert.throws(() => validateOpenMessage({ protocol: PROTOCOL, type: TYPE.OPEN, capability: CAPABILITY, requestId: "wrong-request", case: caseContext }, s), /does not match/);
});

test("only a build-up saved during this bridge session can return", () => {
  assert.throws(() => normaliseSavedEstimate(saved({ savedAt: "2026-10-18T15:00:00.000Z" }), {
    openedAt: "2026-10-18T15:30:00.000Z", caseContext,
  }), /Save or resave/);
  const out = normaliseSavedEstimate(saved(), { openedAt: "2026-10-18T15:30:00.000Z", caseContext });
  assert.equal(out.id, "EST-001");
  assert.equal(out.lines[0].minor, "1250000");
});

test("piece-count mismatch is refused rather than attached to the wrong Case quantity", () => {
  assert.throws(() => normaliseSavedEstimate(saved({ acceptedParts: "1200" }), {
    openedAt: "2026-10-18T15:30:00.000Z", caseContext,
  }), /requires 1400/);
});

test("floating money and malformed result lines are refused", () => {
  assert.throws(() => normaliseSavedEstimate(saved({ lines: [{ id: "material", label: "Material", minor: "12.50" }] }), {
    openedAt: "2026-10-18T15:30:00.000Z", caseContext,
  }), /exact minor-unit money/);
});

test("result message binds the saved estimate to the Case and engine source", () => {
  const s = bridgeSessionFromUrl(sessionUrl);
  const estimate = normaliseSavedEstimate(saved(), { openedAt: "2026-10-18T15:30:00.000Z", caseContext });
  const message = resultMessage(s, caseContext, estimate);
  assert.equal(message.type, TYPE.RESULT);
  assert.equal(message.caseId, caseContext.id);
  assert.equal(message.engineSource, ENGINE_SOURCE);
  assert.equal(message.result.complete, true);
  assert.equal(message.result.lines.length, 2);
});
