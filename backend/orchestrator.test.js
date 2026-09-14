const test = require('node:test');
const assert = require('node:assert/strict');
const { reason } = require('./orchestrator');
const { FixedProvider, RepairsOnRetryProvider, ThrowingProvider, FailsOnceThenSucceedsProvider } = require('./fakeProviders');

// NOTE: these tests exercise the generic buildRequest -> validate -> retry
// path in orchestrator.js. 'discover' does NOT go through that path at all
// (it's routed entirely to discoveryEngine.runDiscoveryPipeline, which has
// its own tests) - it never did, even before recent changes. 'understand'
// is used here as a representative stage that genuinely exercises the
// shared retry/validation machinery these tests are actually about.
const VALID_UNDERSTAND_JSON = JSON.stringify({
  relationships: [],
  pattern: { statement: 'p' },
});

test('reason(): valid provider output passes straight through', async () => {
  const provider = new FixedProvider(VALID_UNDERSTAND_JSON);
  const result = await reason('understand', 'English', { evidence: [], signals: [] }, provider);
  assert.equal(result.ok, true);
  assert.equal(provider.callCount, 1, 'no retry needed for a valid response');
});

test('reason(): unknown stage is rejected without calling the provider', async () => {
  const provider = new FixedProvider(VALID_UNDERSTAND_JSON);
  const result = await reason('not_a_real_stage', 'English', {}, provider);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_REQUEST');
  assert.equal(provider.callCount, 0, 'the provider should never be called for an unknown stage');
});

test('reason(): malformed JSON triggers exactly one repair retry, then succeeds if the retry is valid', async () => {
  const provider = new RepairsOnRetryProvider('not json at all {{{', VALID_UNDERSTAND_JSON);
  const result = await reason('understand', 'English', { evidence: [], signals: [] }, provider);
  assert.equal(result.ok, true);
  assert.equal(provider.callCount, 2, 'exactly one repair retry should have been attempted');
});

test('reason(): malformed JSON on both attempts returns SCHEMA_VALIDATION_FAILED, never corrupts state', async () => {
  const provider = new FixedProvider('still not json {{{');
  const result = await reason('understand', 'English', { evidence: [], signals: [] }, provider);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(result.data, undefined, 'no data field should be present on a failed result');
});

test('reason(): schema-invalid JSON (valid JSON, wrong shape) also triggers repair retry then fails cleanly', async () => {
  const provider = new FixedProvider(JSON.stringify({ relationships: [] })); // missing required 'pattern'
  const result = await reason('understand', 'English', { evidence: [], signals: [] }, provider);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(provider.callCount, 2, 'a retry should have been attempted before giving up');
});

test('reason(): a relationship the model tries to mark supported with only one evidence id is rejected', async () => {
  const provider = new FixedProvider(JSON.stringify({
    relationships: [{ signalAId: 's1', signalBId: 's2', relationship: 'x', type: 'CAUSES', supportingEvidenceIds: ['e1'] }],
    pattern: { statement: 'p' },
  }));
  const result = await reason('understand', 'English', { evidence: [], signals: [] }, provider);
  assert.equal(result.ok, false, 'a relationship needs at least two supporting evidence ids, by design');
});

test('reason(): a transient provider failure (PROVIDER_UNAVAILABLE) is retried once and can recover', async () => {
  const provider = new FailsOnceThenSucceedsProvider('PROVIDER_UNAVAILABLE', VALID_UNDERSTAND_JSON);
  const result = await reason('understand', 'English', { evidence: [], signals: [] }, provider);
  assert.equal(result.ok, true);
  assert.equal(provider.callCount, 2);
});

test('reason(): a persistent provider failure surfaces as a structured error, never a stack trace', async () => {
  const provider = new ThrowingProvider('PROVIDER_UNAVAILABLE');
  const result = await reason('understand', 'English', { evidence: [], signals: [] }, provider);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(typeof result.error.message, 'string');
  assert.ok(!JSON.stringify(result).includes('injected failure'), 'internal error detail must not leak to the caller');
});

test('reason(): AUTHENTICATION_ERROR is not retried at the transient-failure path', async () => {
  const provider = new ThrowingProvider('AUTHENTICATION_ERROR');
  const result = await reason('understand', 'English', { evidence: [], signals: [] }, provider);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTHENTICATION_ERROR');
  assert.equal(provider.callCount, 1, 'auth errors should not trigger the transient-failure retry');
});

test('discover: routes entirely through discoveryEngine, never through buildRequest/validate', async () => {
  const provider = new FixedProvider(JSON.stringify({ evidence: [], signals: [], knowledge_gaps: [], contradictions: [] }));
  const result = await reason('discover', 'English', { conversationTranscript: 'Owner: hello', evidenceOnFile: [] }, provider);
  assert.equal(result.ok, true);
  assert.ok(result.data.discoveryState, 'discover responses always carry the deterministic discoveryState');
});
