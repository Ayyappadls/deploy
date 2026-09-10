const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDiscoveryState, applyController } = require('./discoveryController');

function state(transcript, evidenceOnFile = [], signals = [], openGaps = [], contradictions = [], relationships = []) {
  return computeDiscoveryState({ transcript, evidenceOnFile, signals, openGaps, contradictions, relationships });
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

test('previously asked questions are excluded even when wording is highly similar', () => {
  const transcript = 'Owner: Sales are slow.\nDLSMirror: When you say sales are down, is it mainly fewer customers, smaller purchases, or both?\nOwner: Customers are buying less.';
  const evidence = [{ id: 'e1', normalizedMeaning: 'Customers are buying less.', layer: 'customer', evidenceStatus: 'OWNER-PROVIDED' }];
  const signals = [{ id: 's1', signal: 'Customer activity is lower', severity: 'high', relatedLayers: ['customer'], supportingEvidenceKeys: ['e1'] }];
  const s = state(transcript, evidence, signals);
  assert.notEqual(s.nextBestQuestion?.text, 'When you say sales are down, is it mainly fewer customers, smaller purchases, or both?');
  assert.ok(!s.nextBestQuestion || !/fewer customers, smaller purchases, or both/i.test(s.nextBestQuestion.text));
});

test('the same finance question is never selected twice', () => {
  const transcript = 'Owner: Sales are down and cash feels tight.\nDLSMirror: When the money comes in, what usually takes it back out again?\nOwner: Stock, suppliers, salaries and rent take most of it out.';
  const evidence = [
    { id: 'e1', normalizedMeaning: 'Sales are down.', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e2', normalizedMeaning: 'Cash feels tight.', layer: 'finance', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e3', normalizedMeaning: 'Money goes to stock, suppliers, salaries and rent.', layer: 'finance', evidenceStatus: 'OWNER-PROVIDED' }
  ];
  const signals = [{ id: 's1', signal: 'Cash pressure', severity: 'high', relatedLayers: ['finance'], supportingEvidenceKeys: ['e2'] }];
  const s = state(transcript, evidence, signals);
  assert.notEqual(s.nextBestQuestion?.text, 'When the money comes in, what usually takes it back out again?');
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

test('multiple signals without an evidence-backed relationship never complete discovery', () => {
  const transcript = 'Owner: Sales are down and cash is tighter.\nDLSMirror: What has become harder to manage?\nOwner: Inventory is harder to manage.';
  const evidence = [
    { id: 'e1', normalizedMeaning: 'Sales are down.', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e2', normalizedMeaning: 'Cash is tighter.', layer: 'finance', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e3', normalizedMeaning: 'Inventory is harder to manage.', layer: 'operations', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e4', normalizedMeaning: 'The owner runs the business.', layer: 'owner', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e5', normalizedMeaning: 'The business has customers.', layer: 'customer', evidenceStatus: 'OWNER-PROVIDED' }
  ];
  const signals = [
    { id: 's1', signal: 'Sales are down', severity: 'high', relatedLayers: ['revenue'] },
    { id: 's2', signal: 'Cash is tighter', severity: 'high', relatedLayers: ['finance'] }
  ];
  const s = state(transcript, evidence, signals);
  assert.equal(s.relationshipReadiness.ready, false);
  assert.equal(s.complete, false);
  assert.equal(s.nextBestQuestion.objective, 'test_relationship');
});

test('one evidence reference cannot establish a relationship', () => {
  const evidence = [
    { id: 'e1', normalizedMeaning: 'Sales are down.', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e2', normalizedMeaning: 'Cash is tighter.', layer: 'finance', evidenceStatus: 'OWNER-PROVIDED' }
  ];
  const relationships = [{ signalAId:'s1', signalBId:'s2', type:'CONTRIBUTES_TO', supportingEvidenceIds:['e1'] }];
  const s = state('Owner: Sales are down and cash is tighter.', evidence, [{id:'s1',signal:'Sales down'},{id:'s2',signal:'Cash tighter'}], [], [], relationships);
  assert.equal(s.relationshipReadiness.ready, false);
  assert.equal(s.complete, false);
});

test('duplicate evidence references cannot establish a relationship', () => {
  const evidence = [
    { id: 'e1', normalizedMeaning: 'Sales are down.', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED' }
  ];
  const relationships = [{ signalAId:'s1', signalBId:'s2', type:'CONTRIBUTES_TO', supportingEvidenceIds:['e1','e1'] }];
  const s = state('Owner: Sales are down.', evidence, [{id:'s1',signal:'Sales down'},{id:'s2',signal:'Cash tighter'}], [], [], relationships);
  assert.equal(s.relationshipReadiness.ready, false);
});

test('hypothesis evidence cannot establish a relationship', () => {
  const evidence = [
    { id: 'e1', normalizedMeaning: 'Sales are down.', layer: 'revenue', evidenceStatus: 'HYPOTHESIS' },
    { id: 'e2', normalizedMeaning: 'Cash is tighter.', layer: 'finance', evidenceStatus: 'OWNER-PROVIDED' }
  ];
  const relationships = [{ signalAId:'s1', signalBId:'s2', type:'CONTRIBUTES_TO', supportingEvidenceIds:['e1','e2'] }];
  const s = state('Owner: I think sales are causing the cash problem.', evidence, [{id:'s1',signal:'Sales down'},{id:'s2',signal:'Cash tighter'}], [], [], relationships);
  assert.equal(s.relationshipReadiness.ready, false);
});

test('relationship references must point to current active signals', () => {
  const evidence = [
    { id: 'e1', normalizedMeaning: 'Sales are down.', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e2', normalizedMeaning: 'Cash is tighter.', layer: 'finance', evidenceStatus: 'OWNER-PROVIDED' }
  ];
  const relationships = [{ signalAId:'stale-1', signalBId:'stale-2', type:'CONTRIBUTES_TO', supportingEvidenceIds:['e1','e2'] }];
  const s = state('Owner: Sales are down and cash is tighter.', evidence, [{id:'s1',signal:'Sales down'},{id:'s2',signal:'Cash tighter'}], [], [], relationships);
  assert.equal(s.relationshipReadiness.ready, false);
});

test('two established evidence references can establish relationship readiness', () => {
  const evidence = [
    { id: 'e1', normalizedMeaning: 'Sales are down.', layer: 'revenue', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'e2', normalizedMeaning: 'Cash is tighter.', layer: 'finance', evidenceStatus: 'OWNER-PROVIDED' }
  ];
  const relationships = [{ signalAId:'s1', signalBId:'s2', type:'CONTRIBUTES_TO', supportingEvidenceIds:['e1','e2'] }];
  const s = state('Owner: Sales are down and cash is tighter.\nOwner: I am worried about what is causing the cash pressure.', evidence, [{id:'s1',signal:'Sales down'},{id:'s2',signal:'Cash tighter'}], [], [], relationships);
  assert.equal(s.relationshipReadiness.ready, true);
});

test('exact clothing-shop scenario remains in discovery without a supported relationship', () => {
  const transcript = [
    'Owner: I run a small women’s clothing shop selling sarees, dress materials and ready-made clothes. Recently, sales have started slowing down, and I’m feeling more pressure on cash than I used to.',
    'DLSMirror: When the money comes in, what usually takes it back out again?',
    'Owner: A lot of the money goes back into buying new stock. Some also goes toward supplier payments, staff salaries, rent, and other regular expenses. Recently, more money seems to be getting tied up in slow-moving inventory and customer credit.',
    'DLSMirror: When the business is changing, what has happened to the money coming in compared with before?',
    'Owner: Earlier, we were doing around ₹7–8 lakh a month. Recently, it has come down to around ₹5–6 lakh. Customers are still coming in, but they’re buying less than before.',
    'DLSMirror: What has become harder to deliver or manage day to day compared with before?',
    'Owner: Day to day, managing inventory has become harder. Some clothes are selling slowly, so more money is getting stuck in stock. I’m also having to be more careful about giving customers credit because cash is tighter.',
    'DLSMirror: Who usually makes the important day-to-day decisions, and what happens when you are not there?',
    'Owner: I usually make the important day-to-day decisions myself. When I’m not there, the staff can handle routine customer interactions and sales, but they usually come to me for decisions about purchasing stock, giving credit, pricing, or anything unusual.'
  ].join('\n');
  const evidence = [
    {id:'e1',normalizedMeaning:'Women’s clothing retail shop selling sarees, dress materials and ready-made clothes.',layer:'offer',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e2',normalizedMeaning:'Sales have slowed down.',layer:'revenue',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e3',normalizedMeaning:'Cash pressure has increased.',layer:'finance',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e4',normalizedMeaning:'Money is tied up in slow-moving inventory and customer credit.',layer:'finance',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e5',normalizedMeaning:'Monthly sales fell from ₹7–8 lakh to ₹5–6 lakh and customers buy less.',layer:'customer',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e6',normalizedMeaning:'Inventory is harder to manage and some clothes sell slowly.',layer:'operations',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e7',normalizedMeaning:'Owner makes purchasing, credit, pricing and unusual decisions.',layer:'organization',evidenceStatus:'OWNER-PROVIDED'}
  ];
  const signals = [
    {id:'s1',signal:'Sales are slowing',severity:'high',relatedLayers:['revenue','customer']},
    {id:'s2',signal:'Cash pressure',severity:'high',relatedLayers:['finance']},
    {id:'s3',signal:'Slow-moving inventory',severity:'high',relatedLayers:['operations','finance']}
  ];
  const s = state(transcript, evidence, signals);
  assert.equal(s.complete, false);
  assert.equal(s.relationshipReadiness.ready, false);
  assert.equal(s.nextBestQuestion.objective, 'test_relationship');
  assert.match(s.nextBestQuestion.text, /connected|separate/i);
});
