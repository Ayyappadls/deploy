const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createApp } = require('./server');
const { MockProvider } = require('./MockProvider');
const { DiscoveryLocalProvider } = require('./DiscoveryLocalProvider');
const { createRateLimiter } = require('./rateLimiter');
const { MirrorStore } = require('./store');

/** Boots a real HTTP server on an ephemeral port for the duration of one test. */
async function withServer(opts, fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlsmirror-int-'));
  const app = createApp({
    provider: opts.provider,
    providerLabel: opts.providerLabel || 'mock',
    rateLimit: opts.rateLimit || createRateLimiter({ windowMs: 60000, max: 1000 }),
    store: new MirrorStore({ dataDir }),
    nodeEnv: 'test',
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const STAGES = ['discover', 'understand', 'diagnose', 'transition', 'behavior', 'stakeholder', 'learning'];

test('integration: /api/health reports ok and provider label', async () => {
  await withServer({ provider: new DiscoveryLocalProvider(new MockProvider()), providerLabel: 'mock' }, async (base) => {
    const res = await fetch(`${base}/api/health`);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.provider, 'mock');
  });
});

test('integration: every one of the seven stages returns ok:true through the real HTTP path', async () => {
  await withServer({ provider: new DiscoveryLocalProvider(new MockProvider()), providerLabel: 'mock' }, async (base) => {
    for (const stage of STAGES) {
      const res = await fetch(`${base}/api/reason`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, language: 'English', payload: { conversationTranscript: '', evidenceOnFile: [], openGaps: [], evidence: [], signals: [], relationships: [], pattern: null, diagnosis: null, thesis: null, transition: null, behavior: null, decision: null, observedText: 'x' } }),
      });
      const json = await res.json();
      assert.equal(res.status, 200, `${stage} should return HTTP 200`);
      assert.equal(json.ok, true, `${stage} should return ok:true`);
      assert.ok(json.requestId.startsWith('DLS-'), 'every response carries a request id');
    }
  });
});

test('integration: unsupported stage is rejected with 400 before touching the provider', async () => {
  const provider = new DiscoveryLocalProvider(new MockProvider());
  let called = false;
  const originalGenerate = provider.generate.bind(provider);
  provider.generate = async (...args) => { called = true; return originalGenerate(...args); };

  await withServer({ provider, providerLabel: 'mock' }, async (base) => {
    const res = await fetch(`${base}/api/reason`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'not_a_stage', language: 'English', payload: {} }),
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error.code, 'INVALID_REQUEST');
    assert.equal(called, false, 'the provider must never be called for a request that fails validation');
  });
});

test('integration: no provider configured returns AUTHENTICATION_ERROR, never a secret', async () => {
  await withServer({ provider: null, providerLabel: 'none' }, async (base) => {
    const res = await fetch(`${base}/api/reason`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'discover', language: 'English', payload: { conversationTranscript: '', evidenceOnFile: [], openGaps: [] } }),
    });
    const json = await res.json();
    assert.equal(res.status, 500);
    assert.equal(json.error.code, 'AUTHENTICATION_ERROR');
    assert.ok(!JSON.stringify(json).toLowerCase().includes('key'), 'no mention of an API key in the error response');
  });
});

test('integration: rate limiting returns 429 once the configured max is exceeded', async () => {
  await withServer({ provider: new DiscoveryLocalProvider(new MockProvider()), providerLabel: 'mock', rateLimit: createRateLimiter({ windowMs: 60000, max: 2 }) }, async (base) => {
    const send = () => fetch(`${base}/api/reason`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'discover', language: 'English', payload: { conversationTranscript: '', evidenceOnFile: [], openGaps: [] } }),
    });
    const r1 = await send(); const r2 = await send(); const r3 = await send();
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
    const json3 = await r3.json();
    assert.equal(json3.error.code, 'RATE_LIMITED');
  });
});

test('integration: oversized payload is rejected with INVALID_REQUEST', async () => {
  await withServer({ provider: new DiscoveryLocalProvider(new MockProvider()), providerLabel: 'mock' }, async (base) => {
    const res = await fetch(`${base}/api/reason`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'discover', language: 'English', payload: { conversationTranscript: 'x'.repeat(50000), evidenceOnFile: [], openGaps: [] } }),
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error.code, 'INVALID_REQUEST');
  });
});

test('integration: Business Mirror can be created, saved to, and recovered (leave-and-return)', async () => {
  await withServer({ provider: new DiscoveryLocalProvider(new MockProvider()), providerLabel: 'mock' }, async (base) => {
    const initRes = await fetch(`${base}/api/mirror/init`, { method: 'POST' });
    const init = await initRes.json();
    assert.equal(initRes.status, 201);
    assert.ok(init.businessId);
    assert.ok(init.mirrorId);

    const fakeState = { evidence: [{ id: 'ev_1', statement: 'hardware business, tight cash' }], signals: [] };
    const saveRes = await fetch(`${base}/api/mirror/${init.businessId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: fakeState }),
    });
    assert.equal(saveRes.status, 200);

    // Simulate the owner closing the browser and coming back later.
    const getRes = await fetch(`${base}/api/mirror/${init.businessId}`);
    const got = await getRes.json();
    assert.equal(getRes.status, 200);
    assert.deepEqual(got.state, fakeState, 'the Business Mirror must be recoverable exactly as it was left');
  });
});

test('integration: an unknown businessId returns 404, never someone else\'s data', async () => {
  await withServer({ provider: new DiscoveryLocalProvider(new MockProvider()), providerLabel: 'mock' }, async (base) => {
    const res = await fetch(`${base}/api/mirror/biz_does_not_exist`);
    assert.equal(res.status, 404);
  });
});
