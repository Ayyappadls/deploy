const { ReasoningProvider } = require('./ReasoningProvider');

/**
 * MockProvider — DLSMirror's Local Reasoning Engine.
 *
 * IMPORTANT AND STATED PLAINLY: this is a deterministic, rule-based local
 * simulation of DLSMirror's structured reasoning contract. It is NOT Claude,
 * NOT any LLM, and makes no claim to be. It exists so the full DLSMirror
 * product — architecture, UX, state model, evidence lifecycle, intelligence
 * graph, discovery loop — can be exercised completely offline, for free,
 * with zero configuration, before ever connecting a real reasoning provider.
 *
 * It genuinely inspects the owner's actual words and the business reality
 * accumulated so far (via the same {system, user} text the real orchestrator
 * builds for any provider) and returns different, evidence-linked output for
 * different input — it does not return one fixed canned answer regardless of
 * what's asked.
 *
 * When you're ready to judge actual reasoning quality, set ANTHROPIC_API_KEY
 * and DLSMirror switches to real Claude reasoning automatically, with no
 * other code change (see backend/providerSelect.js).
 */

/* ============================= parsing helpers ============================= */
// The orchestrator builds `user` as fixed, labeled sections (see
// backend/reasoning/orchestrator.js buildRequest). Since this engine and the
// orchestrator are both ours, we can parse those sections directly instead
// of doing any fuzzy NLP.
function textSection(user, label, nextLabel) {
  const start = user.indexOf(label);
  if (start === -1) return '';
  const from = start + label.length;
  const to = nextLabel ? user.indexOf(nextLabel, from) : -1;
  return (to === -1 ? user.slice(from) : user.slice(from, to)).trim();
}
function jsonSection(user, label, nextLabel) {
  const raw = textSection(user, label, nextLabel);
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function lastOwnerLine(transcript) {
  const ownerLines = (transcript || '').split('\n').filter((l) => l.startsWith('Owner: ')).map((l) => l.slice('Owner: '.length));
  return ownerLines[ownerLines.length - 1] || '';
}
function priorOwnerText(transcript) {
  const ownerLines = (transcript || '').split('\n').filter((l) => l.startsWith('Owner: ')).map((l) => l.slice('Owner: '.length));
  return ownerLines.slice(0, -1).join(' ');
}

/* ============================= topic bank (Discovery) ============================= */
// Each topic: keywords to detect it in the owner's own words, which business
// layer it belongs to, what evidence status it deserves, and optionally a
// signal and/or knowledge gap it should raise. Uncertainty words route to
// HYPOTHESIS, never to a confident fact - "I don't know" stays meaningful.
const UNCERTAIN_WORDS = ["don't know the exact", "dont know the exact", "not sure", "approximately", "roughly", "i'd guess", "i guess", "maybe", "i think", "not totally sure", "no fixed", "go by feel", "not tracked", "don't track", "dont track"];

const TOPICS = [
  {
    key: 'cash_visibility',
    kws: ['money is going', "don't know where the money", 'dont know where the money', 'not sure where the money'],
    layer: 'commercial', status: 'OWNER-PROVIDED',
    meaning: 'Sales are happening, but the owner cannot clearly trace where the resulting cash ends up.',
    signal: { text: 'Cash visibility gap despite normal sales activity', type: 'commercial', severity: 'high' },
    gap: { q: 'Roughly how much cash do you usually have on hand at the end of a typical week?', imp: 'high', why: 'Knowing the actual cash position separates a real shortage from money that\u2019s simply tied up elsewhere.' },
  },
  {
    key: 'customer_credit',
    kws: ['credit', 'ask for credit', 'buy on credit', 'udhaar'],
    layer: 'customer', status: 'OWNER-PROVIDED',
    meaning: 'Customers regularly buy on credit rather than paying at the time of sale.',
    signal: { text: 'A meaningful share of revenue is tied up in customer credit', type: 'commercial', severity: 'medium' },
    gap: null,
  },
  {
    key: 'partial_collections',
    kws: ['pay within a month', 'pay me back', 'pay within'],
    layer: 'revenue', status: 'OWNER-PROVIDED',
    meaning: 'Some customers do pay back within roughly a month.',
    signal: null, gap: null,
  },
  {
    key: 'overdue_receivables',
    kws: ['three to six months', "haven't paid", "havent paid", 'months overdue', 'not paid for', "haven't paid for", "havent paid for"],
    layer: 'finance', status: 'OWNER-PROVIDED',
    meaning: 'A portion of customer receivables are three to six months overdue.',
    signal: { text: 'Aging receivables are tying up cash for months at a time', type: 'commercial', severity: 'high' },
    gap: { q: 'About how much, in total, is overdue by more than three months?', imp: 'high', why: 'The scale of what\u2019s overdue changes whether this is a minor timing issue or a real constraint.' },
  },
  {
    key: 'amount_uncertain',
    kws: ["don't know the exact amount", 'dont know the exact amount', 'not sure of the amount'],
    layer: 'finance', status: 'HYPOTHESIS',
    meaning: 'The exact amount customers currently owe is not precisely tracked - only estimated.',
    signal: null,
    gap: { q: 'Would it help to do a quick tally of what each regular customer currently owes?', imp: 'high', why: 'An estimate is useful, but a real number would let DLSMirror actually verify this instead of treating it as a guess.' },
    verificationQuestion: 'Would it help to do a quick tally of what each regular customer currently owes?',
  },
  {
    key: 'supplier_pressure',
    kws: ['i owe', 'owe suppliers', 'owe my supplier', 'owe them money', 'supplier', 'suppliers'],
    layer: 'finance', status: 'OWNER-PROVIDED',
    meaning: 'The business itself owes a meaningful amount to its own suppliers.',
    signal: { text: 'Supplier obligations are adding pressure alongside slow customer collections', type: 'commercial', severity: 'medium' },
    gap: null,
  },
  {
    key: 'record_keeping',
    kws: ["don't update", 'dont update', 'not tracked regularly', 'records inconsistently', "don't update the records"],
    layer: 'commercial', status: 'OWNER-PROVIDED',
    meaning: 'Business records are not updated on a regular, reliable basis.',
    signal: { text: 'Weak record-keeping is limiting visibility into the business', type: 'operational', severity: 'medium' },
    gap: null,
  },
  {
    key: 'fear_of_losing_customer',
    kws: ['may go somewhere else', 'stop buying', 'go somewhere else', 'otherwise they'],
    layer: 'customer', status: 'OWNER-PROVIDED',
    meaning: 'The owner keeps extending credit partly out of fear of losing the customer to a competitor.',
    signal: { text: 'Credit decisions are driven by relationship fear rather than a set policy', type: 'organizational', severity: 'medium' },
    gap: null,
  },
  {
    key: 'no_credit_limit',
    kws: ["don't have a fixed credit limit", "dont have a fixed credit limit", 'no fixed credit limit', 'go by feel', 'no credit limit'],
    layer: 'organization', status: 'OWNER-PROVIDED',
    meaning: 'There is no fixed credit limit - decisions are made case by case, by feel.',
    signal: { text: 'Credit decisions are informal and inconsistent from customer to customer', type: 'organizational', severity: 'medium' },
    gap: null,
  },
  {
    key: 'owner_dependency',
    kws: ['handle the money', 'important customers myself', "don't trust others", 'dont trust others', 'myself'],
    layer: 'owner', status: 'OWNER-PROVIDED',
    meaning: 'The owner personally handles money and key customer relationships, without delegating.',
    signal: { text: 'The owner is a single point of dependency for cash and customer decisions', type: 'organizational', severity: 'medium' },
    gap: null,
  },
  {
    key: 'past_default',
    kws: ['defaulted', 'write some money off', 'wrote off', 'write off', 'write-off'],
    layer: 'external', status: 'OWNER-PROVIDED',
    meaning: 'A past customer defaulted and the business had to write off part of what was owed.',
    signal: { text: 'There is a history of at least one uncollected bad debt', type: 'commercial', severity: 'medium' },
    gap: null,
  },
  {
    key: 'avoidance_behavior',
    kws: ['quiet now', 'bad feeling', "haven't followed up", "havent followed up", "don't know what to say", "dont know what to say", 'awkward'],
    layer: 'customer', status: 'INFERRED',
    meaning: 'The owner suspects a couple of customers may be at risk, but has been avoiding following up with them.',
    signal: { text: 'A known risk signal with specific customers is being avoided, not investigated', type: 'organizational', severity: 'high' },
    gap: { q: 'What is it that makes you hesitate to reach out to those customers directly?', imp: 'high', why: 'What\u2019s actually stopping the conversation matters more here than the accounts themselves.' },
  },
];

// A couple of canonical contradiction pairs, used across any conversation -
// not specific to the hardware scenario, which the brief expects to be
// discovered adaptively rather than pattern-matched to one fixed test.
const CONTRADICTION_PAIRS = [
  { a: ['always pay', 'pay quickly', 'pay on time', 'never late', 'no problem paying'], b: ['60 days', 'takes a while', 'pay late', 'overdue', 'months to pay', "haven't paid", "havent paid"] },
  { a: ['customers love', 'customers are happy', 'no complaints'], b: ['stopped coming', 'stop buying', 'churn', 'leaving'] },
];

function detectTopicKeys(text) {
  const lower = (text || '').toLowerCase();
  const hits = new Set();
  TOPICS.forEach((t) => { if (t.kws.some((k) => lower.includes(k))) hits.add(t.key); });
  return hits;
}
function isUncertain(text) {
  const lower = (text || '').toLowerCase();
  return UNCERTAIN_WORDS.some((w) => lower.includes(w));
}
function findContradiction(priorText, latestText) {
  const priorLower = (priorText || '').toLowerCase();
  const latestLower = (latestText || '').toLowerCase();
  for (const pair of CONTRADICTION_PAIRS) {
    const priorHasA = pair.a.some((w) => priorLower.includes(w));
    const priorHasB = pair.b.some((w) => priorLower.includes(w));
    const latestHasA = pair.a.some((w) => latestLower.includes(w));
    const latestHasB = pair.b.some((w) => latestLower.includes(w));
    if ((priorHasA && latestHasB) || (priorHasB && latestHasA)) {
      const statementA = pair.a.find((w) => priorLower.includes(w) || latestLower.includes(w));
      const statementB = pair.b.find((w) => priorLower.includes(w) || latestLower.includes(w));
      return { statementA, statementB, note: `earlier this sounded like "${statementA}", but now it sounds more like "${statementB}"` };
    }
  }
  return null;
}

/* ============================= DISCOVER ============================= */
function buildDiscoverResponse(user) {
  const transcript = textSection(user, 'Conversation so far:\n', '\n\nEvidence already on file:');
  const evidenceOnFile = jsonSection(user, 'Evidence already on file:\n', '\n\nOpen knowledge gaps:') || [];
  const latest = lastOwnerLine(transcript);
  const prior = priorOwnerText(transcript);

  const coveredKeys = detectTopicKeys(prior + ' ' + evidenceOnFile.map((e) => e.statement || '').join(' '));
  const latestKeys = [...detectTopicKeys(latest)].filter((k) => !coveredKeys.has(k));

  const contradiction = findContradiction(prior, latest);

  const evidence = [];
  const signals = [];
  const knowledgeGaps = [];
  const usedKeys = latestKeys.slice(0, 3);

  usedKeys.forEach((key, idx) => {
    const topic = TOPICS.find((t) => t.key === key);
    const evKey = 'e' + (idx + 1);
    const uncertain = isUncertain(latest);
    const status = uncertain && topic.status === 'OWNER-PROVIDED' ? 'HYPOTHESIS' : topic.status;
    evidence.push({
      key: evKey,
      originalStatement: latest,
      normalizedMeaning: topic.meaning,
      layer: topic.layer,
      evidenceStatus: status,
      verificationQuestion: topic.verificationQuestion || '',
    });
    if (topic.signal) {
      signals.push({
        signal: topic.signal.text, type: topic.signal.type, severity: topic.signal.severity,
        relatedLayers: [topic.layer], supportingEvidenceKeys: [evKey],
      });
    }
    if (topic.gap) {
      knowledgeGaps.push({
        question: topic.gap.q, missingInformation: topic.meaning, importance: topic.gap.imp,
        diagnosticImpact: topic.gap.imp, decisionImpact: 'medium', relationshipImpact: 'medium', relatedLayer: topic.layer,
      });
    }
  });

  // Never return zero evidence for a substantive owner message - fall back
  // to logging what was said, plainly, rather than inventing interpretation.
  if (evidence.length === 0 && latest.trim().length > 0) {
    evidence.push({
      key: 'e1', originalStatement: latest,
      normalizedMeaning: 'Owner shared additional detail: ' + latest.slice(0, 140),
      layer: 'commercial', evidenceStatus: isUncertain(latest) ? 'HYPOTHESIS' : 'OWNER-PROVIDED', verificationQuestion: '',
    });
  }

  const contradictions = contradiction ? [{ existingEvidenceId: null, statementA: contradiction.statementA, statementB: contradiction.statementB, note: contradiction.note }] : [];

  // Next question: resolve a contradiction first; otherwise ask the highest-
  // value still-open gap (this turn's new gap, or a topic mentioned earlier
  // that still has an unanswered gap attached to it); otherwise wrap up.
  let nextQuestion;
  if (contradiction) {
    nextQuestion = {
      text: `Just to make sure I've got this right - ${contradiction.note}. Which is closer to what usually happens?`,
      why: 'Something you said doesn\u2019t quite line up with something said earlier, and it matters enough to check before going further.',
      replies: ['The first thing is more accurate', 'The second thing is more accurate', 'Both happen, depending on the customer'],
    };
  } else if (knowledgeGaps.length > 0) {
    const top = knowledgeGaps[0];
    const topTopic = TOPICS.find((t) => t.gap && t.gap.q === top.question);
    nextQuestion = {
      text: top.question,
      why: (topTopic && topTopic.gap.why) || 'This would materially change what DLSMirror can responsibly conclude.',
      replies: ['I could estimate roughly', "I'd need to check", 'I honestly have no idea'],
    };
  } else {
    nextQuestion = {
      text: 'Is there anything else about how customers pay you, or how the money moves through the business, that I should know before I look at the full picture?',
      why: 'Enough specific pieces are on the table that it\u2019s worth checking for anything still missing before connecting them.',
      replies: ['No, that covers the main things', 'Actually, one more thing', "I'm not sure what else is relevant"],
    };
  }

  return JSON.stringify({ contradictions, evidence, signals, knowledge_gaps: knowledgeGaps, next_question: nextQuestion });
}

/* ============================= domain detection (for later stages) ============================= */
// By the time we reach Understand/Diagnose/etc, we no longer have the raw
// owner text in view for every field - we reason from the evidence and
// signal text already on file (which the local Discover engine wrote using
// its own fixed templates above), so this matching is exact, not fuzzy.
const DOMAIN_MATCHERS = {
  credit_cash: ['credit', 'receivable', 'cash', 'collections', 'overdue', 'supplier'],
  owner_dependency: ['owner', 'dependency', 'delegat', 'single point'],
  record_visibility: ['record-keeping', 'record keeping', 'visibility', 'not tracked'],
  relationship_avoidance: ['avoid', 'risk signal', 'bad feeling', 'hesitat'],
};
function combinedText(...jsonBlocks) {
  return jsonBlocks.filter(Boolean).map((b) => JSON.stringify(b)).join(' ').toLowerCase();
}
function dominantDomain(text) {
  let best = 'generic', bestCount = 0;
  Object.keys(DOMAIN_MATCHERS).forEach((domain) => {
    const count = DOMAIN_MATCHERS[domain].filter((kw) => text.includes(kw)).length;
    if (count > bestCount) { bestCount = count; best = domain; }
  });
  return bestCount > 0 ? best : 'generic';
}

/* ============================= UNDERSTAND ============================= */
function buildUnderstandResponse(user) {
  const evidence = jsonSection(user, 'Evidence:\n', '\n\nSignals:') || [];
  const signals = jsonSection(user, 'Signals:\n', null) || [];

  if (signals.length === 0) {
    return JSON.stringify({ relationships: [], pattern: { statement: 'Not enough distinct signals yet to connect into a pattern.', supportingRelationshipKeys: [], supportingSignalIds: [] } });
  }
  const sorted = [...signals].sort((a, b) => (b.severity === 'high') - (a.severity === 'high'));
  const sigA = sorted[0];
  const sigB = sorted[1] || sorted[0];

  const domain = dominantDomain(combinedText(evidence, signals));
  const relationshipText = {
    credit_cash: `${sigA.signal} together with ${sigB.signal} suggests cash is getting tied up faster than the business notices.`,
    owner_dependency: `${sigA.signal} connects to ${sigB.signal}: growth is adding load to one person instead of the system absorbing it.`,
    record_visibility: `${sigA.signal} makes ${sigB.signal.toLowerCase()} harder to catch early.`,
    relationship_avoidance: `${sigA.signal} means ${sigB.signal.toLowerCase()} isn't being tested against reality.`,
    generic: `${sigA.signal} and ${sigB.signal} appear to be related, though the exact mechanism isn't fully clear yet.`,
  }[domain];

  const relEvidenceIds = evidence.filter((e) => (sigA.relatedLayers || []).includes(e.layer) || (sigB.relatedLayers || []).includes(e.layer)).map((e) => e.id);

  const patternText = {
    credit_cash: 'Revenue growth is not converting cleanly into available cash - credit and collections are where it is getting stuck.',
    owner_dependency: 'The business depends heavily on the owner personally for both cash and customer judgment calls.',
    record_visibility: 'Inconsistent records are hiding problems that would otherwise be easy to catch early.',
    relationship_avoidance: 'A real risk signal exists but is being avoided rather than checked.',
    generic: 'There is more happening in the business than there is current visibility into.',
  }[domain];

  return JSON.stringify({
    relationships: [{ key: 'r1', signalAId: sigA.id, signalBId: sigB.id, relationship: relationshipText, type: sigA.id === sigB.id ? 'CORRELATES_WITH' : 'CONTRIBUTES_TO', supportingEvidenceIds: relEvidenceIds }],
    pattern: { statement: patternText, supportingRelationshipKeys: ['r1'], supportingSignalIds: [sigA.id, sigB.id] },
  });
}

/* ============================= DIAGNOSE ============================= */
const DIAGNOSIS_TEMPLATES = {
  credit_cash: {
    firstPrinciple: { situation: 'Sales are steady, but cash on hand does not reflect it.', assumptions: 'Assumed revenue and cash move together at roughly the same pace.', evidence: 'Credit given freely, receivables aging past three months, supplier payments stretched.', causalChain: 'Sale happens \u2192 credit extended \u2192 collection delayed \u2192 cash unavailable \u2192 own payments delayed.', underlyingReality: 'The business is really running two businesses at once: selling goods, and unintentionally financing its customers.', commercialImplication: 'Every sale on credit is really a small loan the business is making, often without meaning to.' },
    invisibleBottleneck: { deconstruction: 'The shop is really a lending operation wearing a retail storefront.', behavioralTruth: 'The owner extends credit informally to keep relationships and volume, not by policy.', invisibleConflict: 'Wanting to keep every customer happy is quietly working against having cash when it is needed.', rootCause: 'There is no consistent rule for how much credit a customer can carry before it is checked.', leverageVariable: 'The average time it takes a credit sale to turn into cash in hand.', operatingRedesign: 'A simple, consistent credit limit applied the same way to every regular customer.', pilot: 'Apply one clear credit limit to the next 5 wholesale orders and see what changes.', strategicEndState: 'Growth that converts into cash on a predictable timeline, not just into more outstanding credit.' },
    thesis: { thesis: 'The business does not have a sales problem - it has a cash-conversion problem hiding behind healthy-looking sales.', supportingEvidence: 'Credit is extended without a limit, some receivables are months overdue, and supplier payments are stretched at the same time.', contradictingEvidence: '', falsificationCondition: 'If receivables were actually collected within their normal terms and cash still felt short, the constraint would lie elsewhere.' },
  },
  owner_dependency: {
    firstPrinciple: { situation: 'The owner personally handles cash and the most important customer relationships.', assumptions: 'Assumed that only the owner can be trusted with money and key accounts.', evidence: 'Owner states directly they do not delegate money or important customers to others.', causalChain: 'Business grows \u2192 more decisions needed \u2192 all still route through the owner \u2192 owner becomes the ceiling.', underlyingReality: 'The business cannot currently function at full capacity without the owner present at all times.', commercialImplication: 'Growth right now mostly means more hours for the owner, not more freedom.' },
    invisibleBottleneck: { deconstruction: 'The business is structured around one irreplaceable person rather than a repeatable system.', behavioralTruth: 'Trust has never been extended to anyone else for money-related decisions.', invisibleConflict: 'Wanting the business to grow conflicts with never having tested whether anyone else could help carry it.', rootCause: 'No one besides the owner has ever been given a real decision to own.', leverageVariable: 'The smallest money-related decision the owner could hand off first.', operatingRedesign: 'One trusted person owns one clearly defined category of decisions end to end.', pilot: 'Let one helper manage collections follow-up for the smallest accounts for two weeks.', strategicEndState: 'A business that keeps running smoothly on the days the owner is not there.' },
    thesis: { thesis: 'The business is not limited by demand right now - it is limited by how much of the owner it requires.', supportingEvidence: 'The owner personally handles both money and the most important customer relationships, without delegation.', contradictingEvidence: '', falsificationCondition: 'If someone else already reliably handled a real decision without the owner noticing a difference, this would not hold.' },
  },
  record_visibility: {
    firstPrinciple: { situation: 'Business activity is happening, but records are not kept consistently enough to see it clearly.', assumptions: 'Assumed memory and instinct are a reasonable substitute for records.', evidence: 'Owner states records are not updated regularly and amounts owed are estimated, not tracked.', causalChain: 'Transaction happens \u2192 not recorded promptly \u2192 picture of the business drifts from reality \u2192 problems surface late.', underlyingReality: 'Decisions are currently being made on a picture of the business that is already out of date.', commercialImplication: 'Problems are being caught only once they are large enough to be felt, not while they are still small.' },
    invisibleBottleneck: { deconstruction: 'The business is operating on memory instead of a running, current record.', behavioralTruth: 'Recording things has always felt less urgent than serving the next customer.', invisibleConflict: 'Staying focused on customers in the moment is quietly costing visibility into the business as a whole.', rootCause: 'There is no simple, low-effort habit for capturing what happens as it happens.', leverageVariable: 'How quickly a transaction goes from memory into a written record.', operatingRedesign: 'One short, fixed moment each day to write down what changed.', pilot: 'Track just outstanding customer balances daily for two weeks, nothing else yet.', strategicEndState: 'A business picture that is trustworthy enough to make decisions from, not just a feeling.' },
    thesis: { thesis: 'Right now, the business needs a reliable record more than it needs a new plan.', supportingEvidence: 'Records are not updated regularly, and even outstanding amounts are estimated rather than known.', contradictingEvidence: '', falsificationCondition: 'If a quick record-check matched the owner\u2019s memory closely, the gap would be smaller than it appears.' },
  },
  relationship_avoidance: {
    firstPrinciple: { situation: 'The owner has a specific, named concern about certain customers but has not acted on it.', assumptions: 'Assumed that raising the issue would damage the relationship more than leaving it unresolved.', evidence: 'A past default happened before; two current customers now give a similar feeling, but haven\u2019t been contacted.', causalChain: 'Risk noticed \u2192 conversation feels awkward \u2192 avoided \u2192 uncertainty persists \u2192 risk stays unmanaged.', underlyingReality: 'The discomfort of one conversation is currently outweighing the cost of not having it.', commercialImplication: 'The business may be carrying a second write-off it could still act early enough to prevent.' },
    invisibleBottleneck: { deconstruction: 'A known risk is being managed by hoping it resolves itself.', behavioralTruth: 'The owner already senses which accounts are at risk - the gap is action, not awareness.', invisibleConflict: 'Preserving a comfortable relationship in the short term is working against protecting the business in the long term.', rootCause: 'There is no simple, low-pressure way the owner has to open that conversation.', leverageVariable: 'Whether the first, smallest version of that conversation actually happens.', operatingRedesign: 'A short, low-pressure check-in script used for any customer who feels uncertain.', pilot: 'Use it with just one of the two customers this week.', strategicEndState: 'Risk gets checked while it is still small, as a normal habit, not avoided until it is unavoidable.' },
    thesis: { thesis: 'This isn\u2019t a "difficult customer" problem - it\u2019s a "the conversation hasn\u2019t happened yet" problem.', supportingEvidence: 'The owner already named the two customers and the discomfort, without having spoken to either yet.', contradictingEvidence: '', falsificationCondition: 'If reaching out changed nothing about the outcome, the discomfort would not have been the real barrier.' },
  },
  generic: {
    firstPrinciple: { situation: 'The business is active, but the real pressure point is not yet clear.', assumptions: 'Assumed busyness is a reasonable stand-in for clarity.', evidence: 'What has been shared so far is real but not yet enough to point at one cause.', causalChain: 'Activity happens \u2192 effort goes in \u2192 outcome is hard to trace back to a specific cause.', underlyingReality: 'There is more happening in the business than there is visibility into right now.', commercialImplication: 'Without more specifics, any decision made now would be a guess dressed up as a plan.' },
    invisibleBottleneck: { deconstruction: 'Day-to-day busyness is standing in for a clear view of the business.', behavioralTruth: 'Decisions are being made in the moment, based on feel.', invisibleConflict: 'Wanting to act quickly is working against having enough clarity to act well.', rootCause: 'Not enough specific detail has been captured yet to see the real shape of the problem.', leverageVariable: 'The next concrete detail that would most change the picture.', operatingRedesign: 'A short, honest look at what a normal day or week actually involves.', pilot: 'Share a bit more detail with DLSMirror about a typical day.', strategicEndState: 'A clearer, calmer sense of what is really going on before deciding what to do about it.' },
    thesis: { thesis: 'Right now, this business needs clarity more than it needs a plan.', supportingEvidence: 'What has been shared so far is real but partial.', contradictingEvidence: '', falsificationCondition: 'More detail could reveal a completely different, more specific constraint.' },
  },
};
function buildDiagnoseResponse(user) {
  const evidence = jsonSection(user, 'Evidence:\n', '\n\nRelationships:') || [];
  const relationships = jsonSection(user, 'Relationships:\n', '\n\nPattern:') || [];
  const pattern = jsonSection(user, 'Pattern:\n', null);
  const domain = dominantDomain(combinedText(evidence, relationships, pattern));
  const template = DIAGNOSIS_TEMPLATES[domain] || DIAGNOSIS_TEMPLATES.generic;
  return JSON.stringify(template);
}

/* ============================= TRANSITION ============================= */
const TRANSITION_TEMPLATES = {
  credit_cash: { current: 'Busy, sales-first way of running things, with credit extended informally.', constraint: 'No consistent limit on customer credit, and no routine check on what is overdue.', required: 'A simple, consistent credit policy paired with a regular collections check.', future: 'Growth that converts into usable cash on a predictable timeline.', operatingSystem: { mechanism: 'Weekly review of outstanding customer balances, oldest first.', owner: 'The owner, for now, until it can be handed off.', cadence: 'Weekly', metric: 'Total receivables overdue by more than 60 days.', escalation: 'Any account over 90 days overdue gets a direct call that week.' } },
  owner_dependency: { current: 'Every money and customer decision runs through the owner personally.', constraint: 'No one else has been given real authority over any part of it.', required: 'One trusted helper owns one clearly defined category of decisions.', future: 'A business that runs well on the days the owner is not fully present.', operatingSystem: { mechanism: 'A written rule for what a helper can decide without asking first.', owner: 'The owner, to define it; the helper, to run it.', cadence: 'Reviewed weekly at first, then monthly.', metric: 'Number of routine decisions resolved without the owner.', escalation: 'Anything outside the written rule still comes to the owner.' } },
  record_visibility: { current: 'Records are kept from memory, updated irregularly.', constraint: 'No simple, low-effort habit exists for capturing activity as it happens.', required: 'A short daily habit of recording what changed.', future: 'A business picture reliable enough to actually make decisions from.', operatingSystem: { mechanism: 'A two-minute end-of-day note of balances and cash.', owner: 'The owner or whoever closes up.', cadence: 'Daily', metric: 'Whether the daily note actually happened.', escalation: 'Three missed days in a row triggers a simpler version of the habit.' } },
  relationship_avoidance: { current: 'A known risk with specific customers is being sensed but not acted on.', constraint: 'No comfortable, low-pressure way exists to open that conversation.', required: 'A short, low-pressure check-in habit for any account that feels uncertain.', future: 'Risk gets checked while small, as a normal habit, not avoided until unavoidable.', operatingSystem: { mechanism: 'A short, standard check-in message used for any uncertain account.', owner: 'The owner, for the accounts they personally manage.', cadence: 'As soon as an account starts to feel uncertain, not on a fixed schedule.', metric: 'Number of uncertain accounts actually followed up with.', escalation: 'No response after a follow-up triggers a decision on continued credit.' } },
  generic: { current: 'Busy, day-to-day way of running things.', constraint: 'Not enough clarity yet on where the real pressure sits.', required: 'A little more detail on what a normal day and week actually look like.', future: 'A clearer, calmer sense of what is really going on.', operatingSystem: { mechanism: 'A short weekly note on what felt hardest that week.', owner: 'The owner.', cadence: 'Weekly', metric: 'Whether a clear, specific answer emerges.', escalation: 'None yet - not enough is known to define one.' } },
};
function buildTransitionResponse(user) {
  const diagnosis = jsonSection(user, 'Diagnosis:\n', '\n\nCommercial thesis:');
  const thesis = jsonSection(user, 'Commercial thesis:\n', null);
  const domain = dominantDomain(combinedText(diagnosis, thesis));
  return JSON.stringify(TRANSITION_TEMPLATES[domain] || TRANSITION_TEMPLATES.generic);
}

/* ============================= BEHAVIOR ============================= */
const BEHAVIOR_TEMPLATES = {
  credit_cash: { current: 'Credit is extended in the moment, without a consistent check.', friction: 'There is no simple rule to follow instead of judgment calls.', inertia: 'It has always been decided case by case, and that has felt fine until now.', relapseRisk: 'Reverting to informal credit the moment a valued customer asks nicely.', wedge: 'Apply the new limit only to new orders first, not existing balances.', required: 'A written credit limit checked before extending more credit.', capability: 'A simple written rule and a place to note current balances.', adoption: 'The rule gets checked before saying yes to more credit, most of the time.', accountability: 'A weekly look at who is closest to their limit.', measure: 'Fewer new sales added on top of an already-overdue balance.' },
  owner_dependency: { current: 'The owner decides everything personally, out of habit more than necessity.', friction: 'No one else has been told what they are allowed to decide.', inertia: 'Deciding it personally has always worked well enough to get by.', relapseRisk: 'Stepping back in the moment something feels urgent.', wedge: 'Hand off just one small, repeated decision first.', required: 'A trusted helper owns that one decision fully.', capability: 'One clear, spoken rule about what they can decide alone.', adoption: 'The helper acts without checking first, most of the time.', accountability: 'A short weekly check-in on how it is going.', measure: 'Fewer small questions reaching the owner directly.' },
  record_visibility: { current: 'Recording happens irregularly, when there is a spare moment.', friction: 'It has never been anyone\u2019s specific job at a specific time.', inertia: 'Skipping it has never had an immediate visible cost.', relapseRisk: 'Letting it slide again during a busy week.', wedge: 'Track just one number daily first - cash or balances, not everything.', required: 'A fixed two-minute moment each day to record it.', capability: 'A notebook or simple sheet, nothing more.', adoption: 'The note actually gets made most days, even briefly.', accountability: 'A quick weekly look back at the week\u2019s notes.', measure: 'Fewer surprises that could have been caught earlier.' },
  relationship_avoidance: { current: 'Uncertain accounts are noticed, then left alone.', friction: 'There is no comfortable script for opening the conversation.', inertia: 'Avoiding it has not caused an obvious problem yet, so it persists.', relapseRisk: 'Putting it off again once the discomfort returns.', wedge: 'Reach out to the least uncomfortable of the two customers first.', required: 'A short, low-pressure check-in habit used consistently.', capability: 'One simple message template to reduce the awkwardness of starting.', adoption: 'The check-in actually happens within a week of the feeling arising.', accountability: 'A note kept on who was checked in on, and what was learned.', measure: 'Fewer accounts that go quiet without ever being asked why.' },
  generic: { current: 'Decisions are made in the moment, based on feel.', friction: 'There isn\u2019t a clear enough picture yet to decide from.', inertia: 'This has been enough to get by so far.', relapseRisk: 'Falling back into guessing once things feel busy again.', wedge: 'Share one more concrete detail with DLSMirror this week.', required: 'A short, honest look at a normal day or week.', capability: 'Just a bit more detail, nothing more complex.', adoption: 'A bit more gets shared each time something happens.', accountability: 'Checking back in as the picture gets clearer.', measure: 'A clearer, more specific answer than before.' },
};
function buildBehaviorResponse(user) {
  const diagnosis = jsonSection(user, 'Diagnosis:\n', '\n\nTransition:');
  const transition = jsonSection(user, 'Transition:\n', null);
  const domain = dominantDomain(combinedText(diagnosis, transition));
  return JSON.stringify(BEHAVIOR_TEMPLATES[domain] || BEHAVIOR_TEMPLATES.generic);
}

/* ============================= STAKEHOLDER + DECISION ============================= */
const STAKEHOLDER_TEMPLATES = {
  credit_cash: {
    stakeholders: {
      owner: { means: 'A clearer sense of what is actually collectible versus just outstanding.', understand: 'Extending credit freely is quietly costing available cash.', resist: 'Worry that a stricter limit will upset long-time customers.', action: 'Set and stick to one clear credit limit this month.' },
      customer: { means: 'A clearer, consistent credit limit going forward.', understand: 'This protects the shop\u2019s ability to keep serving them well.', resist: 'Long-time customers used to flexible terms may push back at first.', action: 'Explain the new limit warmly, before it is needed.' },
      supplier: { means: 'More predictable payments over time.', understand: 'The business is working to pay on time, not just when cash allows.', resist: '', action: 'Let them know if a payment timeline is changing.' },
    },
    decision: { decision: 'Set one consistent credit limit and check it before extending more credit.', reason: 'Growth is currently increasing outstanding credit faster than cash comes in.', owner: 'You', actions: ['Decide the limit amount', 'Apply it to the next new order', 'Note current balances for existing customers'], expectedOutcome: 'Outstanding receivables stop growing and start shrinking.', successMetric: 'Total overdue balance falls over the next month.', reviewDate: 'in 2 weeks' },
  },
  owner_dependency: {
    stakeholders: {
      owner: { means: 'A little more room to think ahead instead of just reacting.', understand: 'Letting go of small decisions is what makes room for bigger ones.', resist: 'It can feel safer to just decide everything personally.', action: 'Choose one decision to hand off this week.' },
      employee: { means: 'Real trust to decide something without waiting.', understand: 'This is confidence in them, not the owner stepping back.', resist: 'Fear of getting it wrong without checking first.', action: 'Make that one decision independently for two weeks.' },
    },
    decision: { decision: 'Hand off one clear category of decisions this month.', reason: 'Growth currently adds to the owner\u2019s load instead of easing it.', owner: 'You', actions: ['Pick the decision to hand off', 'Write the one-line rule for it', 'Tell the helper directly'], expectedOutcome: 'Fewer everyday questions reach the owner personally.', successMetric: 'Number of routine questions the owner still gets asked, per week.', reviewDate: 'in 2 weeks' },
  },
  record_visibility: {
    stakeholders: {
      owner: { means: 'Less guessing about what is really owed or on hand.', understand: 'A small daily habit beats a big irregular effort.', resist: 'It can feel like one more thing during a busy day.', action: 'Start the two-minute daily note this week.' },
    },
    decision: { decision: 'Start a short daily record of balances and cash.', reason: 'Decisions are currently being made on a picture that is already out of date.', owner: 'You', actions: ['Pick what to track first', 'Do it at the same time each day', 'Review it once a week'], expectedOutcome: 'A noticeably clearer, more current picture of the business.', successMetric: 'The daily note happens on most days.', reviewDate: 'in 2 weeks' },
  },
  relationship_avoidance: {
    stakeholders: {
      owner: { means: 'A clear, low-pressure way to check on a nagging worry.', understand: 'A short conversation now is easier than a bigger loss later.', resist: 'The conversation still feels uncomfortable to start.', action: 'Reach out to one of the two customers this week.' },
      customer: { means: 'Being checked in on, rather than quietly written off.', understand: 'The check-in is genuine, not a demand.', resist: 'May be surprised to be asked directly.', action: 'Keep the first message short and easy to respond to.' },
    },
    decision: { decision: 'Reach out to the two uncertain customers, starting with the easier one.', reason: 'A known risk is currently being avoided rather than checked.', owner: 'You', actions: ['Decide what to say', 'Reach out to the first customer', 'Note what you learn'], expectedOutcome: 'Clarity on whether the risk is real, while it is still small.', successMetric: 'Both customers have been contacted within two weeks.', reviewDate: 'in 2 weeks' },
  },
  generic: {
    stakeholders: { owner: { means: 'A clearer picture, one step at a time.', understand: 'Clarity usually comes before the right decision, not after.', resist: 'It can feel slower than just deciding something.', action: 'Share a bit more detail with DLSMirror.' } },
    decision: { decision: 'Get clear on one thing before trying to fix everything.', reason: 'There isn\u2019t yet enough detail to point to a specific cause.', owner: 'You', actions: ['Share more detail about a normal day'], expectedOutcome: 'One clear, specific answer instead of a general worry.', successMetric: 'A specific cause can be named.', reviewDate: 'in 2 weeks' },
  },
};
function buildStakeholderResponse(user) {
  const diagnosis = jsonSection(user, 'Diagnosis:\n', '\n\nTransition:');
  const transition = jsonSection(user, 'Transition:\n', '\n\nBehavior change:');
  const behavior = jsonSection(user, 'Behavior change:\n', null);
  const domain = dominantDomain(combinedText(diagnosis, transition, behavior));
  return JSON.stringify(STAKEHOLDER_TEMPLATES[domain] || STAKEHOLDER_TEMPLATES.generic);
}

/* ============================= LEARNING ============================= */
// Phrase-based, not single words - "no" would match inside "I don't know"
// and "paid" would match inside "haven't paid" if we used loose single words.
const POSITIVE_WORDS = ['has improved', 'is better now', 'finally paid', 'got collected', 'was resolved', 'worked well', 'much better', 'all caught up'];
const NEGATIVE_WORDS = ['no change', 'no improvement', "didn't help", 'didnt help', 'nothing changed', 'still the same', 'still overdue', 'still unpaid', 'got worse', 'worse than before', 'still hasn\u2019t', 'still has not'];
function buildLearningResponse(user) {
  const decision = jsonSection(user, 'Decision on file:\n', '\n\nWhat the owner reports actually happened:');
  const observedText = textSection(user, 'What the owner reports actually happened:\n', null);
  const lower = observedText.toLowerCase();
  const positive = POSITIVE_WORDS.some((w) => lower.includes(w));
  const negative = NEGATIVE_WORDS.some((w) => lower.includes(w));
  const expected = (decision && decision.expectedOutcome) || 'the expected change';

  let difference, possibleExplanation, newSignalText, severity;
  if (positive && !negative) {
    difference = `The outcome moved in the right direction, roughly matching what was expected: ${expected}`;
    possibleExplanation = 'The action taken was closely followed, and enough time passed for it to show up.';
    newSignalText = 'Early sign that the change is holding'; severity = 'low';
  } else if (negative && !positive) {
    difference = `Little seems to have changed yet compared to what was expected: ${expected}`;
    possibleExplanation = 'Either not enough time has passed, or the action wasn\u2019t followed as consistently as planned.';
    newSignalText = 'The change has not taken hold yet and may need reinforcement'; severity = 'medium';
  } else {
    difference = 'It\u2019s mixed or unclear so far compared to what was expected.';
    possibleExplanation = 'Some parts may be working while others haven\u2019t been tested long enough yet.';
    newSignalText = 'Outcome is inconclusive and worth checking again soon'; severity = 'low';
  }

  return JSON.stringify({
    observedOutcome: observedText.slice(0, 200) || 'No specific outcome was described.',
    difference, possibleExplanation,
    evidenceRequired: 'A specific number or example from the next couple of weeks would make this clearer.',
    newSignal: { signal: newSignalText, type: 'commercial', severity, relatedLayers: ['commercial'] },
  });
}

/* ============================= provider ============================= */
class MockProvider extends ReasoningProvider {
  async generate({ system, user }) {
    if (system.includes('Your job right now is DISCOVERY')) return buildDiscoverResponse(user);
    if (system.includes('Your job is UNDERSTAND')) return buildUnderstandResponse(user);
    if (system.includes('Your job is DIAGNOSE')) return buildDiagnoseResponse(user);
    if (system.includes('Your job is TRANSITION')) return buildTransitionResponse(user);
    if (system.includes('Your job is ENABLE CHANGE')) return buildBehaviorResponse(user);
    if (system.includes('Your job is STAKEHOLDER ALIGNMENT')) return buildStakeholderResponse(user);
    if (system.includes('Your job is LEARNING')) return buildLearningResponse(user);
    return JSON.stringify({});
  }
}

module.exports = { MockProvider };
