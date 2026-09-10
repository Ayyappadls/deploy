const { ReasoningProvider } = require('./ReasoningProvider');

// Local adapter for the same two narrow LLM contracts used by discoveryEngine:
// evidence extraction and question phrasing. It never selects the investigation
// objective; the deterministic discovery engine remains authoritative for that.
class DiscoveryLocalProvider extends ReasoningProvider {
  constructor(delegate) { super(); this.delegate = delegate; }

  async generate({ system = '', user = '' }) {
    if (/TASK:\s*EXTRACT_EVIDENCE/i.test(system)) return JSON.stringify(this.extract(user));
    if (/TASK:\s*PHRASE_QUESTION/i.test(system)) return JSON.stringify(this.phrase(user));
    return this.delegate.generate({ system, user });
  }

  extract(user) {
    const m = user.match(/Latest owner message:\n([\s\S]*?)(?:\n\nExisting evidence|\n\nReturn exactly|$)/i);
    const text = (m ? m[1] : '').trim();
    const lower = text.toLowerCase();
    const evidence = [];
    const signals = [];
    const knowledge = [];
    const add = (normalizedMeaning, layer, signal, topic, delta = 0.35) => {
      const id = `local-${evidence.length + 1}`;
      evidence.push({ id, normalizedMeaning, layer, evidenceStatus: 'OWNER-PROVIDED', originalStatement: text });
      if (signal) signals.push({ signal, severity: /cash|slow|declin|pressure|fall|drop/i.test(signal) ? 'high' : 'medium', relatedLayers: [layer] });
      if (topic) knowledge.push({ topic, delta, decays: true });
    };
    if (/sales|revenue|orders|selling|selling less/.test(lower)) add('Sales are slowing or changing.', 'revenue', 'Sales are slowing', 'revenue', 0.45);
    if (/cash|cash flow|money pressure|under pressure with cash|short of money|liquidity/.test(lower)) add('The business is under pressure with cash.', 'finance', 'Cash pressure is increasing', 'cash_position', 0.45);
    if (/customer|client|buyer/.test(lower)) add('Customer behaviour is changing or is relevant to the current issue.', 'customer', 'Customer behaviour may be changing', 'customer', 0.3);
    if (/cost|expense|margin|profit/.test(lower)) add('Costs or profitability are relevant to the current issue.', 'finance', 'Cost or margin pressure may be relevant', 'economics', 0.3);
    if (!evidence.length && text) add(`Owner reported: ${text.slice(0, 180)}`, 'commercial', null, 'business_reality', 0.2);
    return { evidence, signals, knowledge, contradictions: [] };
  }

  phrase(user) {
    const m = user.match(/Objective:\n([\s\S]*?)(?:\n\nRelevant signals:|\n\nLanguage:|$)/i);
    const objective = (m ? m[1] : 'What have you observed about this?').trim();
    const lang = (user.match(/Language:\s*(.+)$/i) || [,'English'])[1].trim().toLowerCase();
    if (lang.includes('telugu')) return { text: `మీరు చెప్పిన పరిస్థితిలో, ${objective.toLowerCase()} గురించి మీరు ఏమి గమనించారు?` };
    if (lang.includes('hindi')) return { text: `आपने जो स्थिति बताई है, उसमें ${objective.toLowerCase()} के बारे में आपने क्या देखा है?` };
    return { text: `${objective.replace(/[.]$/, '')} What have you observed?` };
  }
}

module.exports = { DiscoveryLocalProvider };
