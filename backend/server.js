require('dotenv').config();
const express = require('express');
const path = require('path');

const { selectProvider } = require('./providerSelect');
const { reason } = require('./orchestrator');
const { validateReasonRequest } = require('./requestValidation');
const { createRateLimiter } = require('./rateLimiter');
const { logReasoningEvent, genRequestId } = require('./logger');
const { MirrorStore } = require('./store');

function isNonBusinessGreeting(text) {
  return /^(hi|hii|hiii|hello|hey|heyy|yo|sup|namaste|hola|good morning|good afternoon|good evening)[.!?\s]*$/i.test(String(text || '').trim());
}

function latestOwnerMessage(transcript) {
  const lines = String(transcript || '').split(/\r?\n/).filter(line => /^Owner:\s*/i.test(line));
  return lines.length ? lines[lines.length - 1].replace(/^Owner:\s*/i, '').trim() : '';
}

function greetingDiscoveryResponse(language) {
  const lang = String(language || 'English').toLowerCase();
  const text = lang.includes('telugu') ? 'హాయ్. బిజినెస్‌లో ప్రస్తుతం ఏమి జరుగుతుందో మీ మాటల్లో చెప్పండి. ఎక్కడి నుంచైనా మొదలుపెట్టవచ్చు.'
    : lang.includes('hindi') ? 'हाय। अभी बिज़नेस में क्या हो रहा है, अपने शब्दों में बताइए। आप कहीं से भी शुरू कर सकते हैं।'
    : lang.includes('tamil') ? 'ஹாய். இப்போது business-ல் என்ன நடக்கிறது என்பதை உங்கள் சொற்களில் சொல்லுங்கள். எங்கிருந்தும் தொடங்கலாம்.'
    : lang.includes('kannada') ? 'ಹಾಯ್. ಈಗ business ನಲ್ಲಿ ಏನು ನಡೆಯುತ್ತಿದೆ ಎಂಬುದನ್ನು ನಿಮ್ಮದೇ ಮಾತಿನಲ್ಲಿ ಹೇಳಿ. ಎಲ್ಲಿಂದ ಬೇಕಾದರೂ ಆರಂಭಿಸಬಹುದು.'
    : lang.includes('malayalam') ? 'ഹായ്. ഇപ്പോൾ business-ൽ എന്താണ് നടക്കുന്നത് എന്ന് നിങ്ങളുടെ വാക്കുകളിൽ പറയൂ. എവിടെ നിന്നുമെങ്കിലും തുടങ്ങാം.'
    : lang.includes('marathi') ? 'हाय. सध्या व्यवसायात काय चालले आहे ते तुमच्या शब्दांत सांगा. कुठूनही सुरुवात करू शकता.'
    : lang.includes('gujarati') ? 'હાય. હાલમાં બિઝનેસમાં શું ચાલી રહ્યું છે તે તમારા શબ્દોમાં કહો. તમે ક્યાંથી પણ શરૂઆત કરી શકો છો.'
    : 'Hi. Tell me what is happening in the business, in your own words. You can start anywhere.';
  return { contradictions: [], evidence: [], signals: [], knowledge_gaps: [], next_question: { text, why: 'I need actual business context before I can responsibly explore what matters.', replies: [] } };
}

