const LAYERS=['owner','offer','customer','revenue','market','operations','finance','organization','commercial','external'];
const FACT_STATUSES=new Set(['OWNER-PROVIDED','OBSERVED','CALCULATED','VERIFIED']);
const WEAK_STATUSES=new Set(['INFERRED','HYPOTHESIS','UNKNOWN']);

function norm(s=''){return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();}
function ownerTurns(t=''){return String(t).split(/\r?\n/).filter(x=>/^Owner:\s*/i.test(x)).map(x=>x.replace(/^Owner:\s*/i,'').trim()).filter(Boolean);}
function questionsFrom(t=''){return String(t).split(/\r?\n/).filter(x=>/^DLSMirror:\s*/i.test(x)).map(x=>x.replace(/^DLSMirror:\s*/i,'').trim()).filter(Boolean);}
function latestOwner(t=''){const a=ownerTurns(t);return a[a.length-1]||'';}
function evidenceText(e=[]){return e.map(x=>x?.normalizedMeaning||x?.originalStatement||x?.statement||'').filter(Boolean).join(' ');}
function evidenceIds(e=[]){return new Set(e.map(x=>x?.id||x?.key).filter(Boolean));}
function statusOf(x){return String(x?.evidenceStatus||'').toUpperCase();}
function meaningful(e=[]){return e.filter(x=>x&&x.normalizedMeaning&&!/^owner shared additional detail/i.test(x.normalizedMeaning));}
function sameQuestion(q, prior=[]){const a=norm(q);if(!a)return true;return prior.some(p=>{const b=norm(p);if(a===b)return true;const aw=new Set(a.split(' ').filter(w=>w.length>3)),bw=new Set(b.split(' ').filter(w=>w.length>3));let n=0;aw.forEach(w=>bw.has(w)&&n++);return n/Math.max(1,Math.min(aw.size,bw.size))>=.85;});}

