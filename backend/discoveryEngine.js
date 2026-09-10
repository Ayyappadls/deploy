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
function relationshipSupported(relationships,evidence,signals){const ids=evidenceIds(evidence),sids=new Set(signals.map(s=>s.id));return relationships.some(r=>Array.isArray(r.supportingEvidenceIds)&&r.supportingEvidenceIds.length>=2&&r.supportingEvidenceIds.every(id=>ids.has(id)&&FACT_STATUSES.has(statusOf(evidence.find(e=>e.id===id))))&&r.signalAId&&r.signalBId&&r.signalAId!==r.signalBId&&sids.has(r.signalAId)&&sids.has(r.signalBId)&&['CAUSES','CORRELATES_WITH','CONTRIBUTES_TO'].includes(r.type)&&!(r.contradictionIds||[]).length);}
function deterministicPhrase(objective,language){const l=String(language||'English').toLowerCase();if(l.includes('telugu'))return `మీరు చెప్పిన పరిస్థితిలో, ${objective.description.toLowerCase()} ఏ మేరకు నిజమో కొంచెం వివరించగలరా?`;if(l.includes('hindi'))return `आपने जो स्थिति बताई है, उसमें ${objective.description.toLowerCase()} कितना सही है?`;return `Based on what you’ve told me, ${objective.description.charAt(0).toLowerCase()+objective.description.slice(1)} What have you observed?`;}
async function llmJson(provider,system,user){const raw=await provider.generate({system,user});let text=String(raw||'').replace(/```json/gi,'').replace(/```/g,'').trim();try{return JSON.parse(text);}catch(e){const a=text.indexOf('{'),b=text.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(text.slice(a,b+1));throw new Error('DISCOVERY_LLM_JSON_INVALID');}}
async function runDiscoveryPipeline({provider,language='English',transcript='',evidenceOnFile=[],askedObjectives=[],relationships=[],turnIndex=0}){
  const latest=latestOwner(transcript);const priorQuestions=questionsFrom(transcript);const existing=Array.isArray(evidenceOnFile)?evidenceOnFile:[];
  const extractSystem=`You are DLSMirror's evidence extraction component. TASK: EXTRACT_EVIDENCE. Extract only evidence from the owner's latest message. You do not choose, rank, or propose what to ask next. Do not output a question. Do not use the 10 business layers to decide what to ask. Preserve uncertainty. Return JSON only.`;
  const extractUser=`Latest owner message:\n${latest}\n\nExisting evidence (context only):\n${JSON.stringify(existing)}\n\nReturn exactly {"evidence":[],"signals":[],"knowledge":[],"contradictions":[]}. Evidence items need normalizedMeaning, layer, evidenceStatus, originalStatement. Signals need signal, severity, relatedLayers. Knowledge items need topic, delta, decays. Do not include next_question.`;
  let raw;try{raw=await llmJson(provider,extractSystem,extractUser);}catch(e){raw={evidence:[],signals:[],knowledge:[],contradictions:[]};}
  const delta={evidence:normalizeEvidenceDelta(raw,latest,turnIndex),signals:normalizeSignals(raw,existing),knowledge:Array.isArray(raw.knowledge)?raw.knowledge:[],contradictions:Array.isArray(raw.contradictions)?raw.contradictions:[]};
  const seeded={evidence:[...existing],signals:Array.isArray(raw.signals)?normalizeSignals(raw,existing):[],knowledge:{...knowledgeFromEvidence(existing)},hypotheses:{},askedObjectives:Array.isArray(askedObjectives)?askedObjectives:[]};
  const state=updateHypotheses(applyEvidence(seeded,delta));
  const objective=selectObjective(state);
  let question=null;
  if(objective){const phraseSystem=`You are DLSMirror's question phrasing component. TASK: PHRASE_QUESTION. You receive ONE investigation objective. Phrase exactly that objective as one natural question for a business owner. You cannot see or choose other objectives. Do not introduce another topic. Output JSON only: {"text":"..."}.`;const phraseUser=`Objective:\n${objective.description}\n\nRelevant signals:\n${JSON.stringify(Object.values(state.signals).filter(s=>objective.targetsHypotheses.some(h=>state.hypotheses[h]?.relatesSignals?.includes(s.id))))}\n\nLanguage: ${language}`;try{const phrased=await llmJson(provider,phraseSystem,phraseUser);if(phrased?.text&&!sameQuestion(phrased.text,priorQuestions))question={text:phrased.text,why:'This question is selected because it can most reduce uncertainty in the current business reality.',replies:[]};}catch(e){}if(!question)question={text:deterministicPhrase(objective,language),why:'This is the highest-value unresolved investigation objective in the current state.',replies:[]};}
  const complete=state.evidence.filter(e=>FACT_STATUSES.has(statusOf(e))).length>=5&&Object.keys(state.signals).length>=1&&relationshipSupported(relationships,state.evidence,Object.values(state.signals))&&decisionReady(latest,state.evidence)&&!delta.contradictions.length;
  return{data:{contradictions:delta.contradictions,evidence:delta.evidence,signals:Object.values(state.signals),knowledge_gaps:[],relationships,next_question:question,discoveryState:{stage:state.signals&&Object.keys(state.signals).length?'SIGNAL_INVESTIGATION':'BUSINESS_REALITY',complete,nextObjective:objective?.id||null,expectedInfoGain:objective?.expectedInfoGain||0,evidenceCount:state.evidence.length,activeSignalCount:Object.keys(state.signals).length}}};
}
module.exports={applyEvidence,updateHypotheses,generateCandidateObjectives,scoreObjective,selectObjective,runDiscoveryPipeline,latestOwner,questionsFrom};