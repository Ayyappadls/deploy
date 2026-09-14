const test = require('node:test');
const assert = require('node:assert/strict');
const { runDiscoveryPipeline } = require('./discoveryEngine');
const { ReasoningProvider } = require('./ReasoningProvider');

// Dispatches based on the TASK marker in the system prompt, so a single
// stub can drive a full multi-call pipeline turn (extraction, optional
// relationship extraction, optional phrasing) with different canned
// responses for each.
class ScriptedProvider extends ReasoningProvider {
  constructor(byTask) { super(); this.byTask = byTask; this.calls = []; }
  async generate({ system, user }) {
    this.calls.push({ system, user });
    if (/TASK:\s*EXTRACT_EVIDENCE/i.test(system)) return JSON.stringify(this.byTask.extract || { evidence: [], signals: [], knowledge_gaps: [], contradictions: [] });
    if (/TASK:\s*EXTRACT_RELATIONSHIP/i.test(system)) return JSON.stringify(this.byTask.relationship || { found: false });
    if (/TASK:\s*PHRASE_QUESTION/i.test(system)) return JSON.stringify(this.byTask.phrase || { text: 'phrased' });
    throw new Error('unexpected task');
  }
}

test('a model trying to sneak VERIFIED into discover-stage evidence is filtered out, not committed', async () => {
  const provider = new ScriptedProvider({ extract: { evidence: [{ key: 'e1', normalizedMeaning: 'x', layer: 'revenue', evidenceStatus: 'VERIFIED', originalStatement: 'x' }], signals: [], knowledge_gaps: [], contradictions: [] } });
  const { data } = await runDiscoveryPipeline({ provider, transcript: 'Owner: x', evidenceOnFile: [] });
  assert.equal(data.evidence.length, 0, 'VERIFIED is not in the model-output enum, by design - the item must be dropped, not committed');
});

test('2 signals with no relationship yet triggers a relationship-extraction attempt', async () => {
  const signalsOnFile = [
    { id: 'sig-a', signal: 'A meaningful share of revenue is tied up in customer credit', severity: 'medium', status: 'active' },
    { id: 'sig-b', signal: 'Aging receivables are tying up cash for months at a time', severity: 'high', status: 'active' },
  ];
  const evidenceOnFile = [
    { id: 'ev-a', normalizedMeaning: 'Customers buy on credit', layer: 'customer', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'ev-b', normalizedMeaning: 'Some receivables are overdue', layer: 'finance', evidenceStatus: 'OWNER-PROVIDED' },
  ];
  const provider = new ScriptedProvider({
    extract: { evidence: [], signals: [], knowledge_gaps: [], contradictions: [] },
    relationship: { found: true, signalAId: 'sig-a', signalBId: 'sig-b', type: 'CONTRIBUTES_TO', relationship: 'Credit becomes overdue receivables', supportingEvidenceIds: ['ev-a', 'ev-b'] },
  });
  const { data } = await runDiscoveryPipeline({ provider, transcript: 'Owner: anything else', evidenceOnFile, signalsOnFile });
  assert.equal(provider.calls.some(c => /TASK:\s*EXTRACT_RELATIONSHIP/i.test(c.system)), true, 'a relationship extraction attempt should have been made');
  assert.equal(data.relationships.length, 1);
  assert.equal(data.relationships[0].supportingEvidenceIds.length, 2);
});

test('a relationship-extraction reply citing fewer than 2 real evidence ids is rejected, not committed', async () => {
  const signalsOnFile = [
    { id: 'sig-a', signal: 'A meaningful share of revenue is tied up in customer credit', severity: 'medium', status: 'active' },
    { id: 'sig-b', signal: 'Aging receivables are tying up cash for months at a time', severity: 'high', status: 'active' },
  ];
  const evidenceOnFile = [{ id: 'ev-a', normalizedMeaning: 'Customers buy on credit', layer: 'customer', evidenceStatus: 'OWNER-PROVIDED' }];
  const provider = new ScriptedProvider({
    extract: { evidence: [], signals: [], knowledge_gaps: [], contradictions: [] },
    relationship: { found: true, signalAId: 'sig-a', signalBId: 'sig-b', type: 'CONTRIBUTES_TO', relationship: 'guess', supportingEvidenceIds: ['ev-a', 'ev-does-not-exist'] },
  });
  const { data } = await runDiscoveryPipeline({ provider, transcript: 'Owner: anything', evidenceOnFile, signalsOnFile });
  assert.equal(data.relationships.length, 0, 'only one real evidence id was cited (the other was fabricated) - must not be committed as supported');
});

test('ids never collide across turns when turnIndex increments (regression: frontend must send an incrementing turnIndex)', async () => {
  const provider = new ScriptedProvider({ extract: { evidence: [{ key: 'e1', normalizedMeaning: 'x', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED', originalStatement: 'x' }], signals: [], knowledge_gaps: [], contradictions: [] } });
  const turn1 = await runDiscoveryPipeline({ provider, transcript: 'Owner: a', evidenceOnFile: [], turnIndex: 0 });
  const turn2 = await runDiscoveryPipeline({ provider, transcript: 'Owner: a\nOwner: b', evidenceOnFile: turn1.data.evidence, turnIndex: 1 });
  assert.notEqual(turn1.data.evidence[0].id, turn2.data.evidence[0].id, 'evidence ids from different turns must not collide');
});

test('discoveryState.complete is false with 2 signals and no relationship, even with plenty of evidence', async () => {
  const signalsOnFile = [
    { id: 'sig-a', signal: 'Revenue decline', severity: 'high', status: 'active' },
    { id: 'sig-b', signal: 'Cash pressure', severity: 'high', status: 'active' },
  ];
  const evidenceOnFile = [
    { id: 'ev-1', normalizedMeaning: 'a', layer: 'owner', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'ev-2', normalizedMeaning: 'b', layer: 'offer', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'ev-3', normalizedMeaning: 'c', layer: 'customer', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'ev-4', normalizedMeaning: 'd', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED' },
  ];
  const provider = new ScriptedProvider({ extract: { evidence: [], signals: [], knowledge_gaps: [], contradictions: [] }, relationship: { found: false } });
  const { data } = await runDiscoveryPipeline({ provider, transcript: 'Owner: I want to decide what to do about this', evidenceOnFile, signalsOnFile });
  assert.equal(data.discoveryState.complete, false);
  assert.ok(data.next_question, 'Discovery must keep asking, not go silent, while incomplete');
});
