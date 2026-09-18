/**
 * Supplier, transport, production, customer — as this case actually knows
 * them.
 *
 * `specs/06-SCENARIOS-AND-SPECIALISTS.md`: *"The supply scene shows supplier
 * -> transport -> production -> customer, populated from the case rather than
 * decorative pseudo-data. Hotspots explain a bottleneck, show source evidence
 * and link to the editable confirmed assumption. Provide an accessible list of
 * the same information."*
 *
 * The load-bearing phrase is *rather than decorative pseudo-data*. A supply
 * chain diagram is the easiest thing in this entire product to fake: four
 * boxes, three arrows, a lorry, an amber dot on the one that looks
 * interesting. It would look like insight and know nothing, and the person
 * reading it has no way to tell those apart — which is the whole failure mode.
 *
 * So three rules:
 *
 *   - **A stage says only what the case holds.** A price increase claim knows
 *     a great deal about a supplier and, usually, nothing whatever about
 *     transport. A stage with nothing in it says so and names what would fill
 *     it. An empty box is a true statement; a populated-looking box is not.
 *   - **No figures.** Not one. The case view withholds every money and
 *     percentage figure until the assumptions under it are confirmed, and a
 *     scene emitting its own would be a second door into the figures that
 *     withholding just closed. This says what is *known* and what is
 *     *missing*, and the sections above say how much.
 *   - **A bottleneck is named only when the case names one.** Where two
 *     stages carry unanswered questions, choosing between them is a judgement
 *     from data that is not here. It reports that instead of picking.
 *
 * An adopted what-if is a fact about the case and is read as one. An
 * *unadopted* one is not, and never reaches here: a scenario badged "NOT THE
 * PLAN" turning up in the plan's own diagram is precisely the disguise
 * `scenarios.mjs` refuses to wear.
 */

export const STAGE = Object.freeze({
  SUPPLIER: "supplier",
  TRANSPORT: "transport",
  PRODUCTION: "production",
  CUSTOMER: "customer",
});

export const STAGE_TITLE = Object.freeze({
  [STAGE.SUPPLIER]: "Supplier",
  [STAGE.TRANSPORT]: "Transport",
  [STAGE.PRODUCTION]: "Production",
  [STAGE.CUSTOMER]: "Customer",
});

/**
 * The same four, as they appear inside a sentence.
 *
 * "This case says nothing about customer" is the kind of line that makes a
 * product read as though it were assembled rather than written.
 */
const AS_NOUN = Object.freeze({
  [STAGE.SUPPLIER]: "the supplier",
  [STAGE.TRANSPORT]: "transport",
  [STAGE.PRODUCTION]: "production",
  [STAGE.CUSTOMER]: "the customer",
});

/** Upstream to downstream, which is the order the arrows point. */
export const ORDER = Object.freeze([
  STAGE.SUPPLIER, STAGE.TRANSPORT, STAGE.PRODUCTION, STAGE.CUSTOMER,
]);

/**
 * What would populate a stage this case says nothing about.
 *
 * Written as the thing to go and find, not as a field to fill in. "Freight
 * terms" is a form label; "who pays for the delivery, and what a second one
 * would cost" is something a person can go and ask.
 */
export const WOULD_FILL = Object.freeze({
  [STAGE.SUPPLIER]: "what the supplier is claiming, and what each part of it rests on",
  [STAGE.TRANSPORT]: "who pays for the delivery, what a second one would cost, and how long it takes",
  [STAGE.PRODUCTION]: "how many are needed over what period, and what happens if they arrive late",
  [STAGE.CUSTOMER]: "the date the parts are needed by, and what has been committed to whom",
});

/** Whether a stage has anything in it. Two words, because they mean different things. */
export const STATE = Object.freeze({
  POPULATED: "populated",
  NOTHING_KNOWN: "nothing known",
});

