const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDiscoveryState, applyController } = require('./discoveryController');

function state(transcript, evidenceOnFile = [], signals = [], openGaps = [], contradictions = []) {
  return computeDiscoveryState({ transcript, evidenceOnFile, signals, openGaps, contradictions });
}

test('empty or non-business input stays in orientation and asks for context', () => {
  const s = state('Owner: Hmm... okay. Tell me what you want to know. I will explain whatever I know.');
  assert.equal(s.stage, 'ORIENTATION');
  assert.equal(s.nextBestQuestion.objective, 'orient');
  assert.match(s.nextBestQuestion.text, /what do you sell|provide/i);
});

test('a greeting is not treated as business evidence', () => {
  const s = state('Owner: hi');
  assert.equal(s.evidenceCount, 0);
  assert.equal(s.stage, 'ORIENTATION');
});

test('a substantive owner statement does not force a finance question just because finance is missing', () => {
  const transcript = 'Owner: Sales have slowed down for the last three months. Customers are coming less than before.';
  const evidence = [{ id: 'e1', normalizedMeaning: 'Sales have slowed down.', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED' }];
  const signals = [{ id: 's1', signal: 'Sales are slowing', severity: 'high', relatedLayers: ['revenue'], supportingEvidenceKeys: ['e1'] }];
  const s = state(transcript, evidence, signals);
  assert.equal(s.nextBestQuestion.objective, 'clarify_active_signal');
  assert.match(s.nextBestQuestion.text, /fewer customers|smaller purchases/i);
});

test('a cash signal can trigger a finance question, but only when cash is actually active', () => {
  const transcript = 'Owner: Sales are okay, but there is never much money left at the end of the week.';
  const evidence = [{ id: 'e1', normalizedMeaning: 'The owner has little cash left.', layer: 'finance', evidenceStatus: 'OWNER-PROVIDED' }];
  const signals = [{ id: 's1', signal: 'Cash pressure', severity: 'high', relatedLayers: ['finance'], supportingEvidenceKeys: ['e1'] }];
  const s = state(transcript, evidence, signals);
  assert.equal(s.nextBestQuestion.objective, 'trace_money');
});

test('contradictions outrank ordinary missing information', () => {
  const transcript = 'Owner: Customers always pay quickly.\nDLSMirror: How do customers usually pay you?\nOwner: Actually some take 60 days.';
  const evidence = [
    { id: 'e1', normalizedMeaning: 'Customers usually pay quickly.', layer: 'customer', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e2', normalizedMeaning: 'Some customers take 60 days.', layer: 'finance', evidenceStatus: 'OWNER-PROVIDED' }
  ];
  const s = state(transcript, evidence, [], [], [{ existingEvidenceId: 'e1', statementA: 'pay quickly', statementB: 'take 60 days', note: 'conflict' }]);
  assert.equal(s.nextBestQuestion.objective, 'resolve_contradiction');
});

test('inferred or hypothetical evidence is verified before it is treated as fact', () => {
  const transcript = 'Owner: I think two customers may stop buying.';
  const evidence = [{ id: 'e1', normalizedMeaning: 'Two customers may be at risk.', layer: 'customer', evidenceStatus: 'HYPOTHESIS', verificationQuestion: 'Have those customers actually stopped buying, or is this a concern you have right now?' }];
  const s = state(transcript, evidence);
  assert.equal(s.nextBestQuestion.objective, 'verify_inference');
});

test('previously asked questions are excluded', () => {
  const transcript = 'Owner: Sales are slow.\nDLSMirror: When you say sales are down, is it mainly fewer customers, smaller purchases, or both?\nOwner: Fewer customers.';
  const evidence = [{ id: 'e1', normalizedMeaning: 'Fewer customers are buying.', layer: 'customer', evidenceStatus: 'OWNER-PROVIDED' }];
  const signals = [{ id: 's1', signal: 'Customer activity is lower', severity: 'high', relatedLayers: ['customer'], supportingEvidenceKeys: ['e1'] }];
  const s = state(transcript, evidence, signals);
  assert.notEqual(s.nextBestQuestion?.text, 'When you say sales are down, is it mainly fewer customers, smaller purchases, or both?');
});

test('generic full-picture question is overridden by the controller', () => {
  const transcript = 'Owner: We sell electrical goods. Sales have been weaker lately.';
  const evidence = [{ id: 'e1', normalizedMeaning: 'Sales have weakened.', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED' }];
  const signals = [{ id: 's1', signal: 'Sales are weakening', severity: 'medium', relatedLayers: ['revenue'], supportingEvidenceKeys: ['e1'] }];
  const providerData = { next_question: { text: 'Is there anything else about how customers pay you, or how the money moves through the business, that I should know before I look at the full picture?', why: 'generic', replies: [] } };
  const s = state(transcript, evidence, signals);
  const out = applyController(providerData, s);
  assert.notEqual(out.next_question.text, providerData.next_question.text);
  assert.match(out.next_question.text, /fewer customers|smaller purchases/i);
});

test('discovery does not declare completion from question count alone', () => {
  const transcript = 'Owner: Sales are fine.\nDLSMirror: Tell me more.\nOwner: Customers are okay.\nDLSMirror: What do you sell?\nOwner: We sell electrical goods.';
  const evidence = [
    { id: 'e1', normalizedMeaning: 'Sales are fine.', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e2', normalizedMeaning: 'Customers are okay.', layer: 'customer', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e3', normalizedMeaning: 'The business sells electrical goods.', layer: 'offer', evidenceStatus: 'OWNER-PROVIDED' }
  ];
  const s = state(transcript, evidence, [], [{ question: 'What is changing in the market?', importance: 'high', diagnosticImpact: 'high', decisionImpact: 'medium', relationshipImpact: 'medium' }]);
  assert.equal(s.complete, false);
});
