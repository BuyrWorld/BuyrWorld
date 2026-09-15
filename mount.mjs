/* The module mount: one source of truth shared with the unit tests.
 * Lifted out of index.html unchanged. Relative imports resolve against
 * this file's URL at the site root, which is where they resolved before.
 */
  // The same module the unit tests run against - one source of truth.
  import { costBridge, partialAcceptance, delayEffect, formatPercent } from "./src/calc/cost-bridge.mjs";
  import { ratioFromPercent, moneyFromDecimal, moneyToDecimalString, money, scaleDiv } from "./src/calc/exact.mjs";
  import { createSeries, movementBetween } from "./src/calc/index-series.mjs";
  import { assessEvidence, formatWeight } from "./src/calc/evidence.mjs";
  import { labelFor, assumptionsToVerify, LEGEND } from "./src/calc/provenance.mjs";
  import { prepareNegotiation, CREDIBILITY } from "./src/calc/negotiation.mjs";
  import { supplierHistory } from "./src/calc/supplier-history.mjs";
  import { portfolio } from "./src/calc/portfolio.mjs";
  import { mapExposure, costShock, shareFrom, parseAmount } from "./src/calc/shock.mjs";
  import { learningCorpus, whatWorks, captureGaps } from "./src/calc/learning.mjs";
  import { classify, nextActions } from "./src/intake/classify.mjs";
  import { alternative, assessBatna, fact, KNOWN, READINESS, STRENGTH, MATERIAL } from "./src/calc/batna.mjs";
  import { comparablePart, compare, findComparable, priceGap, ATTRIBUTES } from "./src/calc/comparable.mjs";
  import { scanOpportunities, SEVERITY } from "./src/calc/radar.mjs";
  import { nextMoves, recordRound, MOVE } from "./src/calc/shadow.mjs";
  import { quote as makeQuote, compareQuotes, questionsFor, SCOPE } from "./src/calc/sourcing.mjs";
  import { length as scLength, density as scDensity, boxVolume, formatLength, formatMass, formatArea,
           LENGTH_UNITS, DENSITY_UNITS } from "./src/calc/units.mjs";
  import { MATERIAL_GAP, buildUpShares, compareToBuildUp, questionsFrom } from "./src/calc/build-up.mjs";
  import { estimateFrom, asCostPlan, saveEstimate, loadEstimates, loadEstimate,
           deleteEstimate, storeStatus as estimateStoreStatus } from "./src/services/estimate-store.mjs";
  import { extractDocument, confirmCandidate, readiness, reviewTable,
           CONFIDENCE as EX_CONFIDENCE, TARGET as EX_TARGET } from "./src/intake/extract-document.mjs";
  import { lotRecord, lotFromReview, millPerformance, rank as millRank, uniqueLots,
           DECISION as MILL_DECISION, RESPONSIBILITY, SCOPE as MILL_SCOPE,
           DEFAULT_MINIMUM_LOTS, FILTERS as MILL_FILTERS } from "./src/calc/mill.mjs";
  import { saveLot, loadLots, deleteLot, clearLots, exportLots,
           storeStatus as lotStoreStatus } from "./src/services/lot-store.mjs";
  import { quantity as ctQuantity, requirement as ctRequirement, observation as ctObservation,
           certificate as ctCertificate, checkCertificate, recordReview, lotKey,
           RESULT as CT_RESULT, OVERALL as CT_OVERALL, KIND as CT_KIND, DISPOSITION as CT_DISPOSITION,
           RULES_VERSION as CT_RULES } from "./src/calc/certificate.mjs";
  import { stage as scStage, routeInput, sheetLayout, barLayout, planMaterial, costPlan,
           assumptions as scAssumptions, BASIS, CONFIDENCE, CONSUMES, COST_ELEMENTS } from "./src/calc/should-cost.mjs";
  import { part as makePart, savePart, loadParts, deletePart, storeStatus as partStoreStatus,
           forComparison } from "./src/services/part-store.mjs";
  import { scenario, withField, readiness as scReadiness, stateOf as scStateOf,
           started as scStarted, SOURCE as SC_SOURCE, ENTRY as SC_ENTRY,
           GOAL as SC_GOAL, compareExtraction, acceptCandidates,
           labelOf as scLabelOf } from "./src/studio/scenario.mjs";
  import { newId as scNewId, saveScenario, loadScenarios, loadScenario,
           deleteScenario, storeStatus as scenarioStoreStatus } from "./src/services/studio-store.mjs";
  import { newCase, saveCase, loadCase, loadCases, listCases, deleteCase, setStatus, linkOutcome,
           storeStatus, STATUS as CASE_STATUS } from "./src/services/case-store.mjs";
  import { parseSpendCsv, analyseSpend as analyseSpendExact, indicativeSavings } from "./src/calc/spend.mjs";
  import { fxRate } from "./src/calc/fx.mjs";
  import { buildDecisionPack } from "./src/calc/decision-pack.mjs";
  import { recordOutcome, summariseOutcomes } from "./src/calc/outcome.mjs";
  import { createAdapter, httpTransport } from "./src/services/ai/adapter.mjs";
  import { extractClaim, confirmField, FIELD_RULES, DRIVER_RULES } from "./src/services/ai/extract-claim.mjs";
  import { saveOutcome, loadOutcomes, clearOutcomes, exportOutcomes } from "./src/services/outcome-store.mjs";
  import { renderDecisionPackHTML } from "./src/render/decision-pack-html.mjs";
  import { STEEL_A } from "./src/data/sample-indices.mjs";
  window.BW = { costBridge, partialAcceptance, delayEffect, formatPercent,
                pc: ratioFromPercent, moneyFromDecimal, moneyToDecimalString,
                createSeries, movementBetween, assessEvidence, formatWeight, fxRate,
                labelFor, assumptionsToVerify, LEGEND,
                prepareNegotiation, CREDIBILITY,
                supplierHistory,
                portfolio,
                mapExposure, costShock, shareFrom, parseAmount,
                learningCorpus, whatWorks, captureGaps, linkOutcome,
                classify, nextActions,
                alternative, assessBatna, fact, KNOWN, READINESS, STRENGTH, MATERIAL,
                comparablePart, compare, findComparable, priceGap, ATTRIBUTES,
                scanOpportunities, SEVERITY,
                nextMoves, recordRound, MOVE,
                makeQuote, compareQuotes, questionsFor, SCOPE,
                scLength, scDensity, boxVolume, formatLength, formatMass, formatArea, LENGTH_UNITS, DENSITY_UNITS,
                ctQuantity, ctRequirement, ctObservation, ctCertificate, checkCertificate, recordReview, lotKey,
                CT_RESULT, CT_OVERALL, CT_KIND, CT_DISPOSITION, CT_RULES,
                MATERIAL_GAP, buildUpShares, compareToBuildUp, questionsFrom,
                estimateFrom, asCostPlan, saveEstimate, loadEstimates, loadEstimate, deleteEstimate, estimateStoreStatus,
                extractDocument, confirmCandidate, readiness, reviewTable, EX_CONFIDENCE, EX_TARGET,
                lotRecord, lotFromReview, millPerformance, millRank, uniqueLots,
                MILL_DECISION, RESPONSIBILITY, MILL_SCOPE, DEFAULT_MINIMUM_LOTS, MILL_FILTERS,
                saveLot, loadLots, deleteLot, clearLots, exportLots, lotStoreStatus,
                scStage, routeInput, sheetLayout, barLayout, planMaterial, costPlan, scAssumptions,
                BASIS, CONFIDENCE, CONSUMES, COST_ELEMENTS,
                makePart, savePart, loadParts, deletePart, partStoreStatus, forComparison,
                scenario, withField, scReadiness, scStateOf, scStarted,
                compareExtraction, acceptCandidates, scLabelOf,
                SC_SOURCE, SC_ENTRY, SC_GOAL,
                scNewId, saveScenario, loadScenarios, loadScenario, deleteScenario,
                scenarioStoreStatus,
                money, scaleDiv,
                newCase, saveCase, loadCase, loadCases, listCases, deleteCase, setStatus,
                storeStatus, CASE_STATUS,
                parseSpendCsv, analyseSpendExact, indicativeSavings,
                buildDecisionPack, renderDecisionPackHTML,
                recordOutcome, summariseOutcomes,
                extractClaim, confirmField, FIELD_RULES, DRIVER_RULES,
                aiAdapter: createAdapter({ transport: httpTransport() }),
                saveOutcome, loadOutcomes, clearOutcomes, exportOutcomes,
                SAMPLE_INDEX: STEEL_A };
  if (typeof defRenderDrivers === "function") defRenderDrivers();
  if (typeof defRenderOutcomes === "function") defRenderOutcomes();
