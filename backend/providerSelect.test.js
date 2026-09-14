const test = require('node:test');
const assert = require('node:assert/strict');
const { selectProvider } = require('./providerSelect');
const { MockProvider } = require('./MockProvider');
const { AnthropicProvider } = require('./AnthropicProvider');
const { DiscoveryLocalProvider } = require('./DiscoveryLocalProvider');
const { ResilientProvider } = require('./ResilientProvider');

test('selectProvider: no key, no force -> Local Reasoning Engine automatically, never throws', () => {
  const { provider, label } = selectProvider({ anthropicApiKey: '', forceLocal: false, model: 'x' });
  assert.equal(label, 'local');
  assert.ok(provider instanceof DiscoveryLocalProvider);
  assert.ok(provider.delegate instanceof MockProvider);
});

test('selectProvider: undefined key (as if .env was never created) -> still Local, no crash', () => {
  const { provider, label } = selectProvider({ anthropicApiKey: undefined, forceLocal: false, model: 'x' });
  assert.equal(label, 'local');
  assert.ok(provider instanceof DiscoveryLocalProvider);
});

test('selectProvider: real key present -> AnthropicProvider is used, with a local fallback', () => {
  const { provider, label } = selectProvider({ anthropicApiKey: 'sk-ant-fake-for-test', forceLocal: false, model: 'claude-sonnet-4-6' });
  assert.equal(label, 'anthropic+local-fallback');
  assert.ok(provider instanceof ResilientProvider);
  assert.ok(provider.primary instanceof AnthropicProvider);
  assert.ok(provider.fallback instanceof DiscoveryLocalProvider);
});

test('selectProvider: forceLocal overrides a present key', () => {
  const { provider, label } = selectProvider({ anthropicApiKey: 'sk-ant-fake-for-test', forceLocal: true, model: 'x' });
  assert.equal(label, 'local');
  assert.ok(provider instanceof DiscoveryLocalProvider);
});
