const { ReasoningProvider } = require('./ReasoningProvider');
const { TOPICS, RELATIONSHIP_PAIRS, detectTopicKeys, isUncertain, findContradiction } = require('./discoveryTopics');

// Local adapter for the three narrow LLM contracts used by discoveryEngine:
// evidence extraction, relationship extraction, and question phrasing. It
// never selects the investigation objective or decides completion; the
// deterministic discovery engine + methodology controller remain
// authoritative for that. It now reuses the SAME topic bank as
// MockProvider (see discoveryTopics.js) instead of a separate, cruder
// keyword set, so local/offline mode genuinely recognizes credit, overdue
// receivables, owner dependency, avoided customers, supplier pressure, etc.
class DiscoveryLocalProvider extends ReasoningProvider {
  constructor(delegate) { super(); this.delegate = delegate; }

  async generate({ system = '', user = '' }) {
    if (/TASK:\s*EXTRACT_EVIDENCE/i.test(system)) return JSON.stringify(this.extract(user));
    if (/TASK:\s*EXTRACT_RELATIONSHIP/i.test(system)) return JSON.stringify(this.extractRelationship(user));
    if (/TASK:\s*PHRASE_QUESTION/i.test(system)) return JSON.stringify(this.phrase(user));
    return this.delegate.generate({ system, user });
  }

  extract(user) {
    const section = (label, next) => {
      const start = user.indexOf(label);
      if (start === -1) return '';
      const from = start + label.length;
      const to = next ? user.indexOf(next, from) : -1;
      return (to === -1 ? user.slice(from) : user.slice(from, to)).trim();
    };
    const jsonSection = (label, next) => { try { return JSON.parse(section(label, next)); } catch (e) { return []; } };
    const latest = section('Latest owner message:\n', '\n\nPrior owner text:').trim();
    const prior = section('Prior owner text:\n', '\n\nExisting evidence:').trim();
    const existingEvidence = jsonSection('Existing evidence:\n', '\n\nExisting signals:') || [];

    const coveredKeys = detectTopicKeys(prior + ' ' + existingEvidence.map((e) => e.statement || e.normalizedMeaning || '').join(' '));
    const latestKeys = [...detectTopicKeys(latest)].filter((k) => !coveredKeys.has(k));
    const contradiction = findContradiction(prior, latest);

    const evidence = [];
    const signals = [];
    const knowledge_gaps = [];
    const usedKeys = latestKeys.slice(0, 3);
    const uncertain = isUncertain(latest);

    usedKeys.forEach((key, idx) => {
      const topic = TOPICS.find((t) => t.key === key);
      const evKey = 'e' + (idx + 1);
      const status = uncertain && topic.status === 'OWNER-PROVIDED' ? 'HYPOTHESIS' : topic.status;
      evidence.push({ key: evKey, originalStatement: latest, normalizedMeaning: topic.meaning, layer: topic.layer, evidenceStatus: status, verificationQuestion: topic.verificationQuestion || '' });
      if (topic.signal) signals.push({ signal: topic.signal.text, type: topic.signal.type, severity: topic.signal.severity, relatedLayers: [topic.layer], supportingEvidenceKeys: [evKey] });
      if (topic.gap) knowledge_gaps.push({ question: topic.gap.q, missingInformation: topic.meaning, importance: topic.gap.imp, diagnosticImpact: topic.gap.imp, decisionImpact: 'medium', relationshipImpact: 'medium', relatedLayer: topic.layer });
    });

    // Never return zero evidence for a substantive owner message - fall
    // back to logging what was said, plainly, rather than inventing
    // interpretation the topic bank doesn't actually recognize.
    if (!evidence.length && latest.trim()) {
      evidence.push({ key: 'e1', originalStatement: latest, normalizedMeaning: 'Owner shared additional detail: ' + latest.slice(0, 140), layer: 'commercial', evidenceStatus: uncertain ? 'HYPOTHESIS' : 'OWNER-PROVIDED', verificationQuestion: '' });
    }

    const contradictions = contradiction ? [{ existingEvidenceId: null, statementA: contradiction.statementA, statementB: contradiction.statementB, note: contradiction.note }] : [];
    return { evidence, signals, knowledge_gaps, contradictions };
  }

  extractRelationship(user) {
    const section = (label, next) => {
      const start = user.indexOf(label);
      if (start === -1) return '';
      const from = start + label.length;
      const to = next ? user.indexOf(next, from) : -1;
      return (to === -1 ? user.slice(from) : user.slice(from, to)).trim();
    };
    const jsonSection = (label, next) => { try { return JSON.parse(section(label, next)); } catch (e) { return null; } };
    const signalA = jsonSection('Signal A:\n', '\n\nSignal B:');
    const signalB = jsonSection('Signal B:\n', '\n\nExisting evidence:');
    if (!signalA || !signalB) return { found: false };

    const textFor = (key) => { const t = TOPICS.find((x) => x.key === key); return t && t.signal && t.signal.text; };
    const keyForSignalText = (text) => { const t = TOPICS.find((x) => x.signal && x.signal.text === text); return t ? t.key : null; };
    const keyA = keyForSignalText(signalA.signal), keyB = keyForSignalText(signalB.signal);
    if (!keyA || !keyB) return { found: false };

    const pair = RELATIONSHIP_PAIRS.find((p) => (p.keys[0] === keyA && p.keys[1] === keyB) || (p.keys[0] === keyB && p.keys[1] === keyA));
    if (!pair) return { found: false };

    // Cite exactly what already, genuinely supports each signal - never a
    // fabricated id. This is honest even though it's mechanical: it reuses
    // the two signals' own real supportingEvidenceIds rather than inventing
    // a new evidence claim to justify the connection.
    const supportingEvidenceIds = [...(signalA.supportingEvidenceIds || []), ...(signalB.supportingEvidenceIds || [])].slice(0, 4);
    return { found: true, signalAId: signalA.id, signalBId: signalB.id, type: pair.type, relationship: pair.relationship, supportingEvidenceIds };
  }

  phrase(user) {
    const m = user.match(/Objective:\n([\s\S]*?)(?:\n\nLanguage:|$)/i);
    const objective = (m ? m[1] : 'What have you observed about this?').trim();
    const lang = (user.match(/Language:\s*(.+)$/i) || [, 'English'])[1].trim().toLowerCase();
    if (lang.includes('telugu')) return { text: `మీరు చెప్పిన పరిస్థితిలో, ${objective.toLowerCase()}` };
    if (lang.includes('hindi')) return { text: `आपने जो स्थिति बताई है, उसमें: ${objective.toLowerCase()}` };
    if (lang.includes('tamil')) return { text: `நீங்கள் சொன்ன நிலையில்: ${objective.toLowerCase()}` };
    return { text: objective };
  }
}

module.exports = { DiscoveryLocalProvider };
