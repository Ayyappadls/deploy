const test = require('node:test');
const assert = require('node:assert/strict');
const { MockProvider } = require('./MockProvider');
const { validate } = require('./schemas');

const provider = new MockProvider();

function discoverUser(transcript, evidenceOnFile) {
  return `Conversation so far:\n${transcript}\n\nEvidence already on file:\n${JSON.stringify(evidenceOnFile || [])}\n\nOpen knowledge gaps:\n[]`;
}
async function discover(transcript, evidenceOnFile) {
  const raw = await provider.generate({ system: 'Your job right now is DISCOVERY blah', user: discoverUser(transcript, evidenceOnFile) });
  return JSON.parse(raw);
}

test('local engine: different owner input produces different evidence, not one canned answer', async () => {
  const a = await discover('Owner: Sales are okay but I dont know where the money is going.');
  const b = await discover('Owner: My staff keep asking me for every decision.');
  assert.notDeepEqual(a.evidence, b.evidence, 'two unrelated owner statements must not produce identical evidence');
});

test('local engine: every discover response passes the real schema validator', async () => {
  const inputs = [
    'Owner: Sales are okay but I dont know where the money is going.',
    'Owner: Customers ask for credit so I give it.',
    "Owner: I don't know the exact amount.",
    'Owner: There was a customer before who defaulted.',
    "Owner: I haven't seriously followed up because I don't know exactly what to say.",
  ];
  for (const t of inputs) {
    const data = await discover(t);
    assert.equal(validate('discover', data), null, `should validate for input: ${t}`);
  }
});

test('local engine: "I don\'t know the exact amount" is preserved as HYPOTHESIS, never upgraded to a confident fact', async () => {
  const data = await discover("Owner: I don't know the exact amount.");
  const relevant = data.evidence.find((e) => e.normalizedMeaning.toLowerCase().includes('not precisely tracked') || e.normalizedMeaning.toLowerCase().includes('estimated'));
  assert.ok(relevant, 'should produce evidence acknowledging the uncertainty');
  assert.equal(relevant.evidenceStatus, 'HYPOTHESIS');
});

test('local engine: never emits VERIFIED - that status is application-controlled only', async () => {
  const scenarios = [
    'Owner: Sales are okay but I dont know where the money is going.',
    'Owner: A few customers havent paid for three to six months.',
    'Owner: I handle the money and important customers myself.',
  ];
  for (const t of scenarios) {
    const data = await discover(t);
    for (const e of data.evidence) {
      assert.notEqual(e.evidenceStatus, 'VERIFIED', 'the local engine must never self-declare VERIFIED');
    }
  }
});

test('local engine: detects a classic contradiction across turns', async () => {
  const transcript = 'Owner: Customers always pay quickly, no problem there.\nOwner: Actually thinking about it, some customers take 60 days to pay.';
  const data = await discover(transcript);
  assert.ok(data.contradictions.length > 0, 'a genuine contradiction across turns should be flagged');
});

test('local engine: does not flag a contradiction between unrelated statements', async () => {
  const transcript = 'Owner: Sales are okay but I dont know where the money is going.\nOwner: My staff keep asking me for every decision.';
  const data = await discover(transcript);
  assert.equal(data.contradictions.length, 0, 'unrelated statements should not be flagged as contradictory');
});

test('local engine: does not repeat the same evidence for the same topic mentioned twice', async () => {
  const first = await discover('Owner: Customers ask for credit so I give it.');
  const evidenceOnFile = first.evidence.map((e, i) => ({ id: 'ev' + i, statement: e.normalizedMeaning, layer: e.layer, evidenceStatus: e.evidenceStatus }));
  const transcript = 'Owner: Customers ask for credit so I give it.\nOwner: Customers ask for credit again, same as before.';
  const second = await discover(transcript, evidenceOnFile);
  const secondMentionsCreditAgain = second.evidence.some((e) => e.normalizedMeaning.toLowerCase().includes('buy on credit'));
  assert.equal(secondMentionsCreditAgain, false, 'a topic already covered should not be re-logged as new evidence');
});

test('local engine: knowledge gaps never disappear as an empty question', async () => {
  const data = await discover('Owner: Sales are okay but I dont know where the money is going.');
  data.knowledge_gaps.forEach((g) => assert.ok(g.question && g.question.length > 5));
  assert.ok(data.next_question === null || (data.next_question.text && data.next_question.text.length > 5));
});