function normalizeEvidenceDelta(raw, latest, turnIndex){
  const src=raw&&Array.isArray(raw.evidence)?raw.evidence:[];
  return src.slice(0,4).filter(x=>x&&x.normalizedMeaning&&LAYERS.includes(x.layer)).map((x,i)=>({...x,id:x.id||`e-${turnIndex}-${i+1}`,sourceTurn:turnIndex,originalStatement:x.originalStatement||latest}));
}
function normalizeSignals(raw,evidence){
  const src=raw&&Array.isArray(raw.signals)?raw.signals:[];
  const byKey=new Map();
  src.slice(0,4).forEach((x,i)=>{if(!x?.signal)return;const label=norm(x.signal).replace(/\s+/g,'_').slice(0,80);const id=x.id||`sig-${label||i+1}`;byKey.set(id,{...x,id,signal:x.signal,confidence:typeof x.confidence==='number'?x.confidence:0.7,firstObservedAt:x.firstObservedAt||Date.now(),lastUpdatedAt:Date.now()});});
  return [...byKey.values()];
}
function applyEvidence(state,delta){
  const next={...state,signals:{...state.signals},knowledge:{...state.knowledge},hypotheses:{...state.hypotheses},evidence:[...(state.evidence||[])]};
  for(const e of delta.evidence||[]){if(!next.evidence.some(x=>x.id===e.id))next.evidence.push(e);}
  for(const s of delta.signals||[]){const prior=next.signals[s.id];next.signals[s.id]=prior?{...prior,...s,firstObservedAt:prior.firstObservedAt}:s;}
  for(const k of delta.knowledge||[]){if(!k?.topic)continue;const prior=next.knowledge[k.topic];next.knowledge[k.topic]={topic:k.topic,sufficiency:Math.max(0,Math.min(1,(prior?.sufficiency||0)+(k.delta||0))),lastEvidenceAt:k.lastEvidenceAt??Date.now(),decays:k.decays!==false};}
  return next;
}
function updateHypotheses(state){
  const s=Object.values(state.signals);const text=evidenceText(state.evidence).toLowerCase();
  const add=(id,description,relates,score)=>{const prior=state.hypotheses[id];state.hypotheses[id]={id,description,relatesSignals:relates,priorLikelihood:prior?.posteriorLikelihood??score,posteriorLikelihood:Math.max(0,Math.min(1,score)),status:'active'};};
  const sales=s.filter(x=>/sales|revenue|customer.*buy|buying|orders/i.test(x.signal||'')).map(x=>x.id);const cash=s.filter(x=>/cash|money|liquidity|payment|receivable/i.test(x.signal||'')).map(x=>x.id);const cost=s.filter(x=>/cost|expense|margin|profit|support|implementation|engineering|custom/i.test(x.signal||'')).map(x=>x.id);
  if(sales.length&&cash.length)add('sales-to-cash','Sales movement may be contributing to cash pressure',[...sales,...cash],0.55);
  if(cost.length&&cash.length)add('cost-to-cash','Higher costs may be contributing to cash pressure',[...cost,...cash],0.5);
  if(/credit|receivable|customer.*owe|overdue/i.test(text)&&cash.length)add('credit-to-cash','Customer payment timing may be contributing to cash pressure',[...cash],0.55);
  if(/custom|support|implementation|engineering/i.test(text)&&/revenue|sales/i.test(text))add('complexity-to-economics','Customer complexity may be reducing the economics of additional revenue',[...s.map(x=>x.id)],0.55);
  return state;
}
function knowledgeFromEvidence(evidence){
  const text=evidenceText(evidence).toLowerCase();const topics={};
  const set=(topic,sufficiency,decays=true)=>topics[topic]={topic,sufficiency,lastEvidenceAt:Date.now(),decays};
  if(/sell|provide|product|service|offer/.test(text))set('offer',0.8,false);
  if(/customer|client|buyer/.test(text))set('customer',0.65,false);
  if(/sales|revenue|orders|money/.test(text))set('revenue',0.7,true);
  if(/cash|payment|credit|receivable/.test(text))set('cash_position',0.45,true);
  return topics;
}
function discrimination(h,objective){if(!h)return 0;const d=(objective.targetsHypotheses||[]).includes(h.id)?0.35:0;return d;}
function generateCandidateObjectives(state){
  const out=[];const text=evidenceText(state.evidence).toLowerCase();const signals=Object.values(state.signals);const hypotheses=Object.values(state.hypotheses).filter(h=>h.status==='active');
  const add=(id,description,targetsHypotheses,topic,base=0)=>{if(!state.askedObjectives.some(x=>x.objectiveId===id)){out.push({id,description,targetsHypotheses,targetsKnowledgeGaps:topic?[topic]:[],base});}};
  for(const h of hypotheses){if(h.relatesSignals.length>=2)add(`test:${h.id}`,`Test whether ${h.description.replace(/\.$/,'')}.`,[h.id],null,0.25);}
  const sales=/sales|revenue|orders/.test(text),cash=/cash|money pressure|short of money|cash flow/.test(text),cost=/cost|expense|profit|margin/.test(text),customer=/customer|client|buyer/.test(text),complex=/custom|support|implementation|engineering|delivery/.test(text);
  if(sales&&cash)add('cash-driver','Identify the main driver of the cash pressure: sales inflow, customer payment timing, costs, or another mechanism.',['sales-to-cash','cost-to-cash','credit-to-cash'], 'cash_position',0.8);
  if(sales&&!customer)add('customer-demand-driver','Distinguish fewer customers from lower purchasing by existing customers.',[],'customer',0.65);
  if(sales&&cost&&complex)add('customer-complexity-economics','Test whether customer complexity is increasing cost-to-serve and weakening the economics of additional revenue.',['complexity-to-economics'],'customer_complexity_cost_link',0.95);
  if(cash&&!/credit|receivable|overdue|paid|payment/.test(text))add('cash-trace','Trace where cash goes after it comes into the business.',['cost-to-cash'],'cash_position',0.7);
  for(const [topic,k] of Object.entries(state.knowledge))if(k.sufficiency<0.55){if(topic==='offer'&&k.sufficiency<0.55)add('knowledge:offer','Establish what the business mainly sells or provides.',[],'offer',0.2);if(topic==='customer')add('knowledge:customer','Understand who buys and how their behaviour is changing.',[],'customer',0.35);}
  return out;
}
function scoreObjective(o,state){const hs=Object.values(state.hypotheses);const relevantSignals=new Set(Object.values(state.signals).map(s=>s.id));const related=hs.filter(h=>o.targetsHypotheses.includes(h.id));const discrimination=related.reduce((n,h)=>n+Math.min(1,0.35+h.relatesSignals.filter(id=>relevantSignals.has(id)).length*0.12),0);const relevance=o.targetsHypotheses.reduce((n,id)=>n+(state.hypotheses[id]?.posteriorLikelihood||0),0);const topic=o.targetsKnowledgeGaps[0];const gap=topic?(1-(state.knowledge[topic]?.sufficiency||0)):0.25;const recent=state.askedObjectives.findIndex(x=>x.objectiveId===o.id);const recency=recent>=0?0.8:0;return{...o,expectedInfoGain:o.base+0.9*discrimination+0.7*relevance+0.8*gap-0.6*recency};}
function selectObjective(state){return generateCandidateObjectives(state).map(o=>scoreObjective(o,state)).sort((a,b)=>b.expectedInfoGain-a.expectedInfoGain)[0]||null;}
function decisionReady(latest,evidence){return /trying to|want to|need to|worried|concerned|decision|improve|change|fix|problem|what should|what do i do/i.test([latest,evidenceText(evidence)].join(' '));}
async function llmJson(provider,system,user){const raw=await provider.generate({system,user});let text=String(raw||'').replace(/```json/gi,'').replace(/```/g,'').trim();try{return JSON.parse(text);}catch(e){const a=text.indexOf('{'),b=text.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(text.slice(a,b+1));throw new Error('DISCOVERY_LLM_JSON_INVALID');}}
const { computeDiscoveryState, applyController, relationshipReadiness } = require('./discoveryController');
const VALID_LAYERS=['owner','offer','customer','revenue','market','operations','finance','organization','commercial','external'];
const VALID_EVIDENCE_STATUSES=['OWNER-PROVIDED','OBSERVED','INFERRED','HYPOTHESIS'];
const VALID_SEVERITIES=['low','medium','high'];
const VALID_IMPORTANCES=['low','medium','high'];
const VALID_RELATIONSHIP_TYPES=['CAUSES','CORRELATES_WITH','CONTRIBUTES_TO'];
function priorOwnerText(t=''){const a=ownerTurns(t);return a.slice(0,-1).join(' ');}
function validEvidenceItem(x){return x&&typeof x.normalizedMeaning==='string'&&x.normalizedMeaning&&VALID_LAYERS.includes(x.layer)&&VALID_EVIDENCE_STATUSES.includes(x.evidenceStatus);}
function validSignalItem(x){return x&&typeof x.signal==='string'&&x.signal&&VALID_SEVERITIES.includes(x.severity);}
function validGapItem(x){return x&&typeof x.question==='string'&&x.question;}
function pick3(v){return VALID_IMPORTANCES.includes(v)?v:'medium';}

