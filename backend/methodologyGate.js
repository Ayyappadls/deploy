/** Deterministic DLSMirror methodology governance. Provider output is untrusted. */
const FACT_STATUSES=new Set(['OWNER-PROVIDED','OBSERVED','CALCULATED','VERIFIED']);
function arr(v){return Array.isArray(v)?v:[];} function str(v){return typeof v==='string'?v:'';}
function evidenceIdSet(p){return new Set(arr(p?.evidence).concat(arr(p?.evidenceOnFile)).map(e=>e?.id).filter(Boolean));}
function materialEvidence(p){return arr(p?.evidence).concat(p?.evidence?[]:arr(p?.evidenceOnFile)).filter(e=>e&&str(e.normalizedMeaning||e.statement));}
function supportedEvidence(r,ids){return Array.isArray(r?.supportingEvidenceIds)&&r.supportingEvidenceIds.length>0&&r.supportingEvidenceIds.every(id=>ids.has(id));}
function contradictionCount(p){return arr(p?.contradictions).length;}
function diagnosisReadiness(p){
 const evidence=materialEvidence(p),signals=arr(p?.signals),relationships=arr(p?.relationships),gaps=arr(p?.openGaps||p?.knowledge_gaps);
 const materialUnknowns=gaps.filter(g=>g&&(['high'].includes(g.importance)||['high'].includes(g.diagnosticImpact)||['high'].includes(g.decisionImpact)||['high'].includes(g.relationshipImpact)));
 const contradictions=contradictionCount(p),supportedRelationships=relationships.filter(r=>supportedEvidence(r,evidenceIdSet(p)));
 const factCount=evidence.filter(e=>FACT_STATUSES.has(str(e.evidenceStatus).toUpperCase())).length;
 const layers=new Set(evidence.map(e=>e.layer).filter(Boolean));
 const coreLayerCoverage=['owner','customer','offer','revenue'].filter(l=>layers.has(l)).length;
 const reasons=[];
 if(factCount<4)reasons.push('not enough established evidence');
 if(signals.length<1)reasons.push('no material signal established');
 if(supportedRelationships.length<1)reasons.push('no evidence-backed relationship established');
 if(materialUnknowns.length)reasons.push('material unknowns remain');
 if(contradictions)reasons.push('material contradictions remain');
 if(coreLayerCoverage<2)reasons.push('insufficient core business context');
 return{ready:reasons.length===0,reasons,factCount,supportedRelationships:supportedRelationships.length,materialUnknowns:materialUnknowns.length,contradictions,coreLayerCoverage};
}
function blocked(stage,r){
 const why=`DLSMirror cannot responsibly conclude yet: ${r.reasons.join('; ')}.`;
 if(stage==='diagnose')return{firstPrinciple:{situation:'Several business signals are visible, but the governing constraint has not been established.',assumptions:'No unverified assumption is being promoted to fact.',evidence:`Established evidence count: ${r.factCount}. Evidence-backed relationships: ${r.supportedRelationships}.`,causalChain:'Signal → relationship → hypothesis → verification → constraint. The chain is not yet sufficiently verified.',underlyingReality:'The current evidence supports continued investigation rather than a definitive root-cause claim.',commercialImplication:'A premature diagnosis could direct the owner toward the wrong intervention.'},invisibleBottleneck:{deconstruction:'No single governing bottleneck is being asserted yet.',behavioralTruth:'Not established from the available evidence.',invisibleConflict:'Multiple plausible explanations remain open.',rootCause:'Not established.',leverageVariable:'The next discriminating question is the current leverage point.',operatingRedesign:'Not ready until the governing constraint is verified.',pilot:'Continue evidence gathering before prescribing a pilot.',strategicEndState:'A verified constraint followed by an evidence-linked transition.'},thesis:{thesis:why,supportingEvidence:'Not sufficient.',contradictingEvidence:'Unresolved uncertainty remains.',falsificationCondition:'Additional evidence changes the governing explanation.'},methodologyGate:{status:'BLOCKED',reasons:r.reasons}};
 if(stage==='transition')return{current:'Several business pressures are visible, but the governing constraint is not verified.',constraint:'Not established.',required:'No transition should be prescribed until the diagnosis is evidence-backed.',future:'A transition derived directly from a verified root cause.',operatingSystem:{mechanism:'Not ready.',owner:'Not assigned.',cadence:'Not assigned.',metric:'Not assigned.',escalation:'Return to diagnosis if evidence remains insufficient.'},methodologyGate:{status:'BLOCKED',reasons:r.reasons}};
 if(stage==='behavior')return{current:'No change mechanism is being prescribed yet.',friction:'Not established.',inertia:'Not established.',relapseRisk:'Premature intervention is the current risk.',wedge:'Continue discovery.',required:'Verify the transition first.',capability:'Not assigned.',adoption:'Not applicable yet.',accountability:'Not assigned.',measure:'Not assigned.',methodologyGate:{status:'BLOCKED',reasons:r.reasons}};
 return{stakeholders:{owner:{means:'The owner needs a reliable diagnosis before acting.',understand:'The evidence is still being established; no unsupported decision is being communicated.'}},decision:{decision:'Continue investigation before making a structural change.',reason:'The DLSMirror evidence gate is not satisfied.',owner:'Owner',actions:[],expectedOutcome:'A defensible decision after the governing constraint is verified.',successMetric:'Diagnosis readiness becomes supported.',reviewDate:'after sufficient evidence is gathered'},methodologyGate:{status:'BLOCKED',reasons:r.reasons}};
}
function gateStage(stage,data,p){
 if(stage==='discover'||stage==='learning')return{data,gate:{status:'OPEN'}};
 const r=diagnosisReadiness(p);
 if(stage==='understand'){
  const ids=evidenceIdSet(p), relationships=arr(data?.relationships).filter(x=>supportedEvidence(x,ids));
  const out={...data,relationships}; if(!relationships.length)out.pattern={statement:'No evidence-backed relationship is established strongly enough yet.',supportingRelationshipKeys:[],supportingSignalIds:[],confidence:'INSUFFICIENT_EVIDENCE'};
  out.methodologyGate={status:'OPEN_WITH_CAUTION',supportedRelationships:relationships.length,note:'Only relationships with explicit evidence support are presented.'}; return{data:out,gate:out.methodologyGate};
 }
 if(stage==='diagnose')return r.ready?{data:{...data,methodologyGate:{status:'OPEN',evidenceBacked:true}},gate:{status:'OPEN'}}:{data:blocked(stage,r),gate:{status:'BLOCKED',reasons:r.reasons}};
 const diagnosis=p?.diagnosis;
 const diagnosisGate=diagnosis?.methodologyGate?.status;
 if(!r.ready||!diagnosis||diagnosisGate!=='OPEN')return{data:blocked(stage,r),gate:{status:'BLOCKED',reasons:r.reasons.concat(!diagnosis?'diagnosis is missing':diagnosisGate!=='OPEN'?'diagnosis is not methodology-approved':[])}};
 if(stage==='transition'&&!p?.thesis)return{data:blocked(stage,{...r,reasons:r.reasons.concat('commercial thesis is missing')}),gate:{status:'BLOCKED',reasons:['commercial thesis is missing']}};
 if((stage==='behavior'||stage==='stakeholder')&&!p?.transition)return{data:blocked(stage,{...r,reasons:r.reasons.concat('approved transition is missing')}),gate:{status:'BLOCKED',reasons:['approved transition is missing']}};
 return{data:{...data,methodologyGate:{status:'OPEN',evidenceBacked:true,causalContinuity:true}},gate:{status:'OPEN'}};
}
module.exports={gateStage,diagnosisReadiness,materialEvidence,supportedEvidence};
