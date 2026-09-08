/**
 * ReasoningProvider — abstract base class.
 *
 * DLSMirror's reasoning orchestrator depends only on this interface, never
 * directly on a specific AI vendor. Swapping providers means writing a new
 * subclass, not touching the orchestrator or any reasoning stage.
 */
class ReasoningProvider {
  /**
   * @param {{system: string, user: string}} request
   * @returns {Promise<string>} raw text response from the model (not yet parsed as JSON)
   */
  async generate(request) {
    throw new Error('ReasoningProvider.generate() must be implemented by a subclass.');
  }
}

module.exports = { ReasoningProvider };
