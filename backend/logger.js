/**
 * Minimal structured logging for observability.
 *
 * Deliberately logs only metadata (requestId, stage, timing, outcome) -
 * never the owner's conversation content, never request/response bodies,
 * and never any credential.
 */
function logReasoningEvent({ requestId, stage, startedAt, success, errorCode, provider }) {
  const latencyMs = Date.now() - startedAt;
  const line = {
    requestId,
    stage,
    provider,
    success,
    errorCode: errorCode || undefined,
    latencyMs,
    timestamp: new Date().toISOString(),
  };
  // eslint-disable-next-line no-console
  console.log('[dlsmirror:reason]', JSON.stringify(line));
}

function genRequestId() {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `DLS-${year}-${rand}`;
}

module.exports = { logReasoningEvent, genRequestId };
