require('dotenv').config();
const express = require('express');
const path = require('path');

const { selectProvider } = require('./providerSelect');
const { reason } = require('./orchestrator');
const { validateReasonRequest } = require('./requestValidation');
const { createRateLimiter } = require('./rateLimiter');
const { logReasoningEvent, genRequestId } = require('./logger');
const { MirrorStore } = require('./store');

function createApp({ provider, providerLabel, rateLimit, store, nodeEnv }) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(express.static(__dirname));

  app.post('/api/mirror/init', (req, res) => {
    const { businessId, mirrorId } = store.createBusiness();
    res.status(201).json({ ok: true, businessId, mirrorId });
  });

  app.get('/api/mirror/:businessId', (req, res) => {
    const record = store.get(req.params.businessId);
    if (!record) {
      return res.status(404).json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'No Business Mirror found for that id.' } });
    }
    res.json({ ok: true, businessId: record.businessId, mirrorId: record.mirrorId, updatedAt: record.updatedAt, state: record.state });
  });

  app.post('/api/mirror/:businessId', (req, res) => {
    const { state } = req.body || {};
    if (typeof state !== 'object' || state === null) {
      return res.status(400).json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'state must be an object.' } });
    }
    const saved = store.save(req.params.businessId, state);
    if (!saved) {
      return res.status(404).json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'No Business Mirror found for that id.' } });
    }
    res.json({ ok: true, businessId: saved.businessId, updatedAt: saved.updatedAt });
  });

  app.post('/api/reason', async (req, res) => {
    const requestId = genRequestId();
    const sessionId = req.headers['x-dls-session-id'] || 'unknown';
    const startedAt = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    const limitResult = rateLimit(ip);
    if (limitResult.limited) {
      logReasoningEvent({ requestId, stage: req.body?.stage, startedAt, success: false, errorCode: 'RATE_LIMITED', provider: providerLabel });
      return res.status(429).json({ ok: false, requestId, error: { code: 'RATE_LIMITED', message: 'DLSMirror is receiving requests faster than it can process them right now. Please wait a moment and try again.' } });
    }

    const invalidReason = validateReasonRequest(req.body);
    if (invalidReason) {
      logReasoningEvent({ requestId, stage: req.body?.stage, startedAt, success: false, errorCode: 'INVALID_REQUEST', provider: providerLabel });
      return res.status(400).json({ ok: false, requestId, error: { code: 'INVALID_REQUEST', message: 'This request is not valid: ' + invalidReason } });
    }

    const { stage, language, payload } = req.body;
    if (!provider) {
      return res.status(500).json({ ok: false, requestId, error: { code: 'AUTHENTICATION_ERROR', message: 'DLSMirror reasoning is not configured on this server.' } });
    }

    try {
      const result = await reason(stage, language || 'English', payload, provider);
      logReasoningEvent({ requestId, sessionId, stage, startedAt, success: result.ok, errorCode: result.ok ? undefined : result.error.code, provider: providerLabel });
      if (!result.ok) {
        const statusMap = { SCHEMA_VALIDATION_FAILED: 502, INVALID_MODEL_RESPONSE: 502, PROVIDER_UNAVAILABLE: 503, PROVIDER_TIMEOUT: 504, RATE_LIMITED: 429, AUTHENTICATION_ERROR: 500, INVALID_REQUEST: 400 };
        return res.status(statusMap[result.error.code] || 500).json({ ok: false, requestId, error: result.error });
      }
      return res.status(200).json({ ok: true, requestId, data: result.data });
    } catch (err) {
      logReasoningEvent({ requestId, sessionId, stage, startedAt, success: false, errorCode: 'INTERNAL_ERROR', provider: providerLabel });
      return res.status(500).json({ ok: false, requestId, error: { code: 'INTERNAL_ERROR', message: 'DLSMirror reasoning is temporarily unavailable.' } });
    }
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, env: nodeEnv, provider: providerLabel }));
  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const PORT = process.env.PORT || 8787;
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
  const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000);
  const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  const forceLocal = process.env.MOCK_MODE === 'true' || process.env.FORCE_LOCAL === 'true');

  const { provider, label: providerLabel } = selectProvider({ anthropicApiKey: ANTHROPIC_API_KEY, forceLocal, model: ANTHROPIC_MODEL });
  const rateLimit = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });
  const store = new MirrorStore({ dataDir: DATA_DIR });
  const app = createApp({ provider, providerLabel, rateLimit, store, nodeEnv: NODE_ENV });
  app.listen(PORT, '0.0.0.0', () => console.log(`DLSMirror backend listening on port ${PORT} (env=${NODE_ENV}, provider=${providerLabel}, data=${DATA_DIR})`));
}
