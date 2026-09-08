const { ReasoningProvider } = require('./ReasoningProvider');

/**
 * AnthropicProvider — the only file in this codebase that reads the
 * Anthropic API key from the environment, or talks to api.anthropic.com.
 *
 * The key never leaves this process. It is never returned to the frontend,
 * never logged, and never included in error responses.
 */
class AnthropicProvider extends ReasoningProvider {
  constructor({ apiKey, model, timeoutMs }) {
    super();
    if (!apiKey) {
      throw new Error('AnthropicProvider requires an API key.');
    }
    this.apiKey = apiKey;
    this.model = model || 'claude-sonnet-4-6';
    this.timeoutMs = timeoutMs || 20000;
  }

  async generate({ system, user }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1000,
          system,
          messages: [{ role: 'user', content: user }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        const e = new Error('Reasoning provider timed out.');
        e.code = 'PROVIDER_TIMEOUT';
        throw e;
      }
      const e = new Error('Reasoning provider unreachable.');
      e.code = 'PROVIDER_UNAVAILABLE';
      throw e;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      const e = new Error('Reasoning provider rejected the request credentials.');
      e.code = 'AUTHENTICATION_ERROR';
      throw e;
    }
    if (response.status === 429) {
      const e = new Error('Reasoning provider is rate limiting this server.');
      e.code = 'RATE_LIMITED';
      throw e;
    }
    if (!response.ok) {
      const e = new Error('Reasoning provider returned an error.');
      e.code = 'PROVIDER_UNAVAILABLE';
      throw e;
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return text;
  }
}

module.exports = { AnthropicProvider };
