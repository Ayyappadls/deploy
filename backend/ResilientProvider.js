const { ReasoningProvider } = require('./ReasoningProvider');

/**
 * Keeps the reasoning path alive when the remote model is temporarily
 * unavailable or rate-limited. The local engine is a deterministic safety
 * net, not a claim of equivalent reasoning quality.
 */
class ResilientProvider extends ReasoningProvider {
  constructor(primary, fallback) {
    super();
    this.primary = primary;
    this.fallback = fallback;
  }

  async generate(input) {
    try {
      return await this.primary.generate(input);
    } catch (err) {
      const retryable = ['PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'RATE_LIMITED'].includes(err.code);
      if (!retryable || !this.fallback) throw err;
      return this.fallback.generate(input);
    }
  }
}

module.exports = { ResilientProvider };
