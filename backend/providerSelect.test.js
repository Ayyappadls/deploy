const test = require('node:test');
const assert = require('node:assert/strict');
const { selectProvider } = require('../providerSelect');
const { MockProvider } = require('../providers/MockProvider');
const { AnthropicProvider } = require('../providers/AnthropicProvider');

test('selectProvider: no key, no force -> Local Reasoning Engine automatically, never throws', () => {
  const { provider, label } = selectProvider({ anthropicApiKey: '', forceLocal: false, model: 'x' });
  assert.equal(label, 'local');
  assert.ok(provider instanceof MockProvider);
});

test('selectProvider: undefined key (as if .env was never created) -> still Local, no crash', () => {
  const { provider, label } = selectProvider({ anthropicApiKey: undefined, forceLocal: false, model: 'x' });
  assert.equal(label, 'local');
  assert.ok(provider instanceof MockProvider);
});

test('selectProvider: real key present -> AnthropicProvider is used', () => {
  const { provider, label } = selectProvider({ anthropicApiKey: 'sk-ant-fake-for-test', forceLocal: false, model: 'claude-sonnet-4-6' });
  assert.equal(label, 'anthropic');
  assert.ok(provider instanceof AnthropicProvider);
});

test('selectProvider: forceLocal overrides a present key', () => {
  const { provider, label } = selectProvider({ anthropicApiKey: 'sk-ant-fake-for-test', forceLocal: true, model: 'x' });
  assert.equal(label, 'local');
  assert.ok(provider instanceof MockProvider);
});
