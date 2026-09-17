/**
 * Who has something to say about this case.
 *
 * `specs/06-SCENARIOS-AND-SPECIALISTS.md` names five: commercial, delivery,
 * technical, negotiation and management. And it says the thing that decides
 * the shape of this file — *"Use an orchestrator to select relevant
 * specialists, not five verbose chat windows on every task."*
 *
 * So the orchestration is a selection, and the selection is made on evidence
 * rather than on enthusiasm: a specialist appears when the case actually
 * holds what it needs, and is listed as not consulted, with the reason, when
 * it does not. Five cards on every case is the failure mode — after the third
 * case where the delivery specialist had nothing, nobody reads any of them.
 *
 * The findings come from engines this repository already has. That is the
 * whole reason this is a small file: `negotiation.mjs` builds a ladder and a
 * walk-away, `cost-bridge.mjs` holds the unsupported share, `batna.mjs` knows
 * whether a supplier could be replaced, `requirements.mjs` and
 * `certificate.mjs` know what a drawing left unsaid. `specs/06` is explicit
 * that this is how it must work: *"Deterministic calculations are tools,
 * never arithmetic performed in generated prose."*
 *
 * Three rules from the spec that are easy to state and easy to lose:
 *
 *   - **No invented consensus.** Two specialists agreeing is worth saying;
 *     manufacturing agreement by dropping the one that disagreed is not. A
 *     contradiction is preserved as a contradiction, with both sources.
 *   - **No confidence percentages.** A number for how sure something is
 *     invites arithmetic on it, and there is nothing behind it to divide.
 *   - **A draft recommendation is not an approved action**, and a technical
 *     specialist never signs anything off.
 */

/** The five, and what each is for. */
export const SPECIALIST = Object.freeze({
  COMMERCIAL: "commercial",
  DELIVERY: "delivery",
  TECHNICAL: "technical",
  NEGOTIATION: "negotiation",
  MANAGEMENT: "management",
});

export const SPECIALIST_TITLE = Object.freeze({
  [SPECIALIST.COMMERCIAL]: "Commercial",
  [SPECIALIST.DELIVERY]: "Delivery",
  [SPECIALIST.TECHNICAL]: "Technical",
  [SPECIALIST.NEGOTIATION]: "Negotiation",
  [SPECIALIST.MANAGEMENT]: "Management",
});

/**
 * Why a specialist was not consulted.
 *
 * Said rather than left blank. "Nothing from delivery" reads as delivery
 * having looked and found nothing, which is a different and much stronger
 * claim than not having been asked.
 */
export const NOT_CONSULTED = Object.freeze({
  NO_DATA: "this case does not hold what it would need",
  NO_ENGINE: "there is no engine for it in this build",
});

/**
 * One finding, in the shape `specs/06` asks for.
 *
 * *"Each card has finding, supporting evidence, missing inputs, proposed
 * action, consequence."* All five, because a finding without a consequence is
 * an observation and a proposed action without the missing inputs is a
 * suggestion to act on something nobody has checked.
 */
export function finding({
  from, said, evidence = [], missing = [], action = null, consequence = null,
  contradicts = null,
} = {}) {
  if (!SPECIALIST_TITLE[from]) throw new TypeError(`"${from}" is not one of the five specialists`);
  if (!said || !String(said).trim()) throw new TypeError("A finding has to say something.");
  return Object.freeze({
    from,
    said: String(said).trim(),
    evidence: Object.freeze([...evidence]),
    missing: Object.freeze([...missing]),
    action,
    consequence,
    contradicts,
  });
}

/* --------------------------------------------------------- the specialists */

/**
 * Commercial: what the quote rests on, and what it does not.
 *
 * Reads the bridge. Nothing here recomputes it — the unsupported share and
 * the unattributed weight are the bridge's own findings, named for a person.
 */
