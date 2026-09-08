const { ReasoningProvider } = require('../providers/ReasoningProvider');

/** Always returns the given (already-JSON-stringified) response. */
class FixedProvider extends ReasoningProvider {
  constructor(responseText) {
    super();
    this.responseText = responseText;
    this.callCount = 0;
  }
  async generate() {
    this.callCount++;
    return this.responseText;
  }
}

/** Returns malformed JSON on the first call, valid JSON on the second - used
 *  to test the orchestrator's one-retry-then-fail behavior. */
class RepairsOnRetryProvider extends ReasoningProvider {
  constructor(badText, goodText) {
    super();
    this.badText = badText;
    this.goodText = goodText;
    this.callCount = 0;
  }
  async generate() {
    this.callCount++;
    return this.callCount === 1 ? this.badText : this.goodText;
  }
}

/** Always throws a provider-level error with the given code - used to test
 *  the retry-once-on-transient-failure path and the no-retry-on-auth path. */
class ThrowingProvider extends ReasoningProvider {
  constructor(code) {
    super();
    this.code = code;
    this.callCount = 0;
  }
  async generate() {
    this.callCount++;
    const e = new Error('injected failure: ' + this.code);
    e.code = this.code;
    throw e;
  }
}

/** Fails once (transient), then succeeds - used to prove the controlled
 *  retry actually recovers a temporary provider failure. */
class FailsOnceThenSucceedsProvider extends ReasoningProvider {
  constructor(code, goodText) {
    super();
    this.code = code;
    this.goodText = goodText;
    this.callCount = 0;
  }
  async generate() {
    this.callCount++;
    if (this.callCount === 1) {
      const e = new Error('injected transient failure');
      e.code = this.code;
      throw e;
    }
    return this.goodText;
  }
}

module.exports = { FixedProvider, RepairsOnRetryProvider, ThrowingProvider, FailsOnceThenSucceedsProvider };
