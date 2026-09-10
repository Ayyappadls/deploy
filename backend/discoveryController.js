const LAYERS=['owner','offer','customer','revenue','market','operations','finance','organization','commercial','external'];
const FACT_STATUSES=new Set(['OWNER-PROVIDED','OBSERVED','CALCULATED','VERIFIED']);
const WEAK_STATUSES=new Set(['INFERRED','HYPOTHESIS','UNKNOWN']);
const SUBSTANTIVE=/\b(i|we)\b.{0,80}\b(run|own|sell|provide|make|manufacture|distribute|deliver|operate)\b|\b(sales|customers?|revenue|orders?|products?|services?|shop|store|business|money|cash|cost|staff|supplier|competition|market|profit|loan|debt|stock|inventory|credit|payment)\b/i;
function norm(s=''){return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();}
function ownerTurns(t=''){return String(t).split(/\r?\n/).filter(x=>/^Owner:\s*/i.test(x)).map(x=>x.replace(/^Owner:\s*/i,'').trim()).filter(Boolean);}
function dlsQuestions(t=''){return String(t).split(/\r?\n/).filter(x=>/^DLSMirror:\s*/i.test(x)).map(x=>x.replace(/^DLSMirror:\s*/i,'').trim()).filter(Boolean);}
function latestOwner(t=''){const a=ownerTurns(t);return a[a.length-1]||'';}
function meaningfulEvidence(e=[]){return(e||[]).filter(x=>x&&x.normalizedMeaning&&!/^owner shared additional detail/i.test(x.normalizedMeaning));}
function hasLayer(e,l){return(e||[]).some(x=>x.layer===l);}
function hasQuestion(q,c){const a=norm(c);if(!a)return true;return q.some(x=>{const b=norm(x);if(a===b)return true;const aw=new Set(a.split(' ').filter(w=>w.length>3)),bw=new Set(b.split(' ').filter(w=>w.length>3));let i=0;aw.forEach(w=>bw.has(w)&&i++);return i/Math.max(1,Math.min(aw.size,bw.size))>=.8;});}
function questionForLayer(layer,latest){
 if(layer==='owner')return'What are you trying to change or improve in the business right now?';
 if(layer==='offer')return'What do you mainly sell or provide, and what has been happening with it lately?';
 if(layer==='customer')return/sales|buy|order|customer/i.test(latest)?'When customers buy from you, what has changed recently in how often or how much they buy?':'Who usually buys from you, and what has changed with those customers recently?';
 if(layer==='revenue')return'When you say the business is changing, what has happened to the money coming in compared with before?';
 if(layer==='market')return'Has anything changed outside the business — competitors, demand, prices, season, or the local market?';
 if(layer==='operations')return'What has become harder to deliver or manage day to day compared with before?';
 if(layer==='finance')return/cash|money/i.test(latest)?'When the money comes in, where does it usually go before you feel you have enough left?':'How does money move through the business after a sale — when customers pay and when you pay suppliers or other costs?';
 if(layer==='organization')return'Who usually makes the important day-to-day decisions, and what happens when you are not there?';
 if(layer==='commercial')return'What do you currently keep track of to know whether the business is doing well or getting worse?';
 return'What outside change do you think may be affecting the business right now?';
}
function evidenceIds(e=[]){return new Set((e||[]).map(x=>x?.id).filter(Boolean));}
function supportedRelationship(r,ids){return Array.isArray(r?.supportingEvidenceIds)&&r.supportingEvidenceIds.length>=2&&r.supportingEvidenceIds.every(id=>ids.has(id));}
function relationshipReadiness({evidence,signals,relationships=[]}){
 const ids=evidenceIds(evidence);
 const explicit=(relationships||[]).filter(r=>supportedRelationship(r,ids));
 const crossLayerSignals=(signals||[]).filter(s=>Array.isArray(s.relatedLayers)&&new Set(s.relatedLayers.filter(Boolean)).size>=2&&Array.isArray(s.supportingEvidenceKeys)&&s.supportingEvidenceKeys.length>=2&&s.supportingEvidenceKeys.every(id=>ids.has(id)));
 return {ready:explicit.length>0||crossLayerSignals.length>0,explicitCount:explicit.length,crossLayerSignalCount:crossLayerSignals.length};
}
function decisionContextReady({latest,evidence}){
 if(hasLayer(evidence,'owner'))return true;
 return /trying to|want to|need to|worried|concerned|decision|improve|change|fix|causing|problem/i.test(String(latest||''));
}
function buildCandidates({latest,evidence,signals,openGaps,contradictions,questions,relationships}){
 const c=[],meaningful=meaningfulEvidence(evidence),seen=new Set((evidence||[]).map(e=>e.layer));
 const rel=relationshipReadiness({evidence,signals,relationships});
 if((contradictions||[]).length)c.push({priority:100,objective:'resolve_contradiction',text:'I noticed two things that may not line up. Which one is closer to what usually happens in the business?',why:'I want to resolve the conflict before using either statement to draw a conclusion.'});
 for(const e of(evidence||[]).filter(x=>WEAK_STATUSES.has(String(x.evidenceStatus||'').toUpperCase())).slice(0,2))if(e.verificationQuestion&&!hasQuestion(questions,e.verificationQuestion))c.push({priority:95,objective:'verify_inference',layer:e.layer,text:e.verificationQuestion,why:'This is currently an inference or hypothesis, so checking it will materially reduce uncertainty.'});
 if(!meaningful.length)c.push({priority:1000,objective:'orient',layer:'owner',text:'Tell me a little about the business first — what do you sell or provide, and what has been happening recently?',why:'I do not have enough business context yet to choose a specific line of investigation.'});
 if(/sales?\s*(are|is|have|has)?\s*(slow|down|fall|drop|declin)|fewer customers|customers?\s*(are|have|are not)\s*(coming|buying)|revenue\s*(is|has)\s*(down|fall)/i.test(latest))c.push({priority:92,objective:'clarify_active_signal',layer:/customer/i.test(latest)?'customer':'revenue',text:/customer/i.test(latest)?'When you say customers have changed, are fewer people coming, or are they buying less when they come?':'When you say sales are down, is it mainly fewer customers, smaller purchases, or both?',why:'I want to define the change clearly before testing what is causing it.'});
 if(/cash|money|not enough left|short of money|cash flow/i.test(latest))c.push({priority:90,objective:'trace_money',layer:'finance',text:'When the money comes in, what usually takes it back out again?',why:'The cash signal matters, but I need to understand where the money goes before deciding what is constraining it.'});
 if(!rel.ready&&meaningful.length>=2)c.push({priority:88,objective:'test_relationship',layer:null,text:'You mentioned a few things changing at the same time. Which of these do you think is directly connected to the other — and what makes you say that?',why:'I have signals, but the relationship between them is not yet established with enough evidence to support a deeper diagnosis.'});
 const adjacency={owner:['customer','offer','organization'],offer:['customer','revenue','operations'],customer:['revenue','market','offer'],revenue:['customer','finance','offer'],market:['customer','external','offer'],operations:['offer','organization','finance'],finance:['revenue','customer','operations'],organization:['owner','operations','commercial'],commercial:['revenue','operations','organization'],external:['market','operations','finance']};
 const active=[...(evidence||[]).map(e=>e.layer),...(signals||[]).flatMap(s=>s.relatedLayers||[])].filter(Boolean),anchor=active[active.length-1]||'owner';
 for(const layer of(adjacency[anchor]||LAYERS))if(!seen.has(layer))c.push({priority:60,objective:'material_gap',layer,text:questionForLayer(layer,latest),why:'This checks a material adjacent part of the business so the active signal is not interpreted in isolation.'});
 if(meaningful.length>=2&&!hasLayer(evidence,'owner'))c.push({priority:45,objective:'decision_context',layer:'owner',text:'What are you most worried about getting wrong here, or what decision are you trying to make?',why:'Knowing the decision context helps focus the investigation on what matters most.'});
 for(const g of(openGaps||[]))if(g?.question&&!hasQuestion(questions,g.question)){const score=(g.importance==='high'?20:0)+(g.diagnosticImpact==='high'?15:0)+(g.decisionImpact==='high'?10:0)+(g.relationshipImpact==='high'?10:0);c.push({priority:30+score,objective:'open_gap',layer:g.relatedLayer||null,text:g.question,why:'This is an unresolved information gap that could materially change the investigation.'});}
 return c.filter(x=>x.text&&!hasQuestion(questions,x.text));
}
function computeDiscoveryState({transcript='',evidenceOnFile=[],signals=[],openGaps=[],contradictions=[],relationships=[]}){
 const latest=latestOwner(transcript),evidence=Array.isArray(evidenceOnFile)?evidenceOnFile:[],questions=dlsQuestions(transcript),meaningful=meaningfulEvidence(evidence),rel=relationshipReadiness({evidence,signals,relationships}),decisionReady=decisionContextReady({latest,evidence}),candidates=buildCandidates({latest,evidence,signals,openGaps,contradictions,questions,relationships});
 candidates.sort((a,b)=>b.priority-a.priority);
 const materialUnknowns=(openGaps||[]).filter(g=>g&&(g.importance==='high'||g.diagnosticImpact==='high'||g.decisionImpact==='high'||g.relationshipImpact==='high'));
 const stage=!meaningful.length?'ORIENTATION':signals.length?'SIGNAL_INVESTIGATION':'BUSINESS_REALITY';
 const factCount=meaningful.filter(e=>FACT_STATUSES.has(String(e.evidenceStatus||'').toUpperCase())).length;
 const coreContext=hasLayer(evidence,'owner')&&(hasLayer(evidence,'customer')||hasLayer(evidence,'offer'))&&hasLayer(evidence,'revenue');
 const complete=factCount>=5&&signals.length>=1&&rel.ready&&materialUnknowns.length===0&&!(contradictions||[]).length&&coreContext&&decisionReady;
 return{stage,latest,questions,evidenceCount:meaningful.length,factCount,activeSignalCount:signals.length,materialUnknownCount:materialUnknowns.length,contradictionCount:(contradictions||[]).length,relationshipReadiness:rel,decisionContextReady:decisionReady,coreContextReady:coreContext,candidates,nextBestQuestion:candidates[0]||null,complete};
}
function applyController(data,state){
 const out={...data};
 if(!SUBSTANTIVE.test(state.latest||'')){out.evidence=[];out.signals=[];out.knowledge_gaps=[];}
 const plan=state.nextBestQuestion;if(!plan){out.next_question=null;return out;}
 const providerQ=out.next_question?.text||'';
 const generic=/anything else about|before i look at the full picture|how the money moves through the business/i.test(providerQ);
 const mustControl=state.stage==='ORIENTATION'||!state.relationshipReadiness.ready||['resolve_contradiction','verify_inference','clarify_active_signal','trace_money','test_relationship'].includes(plan.objective)||generic||!providerQ;
 if(mustControl)out.next_question={text:plan.text,why:plan.why,replies:[]};
 return out;
}
module.exports={computeDiscoveryState,applyController,latestOwner,ownerTurns,dlsQuestions,norm,relationshipReadiness};