function commercial(bridge) {
  if (!bridge || !bridge.contributions) return [];
  const out = [];

  if (bridge.unsupportedChange > 0n) {
    out.push(finding({
      from: SPECIALIST.COMMERCIAL,
      said: "Part of the increase is not supported by any driver the supplier gave.",
      evidence: [{ kind: "calculation", said: bridge.formula }],
      action: "Ask what evidence stands behind the unsupported part before conceding any of it.",
      consequence: "Conceding it sets the base price every future increase is applied to.",
    }));
  }

  if (bridge.unexplainedWeight > 0n) {
    out.push(finding({
      from: SPECIALIST.COMMERCIAL,
      said: "Some of the unit cost has no driver against it, so nothing has been claimed "
          + "for that share and nothing has been ruled out.",
      evidence: [{ kind: "calculation", said: "driver weights do not account for the whole unit cost" }],
      missing: ["what the unattributed share of the unit cost is made of"],
      action: "Ask the supplier to account for the rest of the unit cost.",
      consequence: "A share nobody has named cannot be argued about later either.",
    }));
  }

  if (bridge.constraintApplied) {
    out.push(finding({
      from: SPECIALIST.COMMERCIAL,
      said: `A contractual ${bridge.constraintApplied} applied, so what the drivers warrant and `
          + "what the contract permits are different figures.",
      evidence: [{ kind: "contract", said: `the ${bridge.constraintApplied} in the agreement` }],
      action: "Check which figure the supplier is actually asking against.",
      consequence: "The two being confused is how a cap becomes a floor.",
    }));
  }

  return out;
}

/**
 * Negotiation: what to open with and where to stop.
 *
 * Straight from `negotiation.mjs`, which already builds a ladder, a hard line
 * and a walk-away from the same bridge. No prose is generated around the
 * figures; the rule the engine prints is the rule shown.
 */
function negotiation(plan) {
  if (!plan || !plan.openingPosition) return [];
  const out = [];

  out.push(finding({
    from: SPECIALIST.NEGOTIATION,
    said: "There is an evidenced opening position, and it is not the figure being asked for.",
    evidence: [{ kind: "calculation", said: plan.openingPosition.rule }],
    action: "Open on the evidenced figure rather than negotiating down from theirs.",
    consequence: "Opening at their number makes every concession from it look like a win for you.",
  }));

  const challenges = plan.ladder?.challenges ?? [];
  if (challenges.length > 0) {
    out.push(finding({
      from: SPECIALIST.NEGOTIATION,
      said: `${challenges.length} driver${challenges.length === 1 ? "" : "s"} can be challenged `
          + "on evidence rather than on position.",
      evidence: challenges.map((c) => ({ kind: "driver", said: c.label ?? c.id })),
      action: "Put the challenges before any concession.",
      consequence: "A concession offered first is a concession that buys nothing.",
    }));
  }

  if (plan.walkAway) {
    out.push(finding({
      from: SPECIALIST.NEGOTIATION,
      said: "A walk-away point has been worked out from what this case holds.",
      evidence: [{ kind: "calculation", said: "derived from the bridge and the stated position" }],
      missing: plan.walkAway.missing ?? [],
      action: "Agree the walk-away with whoever owns the contract before the conversation.",
      consequence: "A walk-away decided during a negotiation is a number chosen under pressure.",
    }));
  }

  return out;
}

/**
 * Technical: what the drawing has not said.
 *
 * Never a sign-off. `specs/06`: *"never autonomous sign-off"* — so this
 * reports what is unanswered and stops. A technical specialist that said a
 * part was fine would be the single most dangerous sentence this product
 * could produce.
 */
function technical({ requirements = [], unconfirmedReadings = [] } = {}) {
  const out = [];

  const unverified = requirements.filter((r) => r && r.verification === "unverified");
  if (unverified.length > 0) {
    out.push(finding({
      from: SPECIALIST.TECHNICAL,
      said: `${unverified.length} requirement${unverified.length === 1 ? "" : "s"} cite a `
          + "specification whose contents are not here, so what they require is not known.",
      evidence: unverified.map((r) => ({ kind: "requirement", said: r.summary ?? r.id })),
      missing: ["the cited specification's own figures"],
      action: "Get the specification, or the figures from it, before quoting against it.",
      consequence: "A price against an unread specification is a price against an assumption.",
    }));
  }

  if (unconfirmedReadings.length > 0) {
    out.push(finding({
      from: SPECIALIST.TECHNICAL,
      said: `${unconfirmedReadings.length} value${unconfirmedReadings.length === 1 ? "" : "s"} `
          + "read from the drawing have not been confirmed by anybody.",
      evidence: unconfirmedReadings.map((r) => ({ kind: "reading", said: r.label ?? r.field })),
      missing: unconfirmedReadings.map((r) => r.label ?? r.field),
      action: "Check each against the drawing before anything rests on it.",
      consequence: "A misread dimension is a quote for a different part.",
    }));
  }

  return out;
}

