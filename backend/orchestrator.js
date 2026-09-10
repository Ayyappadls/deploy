const prompts = require('./prompts');
const { validate } = require('./schemas');
const { runDiscoveryPipeline } = require('./discoveryEngine');

function parseJsonLoose(text) {
  let cleaned = (text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  const first = cleaned.indexOf('{'); const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (e) {} }
  return null;
}
function extractPriorQuestions(transcript) { return (transcript || '').split(/\r?\n/).filter(line => /^DLSMirror:\s*/i.test(line)).map(line => line.replace(/^DLSMirror:\s*/i, '').trim()).filter(Boolean); }
function normalizeQuestion(text) { return (text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(); }
function questionIsRepeat(nextQuestion, priorQuestions) { const next=normalizeQuestion(nextQuestion); if(!next)return true; return priorQuestions.some(q=>{const prior=normalizeQuestion(q);if(next===prior)return true;const a=new Set(next.split(' ').filter(w=>w.length>2)),b=new Set(prior.split(' ').filter(w=>w.length>2));let i=0;a.forEach(w=>b.has(w)&&i++);return i/Math.max(1,Math.min(a.size,b.size))>=.88;}); }
function questionTouchesSameTheme(){ return false; }
function chooseFallbackQuestion(){ return null; }
function buildRequest(stage, language, payload) {
  const pre = prompts.sysPreamble(language);
  switch (stage) {
    case 'discover': {
      const priorQuestions=extractPriorQuestions(payload.conversationTranscript||'');
      const latestQuestion=priorQuestions.length?priorQuestions[priorQuestions.length-1]:'';
      const rawGaps=Array.isArray(payload.openGaps)?payload.openGaps:[];
      const openGaps=rawGaps.filter(g=>!latestQuestion||!questionIsRepeat(g.question,[latestQuestion]));
      return {system:pre+prompts.DISCOVERY_INSTRUCTIONS,user:`Conversation so far:\n${payload.conversationTranscript||''}\n\nEvidence already on file:\n${JSON.stringify(payload.evidenceOnFile||[])}\n\nOpen knowledge gaps:\n${JSON.stringify(openGaps)}\n\nPrior DLSMirror questions (anti-repeat only):\n${JSON.stringify(priorQuestions)}`,progression:{priorQuestions,latestQuestion,openGaps}};
    }
    case 'understand': return {system:pre+prompts.UNDERSTAND_INSTRUCTIONS,user:`Evidence:\n${JSON.stringify(payload.evidence||[])}\n\nSignals:\n${JSON.stringify(payload.signals||[])}`};
    case 'diagnose': return {system:pre+prompts.DIAGNOSE_INSTRUCTIONS,user:`Evidence:\n${JSON.stringify(payload.evidence||[])}\n\nRelationships:\n${JSON.stringify(payload.relationships||[])}\n\nPattern:\n${JSON.stringify(payload.pattern||null)}`};
    case 'transition': return {system:pre+prompts.TRANSITION_INSTRUCTIONS,user:`Diagnosis:\n${JSON.stringify(payload.diagnosis||null)}\n\nCommercial thesis:\n${JSON.stringify(payload.thesis||null)}`};
    case 'behavior': return {system:pre+prompts.BEHAVIOR_INSTRUCTIONS,user:`Diagnosis:\n${JSON.stringify(payload.diagnosis||null)}\n\nTransition:\n${JSON.stringify(payload.transition||null)}`};
    case 'stakeholder': return {system:pre+prompts.STAKEHOLDER_INSTRUCTIONS,user:`Diagnosis:\n${JSON.stringify(payload.diagnosis||null)}\n\nTransition:\n${JSON.stringify(payload.transition||null)}\n\nBehavior change:\n${JSON.stringify(payload.behavior||null)}`};
    case 'learning': return {system:pre+prompts.LEARNING_INSTRUCTIONS,user:`Decision on file:\n${JSON.stringify(payload.decision||null)}\n\nWhat the owner reports actually happened:\n${payload.observedText||''}`};
    default:return null;
  }
}
async function callWithRetry(provider,system,user){try{return await provider.generate({system,user});}catch(err){if(err.code==='PROVIDER_UNAVAILABLE'||err.code==='PROVIDER_TIMEOUT'){await new Promise(r=>setTimeout(r,400));return provider.generate({system,user});}throw err;}}
async function reason(stage,language,payload,provider){
  if(stage==='discover'){
    try{return {ok:true,...await runDiscoveryPipeline({provider,language,transcript:payload.conversationTranscript||'',evidenceOnFile:payload.evidenceOnFile||[],askedObjectives:payload.askedObjectives||[],relationships:payload.relationships||[],turnIndex:payload.turnIndex||0})};}
    catch(err){return {ok:false,error:{code:err.code||'PROVIDER_UNAVAILABLE',message:'DLSMirror discovery reasoning is temporarily unavailable.'}};}
  }
  const built=buildRequest(stage,language,payload);if(!built)return {ok:false,error:{code:'INVALID_REQUEST',message:`Unknown reasoning stage: ${stage}`}};
  let raw;try{raw=await callWithRetry(provider,built.system,built.user);}catch(err){return {ok:false,error:{code:err.code||'PROVIDER_UNAVAILABLE',message:'DLSMirror reasoning is temporarily unavailable.'}};}
  let parsed=parseJsonLoose(raw),reason_=parsed?validate(stage,parsed):'could not parse a JSON object from the response';
  if(reason_){try{raw=await provider.generate({system:built.system,user:built.user+`\n\nYour previous response was invalid (${reason_}). Respond again with ONLY a single valid JSON object matching the required schema exactly.`});parsed=parseJsonLoose(raw);reason_=parsed?validate(stage,parsed):'could not parse a JSON object from the retry response';}catch(err){return {ok:false,error:{code:err.code||'PROVIDER_UNAVAILABLE',message:'DLSMirror reasoning is temporarily unavailable.'}};}}
  if(reason_)return {ok:false,error:{code:'SCHEMA_VALIDATION_FAILED',message:'DLSMirror could not validate the reasoning result.'}};
  return {ok:true,data:parsed};
}
module.exports={reason,buildRequest,parseJsonLoose,extractPriorQuestions,questionIsRepeat,questionTouchesSameTheme,chooseFallbackQuestion};