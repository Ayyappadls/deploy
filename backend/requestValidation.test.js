const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReasonRequest, MAX_TRANSCRIPT_CHARS, MAX_ARRAY_ITEMS } = require('../reasoning/requestValidation');

test('accepts a well-formed discover request', () => {
  const reason = validateReasonRequest({ stage: 'discover', language: 'English', payload: { conversationTranscript: 'hi', evidenceOnFile: [], openGaps: [] } });
  assert.equal(reason, null);
});

test('rejects an unknown stage', () => {
  const reason = validateReasonRequest({ stage: 'invent_a_stage', language: 'English', payload: {} });
  assert.notEqual(reason, null);
});

test('rejects a missing payload', () => {
  const reason = validateReasonRequest({ stage: 'discover', language: 'English' });
  assert.notEqual(reason, null);
});

test('rejects a non-string language', () => {
  const reason = validateReasonRequest({ stage: 'discover', language: 42, payload: {} });
  assert.notEqual(reason, null);
});

test('rejects an oversized conversation transcript', () => {
  const huge = 'x'.repeat(MAX_TRANSCRIPT_CHARS + 1);
  const reason = validateReasonRequest({ stage: 'discover', language: 'English', payload: { conversationTranscript: huge, evidenceOnFile: [], openGaps: [] } });
  assert.notEqual(reason, null);
});

test('rejects an oversized evidence array (protects prompt size and token cost)', () => {
  const bigArray = new Array(MAX_ARRAY_ITEMS + 1).fill({ id: 'x' });
  const reason = validateReasonRequest({ stage: 'discover', language: 'English', payload: { conversationTranscript: '', evidenceOnFile: bigArray, openGaps: [] } });
  assert.notEqual(reason, null);
});

test('accepts a request right at the size limits', () => {
  const okArray = new Array(MAX_ARRAY_ITEMS).fill({ id: 'x' });
  const reason = validateReasonRequest({ stage: 'discover', language: 'English', payload: { conversationTranscript: 'x'.repeat(MAX_TRANSCRIPT_CHARS), evidenceOnFile: okArray, openGaps: [] } });
  assert.equal(reason, null);
});
