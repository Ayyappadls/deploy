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

function extractPriorQuestions(transcript) {
  return (transcript || '').split(/\r?\n/)
    .filter(line => /^DLSMirror:\s*/i.test(line))
    .map(line => line.replace(/^DLSMirror:\s*/i, '').trim())
    .filter(Boolean);
}

function normalizeQuestion(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionIsRepeat(nextQuestion, priorQuestions) {
  const next = normalizeQuestion(nextQuestion);
  if (!next) return true;
  return priorQuestions.some(q => {
    const prior = normalizeQuestion(q);
    if (!prior) return false;
    if (next === prior) return true;
    // Catch close rephrasings in the same language without adding another model call.
    const a = new Set(next.split(' ').filter(w => w.length > 2));
    const b = new Set(prior.split(' ').filter(w => w.length > 2));
    if (!a.size || !b.size) return false;
    let intersection = 0;
    a.forEach(w => { if (b.has(w)) intersection++; });
    const union = new Set([...a, ...b]).size;
    const jaccard = intersection / union;
    const containment = intersection / Math.min(a.size, b.size);
    return jaccard >= 0.72 || containment >= 0.88;
  });
}

/** Builds {system, user} for a given stage from the frontend-supplied payload. */
function buildRequest(stage, language, payload) {
  const pre = prompts.sysPreamble(language);
  switch (stage) {
    case 'discover': {
      const priorQuestions = extractPriorQuestions(payload.conversationTranscript || '');
      const latestQuestion = priorQuestions.length ? priorQuestions[priorQuestions.length - 1] : '';
      const system = pre + prompts.DISCOVERY_INSTRUCTIONS;
      const user = `Conversation so far:\n${payload.conversationTranscript || ''}\n\nEvidence already on file:\n${JSON.stringify(payload.evidenceOnFile || [])}\n\nOpen knowledge gaps:\n${JSON.stringify(payload.openGaps || [])}\n\nDiscovery progression state:\nThe latest owner message is the answer to the immediately preceding DLSMirror question. The immediately preceding question was: ${JSON.stringify(latestQuestion)}. Do not ask it again. These are all prior DLSMirror questions and are forbidden to repeat or semantically restate:\n${JSON.stringify(priorQuestions)}`;
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

  // Discovery has an additional application-side progression guard.
  // The model may propose reasoning, but it cannot silently re-ask an owner question.
  if (stage === 'discover' && parsed.next_question && parsed.next_question.text) {
    const priorQuestions = extractPriorQuestions(payload.conversationTranscript || '');
    if (questionIsRepeat(parsed.next_question.text, priorQuestions)) {
      try {
        const correctionUser = user + `\n\nPROGRESSION VALIDATION FAILED: your proposed next_question repeats or closely restates a previous DLSMirror question. Do not repeat it. Choose a materially different missing fact, business layer, relationship, contradiction, or decision-relevant unknown. Return the complete JSON object again, with a genuinely new next_question in ${language}.`;
        raw = await provider.generate({ system, user: correctionUser });
        parsed = parseJsonLoose(raw);
        reason_ = parsed ? validate(stage, parsed) : 'could not parse a JSON object from the progression correction response';
        if (reason_) {
          return { ok: false, error: { code: 'SCHEMA_VALIDATION_FAILED', message: 'DLSMirror could not validate the reasoning result.' } };
        }
        if (parsed.next_question && questionIsRepeat(parsed.next_question.text, priorQuestions)) {
          // Do not expose another repeated question. A null question lets the app
          // continue evaluating sufficiency instead of trapping the owner in a loop.
          parsed.next_question = null;
        }
      } catch (err) {
        return { ok: false, error: { code: err.code || 'PROVIDER_UNAVAILABLE', message: 'DLSMirror reasoning is temporarily unavailable.' } };
      }
    }
  }

  return { ok: true, data: parsed };
}

module.exports = { reason, buildRequest, parseJsonLoose, extractPriorQuestions, questionIsRepeat };
