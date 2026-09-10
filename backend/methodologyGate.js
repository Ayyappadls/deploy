/**
 * DLSMirror methodology governance.
 *
 * This layer is deliberately deterministic. Model output is treated as an
 * untrusted proposal; the gate decides whether the current evidence permits
 * a relationship, diagnosis, transition, behaviour plan, or stakeholder
 * decision to be presented as a conclusion.
 */

const FACT_STATUSES = new Set(['OWNER-PROVIDED','OBSERVED','CALCULATED','VERIFIED']);
const WEAK_STATUSES = new Set(['INFERRED','HYPOTHESIS','UNKNOWN']);

function arr(v) { return Array.isArray(v) ? v : []; }
function str(v) { return typeof v === 'string' ? v : ''; }

function evidenceIdSet(payload) {
  return new Set(arr(payload?.evidence).concat(arr(payload?.evidenceOnFile)).map(e => e?.id).filter(Boolean));
}

function materialEvidence(payload) {
  return arr(payload?.evidence || payload?.evidenceOnFile).filter(e => e && str(e.normalizedMeaning || e.statement));
}

function supportedEvidence(e, ids) {
  if (!e) return false;
  if (e.supportingEvidenceIds && Array.isArray(e.supportingEvidenceIds)) {
    return e.supportingEvidenceIds.length > 0 && e.supportingEvidenceIds.every(id => ids.has(id));
  }
  return false;
}

function evidenceStatus(e) {
  return str(e?.evidenceStatus).toUpperCase();
}

function hasWeakEvidence(payload) {
  return materialEvidence(payload).some(e => WEAK_STATUSES.has(evidenceStatus(e)));
}

function contradictionCount(payload) {
  return arr(payload?.contradictions).length;
}

function diagnosisReadiness(payload) {
  const evidence = materialEvidence(payload);
  const signals = arr(payload?.signals);
  const relationships = arr(payload?.relationships);
  const gaps = arr(payload?.openGaps || payload?.knowledge_gaps);
  const materialUnknowns = gaps.filter(g => ['high'].includes(g?.importance) || ['high'].includes(g?.diagnosticImpact) || ['high'].includes(g?.decisionImpact) || ['high'].includes(g?.relationshipImpact));
  const contradictions = contradictionCount(payload);
  const supportedRelationships = relationships.filter(r => supportedEvidence(r, evidenceIdSet(payload)));
  const factCount = evidence.filter(e => FACT_STATUSES.has(evidenceStatus(e))).length;
  const layers = new Set(evidence.map(e => e.layer).filter(Boolean));
  const coreLayerCoverage = ['owner','customer','offer','revenue'].filter(l => layers.has(l)).length;
  const reasons = [];
  if (factCount < 4) reasons.push('not enough established evidence');
  if (signals.length < 1) reasons.push('no material signal established');
  if (supportedRelationships.length < 1) reasons.push('no evidence-backed relationship established');
  if (materialUnknowns.length > 0) reasons.push('material unknowns remain');
  if (contradictions > 0) reasons.push('material contradictions remain');
  if (coreLayerCoverage < 2) reasons.push('insufficient core business context');
  return { ready: reasons.length === 0, reasons, factCount, supportedRelationships: supportedRelationships.length, materialUnknowns: materialUnknowns.length, contradictions, coreLayerCoverage };
}

function blocked(stage, readiness) {
  const why = `DLSMirror cannot responsibly conclude yet: ${readiness.reasons.join('; ')}.`;
  if (stage === 'diagnose') return {
    firstPrinciple: {
      situation: 'Several business signals are visible, but the governing constraint has not been established.',
      assumptions: 'No unverified assumption is being promoted to fact.',
      evidence: `Established evidence count: ${readiness.factCount}. Evidence-backed relationships: ${readiness.supportedRelationships}.`,
      causalChain: 'Signal → relationship → hypothesis → verification → constraint. The chain is not yet sufficiently verified.',
      underlyingReality: 'The current evidence supports continued investigation rather than a definitive root-cause claim.',
      commercialImplication: 'A premature diagnosis could direct the owner toward the wrong intervention.'
    },
    invisibleBottleneck: {
      deconstruction: 'No single governing bottleneck is being asserted yet.',
      behavioralTruth: 'Not established from the available evidence.',
      invisibleConflict: 'Multiple plausible explanations remain open.',
      rootCause: 'Not established.',
      leverageVariable: 'The next discriminating question is the current leverage point.',
      operatingRedesign: 'Not ready until the governing constraint is verified.',
      pilot: 'Continue evidence gathering before prescribing a pilot.',
      strategicEndState: 'A verified constraint followed by an evidence-linked transition.'
    },
    thesis: { thesis: why, confidence: 'INSUFFICIENT_EVIDENCE' },
    methodologyGate: { status: 'BLOCKED', reasons: readiness.reasons }
  };
  if (stage === 'transition') return {
    current: 'The business is experiencing several visible pressures, but the governing constraint is not yet verified.',
    constraint: 'Not established.',
    required: 'No transition should be prescribed until the diagnosis is evidence-backed.',
    future: 'A transition derived directly from a verified root cause.',
    operatingSystem: { mechanism: 'Not ready.', owner: 'Not assigned.', cadence: 'Not assigned.', metric: 'Not assigned.', escalation: 'Return to diagnosis if evidence remains insufficient.' },
    methodologyGate: { status: 'BLOCKED', reasons: readiness.reasons }
  };
  if (stage === 'behavior') return {
    current: 'No change mechanism is being prescribed yet.', friction: 'Not established.', inertia: 'Not established.', relapseRisk: 'Premature intervention is the current risk.', wedge: 'Continue discovery.', required: 'Verify the transition first.', capability: 'Not assigned.', adoption: 'Not applicable yet.', accountability: 'Not assigned.', measure: 'Not assigned.', methodologyGate: { status: 'BLOCKED', reasons: readiness.reasons }
  };
  if (stage === 'stakeholder') return {
    stakeholders: { owner: { means: 'The owner needs a reliable diagnosis before acting.', understand: 'The evidence is still being established; no unsupported decision is being communicated.' } },
    decision: { decision: 'Continue investigation before making a structural change.', owner: 'DLSMirror / owner jointly', actions: [] },
    methodologyGate: { status: 'BLOCKED', reasons: readiness.reasons }
  };
  return null;
}

function gateStage(stage, data, payload) {
  if (stage === 'discover' || stage === 'learning') return { data, gate: { status: 'OPEN' } };
  const readiness = diagnosisReadiness(payload);
  if (stage === 'understand') {
    const ids = evidenceIdSet(payload);
    const relationships = arr(data?.relationships).filter(r => supportedEvidence(r, ids));
    const out = { ...data, relationships };
    if (!relationships.length) out.pattern = { statement: 'No evidence-backed relationship is established strongly enough yet.', confidence: 'INSUFFICIENT_EVIDENCE' };
    out.methodologyGate = { status: 'OPEN_WITH_CAUTION', supportedRelationships: relationships.length, note: 'Only relationships with explicit evidence support are presented.' };
    return { data: out, gate: { status: 'OPEN_WITH_CAUTION', supportedRelationships: relationships.length } };
  }
  if (!readiness.ready) return { data: blocked(stage, readiness), gate: { status: 'BLOCKED', reasons: readiness.reasons } };
  return { data: { ...data, methodologyGate: { status: 'OPEN', evidenceBacked: true } }, gate: { status: 'OPEN' } };
}

module.exports = { gateStage, diagnosisReadiness, materialEvidence, supportedEvidence };
