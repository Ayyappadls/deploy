/**
 * Request-level validation for POST /api/reason.
 *
 * This is distinct from backend/reasoning/schemas.js, which validates what
 * the LLM sends back. This file validates what the *frontend* sends in,
 * before any of it is used to construct a prompt - stage name, language,
 * and size limits on the payload so a runaway conversation or evidence set
 * can't blow up token usage or memory.
 */
const VALID_STAGES = ['discover', 'understand', 'diagnose', 'transition', 'behavior', 'stakeholder', 'learning'];
const MAX_TRANSCRIPT_CHARS = 20000;
const MAX_ARRAY_ITEMS = 60;
const MAX_STRING_FIELD_CHARS = 4000;

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/** Recursively checks that no array in payload exceeds MAX_ARRAY_ITEMS and
 *  no string field exceeds MAX_STRING_FIELD_CHARS. Returns a reason string
 *  if a limit is violated, or null if the payload is within bounds. */
function checkSize(value, path) {
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) return `${path} has too many items (${value.length} > ${MAX_ARRAY_ITEMS})`;
    for (let i = 0; i < value.length; i++) {
      const reason = checkSize(value[i], `${path}[${i}]`);
      if (reason) return reason;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const reason = checkSize(value[key], `${path}.${key}`);
      if (reason) return reason;
    }
    return null;
  }
  // conversationTranscript is checked separately against its own, larger
  // limit (MAX_TRANSCRIPT_CHARS) - skip it here to avoid double-checking
  // the same field against two different limits.
  if (path === 'payload.conversationTranscript') return null;
  if (typeof value === 'string' && value.length > MAX_STRING_FIELD_CHARS) {
    return `${path} is too long (${value.length} chars > ${MAX_STRING_FIELD_CHARS})`;
  }
  return null;
}

/** Returns null if the request is acceptable, or a short reason string if not. */
function validateReasonRequest(body) {
  if (!isPlainObject(body)) return 'request body must be a JSON object';
  const { stage, language, payload } = body;

  if (typeof stage !== 'string' || !VALID_STAGES.includes(stage)) {
    return `stage must be one of: ${VALID_STAGES.join(', ')}`;
  }
  if (language !== undefined && typeof language !== 'string') {
    return 'language must be a string';
  }
  if (!isPlainObject(payload)) {
    return 'payload must be an object';
  }
  if (typeof payload.conversationTranscript === 'string' && payload.conversationTranscript.length > MAX_TRANSCRIPT_CHARS) {
    return `conversationTranscript is too long (> ${MAX_TRANSCRIPT_CHARS} chars) - this conversation has grown larger than DLSMirror expects for a single reasoning call`;
  }
  const sizeReason = checkSize(payload, 'payload');
  if (sizeReason) return sizeReason;

  return null;
}

module.exports = { validateReasonRequest, VALID_STAGES, MAX_TRANSCRIPT_CHARS, MAX_ARRAY_ITEMS, MAX_STRING_FIELD_CHARS };