/**
 * How much a question weighs.
 *
 * `MATERIAL` is the vocabulary `narrative.mjs` already uses, and it means the
 * same thing here: the case's own figures say something is unsupported. Only
 * those can make a stage the one to look at. Everything else is `OPEN` — a
 * real question, worth asking, and not evidence that this stage is the
 * constraint. Without the distinction every stage carries a question the
 * moment a case exists, and "which stage" stops meaning anything.
 */
export const WEIGHT = Object.freeze({
  MATERIAL: "material",
  OPEN: "open",
});

/**
 * The scene.
 *
 * `bridge` is a cost-bridge result; `adopted` is the what-if scenarios
 * somebody has taken, each already carrying its own `adopted` record. Both are
 * optional, because a case can exist before either.
 */
export function scene({ bridge = null, supplier = null, adopted = [], assumptions = [] } = {}) {
  const taken = (adopted || []).filter((s) => s && s.adopted && s.ready);

  const stages = ORDER.map((stage) =>
    build(stage, { bridge, supplier, taken, assumptions: assumptions || [] }));
  return Object.freeze({
    stages: Object.freeze(stages),
    attention: attentionIn(stages),
  });
}

function build(stage, ctx) {
  const known = [];
  const questions = [];

  if (stage === STAGE.SUPPLIER) supplierStage(ctx, known, questions);
  if (stage === STAGE.TRANSPORT) transportStage(ctx, known, questions);
  if (stage === STAGE.PRODUCTION) productionStage(ctx, known, questions);
  if (stage === STAGE.CUSTOMER) customerStage(ctx, known, questions);

  /* Nothing known is its own state and gets the sentence that says what would
     change it. It is deliberately not phrased as a question: "we know nothing
     about transport" is not a question anybody can go and answer, and a list
     of those trains people to skip the list. */
  if (known.length === 0) {
    questions.length = 0;
    questions.push(Object.freeze({
      said: `This case says nothing about ${AS_NOUN[stage]}. `
          + `What would fill it: ${WOULD_FILL[stage]}.`,
      assumption: null,
      weight: WEIGHT.OPEN,
    }));
  }

  return Object.freeze({
    stage,
    title: STAGE_TITLE[stage],
    state: known.length ? STATE.POPULATED : STATE.NOTHING_KNOWN,
    known: Object.freeze(known.map(Object.freeze)),
    questions: Object.freeze(questions.map(Object.freeze)),
  });
}

/* ------------------------------------------------------------- the stages */

/**
 * What the supplier is claiming, and what each part of it rests on.
 *
 * The only stage a price-increase case is usually able to populate, and it is
 * populated from the drivers themselves — each one named with the source it
 * cited, or named as citing none, which is the thing worth seeing.
 */
function supplierStage({ bridge, supplier, assumptions }, known, questions) {
  if (!bridge) return;

  if (supplier) {
    known.push({ said: `${supplier} is the supplier this claim is from.`, from: "the form" });
  }

  for (const c of bridge.contributions || []) {
    if (c.source) {
      known.push({ said: `${c.label} is claimed against ${c.source}.`, from: "the drivers entered" });
    } else {
      known.push({ said: `${c.label} is claimed with no source named.`, from: "the drivers entered" });
      questions.push({
        said: `Nothing says where ${c.label}'s movement comes from.`,
        /* `specs/06` asks a hotspot to link to the editable confirmed
           assumption. That is the one the case view already offers a tick
           against — found in the list handed in, rather than by this module
           knowing how those ids are spelled. A question with no tickable
           assumption behind it says null rather than pointing at something
           that cannot be confirmed. */
        assumption: idOf(assumptions, `movement-${c.id}`),
        weight: WEIGHT.MATERIAL,
      });
    }
  }

  for (const a of bridge.assumptions || []) {
    if (a.id === "unexplained-weight") {
      questions.push({
        said: "Part of the unit cost is covered by no driver given, so part of what is "
            + "being asked for rests on nothing stated.",
        /* Deliberately not linked. This one is not settled by somebody
           confirming it — it is settled by a driver that does not exist yet,
           and a tick beside it would say the opposite. */
        assumption: null,
        weight: WEIGHT.MATERIAL,
      });
    }
  }
}

