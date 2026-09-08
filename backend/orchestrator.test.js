const test = require('node:test');
const assert = require('node:assert/strict');
const { reason } = require('../reasoning/orchestrator');
const { FixedProvider, RepairsOnRetryProvider, ThrowingProvider, FailsOnceThenSucceedsProvider } = require('./fakeProviders');

const VALID_DISCOVER_JSON = JSON.stringify({
  contradictions: [], evidence: [], signals: [], knowledge_gaps: [],
  next_question: { text: 'q', why: 'w', replies: ['a', 'b', 'c'] },
});

test('reason(): valid provider output passes straight through', async () => {
  const provider = new FixedProvider(VALID_DISCOVER_JSON);
  const result = await reason('discover', 'English', { conversationTranscript: '', evidenceOnFile: [], openGaps: [] }, provider);
  assert.equal(result.ok, true);
  assert.equal(provider.callCount, 1, 'no retry needed for a valid response');
});

test('reason(): unknown stage is rejected without calling the provider', async () => {
  const provider = new FixedProvider(VALID_DISCOVER_JSON);
  const result = await reason('not_a_real_stage', 'English', {}, provider);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_REQUEST');
  assert.equal(provider.callCount, 0, 'the provider should never be called for an unknown stage');
});

test('reason(): malformed JSON triggers exactly one repair retry, then succeeds if the retry is valid', async () => {
  const provider = new RepairsOnRetryProvider('not json at all {{{', VALID_DISCOVER_JSON);
  const result = await reason('discover', 'English', { conversationTranscript: '', evidenceOnFile: [], openGaps: [] }, provider);
  assert.equal(result.ok, true);
  assert.equal(provider.callCount, 2, 'exactly one repair retry should have been attempted');
});

test('reason(): malformed JSON on both attempts returns SCHEMA_VALIDATION_FAILED, never corrupts state', async () => {
  const provider = new FixedProvider('still not json {{{');
  const result = await reason('discover', 'English', { conversationTranscript: '', evidenceOnFile: [], openGaps: [] }, provider);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(result.data, undefined, 'no data field should be present on a failed result');
});

test('reason(): schema-invalid JSON (valid JSON, wrong shape) also triggers repair retry then fails cleanly', async () => {
  const provider = new FixedProvider(JSON.stringify({ evidence: [], signals: [] })); // missing required fields
  const result = await reason('discover', 'English', { conversationTranscript: '', evidenceOnFile: [], openGaps: [] }, provider);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(provider.callCount, 2, 'a retry should have been attempted before giving up');
});

test('reason(): the model can never sneak VERIFIED past validation', async () => {
  const provider = new FixedProvider(JSON.stringify({
    contradictions: [], evidence: [{ normalizedMeaning: 'x', layer: 'revenue', evidenceStatus: 'VERIFIED' }],
    signals: [], knowledge_gaps: [], next_question: null,
  }));
  const result = await reason('discover', 'English', { conversationTranscript: '', evidenceOnFile: [], openGaps: [] }, provider);
  assert.equal(result.ok, false, 'VERIFIED is not in the allowed evidenceStatus enum for model output, by design');
});

test('reason(): a transient provider failure (PROVIDER_UNAVAILABLE) is retried once and can recover', async () => {
  const provider = new FailsOnceThenSucceedsProvider('PROVIDER_UNAVAILABLE', VALID_DISCOVER_JSON);
  const result = await reason('discover', 'English', { conversationTranscript: '', evidenceOnFile: [], openGaps: [] }, provider);
  assert.equal(result.ok, true);
  assert.equal(provider.callCount, 2);
});

test('reason(): a persistent provider failure surfaces as a structured error, never a stack trace', async () => {
  const provider = new ThrowingProvider('PROVIDER_UNAVAILABLE');
  const result = await reason('discover', 'English', { conversationTranscript: '', evidenceOnFile: [], openGaps: [] }, provider);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(typeof result.error.message, 'string');
  assert.ok(!JSON.stringify(result).includes('injected failure'), 'internal error detail must not leak to the caller');
});

test('reason(): AUTHENTICATION_ERROR is not retried at the transient-failure path', async () => {
  const provider = new ThrowingProvider('AUTHENTICATION_ERROR');
  const result = await reason('discover', 'English', { conversationTranscript: '', evidenceOnFile: [], openGaps: [] }, provider);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTHENTICATION_ERROR');
  assert.equal(provider.callCount, 1, 'auth errors should not trigger the transient-failure retry');
});
