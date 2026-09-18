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
  import { identify as identifyFile, nextStep as fileNextStep,
           withinLimits as fileWithinLimits, HANDLING as FILE_HANDLING,
           LIMITS as FILE_LIMITS, HEAD_BYTES } from "./src/intake/file-router.mjs";
  import * as viewer from "./src/intake/viewer.mjs";
  import { narrative, sectionOf, SECTION_TITLE } from "./src/case/narrative.mjs";
  import { quoteCase, needsOf } from "./src/case/from-quote.mjs";
  import { changes as caseChanges, money as briefingMoney,
           saidPlainly as briefingSaid, anythingToSay,
           MONEY_KIND, MONEY_SAID } from "./src/case/briefing.mjs";
  import { ROUTES as INTAKE_ROUTES, routeFor, saidAboutUnready,
           resumable, resumableSaid } from "./src/case/intake.mjs";
  import { consult, missingAcross, SPECIALIST_TITLE, NOT_CONSULTED,
           CONFIDENCE_SAID } from "./src/case/specialists.mjs";
  import { brief, readiness as briefReadiness,
           DRAFT_LABEL as BRIEF_DRAFT_LABEL } from "./src/case/brief.mjs";
  import { project, hiddenSaid, defaultDepthFor, ROLE, ROLES, ROLE_TITLE,
           DEPTH, DEPTHS, SCOPE_SAID } from "./src/case/projection.mjs";
  import { stamp as staleStamp, check as staleCheck,
           DEPENDS as STALE_DEPENDS } from "./src/studio/staleness.mjs";
  import { readTolerance, asTolerance, saidPlainly as toleranceSaid,
           kindOf as toleranceKind, verificationOf as toleranceVerification,
           FORM as TOLERANCE_FORM, APPLIES as TOLERANCE_APPLIES
         } from "./src/intake/read-tolerance.mjs";
  import { readingsFrom, droppedSaid, downscaleTo, SAID as VISION_SAID,
           CONSENT_SAID, CONSENT_CHOICES, PROMPT_VERSION as VISION_PROMPT_VERSION
         } from "./src/intake/vision-read.mjs";
  import { submission as jobSubmission, submit as submitExtraction,
           applicable as resultApplicable, asComparison as resultAsComparison,
           canRetry as jobCanRetry, retryOf as jobRetryOf,
           configured as workerConfigured, JOB, FAILURE as JOB_FAILURE,
           REFUSED as RESULT_REFUSED, UNAVAILABLE_SAID as WORKER_UNAVAILABLE_SAID
         } from "./src/intake/extraction-job.mjs";
  import { assessDocument, saidPlainly as pagesSaidPlainly,
           PAGE as PAGE_TEXT } from "./src/intake/page-text.mjs";
  import { queue as reviewQueue, documentRef, needsReReview,
           confirm as reviewConfirm, correct as reviewCorrect,
           markUnknown as reviewUnknown, reject as reviewReject,
           confirmedValues, outstanding as reviewOutstanding,
           sourceConflicts, stateOf as reviewStateOf, methodSaid,
           METHOD as REVIEW_METHOD, DISPOSITION as REVIEW_DISPOSITION,
           history as reviewHistory, reviveItems } from "./src/intake/review.mjs";
  /* The call: what to take in, what was written down, and what it commits
     anybody to. Renamed on the way in because "prepare", "note" and
     "readiness" are words several modules here already use. */
  import { prepare as prepareCall, withGoal as withCallGoal,
           withQuestion as withCallQuestion, readiness as callReadiness,
           note as callNote, commitments, dateIn as dateInNote,
           confirmCommitment, correctCommitment, commitmentUnknown, rejectCommitment,
           agreed as agreedCommitments, outstanding as outstandingCommitments,
           followUp, followUpReadiness,
           GOAL as CALL_GOAL, GOAL_SAID as CALL_GOAL_SAID, GOALS as CALL_GOALS,
           OWNER as CALL_OWNER, PHASE as CALL_PHASE, NOTE_SOURCE }
    from "./src/case/call.mjs";
  /* The part model as a file, read back exactly — the Phase 5 gate's first
     half — and the deliberate transfer from the part to the costing form. */
  import { writeModel, readModel, roundtrips as modelRoundtrips,
           FORMAT as MODEL_FORMAT } from "./src/studio/model-io.mjs";
  import { blockFrom as blockFromDrawing, NEEDED as DRAWING_NEEDS }
    from "./src/studio/from-drawing.mjs";
  import { propose as proposeBlank, accept as acceptBlank,
           stillAbout as blankStillAbout, ALLOWANCES as BLANK_ALLOWANCES }
    from "./src/studio/to-cost.mjs";
  /* Practice, which cannot touch anything real. Prefixed on the way in
     because start, say and feedback are words with other owners here. */
  import { start as practiceStart, say as practiceSay, finish as practiceDone,
           feedback as practiceFeedback, importCase as importForPractice,
           LABEL as PRACTICE_LABEL, GOAL as PRACTICE_GOAL,
           DIFFICULTY as PRACTICE_DIFFICULTY, DIFFICULTY_SAID as PRACTICE_DIFFICULTY_SAID,
           MOVE as PRACTICE_MOVE, MOVE_SAID as PRACTICE_MOVE_SAID }
    from "./src/case/practice.mjs";
  /* Dictation, which is off: nothing is handed a recogniser here, and the
     adapter says why rather than greying a button out. */
  import { dictation, browserRecogniser, recogniserExists,
           STATE as SPEECH_STATE, SAID as SPEECH_SAID,
           WHY_UNAVAILABLE as SPEECH_WHY } from "./src/services/speech.mjs";
  /* The one place a call note can be written, and only when somebody asks. */
  import { saveCall, loadCalls, loadCall, deleteCall, newCallId,
           storeStatus as callStoreStatus } from "./src/services/call-store.mjs";
  /* Supplier -> transport -> production -> customer, as this case knows them.
     Its generic names are prefixed on the way in: STAGE, STATE and WEIGHT are
     words several modules could reasonably want. */
  import { scene, STAGE as SCENE_STAGE, STAGE_TITLE as SCENE_STAGE_TITLE,
           ORDER as SCENE_ORDER, STATE as SCENE_STATE, WEIGHT as SCENE_WEIGHT,
           WOULD_FILL as SCENE_WOULD_FILL } from "./src/case/supply-scene.mjs";
  /* The three what-ifs. `questionsFor` is renamed on the way in because
     sourcing.mjs already exports one, and two different questions under one
     name on window.BW is a bug waiting for whichever import lands second. */
  import { whatIf, adopt as adoptScenario, stillAbout as scenarioStillAbout,
           questionsFor as scenarioQuestionsFor, SCENARIO, SCENARIO_TITLE,
           NEEDS as SCENARIO_NEEDS } from "./src/calc/scenarios.mjs";
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
  import { findConflicts,
           extractDocument, confirmCandidate, readiness, reviewTable,
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
  import { KIND as REQ_KIND, SCOPE as REQ_SCOPE, VERIFICATION as REQ_VERIFICATION,
           ATTACHMENT as REQ_ATTACHMENT, tolerance as reqTolerance,
           requirement as reqRequirement, newRequirementId, attachments as reqAttachments,
           conflicts as reqConflicts, schedule as reqSchedule, labelOfKind as reqLabelOfKind,
           serialiseRequirements, deserialiseRequirements } from "./src/studio/requirements.mjs";
  import { DRAFT_LABEL, snapshot as reviewSnapshot, buildPackage as buildReviewPackage,
           verifyPackage as verifyReviewPackage, FORMATS as REVIEW_FORMATS }
    from "./src/studio/review-export.mjs";
  import { block, addHole, addPocket, editFeature, removeFeature, resize,
           featureIds, volume, mass as geometryMass, history as geometryHistory,
           FRAME as GEOMETRY_FRAME, FEATURE as GEOMETRY_FEATURE }
    from "./src/studio/geometry.mjs";
  import { validate as validateProposal, preview as previewProposal,
           accept as acceptProposal, describe as describeStep, withheld,
           OPERATION as EDIT_OPERATION, OUTCOME as EDIT_OUTCOME }
    from "./src/studio/edit-proposal.mjs";
  import { readInstruction, PHRASINGS } from "./src/studio/read-instruction.mjs";
  /* The provider-backed reader. Exposed, and deliberately given no transport:
     configuring one needs a credential, a retention decision and an authority
     that is not this file. With none, proposeEdit reports that and the rule
     reader answers instead. */
  import { proposeEdit, PROMPT_VERSION as EDIT_PROMPT_VERSION }
    from "./src/services/ai/propose-edit.mjs";
  import { updateStudio, initStudio } from "./src/render/studio-view.mjs";
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
  window.BW = { identifyFile, fileNextStep, fileWithinLimits,
                narrative, sectionOf, SECTION_TITLE, quoteCase, needsOf,
                brief, briefReadiness, BRIEF_DRAFT_LABEL,
                consult, missingAcross, SPECIALIST_TITLE, NOT_CONSULTED,
                INTAKE_ROUTES, routeFor, saidAboutUnready, resumable, resumableSaid,
                caseChanges, briefingMoney, briefingSaid, anythingToSay,
                MONEY_KIND, MONEY_SAID,
                CONFIDENCE_SAID,
                project, hiddenSaid, defaultDepthFor, ROLE, ROLES, ROLE_TITLE,
                DEPTH, DEPTHS, SCOPE_SAID,
                staleStamp, staleCheck, STALE_DEPENDS,
                readTolerance, asTolerance, toleranceSaid, toleranceKind,
                toleranceVerification, TOLERANCE_FORM, TOLERANCE_APPLIES,
                readingsFrom, droppedSaid, downscaleTo, VISION_SAID, findConflicts,
                CONSENT_SAID, CONSENT_CHOICES, VISION_PROMPT_VERSION,
                jobSubmission, submitExtraction, resultApplicable, resultAsComparison,
                jobCanRetry, jobRetryOf, workerConfigured, JOB, JOB_FAILURE,
                RESULT_REFUSED, WORKER_UNAVAILABLE_SAID,
                assessDocument, pagesSaidPlainly, PAGE_TEXT,
                reviewQueue, documentRef, needsReReview,
                reviewConfirm, reviewCorrect, reviewUnknown, reviewReject,
                confirmedValues, reviewOutstanding, sourceConflicts,
                reviewStateOf, methodSaid, REVIEW_METHOD, REVIEW_DISPOSITION,
                reviewHistory, reviveItems,
                FILE_HANDLING, FILE_LIMITS, HEAD_BYTES, viewer,
                costBridge, partialAcceptance, delayEffect, formatPercent,
                pc: ratioFromPercent, moneyFromDecimal, moneyToDecimalString,
                createSeries, movementBetween, assessEvidence, formatWeight, fxRate,
                labelFor, assumptionsToVerify, LEGEND,
                prepareNegotiation, CREDIBILITY,
                supplierHistory,
                portfolio,
                mapExposure, costShock, shareFrom, parseAmount,
                learningCorpus, whatWorks, captureGaps, linkOutcome,
                classify, nextActions,
                prepareCall, withCallGoal, withCallQuestion, callReadiness,
                callNote, commitments, dateInNote,
                confirmCommitment, correctCommitment, commitmentUnknown, rejectCommitment,
                agreedCommitments, outstandingCommitments, followUp, followUpReadiness,
                CALL_GOAL, CALL_GOAL_SAID, CALL_GOALS, CALL_OWNER, CALL_PHASE, NOTE_SOURCE,
                writeModel, readModel, modelRoundtrips, MODEL_FORMAT,
                proposeBlank, acceptBlank, blankStillAbout, BLANK_ALLOWANCES,
                blockFromDrawing, DRAWING_NEEDS,
                practiceStart, practiceSay, practiceDone, practiceFeedback,
                importForPractice, PRACTICE_LABEL, PRACTICE_GOAL,
                PRACTICE_DIFFICULTY, PRACTICE_DIFFICULTY_SAID,
                PRACTICE_MOVE, PRACTICE_MOVE_SAID,
                dictation, browserRecogniser, recogniserExists,
                SPEECH_STATE, SPEECH_SAID, SPEECH_WHY,
                saveCall, loadCalls, loadCall, deleteCall, newCallId, callStoreStatus,
                scene, SCENE_STAGE, SCENE_STAGE_TITLE, SCENE_ORDER, SCENE_STATE,
                SCENE_WEIGHT, SCENE_WOULD_FILL,
                whatIf, adoptScenario, scenarioStillAbout, scenarioQuestionsFor,
                SCENARIO, SCENARIO_TITLE, SCENARIO_NEEDS,
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
                REQ_KIND, REQ_SCOPE, REQ_VERIFICATION, REQ_ATTACHMENT,
                reqTolerance, reqRequirement, newRequirementId, reqAttachments,
                reqConflicts, reqSchedule, reqLabelOfKind,
                serialiseRequirements, deserialiseRequirements,
                DRAFT_LABEL, reviewSnapshot, buildReviewPackage, verifyReviewPackage,
                REVIEW_FORMATS,
                block, addHole, addPocket, editFeature, removeFeature, resize,
                featureIds, volume, geometryMass, geometryHistory,
                GEOMETRY_FRAME, GEOMETRY_FEATURE,
                validateProposal, previewProposal, acceptProposal, describeStep, withheld,
                EDIT_OPERATION, EDIT_OUTCOME, readInstruction, PHRASINGS,
                proposeEdit, EDIT_PROMPT_VERSION,
                money, scaleDiv,
                newCase, saveCase, loadCase, loadCases, listCases, deleteCase, setStatus,
                storeStatus, CASE_STATUS,
                parseSpendCsv, analyseSpendExact, indicativeSavings,
                buildDecisionPack, renderDecisionPackHTML,
                recordOutcome, summariseOutcomes,
                extractClaim, confirmField, FIELD_RULES, DRIVER_RULES,
                aiAdapter: createAdapter({ transport: httpTransport() }),
                saveOutcome, loadOutcomes, clearOutcomes, exportOutcomes,
                updateStudio, SAMPLE_INDEX: STEEL_A };
  /* Isolated, like the two calls below it. It builds markup it does not own,
     and a throw would leave window.BW assigned — so the engine-missing banner
     stays correctly quiet — while the renders after it never run, leaving a
     page that looks fine with two tables empty and nothing saying why. */
  try { initStudio(); } catch (e) {
    console.error("The Studio preview did not start:", e && e.message);
  }
  if (typeof defRenderDrivers === "function") defRenderDrivers();
  if (typeof defRenderOutcomes === "function") defRenderOutcomes();
