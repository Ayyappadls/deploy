const LAYERS=['owner','offer','customer','revenue','market','operations','finance','organization','commercial','external'];
const FACT_STATUSES=new Set(['OWNER-PROVIDED','OBSERVED','CALCULATED','VERIFIED']);
const WEAK_STATUSES=new Set(['INFERRED','HYPOTHESIS','UNKNOWN']);
const SUBSTANTIVE=/\b(i|we)\b.{0,100}\b(run|own|sell|provide|make|manufacture|distribute|deliver|operate)\b|\b(sales|customers?|revenue|orders?|products?|services?|shop|store|business|money|cash|cost|staff|supplier|competition|market|profit|loan|debt|stock|inventory|credit|payment|margin|support|implementation|engineering|customization|capacity)\b/i;
function norm(s=''){return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();}
function ownerTurns(t=''){return String(t).split(/\r?\n/).filter(x=>/^Owner:\s*/i.test(x)).map(x=>x.replace(/^Owner:\s*/i,'').trim()).filter(Boolean);}
function dlsQuestions(t=''){return String(t).split(/\r?\n/).filter(x=>/^DLSMirror:\s*/i.test(x)).map(x=>x.replace(/^DLSMirror:\s*/i,'').trim()).filter(Boolean);}
function latestOwner(t=''){const a=ownerTurns(t);return a[a.length-1]||'';}
function meaningfulEvidence(e=[]){return(e||[]).filter(x=>x&&x.normalizedMeaning&&!/^owner shared additional detail/i.test(x.normalizedMeaning));}
function hasLayer(e,l){return(e||[]).some(x=>x.layer===l);}
function evidenceText(e=[]){return(e||[]).map(x=>x?.normalizedMeaning||x?.originalStatement||x?.statement||'').filter(Boolean).join(' ');}
function signalNames(signals=[]){return(signals||[]).filter(s=>s?.id).map(s=>String(s.signal||s.name||'').trim()).filter(Boolean);}
function evidenceIds(e=[]){return new Set((e||[]).map(x=>x?.id).filter(Boolean));}
function evidenceStatus(id,evidence=[]){const e=(evidence||[]).find(x=>x?.id===id);return String(e?.evidenceStatus||'').toUpperCase();}
function supportedRelationship(r,evidence=[],signals=[]){
 const ids=evidenceIds(evidence),refs=Array.isArray(r?.supportingEvidenceIds)?r.supportingEvidenceIds:[],signalIds=new Set((signals||[]).map(s=>s?.id).filter(Boolean));
 if(refs.length<2||new Set(refs).size<2||!refs.every(id=>ids.has(id)))return false;
 if(!r?.signalAId||!r?.signalBId||r.signalAId===r.signalBId)return false;
 if(!signalIds.has(r.signalAId)||!signalIds.has(r.signalBId))return false;
 if(!['CAUSES','CORRELATES_WITH','CONTRIBUTES_TO'].includes(r?.type))return false;
 if(Array.isArray(r.contradictionIds)&&r.contradictionIds.length)return false;
 return refs.every(id=>FACT_STATUSES.has(evidenceStatus(id,evidence)));
}
function relationshipReadiness({evidence,signals,relationships=[]}){
 const explicit=(relationships||[]).filter(r=>supportedRelationship(r,evidence,signals));
 return {ready:explicit.length>0,explicitCount:explicit.length,crossLayerSignalCount:0};
}
function decisionContextReady({latest,evidence}){
 const text=[latest,...(evidence||[]).filter(e=>e.layer==='owner').map(e=>e.normalizedMeaning||e.originalStatement||'')].join(' ');
 return /trying to|want to|need to|worried|concerned|decision|improve|change|fix|problem|what should|what do i do|where should/i.test(text);
}
function alreadyKnown(text,transcript){return hasQuestion(dlsQuestions(transcript),text);}
function hasQuestion(q,c){const a=norm(c);if(!a)return true;return q.some(x=>{const b=norm(x);if(a===b)return true;const aw=new Set(a.split(' ').filter(w=>w.length>3)),bw=new Set(b.split(' ').filter(w=>w.length>3));let i=0;aw.forEach(w=>bw.has(w)&&i++);const ratio=i/Math.max(1,Math.min(aw.size,bw.size));return ratio>=.8||((aw.size>=5&&bw.size>=5)&&i>=Math.min(aw.size,bw.size)-1);});}
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
function relationshipQuestion(signals=[],evidence=[]){
 const names=signalNames(signals),text=evidenceText(evidence);
 if(names.length>=2)return`You mentioned ${names[0]} and ${names[1]}. Do you think they are connected, or could they be separate issues? What makes you say that?`;
 if(/revenue/i.test(text)&&/profit|cash|margin/i.test(text)&&/cost|support|engineering|salary|expense/i.test(text))return'Your revenue is growing, but profit or cash is not improving while costs are rising. Do you think the extra revenue is coming with higher costs to serve customers? What have you observed?';
 if(/customer|client/i.test(text)&&/custom|support|implementation|service/i.test(text)&&/engineering|operation|cost/i.test(text))return'You mentioned customers need more customization or support, while delivery effort is increasing. Do you think the customer requirements are driving the higher delivery cost? What have you observed?';
 return'There are several changes showing up in the business. Which of them do you think are connected, if any, and what makes you say that?';
}
function materialPatternCandidates(latest,evidence,signals,questions){
 const text=`${latest} ${evidenceText(evidence)}`.toLowerCase(),c=[];
 const add=(priority,objective,text,why)=>{if(text&&!hasQuestion(questions,text))c.push({priority,objective,text,why});};
 const econ=/revenue/.test(text)&&/(profit|margin|cash)/.test(text);
 const service=/customization|customer-specific|custom work/.test(text)&&/support|implementation|engineering|delivery/.test(text);
 const capacity=/capacity|team time|effort|resource|engineering/.test(text)&&/customer|implementation|support|custom/.test(text);
 const owner=/owner|founder|myself|come back to me|when i.?m away|decision.*delay/.test(text);
 const money=/cost|expense|cash|profit|margin/.test(text);
 if(econ&&service){add(99,'test_customer_economics','You’ve established that revenue is growing while customer complexity and delivery effort are also rising. Are the customers creating the most implementation, support or engineering work also the ones contributing most of the additional revenue?','This distinguishes healthy revenue growth from revenue whose economics may be deteriorating.');add(98,'quantify_cost_to_serve','Compared with a typical customer, how much more team time or cost does a highly customized customer require to onboard and support?','The mechanism is plausible, but its materiality is not yet quantified.');add(97,'test_reusability','When engineering builds something for a specific customer, how often does that work become part of the standard product versus remaining a one-off solution?','This tests whether growing customer complexity is creating reusable product value or recurring delivery burden.');}
 else if(service&&capacity){add(99,'quantify_cost_to_serve','You said customer complexity is increasing team time. What is the biggest source of that additional effort — implementation, support, engineering changes, or something else?','I need to isolate the mechanism producing the capacity pressure.');add(98,'test_reusability','When the team handles a customer-specific request, does that work usually become reusable for other customers, or is it mostly one-off?','This distinguishes scalable product investment from non-scalable service work.');}
 if(econ&&money&&!service){add(98,'distinguish_economic_driver','Revenue is increasing but profit and cash are not improving. Which cost or investment has increased the most relative to the revenue growth?','Several economic explanations remain possible, so I need to distinguish the dominant driver.');add(97,'quantify_economic_change','Roughly how has the cost of serving or acquiring a customer changed compared with before?','Quantifying the change will show whether the economic gap is material.');}
 if(owner&&service){add(96,'test_owner_complexity','You’ve said customer exceptions and complex work still come back to you. Are the same customer situations that consume the most team effort also the ones that require the most of your decisions?','This tests whether customer complexity is also creating owner dependency.');}
 if(owner&&!service){add(94,'test_decision_dependency','When a decision comes back to you, what is usually missing that prevents the team from making it themselves — authority, information, a clear rule, or something else?','This identifies the mechanism behind decision dependency rather than treating owner dependence as the diagnosis.');}
 return c;
}
function buildCandidates({latest,evidence,signals,openGaps,contradictions,questions,relationships,transcript}){
 const c=[],meaningful=meaningfulEvidence(evidence),seen=new Set((evidence||[]).map(e=>e.layer));
 const rel=relationshipReadiness({evidence,signals,relationships});
 const currentOwnerIsSubstantive=SUBSTANTIVE.test(latest);
 const add=(priority,objective,text,why,layer=null)=>{if(text&&!hasQuestion(questions,text))c.push({priority,objective,text,why,layer});};
 if((contradictions||[]).length)add(110,'resolve_contradiction','I noticed two things that may not line up. Which one is closer to what usually happens in the business?','I want to resolve the conflict before using either statement to draw a conclusion.');
 for(const e of(evidence||[]).filter(x=>WEAK_STATUSES.has(String(x.evidenceStatus||'').toUpperCase())).slice(0,3))if(e.verificationQuestion&&!hasQuestion(questions,e.verificationQuestion))add(108,'verify_inference',e.verificationQuestion,'This is currently an inference or hypothesis, so checking it will materially reduce uncertainty.',e.layer);
 if(!meaningful.length&&!currentOwnerIsSubstantive){add(1000,'orient','Tell me a little about the business first — what do you sell or provide, and what has been happening recently?','I do not have enough business context yet to choose a specific line of investigation.','owner');return c;}
 const material=materialPatternCandidates(latest,evidence,signals,questions);
 for(const x of material)c.push(x);
 const customerMixKnown=/(fewer|less) customers?.{0,120}(spend|buy|purchase)|(spend|buy|purchase).{0,120}(less|lower).{0,120}customers?/i.test(`${latest} ${evidenceText(evidence)}`);
 if(/sales?\s*(are|is|have|has)?\s*(slow|down|fall|drop|declin)|fewer customers|customers?\s*(are|have|are not)\s*(coming|buying)|revenue\s*(is|has)\s*(down|fall)/i.test(latest)&&!customerMixKnown)add(92,'clarify_active_signal',/customer/i.test(latest)?'When you say customers have changed, are fewer people coming, or are they buying less when they come?':'When you say sales are down, is it mainly fewer customers, smaller purchases, or both?','I want to define the change clearly before testing what is causing it.',/customer/i.test(latest)?'customer':'revenue');
 if(/cash|money|not enough left|short of money|cash flow/i.test(latest))add(90,'trace_money','When the money comes in, what usually takes it back out again?','The cash signal matters, but I need to understand where the money goes before deciding what is constraining it.','finance');
 if(!rel.ready&&meaningful.length>=2){const rq=relationshipQuestion(signals,evidence);if(!hasQuestion(questions,rq))add(94,'test_relationship',rq,'I have several signals without an evidence-backed relationship. I need to test the most material connection before deeper interpretation.');}
 const highGaps=(openGaps||[]).filter(g=>g&&(g.importance==='high'||g.diagnosticImpact==='high'||g.decisionImpact==='high'||g.relationshipImpact==='high'));
 for(const g of highGaps)if(g?.question&&!hasQuestion(questions,g.question)){const score=(g.importance==='high'?20:0)+(g.diagnosticImpact==='high'?15:0)+(g.decisionImpact==='high'?10:0)+(g.relationshipImpact==='high'?10:0);add(80+score,'open_gap',g.question,'This is an unresolved information gap that could materially change the investigation.',g.relatedLayer||null);}
 if(meaningful.length>=2&&!decisionContextReady({latest,evidence}))add(70,'decision_context','What are you most worried about getting wrong here, or what decision are you trying to make?','I need the owner’s decision or concern to focus the investigation on what matters most.','owner');
 const adjacency={owner:['customer','offer','organization'],offer:['customer','revenue','operations'],customer:['revenue','market','offer'],revenue:['customer','finance','offer'],market:['customer','external','offer'],operations:['offer','organization','finance'],finance:['revenue','customer','operations'],organization:['owner','operations','commercial'],commercial:['revenue','operations','organization'],external:['market','operations','finance']};
 const active=[...(evidence||[]).map(e=>e.layer),...(signals||[]).flatMap(s=>s.relatedLayers||[])].filter(Boolean),anchor=active[active.length-1]||'owner';
 // Ontology questions are deliberately low priority. They are fallbacks, never the default path when a material investigation exists.
 if(material.length===0&&highGaps.length===0&&!(!rel.ready&&meaningful.length>=2))for(const layer of(adjacency[anchor]||LAYERS))if(!seen.has(layer))add(40,'material_gap',questionForLayer(layer,latest),'Check an adjacent business area only because no higher-value unresolved mechanism is currently available.',layer);
 return c;
}
function computeDiscoveryState({transcript='',evidenceOnFile=[],signals=[],openGaps=[],contradictions=[],relationships=[]}){
 const latest=latestOwner(transcript),evidence=Array.isArray(evidenceOnFile)?evidenceOnFile:[],questions=dlsQuestions(transcript),meaningful=meaningfulEvidence(evidence),rel=relationshipReadiness({evidence,signals,relationships}),decisionReady=decisionContextReady({latest,evidence}),candidates=buildCandidates({latest,evidence,signals,openGaps,contradictions,questions,relationships,transcript});
 candidates.sort((a,b)=>b.priority-a.priority);
 const materialUnknowns=(openGaps||[]).filter(g=>g&&(g.importance==='high'||g.diagnosticImpact==='high'||g.decisionImpact==='high'||g.relationshipImpact==='high'));
 const stage=!meaningful.length&&!SUBSTANTIVE.test(latest)?'ORIENTATION':signals.length?'SIGNAL_INVESTIGATION':'BUSINESS_REALITY';
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
 const ontology=/what do you mainly sell or provide|who usually buys from you|has anything changed outside the business|what outside change do you think/i.test(providerQ);
 const controllerObjectives=['orient','resolve_contradiction','verify_inference','clarify_active_signal','trace_money','test_relationship','test_economic_mechanism','test_delivery_economics','test_customer_economics','quantify_cost_to_serve','test_reusability','distinguish_economic_driver','quantify_economic_change','test_owner_complexity','test_decision_dependency','decision_context','open_gap'];
 const mustControl=state.stage==='ORIENTATION'||!state.relationshipReadiness.ready||controllerObjectives.includes(plan.objective)||generic||ontology||!providerQ;
 if(mustControl)out.next_question={text:plan.text,why:plan.why,replies:[]};
 return out;
}
module.exports={computeDiscoveryState,applyController,latestOwner,ownerTurns,dlsQuestions,norm,relationshipReadiness,supportedRelationship};