/** An assumption id, only if it is one the case actually offers. */
const idOf = (assumptions, id) =>
  (assumptions || []).some((a) => a && a.id === id) ? id : null;

/**
 * Transport.
 *
 * A supplier claim carries nothing about it. An adopted option can: pricing a
 * second delivery's freight, or a premium to move it faster, is a transport
 * fact somebody has stood behind.
 */
function transportStage({ taken }, known, questions) {
  for (const s of taken) {
    if (s.kind === "split-delivery") {
      known.push({
        said: "A second delivery's freight was priced in an option this case adopted.",
        from: adoptedFrom(s),
      });
    }
    if (s.kind === "expedite") {
      known.push({
        said: "A premium to move the delivery earlier was priced, against a date somebody "
            + "confirmed, in an option this case adopted.",
        from: adoptedFrom(s),
      });
      questions.push({
        said: "Whether that expedited date is contractual or best-efforts.",
        assumption: null,
        weight: WEIGHT.OPEN,
      });
    }
    if (s.kind === "alternative-stock") {
      known.push({
        said: "An alternative source's lead time was recorded in an option this case adopted.",
        from: adoptedFrom(s),
      });
    }
  }
}

/** What the parts are for. The quantity is on the form; almost nothing else is. */
function productionStage({ bridge }, known, questions) {
  if (!bridge) return;
  if (typeof bridge.annualVolume === "number") {
    known.push({
      said: "The annual quantity this claim is priced over is stated.",
      from: "the form",
    });
    questions.push({
      said: "Whether that quantity is a forecast or a commitment, and what happens to the "
          + "price if it is missed.",
      assumption: null,
      weight: WEIGHT.OPEN,
    });
  }
}

/** Who is waiting for them, and when. Populated only by an adopted option. */
function customerStage({ taken }, known, questions) {
  for (const s of taken) {
    if (s.kind === "split-delivery") {
      known.push({
        said: "An adopted option covers part of the requirement on the first delivery and "
            + "the rest on a later one.",
        from: adoptedFrom(s),
      });
      questions.push({
        said: "Who is waiting for the part that arrives later, and whether they have been told.",
        assumption: null,
        weight: WEIGHT.OPEN,
      });
    }
    if (s.kind === "expedite") {
      known.push({
        said: "An adopted option brings the whole quantity in on an earlier date.",
        from: adoptedFrom(s),
      });
    }
  }
}

/** Where an adopted fact came from, in words that survive being read alone. */
const adoptedFrom = (s) =>
  `the option "${s.title}", adopted by ${s.adopted.by} on ${s.adopted.at}`;

/* -------------------------------------------------------- the bottleneck */

/**
 * Which stage to look at, when the case names one.
 *
 * Only questions the case's own figures raise count — a stage whose single
 * question is "nothing is known here" is unknown rather than constrained, and
 * calling the emptiest box the bottleneck would be the diagram inventing its
 * own conclusion.
 */
function attentionIn(stages) {
  const material = (q) => q.weight === WEIGHT.MATERIAL;
  const carrying = stages.filter((s) => s.questions.some(material));

  if (carrying.length === 1) {
    return Object.freeze({
      stage: carrying[0].stage,
      why: carrying[0].questions.find(material).said,
    });
  }
  if (carrying.length > 1) {
    return Object.freeze({
      stage: null,
      why: `${carrying.length} stages carry an unanswered question — `
         + `${carrying.map((s) => s.title.toLowerCase()).join(", ")}. Which of them is the `
         + "constraint is a judgement about things this case does not hold, so it is not "
         + "made here.",
    });
  }
  return Object.freeze({
    stage: null,
    why: "Nothing in this case names a stage as the constraint.",
  });
}
