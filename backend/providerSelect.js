const { AnthropicProvider } = require('./AnthropicProvider');
const { OpenAIProvider } = require('./OpenAIProvider');
const { MockProvider } = require('./MockProvider');

/**
 * Provider priority:
 * 1. FORCE_LOCAL / MOCK_MODE -> deterministic local engine
 * 2. OPENAI_API_KEY -> real OpenAI reasoning
 * 3. ANTHROPIC_API_KEY -> real Claude reasoning
 * 4. otherwise -> deterministic local engine
 */
function selectProvider({ anthropicApiKey, openaiApiKey, forceLocal, model, openaiModel }) {
  if (forceLocal) return { provider: new MockProvider(), label: 'local' };
  if (openaiApiKey) return { provider: new OpenAIProvider({ apiKey: openaiApiKey, model: openaiModel }), label: 'openai' };
  if (anthropicApiKey) return { provider: new AnthropicProvider({ apiKey: anthropicApiKey, model }), label: 'anthropic' };
  return { provider: new MockProvider(), label: 'local' };
}

module.exports = { selectProvider };
