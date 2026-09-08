/**
 * Strict validation for every stage's model output.
 *
 * The model is a reasoning proposer, never the owner of DLSMirror's state.
 * Nothing returned by a provider reaches the frontend (and therefore the
 * Business Reality state) unless it passes these checks: required fields
 * present, correct types, and enum values within the allowed set.
 */

const LAYERS = ['owner','offer','customer','revenue','market','operations','finance','organization','commercial','external'];
const EVIDENCE_STATUSES = ['OWNER-PROVIDED','OBSERVED','INFERRED','HYPOTHESIS'];
const SEVERITIES = ['low','medium','high'];
const IMPORTANCES = ['low','medium','high'];
const SIGNAL_TYPES = ['commercial','operational','customer','organizational'];
const RELATIONSHIP_TYPES = ['CAUSES','CORRELATES_WITH','CONTRIBUTES_TO'];

const isStr = (v) => typeof v === 'string';
const isArr = (v) => Array.isArray(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const inSet = (v, set) => set.includes(v);

function validateDiscover(data) {
  if (!isObj(data)) return 'response is not an object';
  if (!isArr(data.contradictions)) return 'contradictions must be an array';
  if (!isArr(data.evidence)) return 'evidence must be an array';
  if (!isArr(data.signals)) return 'signals must be an array';
  if (!isArr(data.knowledge_gaps)) return 'knowledge_gaps must be an array';
  if (!('next_question' in data)) return 'next_question is required (may be null)';
  for (const e of data.evidence) {
    if (!isObj(e) || !isStr(e.normalizedMeaning) || !inSet(e.layer, LAYERS) || !inSet(e.evidenceStatus, EVIDENCE_STATUSES)) {
      return 'invalid evidence item';
    }
  }
  for (const s of data.signals) {
    if (!isObj(s) || !isStr(s.signal) || !inSet(s.severity, SEVERITIES)) return 'invalid signal item';
    if (s.type && !inSet(s.type, SIGNAL_TYPES)) return 'invalid signal type';
  }
  for (const g of data.knowledge_gaps) {
    if (!isObj(g) || !isStr(g.question)) return 'invalid knowledge gap';
    if (g.importance && !inSet(g.importance, IMPORTANCES)) return 'invalid gap importance';
  }
  if (data.next_question !== null) {
    if (!isObj(data.next_question) || !isStr(data.next_question.text)) return 'invalid next_question';
  }
  return null;
}

function validateUnderstand(data) {
  if (!isObj(data)) return 'response is not an object';
  if (!isArr(data.relationships)) return 'relationships must be an array';
  if (!isObj(data.pattern)) return 'pattern must be an object';
  if (!isStr(data.pattern.statement)) return 'pattern.statement must be a string';
  for (const r of data.relationships) {
    if (!isObj(r) || !isStr(r.signalAId) || !isStr(r.signalBId) || !isStr(r.relationship)) return 'invalid relationship';
    if (r.type && !inSet(r.type, RELATIONSHIP_TYPES)) return 'invalid relationship type';
    if (r.supportingEvidenceIds && !isArr(r.supportingEvidenceIds)) return 'supportingEvidenceIds must be an array';
  }
  return null;
}

function validateDiagnose(data) {
  if (!isObj(data)) return 'response is not an object';
  if (!isObj(data.firstPrinciple)) return 'firstPrinciple must be an object';
  if (!isObj(data.invisibleBottleneck)) return 'invisibleBottleneck must be an object';
  if (!isObj(data.thesis) || !isStr(data.thesis.thesis)) return 'thesis must be an object with a thesis string';
  const fpKeys = ['situation','assumptions','evidence','causalChain','underlyingReality','commercialImplication'];
  for (const k of fpKeys) if (!isStr(data.firstPrinciple[k])) return `firstPrinciple.${k} must be a string`;
  const ibKeys = ['deconstruction','behavioralTruth','invisibleConflict','rootCause','leverageVariable','operatingRedesign','pilot','strategicEndState'];
  for (const k of ibKeys) if (!isStr(data.invisibleBottleneck[k])) return `invisibleBottleneck.${k} must be a string`;
  return null;
}

function validateTransition(data) {
  if (!isObj(data)) return 'response is not an object';
  for (const k of ['current','constraint','required','future']) if (!isStr(data[k])) return `${k} must be a string`;
  if (!isObj(data.operatingSystem)) return 'operatingSystem must be an object';
  for (const k of ['mechanism','owner','cadence','metric','escalation']) if (!isStr(data.operatingSystem[k])) return `operatingSystem.${k} must be a string`;
  return null;
}

function validateBehavior(data) {
  if (!isObj(data)) return 'response is not an object';
  const keys = ['current','friction','inertia','relapseRisk','wedge','required','capability','adoption','accountability','measure'];
  for (const k of keys) if (!isStr(data[k])) return `${k} must be a string`;
  return null;
}

function validateStakeholder(data) {
  if (!isObj(data)) return 'response is not an object';
  if (!isObj(data.stakeholders) || !isObj(data.stakeholders.owner)) return 'stakeholders.owner is required';
  for (const key of Object.keys(data.stakeholders)) {
    const s = data.stakeholders[key];
    if (!isObj(s) || !isStr(s.means) || !isStr(s.understand)) return `invalid stakeholder entry: ${key}`;
  }
  if (!isObj(data.decision) || !isStr(data.decision.decision) || !isStr(data.decision.owner)) return 'decision is required with decision and owner strings';
  if (data.decision.actions && !isArr(data.decision.actions)) return 'decision.actions must be an array';
  return null;
}

function validateLearning(data) {
  if (!isObj(data)) return 'response is not an object';
  for (const k of ['observedOutcome','difference','possibleExplanation','evidenceRequired']) {
    if (!isStr(data[k])) return `${k} must be a string`;
  }
  if (!isObj(data.newSignal) || !isStr(data.newSignal.signal)) return 'newSignal.signal is required';
  if (data.newSignal.severity && !inSet(data.newSignal.severity, SEVERITIES)) return 'invalid newSignal.severity';
  return null;
}

const VALIDATORS = {
  discover: validateDiscover,
  understand: validateUnderstand,
  diagnose: validateDiagnose,
  transition: validateTransition,
  behavior: validateBehavior,
  stakeholder: validateStakeholder,
  learning: validateLearning,
};

/** Returns null if valid, or a short human-readable reason string if invalid. */
function validate(stage, data) {
  const fn = VALIDATORS[stage];
  if (!fn) return 'unknown stage';
  return fn(data);
}

module.exports = { validate, LAYERS, EVIDENCE_STATUSES, SEVERITIES, IMPORTANCES, SIGNAL_TYPES, RELATIONSHIP_TYPES };
