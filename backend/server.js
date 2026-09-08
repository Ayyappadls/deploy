require('dotenv').config();
const express = require('express');
const path = require('path');

const { selectProvider } = require('./providerSelect');
const { reason } = require('./reasoning/orchestrator');
const { validateReasonRequest } = require('./reasoning/requestValidation');
const { createRateLimiter } = require('./rateLimiter');
const { logReasoningEvent, genRequestId } = require('./logger');
const { MirrorStore } = require('./persistence/store');

/**
 * createApp — builds the Express app without starting a listener, so both
 * server.js (real runtime) and the test suite (backend/test/*) can use the
 * exact same app with different injected providers/stores.
 */
function createApp({ provider, providerLabel, rateLimit, store, nodeEnv }) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // Serve the DLSMirror frontend as static files from the same origin.
  app.use(express.static(path.join(__dirname, '..', 'frontend')));

  // ---- Business Mirror identity + persistence ---------------------------
  // Minimal conceptual model: businessId identifies the business, mirrorId
  // identifies this particular Mirror instance for it. One business has one
  // Mirror in this prototype; the ids are kept distinct so a future version
  // could support more than one Mirror per business without a schema change.
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

  // ---- Reasoning gateway --------------------------------------------------
  app.post('/api/reason', async (req, res) => {
    const requestId = genRequestId();
    const sessionId = req.headers['x-dls-session-id'] || 'unknown';
    const startedAt = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    const limitResult = rateLimit(ip);
    if (limitResult.limited) {
      logReasoningEvent({ requestId, stage: req.body?.stage, startedAt, success: false, errorCode: 'RATE_LIMITED', provider: providerLabel });
      return res.status(429).json({
        ok: false,
        requestId,
        error: { code: 'RATE_LIMITED', message: 'DLSMirror is receiving requests faster than it can process them right now. Please wait a moment and try again.' },
      });
    }

    const invalidReason = validateReasonRequest(req.body);
    if (invalidReason) {
      logReasoningEvent({ requestId, stage: req.body?.stage, startedAt, success: false, errorCode: 'INVALID_REQUEST', provider: providerLabel });
      return res.status(400).json({
        ok: false,
        requestId,
        error: { code: 'INVALID_REQUEST', message: 'This request is not valid: ' + invalidReason },
      });
    }

    const { stage, language, payload } = req.body;

    if (!provider) {
      logReasoningEvent({ requestId, stage, startedAt, success: false, errorCode: 'AUTHENTICATION_ERROR', provider: providerLabel });
      return res.status(500).json({
        ok: false,
        requestId,
        error: { code: 'AUTHENTICATION_ERROR', message: 'DLSMirror reasoning is not configured on this server.' },
      });
    }

    try {
      const result = await reason(stage, language || 'English', payload, provider);
      logReasoningEvent({ requestId, sessionId, stage, startedAt, success: result.ok, errorCode: result.ok ? undefined : result.error.code, provider: providerLabel });

      if (!result.ok) {
        const statusMap = {
          SCHEMA_VALIDATION_FAILED: 502,
          INVALID_MODEL_RESPONSE: 502,
          PROVIDER_UNAVAILABLE: 503,
          PROVIDER_TIMEOUT: 504,
          RATE_LIMITED: 429,
          AUTHENTICATION_ERROR: 500,
          INVALID_REQUEST: 400,
        };
        const status = statusMap[result.error.code] || 500;
        return res.status(status).json({ ok: false, requestId, error: result.error });
      }

      return res.status(200).json({ ok: true, requestId, data: result.data });
    } catch (err) {
      logReasoningEvent({ requestId, sessionId, stage, startedAt, success: false, errorCode: 'INTERNAL_ERROR', provider: providerLabel });
      return res.status(500).json({
        ok: false,
        requestId,
        error: { code: 'INTERNAL_ERROR', message: 'DLSMirror reasoning is temporarily unavailable.' },
      });
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, env: nodeEnv, provider: providerLabel });
  });

  return app;
}

module.exports = { createApp };

// ---- Real runtime entrypoint (not run when required by tests) -----------
if (require.main === module) {
  const PORT = process.env.PORT || 8787;
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
  const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000);
  const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  const forceLocal = process.env.MOCK_MODE === 'true' || process.env.FORCE_LOCAL === 'true';

  const { provider, label: providerLabel } = selectProvider({ anthropicApiKey: ANTHROPIC_API_KEY, forceLocal, model: ANTHROPIC_MODEL });

  if (providerLabel === 'local') {
    console.log('[dlsmirror] No ANTHROPIC_API_KEY found (or local mode forced) - starting on the Local Reasoning Engine.');
    console.log('[dlsmirror] This is a deterministic, offline simulation, not a real AI model - no cost, no key, no internet needed.');
    console.log('[dlsmirror] Set ANTHROPIC_API_KEY in backend/.env whenever you want to switch to real Claude reasoning.');
  } else {
    console.log('[dlsmirror] ANTHROPIC_API_KEY found - using real Claude reasoning.');
  }

  const rateLimit = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });
  const store = new MirrorStore({ dataDir: DATA_DIR });

  const app = createApp({ provider, providerLabel, rateLimit, store, nodeEnv: NODE_ENV });

  app.listen(PORT, () => {
    console.log(`DLSMirror backend listening on http://localhost:${PORT} (env=${NODE_ENV}, provider=${providerLabel}, data=${DATA_DIR})`);
  });
}
