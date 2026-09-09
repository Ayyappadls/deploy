const { AnthropicProvider } = require('./AnthropicProvider');
const { OpenAIProvider } = require('./OpenAIProvider');
const { MockProvider } = require('./MockProvider');

/**
 * Provider priority:
 * 1. FORCE_LOCAL / MOCK_MODE -> deterministic local engine
 * 2. OPENAI_API_KEY -> real OpenAI reasoning
 * 3. ANTHROPIC_API_KEY -> real Claude reasoning
 * 4. otherwise -> deterministic local engine
 *
 * OPENAI_API_KEY is read server-side so the existing server bootstrap does
 * not need to expose or pass the secret through application state.
 */
function selectProvider({ anthropicApiKey, openaiApiKey, forceLocal, model, openaiModel }) {
  if (forceLocal) return { provider: new MockProvider(), label: 'local' };

  const resolvedOpenAIKey = openaiApiKey || process.env.OPENAI_API_KEY || '';
  if (resolvedOpenAIKey) {
    return {
      provider: new OpenAIProvider({
        apiKey: resolvedOpenAIKey,
        model: openaiModel || process.env.OPENAI_MODEL || 'gpt-5.6-luna'
      }),
      label: 'openai'
    };
  }

  if (anthropicApiKey) return { provider: new AnthropicProvider({ apiKey: anthropicApiKey, model }), label: 'anthropic' };
  return { provider: new MockProvider(), label: 'local' };
}

module.exports = { selectProvider };