/**
 * Delivery: whether this supplier could be replaced, and at what cost.
 *
 * The narrowest of the five here, and deliberately so. `batna.mjs` answers a
 * real question about supply risk; timing alternatives and operational
 * unknowns, which `specs/06` also asks delivery for, have no engine in this
 * build and are not invented.
 */
function delivery(batna) {
  if (!batna) return [];
  const out = [];

  if (batna.readiness && batna.readiness !== "ready") {
    out.push(finding({
      from: SPECIALIST.DELIVERY,
      said: "No alternative supplier is ready, so the position rests on this one continuing "
          + "to supply.",
      evidence: [{ kind: "assessment", said: "assessed from what is recorded about alternatives" }],
      missing: batna.missing ?? [],
      action: "Decide whether qualifying an alternative is worth starting now.",
      consequence: "A BATNA that takes six months to build is not a BATNA in this conversation.",
    }));
  }

  return out;
}

/* ------------------------------------------------------ the orchestration */

/**
 * Which specialists have something to say, and what they say.
 *
 * Each source is optional. A case that is only a quote gets commercial and
 * negotiation; nothing pretends the other three looked.
 */
export function consult({
  bridge = null, plan = null, requirements = null, unconfirmedReadings = null, batna = null,
} = {}) {
  const cards = [];
  const notConsulted = [];

  const ask = (who, findings, available, why) => {
    if (!available) {
      notConsulted.push(Object.freeze({ from: who, why }));
      return;
    }
    if (findings.length === 0) {
      /* Consulted and had nothing. Different from not consulted, and said
         differently. */
      notConsulted.push(Object.freeze({ from: who, why: "nothing to raise on this case" }));
      return;
    }
    cards.push(...findings);
  };

  ask(SPECIALIST.COMMERCIAL, commercial(bridge), Boolean(bridge), NOT_CONSULTED.NO_DATA);
  ask(SPECIALIST.NEGOTIATION, negotiation(plan), Boolean(plan), NOT_CONSULTED.NO_DATA);
  ask(SPECIALIST.TECHNICAL,
    technical({ requirements: requirements ?? [], unconfirmedReadings: unconfirmedReadings ?? [] }),
    Boolean(requirements || unconfirmedReadings), NOT_CONSULTED.NO_DATA);
  ask(SPECIALIST.DELIVERY, delivery(batna), Boolean(batna), NOT_CONSULTED.NO_DATA);

  return Object.freeze({
    findings: Object.freeze(aggregate(cards)),
    notConsulted: Object.freeze(notConsulted),
    /* Management is the brief, which is its own module and its own artefact.
       Listing it here as a card would put the summary of the cards among the
       cards. */
    management: "see the brief",
  });
}

/**
 * Duplicate findings gathered; contradictions kept apart.
 *
 * `specs/06`: *"Aggregate duplicate findings and preserve contradictions as
 * unresolved, citing both sources."* Two specialists reaching the same
 * conclusion is worth one line saying both did. Two reaching opposite ones is
 * worth two lines and a note, because the disagreement is the finding — and
 * resolving it here by keeping the more confident one is exactly the invented
 * consensus the spec forbids.
 */
export function aggregate(findings) {
  const bySaid = new Map();
  for (const f of findings) {
    const key = f.said.toLowerCase();
    if (!bySaid.has(key)) { bySaid.set(key, { ...f, alsoFrom: [] }); continue; }
    const first = bySaid.get(key);
    if (!first.alsoFrom.includes(f.from) && f.from !== first.from) first.alsoFrom.push(f.from);
  }
  return [...bySaid.values()].map((f) => Object.freeze({
    ...f, alsoFrom: Object.freeze(f.alsoFrom),
  }));
}

/**
 * What a card says about how sure it is.
 *
 * Nothing. `specs/06` forbids confidence percentages, and the reason is worth
 * keeping in front of whoever adds the next specialist: a number for how sure
 * something is invites arithmetic on it, and there is nothing behind it to
 * divide. What a card carries instead is its evidence and what it is missing,
 * which are the two things somebody can actually act on.
 */
export const CONFIDENCE_SAID =
  "These are findings from the figures on this case, not opinions with a confidence attached. "
  + "Each says what it rests on and what it is missing; neither is a probability.";

/** Everything the cards are waiting on, gathered once. */
export const missingAcross = (consulted) =>
  Object.freeze([...new Set(consulted.findings.flatMap((f) => f.missing))]);
