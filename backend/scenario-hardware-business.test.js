const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createApp } = require('../server');
const { MockProvider } = require('../providers/MockProvider');
const { createRateLimiter } = require('../rateLimiter');
const { MirrorStore } = require('../persistence/store');

/**
 * WHAT THIS TEST PROVES, AND WHAT IT DOESN'T
 * -------------------------------------------
 * As of this upgrade, MockProvider is a genuine (if simple, rule-based)
 * local reasoning engine: it inspects the owner's actual words, extracts
 * different evidence for different topics (credit, overdue receivables,
 * owner-dependency, avoided customers, supplier pressure...), preserves
 * uncertainty as HYPOTHESIS rather than confident fact, and reasons about
 * a genuinely different dominant theme depending on what's been said. This
 * test both exercises the full engineering pipeline across 9 turns AND
 * asserts on real, content-specific behavior below.
 *
 * What it still does NOT prove: that this is as good as an actual LLM's
 * judgment. This is deterministic keyword-driven reasoning, not language
 * understanding - it can miss nuance a real model would catch, and it can
 * only recognize situations it has a template for. Judging genuine
 * reasoning quality against unforeseen phrasing needs a real
 * ANTHROPIC_API_KEY and Live Mode; see README "Known limitations".
 */

const OWNER_TURNS = [
  "Sales are okay but I don't really know where the money is going.",
  "We're a hardware and building materials shop. Maybe 20 to 40 customers a month.",
  "Some months it's five lakh, some months up to twelve lakh, depends on construction season.",
  "A lot of regular customers buy on credit and pay me back later, that's normal in this business.",
  "Honestly I'd guess fifty thousand to a lakh is outstanding at any time, but I don't track it closely.",
  "A few of them are three to six months overdue, if I'm being honest.",
  "My supplier payments have been stretched too, I'm paying them later than I used to.",
  "There are two customers I have a bad feeling about but I keep putting off calling them.",
  "I'm not totally sure why - the balance isn't clear in my head, and it feels awkward to ask, and I don't want them to stop buying from me.",
];

async function withServer(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlsmirror-scenario-'));
  const app = createApp({
    provider: new MockProvider(),
    providerLabel: 'mock',
    rateLimit: createRateLimiter({ windowMs: 60000, max: 1000 }),
    store: new MirrorStore({ dataDir }),
    nodeEnv: 'test',
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('scenario: a 9-turn messy hardware-business Discovery session builds real, differentiated, evidence-grounded understanding', async () => {
  await withServer(async (base) => {
    let transcript = '';
    let evidenceOnFile = [];
    const seenRequestIds = new Set();
    let sawHypothesis = false;
    let sawContradiction = false;

    for (let i = 0; i < OWNER_TURNS.length; i++) {
      transcript += (transcript ? '\n' : '') + 'Owner: ' + OWNER_TURNS[i];

      const res = await fetch(`${base}/api/reason`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: 'discover',
          language: 'English',
          payload: { conversationTranscript: transcript, evidenceOnFile, openGaps: [] },
        }),
      });
      const json = await res.json();

      assert.equal(res.status, 200, `turn ${i + 1} should succeed`);
      assert.equal(json.ok, true, `turn ${i + 1} should return ok:true`);
      assert.ok(Array.isArray(json.data.evidence), `turn ${i + 1} should return an evidence array`);
      assert.ok(!seenRequestIds.has(json.requestId), 'every turn gets a unique request id');
      seenRequestIds.add(json.requestId);

      json.data.evidence.forEach((e) => {
        assert.notEqual(e.evidenceStatus, 'VERIFIED', 'the engine must never self-declare VERIFIED');
        if (e.evidenceStatus === 'HYPOTHESIS') sawHypothesis = true;
      });
      if (json.data.contradictions.length > 0) sawContradiction = true;

      evidenceOnFile = evidenceOnFile.concat(
        json.data.evidence.map((e, idx) => ({ id: `ev_turn${i}_${idx}`, statement: e.normalizedMeaning, layer: e.layer, evidenceStatus: e.evidenceStatus }))
      );
    }

    assert.equal(seenRequestIds.size, OWNER_TURNS.length, 'no request id collisions across a long session');

    // Real content assertions, not just plumbing: over 9 turns covering
    // credit, overdue receivables, an uncertain amount, supplier pressure,
    // and avoided customers, the engine should have surfaced evidence
    // touching each of the layers the scenario actually describes.
    const layersTouched = new Set(evidenceOnFile.map((e) => e.layer));
    assert.ok(layersTouched.has('customer'), 'should recognize customer-related evidence (credit, avoidance)');
    assert.ok(layersTouched.has('finance'), 'should recognize finance-related evidence (overdue receivables, uncertain amount)');
    assert.ok(sawHypothesis, '"I don\u2019t know the exact amount" should produce at least one HYPOTHESIS-status item, not a confident fact');

    const allStatements = evidenceOnFile.map((e) => e.statement.toLowerCase()).join(' | ');
    assert.ok(allStatements.includes('credit'), 'credit should be recognized as a topic somewhere in the session');
    assert.ok(allStatements.includes('overdue') || allStatements.includes('receivable'), 'overdue receivables should be recognized');
  });
});

test('scenario (engineering only): Business Mirror persists growing state across all 9 turns and survives a simulated restart', async () => {
  await withServer(async (base) => {
    const initRes = await fetch(`${base}/api/mirror/init`, { method: 'POST' });
    const { businessId } = await initRes.json();

    let evidence = [];
    for (let i = 0; i < OWNER_TURNS.length; i++) {
      evidence.push({ id: `ev_${i}`, statement: OWNER_TURNS[i] });
      const saveRes = await fetch(`${base}/api/mirror/${businessId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: { evidence, turn: i } }),
      });
      assert.equal(saveRes.status, 200, `save at turn ${i + 1} should succeed`);
    }

    const getRes = await fetch(`${base}/api/mirror/${businessId}`);
    const got = await getRes.json();
    assert.equal(got.state.evidence.length, OWNER_TURNS.length, 'all nine turns of evidence should be present after leaving and returning');
    assert.equal(got.state.turn, OWNER_TURNS.length - 1);
  });
});