function normalizeQuestion(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function genericCashQuestion(text) {
  const q = normalizeQuestion(text);
  return q.includes('anything else about how customers pay you') || q.includes('how the money moves through the business') || q.includes('how customers pay you') || q.includes('money moves through the business');
}

// A correction is a first-class Discovery event. If the owner says the system
// has the business type wrong, do not let stale domain assumptions survive.
function businessRealityCorrection(text) {
  const lower = String(text || '').toLowerCase();
  return /\b(not|isn't|isnt|actually|rather)\b.{0,50}\b(restaurant|cafe|hotel|business type)\b/.test(lower)
    || /\b(not a|not an)\s+(restaurant|cafe|hotel|shop|store)\b/.test(lower)
    || /\b(i('| a)?m|we('| a)?re)\b.{0,25}\b(running|run|own)\b.{0,25}\b(fruit|fruits|grocery|wholesale|distributor|manufacturing|service)\b/.test(lower);
}

function correctionDiscoveryResponse(data, payload) {
  const owner = latestOwnerMessage(payload?.conversationTranscript);
  if (!businessRealityCorrection(owner)) return data;
  return {
    ...data,
    contradictions: [{
      existingEvidenceId: null,
      statementA: 'The earlier reasoning assumed a different business type.',
      statementB: owner,
      note: 'The owner has corrected the business context, so reasoning that depended on the earlier assumption must not be treated as established.'
    }],
    evidence: [{
      key: 'business-correction',
      originalStatement: owner,
      normalizedMeaning: 'The owner has explicitly corrected or clarified the business context.',
      layer: 'owner',
      evidenceStatus: 'OWNER-PROVIDED',
      verificationQuestion: ''
    }],
    signals: [],
    knowledge_gaps: [{
      question: 'What do you actually sell or provide, and how do customers usually buy from you?',
      missingInformation: 'The actual business model and customer transaction flow need to be grounded before continuing discovery.',
      importance: 'high', diagnosticImpact: 'high', decisionImpact: 'high', relationshipImpact: 'high', relatedLayer: 'offer'
    }],
    next_question: {
      text: 'Thanks — I had the business context wrong. What do you actually sell or provide, and how do customers usually buy from you?',
      why: 'Your correction invalidates the earlier business assumption. I should re-anchor the Business Reality before drawing conclusions or asking a more specific question.',
      replies: ['I sell products', 'I provide a service', 'It is a mix of both']
    }
  };
}

function replaceStaleLocalDiscoveryQuestion(data, payload, language) {
  if (!data?.next_question || !genericCashQuestion(data.next_question.text)) return data;
  const transcript = String(payload?.conversationTranscript || '');
  const owner = latestOwnerMessage(transcript).toLowerCase();
  const businessSignal = /restaurant|cafe|shop|store|retail|food|menu|dish|item|customer|customers|sales|revenue|weekend|busy/.test(owner);
  const cashSignal = /(cash|money).{0,120}(low|little|not much|left|short)/.test(owner);
  if (!businessSignal && !cashSignal) return data;
  const askedLines = transcript.split(/\r?\n/).filter(line => /^DLSMirror:\s*/i.test(line));
  const alreadyAskedCost = askedLines.some(line => /(biggest costs|ingredient|staff cost|rent|delivery fees)/i.test(line));
  const candidate = /restaurant|cafe|food|menu|dish|item/.test(owner)
    ? 'Which items sell the most on weekends, and do you know which of those actually leave the most money after ingredient cost?'
    : 'When the business is busy, what usually takes the biggest share of the money coming in?';
  if (alreadyAskedCost && transcript.toLowerCase().includes(normalizeQuestion(candidate).slice(0, 40))) return data;
  data.next_question = { text: candidate, why: 'You have now told me that busy days bring higher costs, but we still do not know whether the items driving sales are also the ones creating enough margin.', replies: ['I know roughly', "I'd need to check", "I don't track that"] };
  return data;
}

function createApp({ provider, providerLabel, rateLimit, store, nodeEnv }) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(express.static(__dirname));
  app.post('/api/mirror/init', (req, res) => { const { businessId, mirrorId } = store.createBusiness(); res.status(201).json({ ok: true, businessId, mirrorId }); });
  app.get('/api/mirror/:businessId', (req, res) => { const record = store.get(req.params.businessId); if (!record) return res.status(404).json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'No Business Mirror found for that id.' } }); res.json({ ok: true, businessId: record.businessId, mirrorId: record.mirrorId, updatedAt: record.updatedAt, state: record.state }); });
  app.post('/api/mirror/:businessId', (req, res) => { const { state } = req.body || {}; if (typeof state !== 'object' || state === null) return res.status(400).json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'state must be an object.' } }); const saved = store.save(req.params.businessId, state); if (!saved) return res.status(404).json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'No Business Mirror found for that id.' } }); res.json({ ok: true, businessId: saved.businessId, updatedAt: saved.updatedAt }); });
  app.post('/api/reason', async (req, res) => {
    const requestId = genRequestId(); const sessionId = req.headers['x-dls-session-id'] || 'unknown'; const startedAt = Date.now(); const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const limitResult = rateLimit(ip); if (limitResult.limited) return res.status(429).json({ ok: false, requestId, error: { code: 'RATE_LIMITED', message: 'DLSMirror is receiving requests faster than it can process them right now. Please wait a moment and try again.' } });
    const invalidReason = validateReasonRequest(req.body); if (invalidReason) return res.status(400).json({ ok: false, requestId, error: { code: 'INVALID_REQUEST', message: 'This request is not valid: ' + invalidReason } });
    const { stage, language, payload } = req.body; if (!provider) return res.status(500).json({ ok: false, requestId, error: { code: 'AUTHENTICATION_ERROR', message: 'DLSMirror reasoning is not configured on this server.' } });
    if (stage === 'discover' && isNonBusinessGreeting(latestOwnerMessage(payload?.conversationTranscript))) { const data = greetingDiscoveryResponse(language); logReasoningEvent({ requestId, sessionId, stage, startedAt, success: true, provider: 'input-gate' }); return res.status(200).json({ ok: true, requestId, data }); }
    try {
      const result = await reason(stage, language || 'English', payload, provider);
      logReasoningEvent({ requestId, sessionId, stage, startedAt, success: result.ok, errorCode: result.ok ? undefined : result.error.code, provider: providerLabel });
      if (!result.ok) { const statusMap = { SCHEMA_VALIDATION_FAILED: 502, INVALID_MODEL_RESPONSE: 502, PROVIDER_UNAVAILABLE: 503, PROVIDER_TIMEOUT: 504, RATE_LIMITED: 429, AUTHENTICATION_ERROR: 500, INVALID_REQUEST: 400 }; return res.status(statusMap[result.error.code] || 500).json({ ok: false, requestId, error: result.error }); }
      let data = result.data;
      if (stage === 'discover') { data = correctionDiscoveryResponse(data, payload); if (providerLabel === 'local') data = replaceStaleLocalDiscoveryQuestion(data, payload, language); }
      return res.status(200).json({ ok: true, requestId, data });
    } catch (err) { logReasoningEvent({ requestId, sessionId, stage, startedAt, success: false, errorCode: 'INTERNAL_ERROR', provider: providerLabel }); return res.status(500).json({ ok: false, requestId, error: { code: 'INTERNAL_ERROR', message: 'DLSMirror reasoning is temporarily unavailable.' } }); }
  });
  app.get('/api/health', (req, res) => res.json({ ok: true, env: nodeEnv, provider: providerLabel }));
  return app;
}
module.exports = { createApp };
if (require.main === module) {
  const PORT = process.env.PORT || 8787; const NODE_ENV = process.env.NODE_ENV || 'development'; const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''; const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'; const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000); const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60); const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); const forceLocal = process.env.MOCK_MODE === 'true' || process.env.FORCE_LOCAL === 'true'; const { provider, label: providerLabel } = selectProvider({ anthropicApiKey: ANTHROPIC_API_KEY, forceLocal, model: ANTHROPIC_MODEL }); const rateLimit = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX }); const store = new MirrorStore({ dataDir: DATA_DIR }); const app = createApp({ provider, providerLabel, rateLimit, store, nodeEnv: NODE_ENV }); app.listen(PORT, '0.0.0.0', () => console.log(`DLSMirror backend listening on port ${PORT} (env=${NODE_ENV}, provider=${providerLabel}, data=${DATA_DIR})`));
}
