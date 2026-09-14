/** Strict validation for provider output. Provider output is untrusted input. */
const LAYERS = ['owner','offer','customer','revenue','market','operations','finance','organization','commercial','external'];
const EVIDENCE_STATUSES = ['OWNER-PROVIDED','OBSERVED','CALCULATED','INFERRED','HYPOTHESIS','UNKNOWN'];
const SEVERITIES = ['low','medium','high'];
const IMPORTANCES = ['low','medium','high'];
const SIGNAL_TYPES = ['commercial','operational','customer','organizational'];
const RELATIONSHIP_TYPES = ['CAUSES','CORRELATES_WITH','CONTRIBUTES_TO'];
const isStr=v=>typeof v==='string', isArr=v=>Array.isArray(v), isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v), inSet=(v,s)=>s.includes(v);
function validateDiscover(data){
 if(!isObj(data))return'response is not an object';
 for(const k of ['contradictions','evidence','signals','knowledge_gaps'])if(!isArr(data[k]))return`${k} must be an array`;
 if(!('next_question'in data))return'next_question is required (may be null)';
 for(const e of data.evidence)if(!isObj(e)||!isStr(e.normalizedMeaning)||!inSet(e.layer,LAYERS)||!inSet(e.evidenceStatus,EVIDENCE_STATUSES))return'invalid evidence item';
 for(const s of data.signals)if(!isObj(s)||!isStr(s.signal)||!inSet(s.severity,SEVERITIES))return'invalid signal item';
 for(const g of data.knowledge_gaps)if(!isObj(g)||!isStr(g.question))return'invalid knowledge gap';
 if(data.next_question!==null&&(!isObj(data.next_question)||!isStr(data.next_question.text)))return'invalid next_question';
 return null;
}
function validateUnderstand(data){
 if(!isObj(data)||!isArr(data.relationships)||!isObj(data.pattern)||!isStr(data.pattern.statement))return'invalid understand response';
 for(const r of data.relationships){
  if(!isObj(r)||!isStr(r.signalAId)||!isStr(r.signalBId)||!isStr(r.relationship))return'invalid relationship';
  if(!inSet(r.type,RELATIONSHIP_TYPES))return'invalid relationship type';
  if(!isArr(r.supportingEvidenceIds)||r.supportingEvidenceIds.length<2||r.supportingEvidenceIds.some(id=>!isStr(id)))return'relationship requires at least two supporting evidence ids';
 }
 return null;
}
function validateDiagnose(data){
 if(!isObj(data)||!isObj(data.firstPrinciple)||!isObj(data.invisibleBottleneck)||!isObj(data.thesis)||!isStr(data.thesis.thesis))return'invalid diagnosis response';
 for(const k of ['situation','assumptions','evidence','causalChain','underlyingReality','commercialImplication'])if(!isStr(data.firstPrinciple[k]))return`firstPrinciple.${k} must be a string`;
 for(const k of ['deconstruction','behavioralTruth','invisibleConflict','rootCause','leverageVariable','operatingRedesign','pilot','strategicEndState'])if(!isStr(data.invisibleBottleneck[k]))return`invisibleBottleneck.${k} must be a string`;
 return null;
}
function validateTransition(data){
 if(!isObj(data))return'response is not an object';
 for(const k of ['current','constraint','required','future'])if(!isStr(data[k]))return`${k} must be a string`;
 if(!isObj(data.operatingSystem))return'operatingSystem must be an object';
 for(const k of ['mechanism','owner','cadence','metric','escalation'])if(!isStr(data.operatingSystem[k]))return`operatingSystem.${k} must be a string`;
 return null;
}
function validateBehavior(data){if(!isObj(data))return'response is not an object';for(const k of ['current','friction','inertia','relapseRisk','wedge','required','capability','adoption','accountability','measure'])if(!isStr(data[k]))return`${k} must be a string`;return null;}
function validateStakeholder(data){if(!isObj(data)||!isObj(data.stakeholders)||!isObj(data.stakeholders.owner))return'stakeholders.owner is required';for(const key of Object.keys(data.stakeholders)){const s=data.stakeholders[key];if(!isObj(s)||!isStr(s.means)||!isStr(s.understand))return`invalid stakeholder entry: ${key}`;}if(!isObj(data.decision)||!isStr(data.decision.decision)||!isStr(data.decision.owner))return'decision is required';return null;}
function validateLearning(data){if(!isObj(data))return'response is not an object';for(const k of ['observedOutcome','difference','possibleExplanation','evidenceRequired'])if(!isStr(data[k]))return`${k} must be a string`;if(!isObj(data.newSignal)||!isStr(data.newSignal.signal))return'newSignal.signal is required';if(data.newSignal.severity&&!inSet(data.newSignal.severity,SEVERITIES))return'newSignal.severity is invalid';if(data.newSignal.type&&!inSet(data.newSignal.type,SIGNAL_TYPES))return'newSignal.type is invalid';if(data.newSignal.relatedLayers&&(!isArr(data.newSignal.relatedLayers)||!data.newSignal.relatedLayers.every(l=>inSet(l,LAYERS))))return'newSignal.relatedLayers is invalid';return null;}
const VALIDATORS={discover:validateDiscover,understand:validateUnderstand,diagnose:validateDiagnose,transition:validateTransition,behavior:validateBehavior,stakeholder:validateStakeholder,learning:validateLearning};
function validate(stage,data){const fn=VALIDATORS[stage];return fn?fn(data):'unknown stage';}
module.exports={validate,LAYERS,EVIDENCE_STATUSES,SEVERITIES,IMPORTANCES,SIGNAL_TYPES,RELATIONSHIP_TYPES};
