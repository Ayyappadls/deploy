const { AnthropicProvider } = require('./AnthropicProvider');
const { OpenAIProvider } = require('./OpenAIProvider');
const { MockProvider } = require('./MockProvider');
const { DiscoveryLocalProvider } = require('./DiscoveryLocalProvider');
const { ResilientProvider } = require('./ResilientProvider');

function selectProvider({ anthropicApiKey, openaiApiKey, forceLocal, model, openaiModel }) {
  const baseLocal = new MockProvider();
  const local = new DiscoveryLocalProvider(baseLocal);
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