async function runDiscoveryPipeline({provider,language='English',transcript='',evidenceOnFile=[],signalsOnFile=[],relationshipsOnFile=[],openGapsOnFile=[],contradictionsOnFile=[],turnIndex=0}){
  const latest=latestOwner(transcript);
  const prior=priorOwnerText(transcript);
  const existingEvidence=Array.isArray(evidenceOnFile)?evidenceOnFile:[];
  const existingSignals=Array.isArray(signalsOnFile)?signalsOnFile:[];
  const existingRelationships=Array.isArray(relationshipsOnFile)?relationshipsOnFile:[];
  const existingGaps=Array.isArray(openGapsOnFile)?openGapsOnFile:[];
  const existingContradictions=Array.isArray(contradictionsOnFile)?contradictionsOnFile:[];

  // 1) extraction: evidence/signals/knowledge_gaps/contradictions from the
  // owner's latest message only. The model never proposes next_question and
  // never decides sufficiency - the application does, below.
  const extractSystem=`You are DLSMirror's evidence extraction component. TASK: EXTRACT_EVIDENCE. Extract only NEW information from the owner's latest message - never repeat something already on file. Preserve the owner's original wording and give a normalized plain-language meaning. Never invent specific numbers, names, or facts the owner did not provide or clearly imply; if genuinely uncertain, use evidenceStatus INFERRED or HYPOTHESIS rather than a confident status, and include a verificationQuestion. You never label anything VERIFIED - that is reserved for the application. Check whether the latest message contradicts evidence already on file. You do not choose, rank, or propose what to ask next, and you do not decide when Discovery is complete. Write every field in ${language}. Return JSON only.`;
  const extractUser=`Latest owner message:\n${latest}\n\nPrior owner text:\n${prior}\n\nExisting evidence:\n${JSON.stringify(existingEvidence)}\n\nExisting signals:\n${JSON.stringify(existingSignals)}\n\nOpen knowledge gaps:\n${JSON.stringify(existingGaps)}\n\nLanguage: ${language}\n\nReturn exactly {"evidence":[{"key":"e1","originalStatement":"...","normalizedMeaning":"...","layer":"one of ${VALID_LAYERS.join('|')}","evidenceStatus":"one of ${VALID_EVIDENCE_STATUSES.join('|')}","verificationQuestion":""}],"signals":[{"signal":"...","type":"commercial|operational|customer|organizational","severity":"low|medium|high","relatedLayers":[],"supportingEvidenceKeys":["e1"]}],"knowledge_gaps":[{"question":"...","missingInformation":"...","importance":"low|medium|high","diagnosticImpact":"low|medium|high","decisionImpact":"low|medium|high","relationshipImpact":"low|medium|high","relatedLayer":"..."}],"contradictions":[]}. At most 3 evidence items, 2 signals, 2 knowledge gaps, only genuinely new ones.`;
  let raw;try{raw=await llmJson(provider,extractSystem,extractUser);}catch(e){raw={evidence:[],signals:[],knowledge_gaps:[],contradictions:[]};}

  // 2) merge evidence - stable ids, key->id map so signals/relationships
  // proposed this same turn can reference them.
  const keyToId={};
  const newEvidence=(Array.isArray(raw.evidence)?raw.evidence:[]).filter(validEvidenceItem).slice(0,3).map((e,i)=>{
    const id=`ev-${turnIndex}-${i+1}`;if(e.key)keyToId[e.key]=id;
    return {id,statement:e.normalizedMeaning,normalizedMeaning:e.normalizedMeaning,originalStatement:e.originalStatement||latest,layer:e.layer,evidenceStatus:e.evidenceStatus,verificationQuestion:e.verificationQuestion||''};
  });
  const allEvidence=existingEvidence.concat(newEvidence);
  const knownEvidenceIds=new Set(allEvidence.map(e=>e.id));
  const resolveIds=(keys)=>(Array.isArray(keys)?keys:[]).map(k=>keyToId[k]||k).filter(id=>knownEvidenceIds.has(id));

  // 3) merge signals - dedupe by normalized text against what's on file.
  const existingSignalTexts=new Set(existingSignals.map(s=>norm(s.signal||'')));
  const newSignals=(Array.isArray(raw.signals)?raw.signals:[]).filter(validSignalItem).filter(s=>!existingSignalTexts.has(norm(s.signal))).slice(0,2).map((s,i)=>({
    id:`sig-${turnIndex}-${i+1}`,signal:s.signal,type:s.type||'commercial',severity:s.severity,
    relatedLayers:Array.isArray(s.relatedLayers)?s.relatedLayers:[],supportingEvidenceIds:resolveIds(s.supportingEvidenceKeys),status:'active',
  }));
  const allSignals=existingSignals.concat(newSignals);

  // 4) merge knowledge gaps - dedupe by normalized question text.
  const existingGapQuestions=new Set(existingGaps.map(g=>norm(g.question||'')));
  const newGaps=(Array.isArray(raw.knowledge_gaps)?raw.knowledge_gaps:[]).filter(validGapItem).filter(g=>!existingGapQuestions.has(norm(g.question))).slice(0,2).map((g,i)=>({
    id:`gap-${turnIndex}-${i+1}`,question:g.question,missingInformation:g.missingInformation||'',
    importance:pick3(g.importance),diagnosticImpact:pick3(g.diagnosticImpact),decisionImpact:pick3(g.decisionImpact),relationshipImpact:pick3(g.relationshipImpact),
    relatedLayer:VALID_LAYERS.includes(g.relatedLayer)?g.relatedLayer:'commercial',
  }));
  const allGaps=existingGaps.concat(newGaps);

  // 5) contradictions - the frontend is responsible for no longer sending a
  // contradiction once the owner has actually resolved it (see index.html).
  const newContradictions=(Array.isArray(raw.contradictions)?raw.contradictions:[]).filter(c=>c&&c.note).slice(0,1);
  const allContradictions=existingContradictions.concat(newContradictions);

  // 6) relationship extraction - ONLY attempted when 2+ signals exist and
  // none of them are already connected by a supported (evidence-backed)
  // relationship. This is what makes "no relationship -> no causal
  // interpretation -> no completion" enforceable WITHIN Discovery itself,
  // instead of only in a separate stage that runs after completion is
  // already decided.
  let newRelationship=null;
  const readiness=relationshipReadiness({evidence:allEvidence,signals:allSignals,relationships:existingRelationships});
  if(allSignals.length>=2&&!readiness.ready){
    const unconnected=allSignals.filter(s=>!existingRelationships.some(r=>r.signalAId===s.id||r.signalBId===s.id));
    const pair=(unconnected.length>=2?unconnected:allSignals).slice(-2);
    const [a,b]=pair;
    if(a&&b&&a.id!==b.id){
      const relSystem=`You are DLSMirror's relationship extraction component. TASK: EXTRACT_RELATIONSHIP. You are given exactly two signals and the evidence on file. Only report a relationship if there is a SPECIFIC, evidence-backed connection between them - never invent one just because both happen to exist. Cite only real evidence ids already given to you. If there is no clear connection, return {"found":false}. Return JSON only.`;
      const relUser=`Signal A:\n${JSON.stringify(a)}\n\nSignal B:\n${JSON.stringify(b)}\n\nExisting evidence:\n${JSON.stringify(allEvidence)}\n\nLanguage: ${language}\n\nReturn exactly {"found":true or false,"signalAId":"...","signalBId":"...","type":"CAUSES|CORRELATES_WITH|CONTRIBUTES_TO","relationship":"...","supportingEvidenceIds":[]}.`;
      let relRaw;try{relRaw=await llmJson(provider,relSystem,relUser);}catch(e){relRaw={found:false};}
      if(relRaw&&relRaw.found&&relRaw.signalAId===a.id&&relRaw.signalBId===b.id&&VALID_RELATIONSHIP_TYPES.includes(relRaw.type)){
        const citedIds=(Array.isArray(relRaw.supportingEvidenceIds)?relRaw.supportingEvidenceIds:[]).filter(id=>knownEvidenceIds.has(id));
        if(citedIds.length>=2)newRelationship={id:`rel-${turnIndex}-1`,signalAId:a.id,signalBId:b.id,type:relRaw.type,relationship:relRaw.relationship||'',supportingEvidenceIds:citedIds};
      }
    }
  }
  const allRelationships=existingRelationships.concat(newRelationship?[newRelationship]:[]);

  // 7) the app - not the model - decides what's next and whether Discovery
  // is complete, via the deterministic methodology controller.
  const discoveryState=computeDiscoveryState({transcript,evidenceOnFile:allEvidence,signals:allSignals,openGaps:allGaps,contradictions:allContradictions,relationships:allRelationships});
  const controlled=applyController({next_question:null},discoveryState);
  let nextQuestion=null;
  if(controlled.next_question){
    const planText=controlled.next_question.text;
    let text=planText;
    if(!/^english$/i.test(String(language||'English').trim())){
      try{
        const phraseSystem=`You are DLSMirror's question phrasing component. TASK: PHRASE_QUESTION. Phrase the given objective as one natural question for a business owner, in the required language. Do not introduce another topic or change its meaning. Output JSON only: {"text":"..."}.`;
        const phraseUser=`Objective:\n${planText}\n\nLanguage: ${language}`;
        const phrased=await llmJson(provider,phraseSystem,phraseUser);
        if(phrased&&phrased.text)text=phrased.text;
      }catch(e){}
    }
    nextQuestion={text,why:controlled.next_question.why,replies:controlled.next_question.replies||[]};
  }

  return {data:{
    evidence:newEvidence,signals:newSignals,knowledge_gaps:newGaps,contradictions:newContradictions,
    relationships:newRelationship?[newRelationship]:[],
    next_question:discoveryState.complete?null:nextQuestion,
    discoveryState,
  }};
}
module.exports={applyEvidence,updateHypotheses,generateCandidateObjectives,scoreObjective,selectObjective,runDiscoveryPipeline,latestOwner,questionsFrom};