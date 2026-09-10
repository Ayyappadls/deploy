const { AnthropicProvider } = require('./AnthropicProvider');
const { OpenAIProvider } = require('./OpenAIProvider');
const { MockProvider } = require('./MockProvider');
const { ResilientProvider } = require('./ResilientProvider');

/**
 * Remote reasoning is preferred when configured. The local engine remains a
 * deterministic fallback so transient provider failures do not terminate a
 * Discovery session. FORCE_LOCAL is still available for offline testing.
 */
function selectProvider({ anthropicApiKey, openaiApiKey, forceLocal, model, openaiModel }) {
  const local = new MockProvider();
  if (forceLocal) return { provider: local, label: 'local' };

  const resolvedOpenAIKey = openaiApiKey || process.env.OPENAI_API_KEY || '';
  if (resolvedOpenAIKey) {
    const primary = new OpenAIProvider({ apiKey: resolvedOpenAIKey, model: openaiModel || process.env.OPENAI_MODEL || 'gpt-5.6-luna' });
    return { provider: new ResilientProvider(primary, local), label: 'openai+local-fallback' };
  }

  if (anthropicApiKey) {
    const primary = new AnthropicProvider({ apiKey: anthropicApiKey, model });
    return { provider: new ResilientProvider(primary, local), label: 'anthropic+local-fallback' };
  }

  return { provider: local, label: 'local' };
}

module.exports = { selectProvider };
