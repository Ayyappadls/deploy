const prompts = require('./prompts');
const { validate } = require('./schemas');

function parseJsonLoose(text) {
  let cleaned = (text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (e) { /* fall through */ }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (e) { /* fall through */ }
  }
  return null;
}

/** Builds {system, user} for a given stage from the frontend-supplied payload. */
function buildRequest(stage, language, payload) {
  const pre = prompts.sysPreamble(language);
  switch (stage) {
    case 'discover': {
      const system = pre + prompts.DISCOVERY_INSTRUCTIONS;
      const user = `Conversation so far:\n${payload.conversationTranscript || ''}\n\nEvidence already on file:\n${JSON.stringify(payload.evidenceOnFile || [])}\n\nOpen knowledge gaps:\n${JSON.stringify(payload.openGaps || [])}`;
      return { system, user };
    }
    case 'understand': {
      const system = pre + prompts.UNDERSTAND_INSTRUCTIONS;
      const user = `Evidence:\n${JSON.stringify(payload.evidence || [])}\n\nSignals:\n${JSON.stringify(payload.signals || [])}`;
      return { system, user };
    }
    case 'diagnose': {
      const system = pre + prompts.DIAGNOSE_INSTRUCTIONS;
      const user = `Evidence:\n${JSON.stringify(payload.evidence || [])}\n\nRelationships:\n${JSON.stringify(payload.relationships || [])}\n\nPattern:\n${JSON.stringify(payload.pattern || null)}`;
      return { system, user };
    }
    case 'transition': {
      const system = pre + prompts.TRANSITION_INSTRUCTIONS;
      const user = `Diagnosis:\n${JSON.stringify(payload.diagnosis || null)}\n\nCommercial thesis:\n${JSON.stringify(payload.thesis || null)}`;
      return { system, user };
    }
    case 'behavior': {
      const system = pre + prompts.BEHAVIOR_INSTRUCTIONS;
      const user = `Diagnosis:\n${JSON.stringify(payload.diagnosis || null)}\n\nTransition:\n${JSON.stringify(payload.transition || null)}`;
      return { system, user };
    }
    case 'stakeholder': {
      const system = pre + prompts.STAKEHOLDER_INSTRUCTIONS;
      const user = `Diagnosis:\n${JSON.stringify(payload.diagnosis || null)}\n\nTransition:\n${JSON.stringify(payload.transition || null)}\n\nBehavior change:\n${JSON.stringify(payload.behavior || null)}`;
      return { system, user };
    }
    case 'learning': {
      const system = pre + prompts.LEARNING_INSTRUCTIONS;
      const user = `Decision on file:\n${JSON.stringify(payload.decision || null)}\n\nWhat the owner reports actually happened:\n${payload.observedText || ''}`;
      return { system, user };
    }
    default:
      return null;
  }
}

async function callWithRetry(provider, system, user) {
  try {
    return await provider.generate({ system, user });
  } catch (err) {
    // one controlled retry for transient provider failures only
    if (err.code === 'PROVIDER_UNAVAILABLE' || err.code === 'PROVIDER_TIMEOUT') {
      await new Promise((r) => setTimeout(r, 400));
      return await provider.generate({ system, user });
    }
    throw err;
  }
}

/**
 * The core propose -> validate -> decide pipeline.
 * Returns {ok:true, data} or {ok:false, error:{code, message}}.
 * Never returns raw, unvalidated model output.
 */
async function reason(stage, language, payload, provider) {
  const built = buildRequest(stage, language, payload);
  if (!built) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: `Unknown reasoning stage: ${stage}` } };
  }
  const { system, user } = built;

  let raw;
  try {
    raw = await callWithRetry(provider, system, user);
  } catch (err) {
    const code = err.code || 'PROVIDER_UNAVAILABLE';
    return { ok: false, error: { code, message: 'DLSMirror reasoning is temporarily unavailable.' } };
  }

  let parsed = parseJsonLoose(raw);
  let reason_ = parsed ? validate(stage, parsed) : 'could not parse a JSON object from the response';

  if (reason_) {
    // one retry with an explicit correction nudge before giving up
    try {
      const retryUser = user + `\n\nYour previous response was invalid (${reason_}). Respond again with ONLY a single valid JSON object matching the required schema exactly.`;
      raw = await provider.generate({ system, user: retryUser });
      parsed = parseJsonLoose(raw);
      reason_ = parsed ? validate(stage, parsed) : 'could not parse a JSON object from the retry response';
    } catch (err) {
      return { ok: false, error: { code: err.code || 'PROVIDER_UNAVAILABLE', message: 'DLSMirror reasoning is temporarily unavailable.' } };
    }
  }

  if (reason_) {
    return { ok: false, error: { code: 'SCHEMA_VALIDATION_FAILED', message: 'DLSMirror could not validate the reasoning result.' } };
  }

  return { ok: true, data: parsed };
}

module.exports = { reason, buildRequest, parseJsonLoose };
