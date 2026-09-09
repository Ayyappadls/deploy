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

function questionTouchesSameTheme(question, previousQuestion) {
  const a = normalizeQuestion(question);
  const b = normalizeQuestion(previousQuestion);
  if (!a || !b) return false;
  const themes = [
    ['cash','money','payment','pay','collect','collection','receivable','credit','cashflow'],
    ['profit','margin','cost','expense','spend','ingredient','salary','rent','electricity'],
    ['item','items','product','products','dish','dishes','menu','sell','selling','sales'],
    ['stock','inventory','supplier','suppliers','purchase','buy','buying'],
    ['customer','customers','repeat','return','churn','complaint'],
    ['staff','employee','employees','capacity','busy','slow','operation','operations'],
    ['market','competitor','competition','demand','season','seasonal'],
    ['owner','decision','tracking','records','process','system'],
  ];
  return themes.some(words => {
    const inA = words.some(w => a.includes(w));
    const inB = words.some(w => b.includes(w));
    return inA && inB;
  });
}

function chooseFallbackQuestion(language, priorQuestions, evidenceOnFile) {
  const lang = String(language || 'English').toLowerCase();
  const joinedEvidence = (evidenceOnFile || []).map(e => `${e.layer || ''} ${e.normalizedMeaning || e.statement || ''}`).join(' ').toLowerCase();
  const asked = priorQuestions.map(normalizeQuestion).join(' ');
  const has = (...terms) => terms.some(t => joinedEvidence.includes(t));
  const notAsked = text => !asked.includes(normalizeQuestion(text).slice(0, 48));

  const q = {
    telugu: [
      ['offer', 'వీకెండ్‌లో ఎక్కువగా అమ్ముడయ్యే items ఏవి? వాటిలో ఏవి ingredient ఖర్చులు తీసేసిన తర్వాత ఎక్కువ డబ్బు మిగులుస్తాయో మీకు తెలుసా?'],
      ['operations', 'వీకెండ్‌లో కస్టమర్లు ఎక్కువగా వచ్చినప్పుడు స్టాఫ్ ఖర్చు, సరుకుల ఖర్చు లేదా పని ఒత్తిడి ఎలా మారుతుంది?'],
      ['inventory', 'బిజీగా ఉండే రోజులకు ముందు ఎంత సరుకు కొనాలో మీరు సాధారణంగా ఎలా నిర్ణయిస్తారు?'],
      ['customer', 'మీ రెస్టారెంట్‌కు తిరిగి తిరిగి వచ్చే కస్టమర్లు ఎలాంటి వారు? వారు ఎక్కువగా ఏ items కోసం వస్తారు?'],
    ],
    hindi: [
      ['offer', 'वीकेंड पर सबसे ज्यादा बिकने वाले items कौन से हैं? और क्या आपको पता है कि ingredient cost निकालने के बाद इनमें से कौन से items सबसे ज्यादा पैसा छोड़ते हैं?'],
      ['operations', 'वीकेंड पर ग्राहक बढ़ने के साथ staff cost, ingredient cost या काम का दबाव कैसे बदलता है?'],
      ['inventory', 'बिजी दिनों से पहले कितना stock खरीदना है, आप आम तौर पर कैसे तय करते हैं?'],
      ['customer', 'आपके पास बार-बार आने वाले ग्राहक किस तरह के हैं, और वे आम तौर पर कौन से items लेते हैं?'],
    ],
    tamil: [
      ['offer', 'வார இறுதியில் அதிகமாக விற்கும் items எவை? அவற்றில் ingredient செலவை கழித்த பிறகு எந்த items அதிக பணம் மிச்சப்படுத்துகின்றன என்பது உங்களுக்கு தெரியுமா?'],
      ['operations', 'வார இறுதியில் customer volume அதிகரிக்கும்போது staff cost, ingredient cost அல்லது வேலை அழுத்தம் எப்படி மாறுகிறது?'],
      ['inventory', 'பிஸியான நாட்களுக்கு முன்பு எவ்வளவு stock வாங்க வேண்டும் என்பதை நீங்கள் எப்படி முடிவு செய்கிறீர்கள்?'],
      ['customer', 'மீண்டும் மீண்டும் வரும் customers பொதுவாக யார், அவர்கள் எந்த items-ஐ அதிகமாக வாங்குகிறார்கள்?'],
    ],
    kannada: [
      ['offer', 'ವೀಕೆಂಡ್‌ನಲ್ಲಿ ಹೆಚ್ಚು ಮಾರಾಟವಾಗುವ items ಯಾವವು? ಅವುಗಳಲ್ಲಿ ingredient ಖರ್ಚು ತೆಗೆದ ನಂತರ ಯಾವವು ಹೆಚ್ಚು ಹಣ ಉಳಿಸುತ್ತವೆ ಎಂಬುದು ನಿಮಗೆ ಗೊತ್ತೇ?'],
      ['operations', 'ವೀಕೆಂಡ್‌ನಲ್ಲಿ customers ಹೆಚ್ಚಾದಾಗ staff cost, ingredient cost ಅಥವಾ ಕೆಲಸದ ಒತ್ತಡ ಹೇಗೆ ಬದಲಾಗುತ್ತದೆ?'],
      ['inventory', 'ಬಿಜಿ ದಿನಗಳ ಮುಂಚೆ ಎಷ್ಟು stock ಖರೀದಿಸಬೇಕು ಎಂದು ನೀವು ಸಾಮಾನ್ಯವಾಗಿ ಹೇಗೆ ನಿರ್ಧರಿಸುತ್ತೀರಿ?'],
      ['customer', 'ಮತ್ತೆ ಮತ್ತೆ ಬರುವ customers ಯಾರು, ಮತ್ತು ಅವರು ಸಾಮಾನ್ಯವಾಗಿ ಯಾವ items ಖರೀದಿಸುತ್ತಾರೆ?'],
    ],
    malayalam: [
      ['offer', 'വീക്കൻഡിൽ ഏറ്റവും കൂടുതൽ വിറ്റുപോകുന്ന items ഏവയാണ്? ingredient cost കുറച്ചതിന് ശേഷം ഏതാണ് കൂടുതൽ പണം ബാക്കി വയ്ക്കുന്നത് എന്ന് നിങ്ങൾക്കറിയാമോ?'],
      ['operations', 'വീക്കൻഡിൽ customers കൂടുമ്പോൾ staff cost, ingredient cost അല്ലെങ്കിൽ ജോലി സമ്മർദ്ദം എങ്ങനെ മാറുന്നു?'],
      ['inventory', 'തിരക്കുള്ള ദിവസങ്ങൾക്ക് മുമ്പ് എത്ര stock വാങ്ങണമെന്ന് നിങ്ങൾ സാധാരണ എങ്ങനെ തീരുമാനിക്കുന്നു?'],
      ['customer', 'വീണ്ടും വീണ്ടും വരുന്ന customers ആരൊക്കെയാണ്, അവർ സാധാരണ ഏത് items ആണ് വാങ്ങുന്നത്?'],
    ],
    marathi: [
      ['offer', 'वीकेंडला सर्वात जास्त विकले जाणारे items कोणते? ingredient cost वजा केल्यानंतर कोणते items जास्त पैसे ठेवतात हे तुम्हाला माहीत आहे का?'],
      ['operations', 'वीकेंडला customers वाढले की staff cost, ingredient cost किंवा कामाचा ताण कसा बदलतो?'],
      ['inventory', 'गर्दीच्या दिवसांपूर्वी किती stock घ्यायचा हे तुम्ही साधारण कसे ठरवता?'],
      ['customer', 'पुन्हा पुन्हा येणारे customers कोण आहेत आणि ते साधारण कोणते items घेतात?'],
    ],
    gujarati: [
      ['offer', 'વીકએન્ડમાં સૌથી વધારે વેચાતા items કયા છે? ingredient cost કાઢ્યા પછી કયા items સૌથી વધારે પૈસા છોડે છે તે તમને ખબર છે?'],
      ['operations', 'વીકએન્ડમાં customers વધે ત્યારે staff cost, ingredient cost અથવા કામનો દબાણ કેવી રીતે બદલાય છે?'],
      ['inventory', 'ભીડવાળા દિવસો પહેલાં કેટલો stock ખરીદવો તે તમે સામાન્ય રીતે કેવી રીતે નક્કી કરો છો?'],
      ['customer', 'વારંવાર પાછા આવતા customers કોણ છે અને તેઓ સામાન્ય રીતે કયા items લે છે?'],
    ],
    english: [
      ['offer', 'Which items sell the most on a busy weekend, and do you know which of those actually leave you the most money after ingredient costs?'],
      ['operations', 'When the restaurant gets much busier on weekends, how do staff costs, ingredient costs, or workload change?'],
      ['inventory', 'Before a busy weekend, how do you usually decide how much stock to buy?'],
      ['customer', 'What kinds of customers come back regularly, and which items do they usually buy?'],
    ],
  };
  const options = q[lang] || q.english;
  const layerSeen = {
    offer: has('offer','product','item','dish','menu'),
    operations: has('operations','staff','employee','capacity'),
    inventory: has('inventory','stock','supplier'),
    customer: has('customer','customers'),
  };
  for (const [key, text] of options) {
    if (!layerSeen[key] && notAsked(text)) return { text, why: 'This explores a different part of the business so DLSMirror can test what is driving the issue rather than keep asking about the same signal.', replies: [] };
  }
  return null;
}

