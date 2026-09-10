const LAYERS = ['owner','offer','customer','revenue','market','operations','finance','organization','commercial','external'];

const SUBSTANTIVE = /\b(i|we)\b.{0,80}\b(run|own|sell|provide|make|manufacture|distribute|deliver|operate)\b|\b(sales|customers?|revenue|orders?|products?|services?|shop|store|business|money|cash|cost|staff|supplier|competition|market|profit|loan|debt|stock|inventory)\b/i;

function norm(s = '') {
  return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function ownerTurns(transcript = '') {
  return String(transcript).split(/\r?\n/)
    .filter(line => /^Owner:\s*/i.test(line))
    .map(line => line.replace(/^Owner:\s*/i, '').trim())
    .filter(Boolean);
}

function dlsQuestions(transcript = '') {
  return String(transcript).split(/\r?\n/)
    .filter(line => /^DLSMirror:\s*/i.test(line))
    .map(line => line.replace(/^DLSMirror:\s*/i, '').trim())
    .filter(Boolean);
}

function latestOwner(transcript = '') {
  const turns = ownerTurns(transcript);
  return turns[turns.length - 1] || '';
}

function meaningfulEvidence(evidence = []) {
  return (evidence || []).filter(e => e && e.normalizedMeaning && !/^owner shared additional detail/i.test(e.normalizedMeaning));
}

function layerCounts(evidence = []) {
  const counts = Object.fromEntries(LAYERS.map(layer => [layer, 0]));
  for (const e of evidence || []) if (counts[e.layer] !== undefined) counts[e.layer]++;
  return counts;
}

function hasLayer(evidence, layer) {
  return (evidence || []).some(e => e.layer === layer);
}

function hasQuestion(questions, candidate) {
  const a = norm(candidate);
  if (!a) return true;
  return questions.some(existing => {
    const b = norm(existing);
    if (a === b) return true;
    const aw = new Set(a.split(' ').filter(w => w.length > 3));
    const bw = new Set(b.split(' ').filter(w => w.length > 3));
    if (!aw.size || !bw.size) return false;
    let intersection = 0;
    aw.forEach(w => { if (bw.has(w)) intersection++; });
    return intersection / Math.max(1, Math.min(aw.size, bw.size)) >= 0.8;
  });
}

function questionForLayer(layer, latest) {
  const l = norm(latest);
  if (layer === 'owner') return 'What are you trying to change or improve in the business right now?';
  if (layer === 'offer') return 'What do you mainly sell or provide, and what has been happening with it lately?';
  if (layer === 'customer') return /sales|buy|order|customer/i.test(latest)
    ? 'When customers buy from you, what has changed recently in how often or how much they buy?'
    : 'Who usually buys from you, and what has changed with those customers recently?';
  if (layer === 'revenue') return 'When you say the business is changing, what has happened to the money coming in compared with before?';
  if (layer === 'market') return 'Has anything changed outside the business — competitors, demand, prices, season, or the local market?';
  if (layer === 'operations') return 'What has become harder to deliver or manage day to day compared with before?';
  if (layer === 'finance') return /cash|money/i.test(l)
    ? 'When the money comes in, where does it usually go before you feel you have enough left?'
    : 'How does money move through the business after a sale — when customers pay and when you pay suppliers or other costs?';
  if (layer === 'organization') return 'Who usually makes the important day-to-day decisions, and what happens when you are not there?';
  if (layer === 'commercial') return 'What do you currently keep track of to know whether the business is doing well or getting worse?';
  if (layer === 'external') return 'What outside change do you think may be affecting the business right now?';
  return 'What has changed recently in the business?';
}

function buildCandidates(state) {
  const { latest, evidence, signals, openGaps, contradictions, questions } = state;
  const candidates = [];
  const seenLayers = new Set((evidence || []).map(e => e.layer));
  const meaningful = meaningfulEvidence(evidence);

  if ((contradictions || []).length) {
    candidates.push({
      priority: 100,
      objective: 'resolve_contradiction',
      layer: null,
      text: 'I noticed two things that may not line up. Which one is closer to what usually happens in the business?',
      why: 'I want to resolve the conflict before using either statement to draw a conclusion.'
    });
  }

  const uncertainEvidence = (evidence || []).filter(e => ['INFERRED', 'HYPOTHESIS'].includes(e.evidenceStatus));
  for (const e of uncertainEvidence.slice(0, 2)) {
    if (e.verificationQuestion && !hasQuestion(questions, e.verificationQuestion)) {
      candidates.push({ priority: 95, objective: 'verify_inference', layer: e.layer, text: e.verificationQuestion,
        why: 'This is currently an inference or guess, so checking it will materially reduce uncertainty.' });
    }
  }

  if (!meaningful.length && !SUBSTANTIVE.test(latest)) {
    candidates.push({ priority: 1000, objective: 'orient', layer: 'owner',
      text: 'Tell me a little about the business first — what do you sell or provide, and what has been happening recently?',
      why: 'I do not have enough business context yet to choose a specific line of investigation.' });
  } else if (!meaningful.length) {
    candidates.push({ priority: 1000, objective: 'orient', layer: 'owner',
      text: 'Tell me a little about the business first — what do you sell or provide, and what has been happening recently?',
      why: 'I have the owner’s first statement, but not enough context to investigate a specific cause responsibly.' });
  }

  if (/sales?\s*(are|is|have|has)?\s*(slow|down|fall|drop|declin)|fewer customers|customers?\s*(are|have|are not)\s*(coming|buying)|revenue\s*(is|has)\s*(down|fall)/i.test(latest)) {
    candidates.push({ priority: 92, objective: 'clarify_active_signal', layer: /customer/i.test(latest) ? 'customer' : 'revenue',
      text: /customer/i.test(latest)
        ? 'When you say customers have changed, are fewer people coming, or are they buying less when they come?'
        : 'When you say sales are down, is it mainly fewer customers, smaller purchases, or both?',
      why: 'I want to define the change clearly before testing what is causing it.' });
  }

  if (/cash|money|not enough left|short of money|cash flow/i.test(latest)) {
    candidates.push({ priority: 90, objective: 'trace_money', layer: 'finance',
      text: 'When the money comes in, what usually takes it back out again?',
      why: 'The cash signal matters, but I need to understand where the money goes before deciding what is constraining it.' });
  }

  const adjacency = {
    owner: ['customer','offer','organization'], offer: ['customer','revenue','operations'],
    customer: ['revenue','market','offer'], revenue: ['customer','finance','offer'],
    market: ['customer','external','offer'], operations: ['offer','organization','finance'],
    finance: ['revenue','customer','operations'], organization: ['owner','operations','commercial'],
    commercial: ['revenue','operations','organization'], external: ['market','operations','finance']
  };
  const activeLayers = [...(evidence || []).map(e => e.layer), ...(signals || []).flatMap(s => s.relatedLayers || [])].filter(Boolean);
  const anchor = activeLayers[activeLayers.length - 1] || 'owner';
  for (const layer of (adjacency[anchor] || LAYERS)) {
    if (!seenLayers.has(layer)) {
      candidates.push({ priority: 60, objective: 'material_gap', layer,
        text: questionForLayer(layer, latest),
        why: 'This checks a material adjacent part of the business so the active signal is not interpreted in isolation.' });
    }
  }

  if (meaningful.length >= 2 && !hasLayer(evidence, 'owner')) {
    candidates.push({ priority: 45, objective: 'decision_context', layer: 'owner',
      text: 'What are you most worried about getting wrong here, or what decision are you trying to make?',
      why: 'Knowing the decision context helps focus the investigation on what matters most.' });
  }

  // Existing open gaps remain candidates, but only after resolving the immediate answer,
  // contradictions and higher-value state transitions above.
  for (const gap of openGaps || []) {
    if (gap && gap.question && !hasQuestion(questions, gap.question)) {
      const score = (gap.importance === 'high' ? 20 : 0) + (gap.diagnosticImpact === 'high' ? 15 : 0) +
        (gap.decisionImpact === 'high' ? 10 : 0) + (gap.relationshipImpact === 'high' ? 10 : 0);
      candidates.push({ priority: 30 + score, objective: 'open_gap', layer: gap.relatedLayer || null,
        text: gap.question, why: 'This is an unresolved information gap that could materially change the investigation.' });
    }
  }

  return candidates.filter(c => c.text && !hasQuestion(questions, c.text));
}

function computeDiscoveryState({ transcript = '', evidenceOnFile = [], signals = [], openGaps = [], contradictions = [] }) {
  const latest = latestOwner(transcript);
  const evidence = Array.isArray(evidenceOnFile) ? evidenceOnFile : [];
  const questions = dlsQuestions(transcript);
  const meaningful = meaningfulEvidence(evidence);
  const candidates = buildCandidates({ latest, evidence, signals, openGaps, contradictions, questions });
  candidates.sort((a, b) => b.priority - a.priority);
  const materialUnknowns = (openGaps || []).filter(g => g && (g.importance === 'high' || g.diagnosticImpact === 'high' || g.decisionImpact === 'high' || g.relationshipImpact === 'high'));
  const stage = !meaningful.length ? 'ORIENTATION' : (signals.length ? 'SIGNAL_INVESTIGATION' : 'BUSINESS_REALITY');
  const complete = meaningful.length >= 3 && signals.length >= 1 && materialUnknowns.length === 0 && !(contradictions || []).length;
  return {
    stage, latest, questions, evidenceCount: meaningful.length, activeSignalCount: signals.length,
    materialUnknownCount: materialUnknowns.length, contradictionCount: (contradictions || []).length,
    candidates, nextBestQuestion: candidates[0] || null, complete, layerCounts: layerCounts(evidence)
  };
}

function applyController(data, state) {
  const out = { ...data };
  const plan = state.nextBestQuestion;
  if (!plan) { out.next_question = null; return out; }
  const providerQ = out.next_question?.text || '';
  const generic = /anything else about|before i look at the full picture|how the money moves through the business/i.test(providerQ);
  const mustControl = state.stage === 'ORIENTATION' || ['resolve_contradiction','verify_inference','clarify_active_signal','trace_money'].includes(plan.objective) || generic || !providerQ;
  if (mustControl) out.next_question = { text: plan.text, why: plan.why, replies: [] };
  return out;
}

module.exports = { computeDiscoveryState, applyController, latestOwner, ownerTurns, dlsQuestions, norm };