test('local engine: Understand only cites signal ids that were actually given to it', async () => {
  const signals = [
    { id: 'sig_abc', signal: 'Cash visibility gap despite normal sales activity', severity: 'high', relatedLayers: ['commercial'] },
    { id: 'sig_def', signal: 'A meaningful share of revenue is tied up in customer credit', severity: 'medium', relatedLayers: ['customer'] },
  ];
  const evidence = [
    { id: 'ev_1', statement: 'x', layer: 'commercial', evidenceStatus: 'OWNER-PROVIDED' },
    { id: 'ev_2', statement: 'y', layer: 'customer', evidenceStatus: 'OWNER-PROVIDED' },
  ];
  const raw = await provider.generate({ system: 'Your job is UNDERSTAND blah', user: `Evidence:\n${JSON.stringify(evidence)}\n\nSignals:\n${JSON.stringify(signals)}` });
  const data = JSON.parse(raw);
  assert.equal(validate('understand', data), null);
  data.relationships.forEach((r) => {
    assert.ok(['sig_abc', 'sig_def'].includes(r.signalAId));
    assert.ok(['sig_abc', 'sig_def'].includes(r.signalBId));
  });
});

test('local engine: Diagnose produces domain-specific content, not the same thesis regardless of input', async () => {
  const creditEvidence = [{ id: 'e1', statement: 'Customers regularly buy on credit rather than paying at the time of sale.', layer: 'customer', evidenceStatus: 'OWNER-PROVIDED' }];
  const ownerEvidence = [{ id: 'e1', statement: 'The owner personally handles money and key customer relationships, without delegating.', layer: 'owner', evidenceStatus: 'OWNER-PROVIDED' }];

  const creditRaw = await provider.generate({ system: 'Your job is DIAGNOSE blah', user: `Evidence:\n${JSON.stringify(creditEvidence)}\n\nRelationships:\n[]\n\nPattern:\nnull` });
  const ownerRaw = await provider.generate({ system: 'Your job is DIAGNOSE blah', user: `Evidence:\n${JSON.stringify(ownerEvidence)}\n\nRelationships:\n[]\n\nPattern:\nnull` });

  const creditData = JSON.parse(creditRaw);
  const ownerData = JSON.parse(ownerRaw);
  assert.notEqual(creditData.thesis.thesis, ownerData.thesis.thesis, 'different accumulated evidence should produce a different thesis');
  assert.equal(validate('diagnose', creditData), null);
  assert.equal(validate('diagnose', ownerData), null);
});

test('local engine: Learning distinguishes a positive outcome from a negative one', async () => {
  const decision = { expectedOutcome: 'Outstanding receivables stop growing.' };
  const posRaw = await provider.generate({ system: 'Your job is LEARNING blah', user: `Decision on file:\n${JSON.stringify(decision)}\n\nWhat the owner reports actually happened:\nThings have improved, we finally paid off two old balances.` });
  const negRaw = await provider.generate({ system: 'Your job is LEARNING blah', user: `Decision on file:\n${JSON.stringify(decision)}\n\nWhat the owner reports actually happened:\nNothing changed, still overdue same as before.` });
  const pos = JSON.parse(posRaw);
  const neg = JSON.parse(negRaw);
  assert.notEqual(pos.difference, neg.difference, 'a positive and a negative outcome report should not produce identical learning output');
  assert.equal(validate('learning', pos), null);
  assert.equal(validate('learning', neg), null);
});

test('local engine: all six downstream stages return schema-valid output for a generic (undetected-domain) input', async () => {
  const raw = { evidence: [], relationships: [], pattern: null, diagnosis: null, thesis: null, transition: null, behavior: null, decision: null };
  const understand = JSON.parse(await provider.generate({ system: 'Your job is UNDERSTAND blah', user: `Evidence:\n[]\n\nSignals:\n[]` }));
  assert.equal(validate('understand', understand), null);
  const diagnose = JSON.parse(await provider.generate({ system: 'Your job is DIAGNOSE blah', user: `Evidence:\n[]\n\nRelationships:\n[]\n\nPattern:\nnull` }));
  assert.equal(validate('diagnose', diagnose), null);
  const transition = JSON.parse(await provider.generate({ system: 'Your job is TRANSITION blah', user: `Diagnosis:\n${JSON.stringify(diagnose)}\n\nCommercial thesis:\n${JSON.stringify(diagnose.thesis)}` }));
  assert.equal(validate('transition', transition), null);
  const behavior = JSON.parse(await provider.generate({ system: 'Your job is ENABLE CHANGE blah', user: `Diagnosis:\n${JSON.stringify(diagnose)}\n\nTransition:\n${JSON.stringify(transition)}` }));
  assert.equal(validate('behavior', behavior), null);
  const stakeholder = JSON.parse(await provider.generate({ system: 'Your job is STAKEHOLDER ALIGNMENT blah', user: `Diagnosis:\n${JSON.stringify(diagnose)}\n\nTransition:\n${JSON.stringify(transition)}\n\nBehavior change:\n${JSON.stringify(behavior)}` }));
  assert.equal(validate('stakeholder', stakeholder), null);
});

test('local engine: no risky substring false-positives (e.g. "however" must not trigger a supplier-debt signal)', async () => {
  const data = await discover('Owner: However, business has otherwise been fine this month.');
  const falsePositive = data.evidence.some((e) => e.normalizedMeaning.includes('owes a meaningful amount to its own suppliers'));
  assert.equal(falsePositive, false);
});