function buildRequest(stage, language, payload) {
  const pre = prompts.sysPreamble(language);
  switch (stage) {
    case 'discover': {
      const priorQuestions = extractPriorQuestions(payload.conversationTranscript || '');
      const latestQuestion = priorQuestions.length ? priorQuestions[priorQuestions.length - 1] : '';
      const rawGaps = Array.isArray(payload.openGaps) ? payload.openGaps : [];
      const openGaps = rawGaps.filter(g => !latestQuestion || !questionIsRepeat(g.question, [latestQuestion]));
      const system = pre + prompts.DISCOVERY_INSTRUCTIONS;
      const user = `Conversation so far:\n${payload.conversationTranscript || ''}\n\nEvidence already on file:\n${JSON.stringify(payload.evidenceOnFile || [])}\n\nOpen knowledge gaps that remain AFTER the owner's latest answer (the immediately preceding question has already been answered and must not be selected again):\n${JSON.stringify(openGaps)}\n\nDiscovery progression state:\nThe latest owner message is the answer to the immediately preceding DLSMirror question. The immediately preceding question was: ${JSON.stringify(latestQuestion)}. Do not ask it again. These are all prior DLSMirror questions and are forbidden to repeat or semantically restate:\n${JSON.stringify(priorQuestions)}`;
      return { system, user, progression: { priorQuestions, latestQuestion, openGaps } };
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
    if (err.code === 'PROVIDER_UNAVAILABLE' || err.code === 'PROVIDER_TIMEOUT') {
      await new Promise((r) => setTimeout(r, 400));
      return await provider.generate({ system, user });
    }
    throw err;
  }
}

async function reason(stage, language, payload, provider) {
  const built = buildRequest(stage, language, payload);
  if (!built) return { ok: false, error: { code: 'INVALID_REQUEST', message: `Unknown reasoning stage: ${stage}` } };
  const { system, user } = built;

  let raw;
  try { raw = await callWithRetry(provider, system, user); }
  catch (err) {
    return { ok: false, error: { code: err.code || 'PROVIDER_UNAVAILABLE', message: 'DLSMirror reasoning is temporarily unavailable.' } };
  }

  let parsed = parseJsonLoose(raw);
  let reason_ = parsed ? validate(stage, parsed) : 'could not parse a JSON object from the response';

  if (reason_) {
    try {
      const retryUser = user + `\n\nYour previous response was invalid (${reason_}). Respond again with ONLY a single valid JSON object matching the required schema exactly.`;
      raw = await provider.generate({ system, user: retryUser });
      parsed = parseJsonLoose(raw);
      reason_ = parsed ? validate(stage, parsed) : 'could not parse a JSON object from the retry response';
    } catch (err) {
      return { ok: false, error: { code: err.code || 'PROVIDER_UNAVAILABLE', message: 'DLSMirror reasoning is temporarily unavailable.' } };
    }
  }
  if (reason_) return { ok: false, error: { code: 'SCHEMA_VALIDATION_FAILED', message: 'DLSMirror could not validate the reasoning result.' } };

  if (stage === 'discover' && parsed.next_question && parsed.next_question.text) {
    const priorQuestions = built.progression ? built.progression.priorQuestions : extractPriorQuestions(payload.conversationTranscript || '');
    const previousQuestion = priorQuestions.length ? priorQuestions[priorQuestions.length - 1] : '';
    const repeated = questionIsRepeat(parsed.next_question.text, priorQuestions);
    const sameTheme = previousQuestion && questionTouchesSameTheme(parsed.next_question.text, previousQuestion);
    if (repeated || sameTheme) {
      try {
        const correctionUser = user + `\n\nPROGRESSION VALIDATION FAILED: your proposed next_question either repeats a previous question or stays on the same business theme as the immediately preceding question. The owner has already answered that question. Choose a materially different business layer or cross-layer relationship. Return the complete JSON object again, with a genuinely new next_question in ${language}.`;
        raw = await provider.generate({ system, user: correctionUser });
        parsed = parseJsonLoose(raw);
        reason_ = parsed ? validate(stage, parsed) : 'could not parse progression correction response';
      } catch (err) {
        return { ok: false, error: { code: err.code || 'PROVIDER_UNAVAILABLE', message: 'DLSMirror reasoning is temporarily unavailable.' } };
      }
    }
    if (!reason_ && parsed.next_question && parsed.next_question.text &&
        (questionIsRepeat(parsed.next_question.text, priorQuestions) ||
         (previousQuestion && questionTouchesSameTheme(parsed.next_question.text, previousQuestion)))) {
      const fallback = chooseFallbackQuestion(language, priorQuestions, payload.evidenceOnFile || []);
      if (fallback) parsed.next_question = fallback;
      else parsed.next_question = null;
    }
  }

  return { ok: true, data: parsed };
}

module.exports = { reason, buildRequest, parseJsonLoose, extractPriorQuestions, questionIsRepeat, questionTouchesSameTheme, chooseFallbackQuestion };
