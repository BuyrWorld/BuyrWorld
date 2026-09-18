/**
 * Writing a part model down, and reading it back exactly.
 *
 * `specs/02`'s Phase 5 gate opens with *"exact geometry roundtrip"*, and the
 * failure it is guarding against is specific: dimensions written as strings
 * come back as strings, and the first thing that multiplies one gets an answer
 * ten billion times too large. Read them with `Number()` instead and a long
 * part quietly loses its last micrometre.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { block, addHole, addPocket, removeFeature, volume, FEATURE } from "../../src/studio/geometry.mjs";
import { writeModel, readModel, roundtrips, FORMAT, UNITS } from "../../src/studio/model-io.mjs";

/** A block with both kinds of feature on it. */
function part() {
  let m = block({ widthUm: 100_000n, lengthUm: 60_000n, thicknessUm: 10_000n });
  m = addHole(m, { xUm: 15_000n, yUm: 20_000n, diameterUm: 8_000n }).model;
  m = addPocket(m, {
    xUm: 40_000n, yUm: 10_000n, widthUm: 20_000n, lengthUm: 20_000n, depthUm: 3_000n,
  }).model;
  return m;
}

/* -------------------------------------------------------------- the trip */

describe("the round trip", () => {
  test("write, read, write — identical, byte for byte", () => {
    const first = writeModel(part());
    const { model, error } = readModel(first);
    assert.equal(error, undefined);
    assert.equal(writeModel(model), first);
  });

  test("and the module will say so itself", () => {
    assert.equal(roundtrips(part()).ok, true);
    assert.match(roundtrips(part()).why, /identical/);
  });

  test("every dimension comes back a BigInt, not a string", () => {
    const { model } = readModel(writeModel(part()));
    for (const name of ["widthUm", "lengthUm", "thicknessUm"]) {
      assert.equal(typeof model[name], "bigint", `${name} came back a ${typeof model[name]}`);
    }
    for (const f of model.features) {
      assert.equal(typeof f.xUm, "bigint");
    }
  });

  test("and the arithmetic gives the same answer on both sides", () => {
    const before = volume(part());
    const after = volume(readModel(writeModel(part())).model);
    assert.equal(after.lowerUm3, before.lowerUm3);
    assert.equal(after.upperUm3, before.upperUm3);
    assert.equal(after.exact, before.exact);
  });

  test("a dimension no float could hold survives", () => {
    /* 9,007,199,254,740,993 µm is Number.MAX_SAFE_INTEGER + 2: a nine-billion
       metre part, which is absurd, and exactly why it is the right test. If it
       came back as a Number it would come back even. */
    const absurd = block({
      widthUm: 9_007_199_254_740_993n, lengthUm: 1_000n, thicknessUm: 1_000n,
    });
    assert.equal(readModel(writeModel(absurd)).model.widthUm, 9_007_199_254_740_993n);
  });

  test("ids and revision survive, because a requirement points at an id", () => {
    let m = part();
    m = removeFeature(m, "hole-1").model;
    const { model } = readModel(writeModel(m));
    assert.deepEqual(model.features.map((f) => f.id), m.features.map((f) => f.id));
    assert.equal(model.revision, m.revision);
    assert.ok(model.issuedIds.includes("hole-1"),
      "a deleted id was forgotten, so it can be issued again");
  });
});

/* ----------------------------------------------------------- what it says */

describe("the file says what it is", () => {
  const written = () => JSON.parse(writeModel(part()));

  test("its format and its units are in it, not assumed by the reader", () => {
    assert.equal(written().format, FORMAT);
    assert.equal(written().geometryUnits, UNITS);
  });

  test("and the frame, so a coordinate means something", () => {
    assert.match(written().frame.origin, /bottom-left/);
  });

  test("two writes of the same model produce the same bytes", () => {
    assert.equal(writeModel(part()), writeModel(part()));
  });
});

/* ------------------------------------------------------- what it refuses */

describe("a file it will not open", () => {
  const broken = (change) => {
    const raw = JSON.parse(writeModel(part()));
    change(raw);
    return readModel(JSON.stringify(raw));
  };

  test("something that is not JSON at all", () => {
    assert.match(readModel("<xml/>").error, /not even JSON/);
  });

  test("a format this build does not read", () => {
    assert.match(broken((r) => { r.format = "somebody-elses/2"; }).error, /not opened/);
  });

  test("dimensions in another unit", () => {
    assert.match(broken((r) => { r.geometryUnits = "mm"; }).error, /micrometres/);
  });

  test("a dimension that has been through a decimal", () => {
    assert.match(broken((r) => { r.widthUm = "100.5"; }).error, /whole number of micrometres/);
  });

  test("a dimension written as a number rather than as text", () => {
    /* Even an integral one: 1e5 and 100000.4-rounded-by-the-writer are the
       same thing by the time they arrive here. */
    assert.match(broken((r) => { r.widthUm = 100000; }).error, /whole number of micrometres/);
  });

  test("a feature kind it does not know", () => {
    assert.match(broken((r) => { r.features[0].kind = "chamfer"; }).error, /does not know/);
  });

  test("two features with the same name", () => {
    assert.match(broken((r) => { r.features[1].id = r.features[0].id; }).error, /both called/);
  });

  test("a hole that falls outside the block, in the editor's own words", () => {
    const e = broken((r) => { r.features[0].xUm = "900000"; }).error;
    assert.match(e, /falls outside the block/);
    assert.match(e, /describes a part this cannot hold/);
  });

  test("a pocket as deep as the part is a hole, and says so", () => {
    assert.match(broken((r) => { r.features[1].depthUm = "10000"; }).error,
      /That is a hole, not a pocket/);
  });

  test("and nothing it refuses throws — there is a person to show it to", () => {
    for (const bad of ["", "null", "[]", '{"format":"buyrworld-part-model/1"}']) {
      assert.doesNotThrow(() => readModel(bad));
      assert.ok(readModel(bad).error, `${bad} was accepted`);
    }
  });
});

describe("writing", () => {
  test("refuses when there is nothing to write", () => {
    assert.throws(() => writeModel(null), /no model to write/);
    assert.throws(() => writeModel({ widthUm: "100000" }), /no model to write/);
  });
});

/* ------------------------------------------- the file the package ships */

describe("the model in a review package", () => {
  test("is written in this format, and opens", async () => {
    const { snapshot, buildPackage } = await import("../../src/studio/review-export.mjs");
    const { requirement, tolerance, KIND } = await import("../../src/studio/requirements.mjs");

    const model = part();
    const pkg = await buildPackage(snapshot({
      part: "SYN-BRACKET-001", partRevision: "B", units: "mm",
      preparedBy: "a buyer", at: "2026-09-15T12:00:00.000Z",
      requirements: [requirement({
        kind: KIND.DIMENSIONAL,
        tolerance: tolerance({ nominal: "10", plusMinus: "0.1", unit: "mm" }),
        source: "the enquiry",
      })],
      model,
    }));

    const file = JSON.parse(pkg.files["part-model.json"]);
    assert.equal(file.modelFormat, FORMAT);

    const back = readModel(file.model);
    assert.equal(back.error, undefined, back.error);
    assert.equal(writeModel(back.model), writeModel(model),
      "the package ships a model that does not read back as itself");
  });
});
