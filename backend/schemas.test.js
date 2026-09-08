const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../reasoning/schemas');

test('discover: valid response passes', () => {
  const data = {
    contradictions: [],
    evidence: [{ key: 'e1', originalStatement: 'x', normalizedMeaning: 'Sales are healthy.', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED', verificationQuestion: '' }],
    signals: [{ signal: 'Cash pressure', type: 'commercial', severity: 'high', relatedLayers: ['revenue'], supportingEvidenceKeys: ['e1'] }],
    knowledge_gaps: [{ question: 'How quickly do customers pay?', missingInformation: 'payment timing', importance: 'high' }],
    next_question: { text: 'How quickly do customers pay?', why: 'checks collections', replies: ['a', 'b', 'c'] },
  };
  assert.equal(validate('discover', data), null);
});

test('discover: rejects invalid evidenceStatus', () => {
  const data = {
    contradictions: [], evidence: [{ normalizedMeaning: 'x', layer: 'revenue', evidenceStatus: 'VERIFIED' }],
    signals: [], knowledge_gaps: [], next_question: null,
  };
  assert.notEqual(validate('discover', data), null, 'model must never self-declare VERIFIED, and status must be in the allowed set');
});

test('discover: rejects invalid layer', () => {
  const data = { contradictions: [], evidence: [{ normalizedMeaning: 'x', layer: 'not_a_real_layer', evidenceStatus: 'OWNER-PROVIDED' }], signals: [], knowledge_gaps: [], next_question: null };
  assert.notEqual(validate('discover', data), null);
});

test('discover: rejects missing top-level array fields', () => {
  assert.notEqual(validate('discover', { evidence: [], signals: [], next_question: null }), null);
});

test('understand: valid response passes', () => {
  const data = {
    relationships: [{ key: 'r1', signalAId: 'sig_1', signalBId: 'sig_2', relationship: 'x drives y', type: 'CONTRIBUTES_TO', supportingEvidenceIds: ['ev_1'] }],
    pattern: { statement: 'Growth is consuming cash.', supportingRelationshipKeys: ['r1'], supportingSignalIds: ['sig_1', 'sig_2'] },
  };
  assert.equal(validate('understand', data), null);
});

test('understand: rejects invalid relationship type', () => {
  const data = { relationships: [{ signalAId: 'a', signalBId: 'b', relationship: 'x', type: 'MAKES_MAGIC_HAPPEN' }], pattern: { statement: 'x' } };
  assert.notEqual(validate('understand', data), null);
});

test('diagnose: valid response passes', () => {
  const data = {
    firstPrinciple: { situation: 'a', assumptions: 'b', evidence: 'c', causalChain: 'd', underlyingReality: 'e', commercialImplication: 'f' },
    invisibleBottleneck: { deconstruction: 'a', behavioralTruth: 'b', invisibleConflict: 'c', rootCause: 'd', leverageVariable: 'e', operatingRedesign: 'f', pilot: 'g', strategicEndState: 'h' },
    thesis: { thesis: 'x', supportingEvidence: 'y', contradictingEvidence: '', falsificationCondition: 'z' },
  };
  assert.equal(validate('diagnose', data), null);
});

test('diagnose: rejects incomplete firstPrinciple', () => {
  const data = { firstPrinciple: { situation: 'a' }, invisibleBottleneck: {}, thesis: { thesis: 'x' } };
  assert.notEqual(validate('diagnose', data), null);
});

test('transition: valid response passes', () => {
  const data = { current: 'a', constraint: 'b', required: 'c', future: 'd', operatingSystem: { mechanism: 'a', owner: 'b', cadence: 'c', metric: 'd', escalation: 'e' } };
  assert.equal(validate('transition', data), null);
});

test('behavior: valid response passes', () => {
  const data = { current: 'a', friction: 'b', inertia: 'c', relapseRisk: 'd', wedge: 'e', required: 'f', capability: 'g', adoption: 'h', accountability: 'i', measure: 'j' };
  assert.equal(validate('behavior', data), null);
});

test('behavior: rejects missing relapseRisk (evidence-lifecycle-adjacent field)', () => {
  const { relapseRisk, ...rest } = { current: 'a', friction: 'b', inertia: 'c', relapseRisk: 'd', wedge: 'e', required: 'f', capability: 'g', adoption: 'h', accountability: 'i', measure: 'j' };
  assert.notEqual(validate('behavior', rest), null);
});

test('stakeholder: valid response passes', () => {
  const data = {
    stakeholders: { owner: { means: 'a', understand: 'b', resist: '', action: 'c' } },
    decision: { decision: 'a', reason: 'b', owner: 'You', actions: ['x'], expectedOutcome: 'y', successMetric: 'z', reviewDate: 'in 2 weeks' },
  };
  assert.equal(validate('stakeholder', data), null);
});

test('stakeholder: rejects missing owner stakeholder', () => {
  const data = { stakeholders: { employee: { means: 'a', understand: 'b' } }, decision: { decision: 'a', owner: 'You' } };
  assert.notEqual(validate('stakeholder', data), null);
});

test('learning: valid response passes', () => {
  const data = { observedOutcome: 'a', difference: 'b', possibleExplanation: 'c', evidenceRequired: 'd', newSignal: { signal: 'x', type: 'commercial', severity: 'medium', relatedLayers: ['finance'] } };
  assert.equal(validate('learning', data), null);
});

test('learning: rejects invalid severity enum', () => {
  const data = { observedOutcome: 'a', difference: 'b', possibleExplanation: 'c', evidenceRequired: 'd', newSignal: { signal: 'x', severity: 'catastrophic' } };
  assert.notEqual(validate('learning', data), null);
});
