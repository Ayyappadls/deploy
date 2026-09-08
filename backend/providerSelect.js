const { AnthropicProvider } = require('./providers/AnthropicProvider');
const { MockProvider } = require('./providers/MockProvider');

/**
 * selectProvider — decides which ReasoningProvider backs /api/reason.
 *
 * Default behavior (no configuration required): if no Anthropic key is
 * present, DLSMirror runs on the local deterministic reasoning engine
 * automatically. It never crashes, never demands a key, and never shows an
 * API-key error just because none was provided — that's the whole point of
 * the no-API-key local build.
 *
 * Setting ANTHROPIC_API_KEY later switches to real Claude reasoning with no
 * other code change. Setting FORCE_LOCAL=true always uses the local engine
 * even if a key is present (useful for demos or cost-free testing).
 */
function selectProvider({ anthropicApiKey, forceLocal, model }) {
  if (forceLocal) {
    return { provider: new MockProvider(), label: 'local' };
  }
  if (anthropicApiKey) {
    return { provider: new AnthropicProvider({ apiKey: anthropicApiKey, model }), label: 'anthropic' };
  }
  return { provider: new MockProvider(), label: 'local' };
}

module.exports = { selectProvider };
