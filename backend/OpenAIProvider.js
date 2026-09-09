const { ReasoningProvider } = require('./ReasoningProvider');

/**
 * OpenAIProvider — server-side OpenAI Responses API adapter.
 * The API key is read only from the server environment and is never returned
 * to the frontend or logged.
 */
class OpenAIProvider extends ReasoningProvider {
  constructor({ apiKey, model, timeoutMs }) {
    super();
    if (!apiKey) throw new Error('OpenAIProvider requires an API key.');
    this.apiKey = apiKey;
    this.model = model || 'gpt-5.6-luna';
    this.timeoutMs = timeoutMs || 30000;
  }

  async generate({ system, user }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          instructions: system,
          input: user,
          max_output_tokens: 2000,
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
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;

    const text = (data.output || [])
      .flatMap(item => Array.isArray(item.content) ? item.content : [])
      .filter(item => item.type === 'output_text' && typeof item.text === 'string')
      .map(item => item.text)
      .join('\n');

    if (!text.trim()) {
      const e = new Error('Reasoning provider returned no usable text.');
      e.code = 'INVALID_MODEL_RESPONSE';
      throw e;
    }
    return text;
  }
}

module.exports = { OpenAIProvider };
