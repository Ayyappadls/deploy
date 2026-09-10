const test = require('node:test');
const assert = require('node:assert/strict');
const { gateStage, diagnosisReadiness } = require('./methodologyGate');
const baseEvidence = [
  { id:'e1', layer:'owner', evidenceStatus:'OWNER-PROVIDED', normalizedMeaning:'Owner runs the business and makes important decisions.' },
  { id:'e2', layer:'offer', evidenceStatus:'OWNER-PROVIDED', normalizedMeaning:'The business sells clothing.' },
  { id:'e3', layer:'customer', evidenceStatus:'OWNER-PROVIDED', normalizedMeaning:'Customers are buying less.' },
  { id:'e4', layer:'revenue', evidenceStatus:'OWNER-PROVIDED', normalizedMeaning:'Monthly revenue fell from 8 lakh to 6 lakh.' },
  { id:'e5', layer:'finance', evidenceStatus:'OWNER-PROVIDED', normalizedMeaning:'Cash is tighter and some sales are on credit.' }
];
function payload(extra={}) { return { evidence:baseEvidence, signals:[{id:'s1',signal:'Revenue decline',severity:'high'}], relationships:[{id:'r1',signalAId:'s1',signalBId:'e5',relationship:'CONTRIBUTES_TO',supportingEvidenceIds:['e4','e5']}], openGaps:[], contradictions:[], ...extra }; }
test('blocks diagnosis when evidence is insufficient',()=>{const p={evidence:baseEvidence.slice(0,2),signals:[],relationships:[],openGaps:[],contradictions:[]}; const r=diagnosisReadiness(p); assert.equal(r.ready,false); const out=gateStage('diagnose',{thesis:{thesis:'unsupported'}},p); assert.equal(out.gate.status,'BLOCKED'); assert.equal(out.data.methodologyGate.status,'BLOCKED');});
test('hypothesis does not satisfy readiness',()=>{const p=payload({evidence:baseEvidence.map((e,i)=>i===4?{...e,evidenceStatus:'HYPOTHESIS'}:e)}); assert.equal(diagnosisReadiness(p).ready,false);});
test('material unknown blocks diagnosis',()=>{const p=payload({openGaps:[{question:'Why did customers buy less?',importance:'high'}]}); const r=diagnosisReadiness(p); assert.equal(r.ready,false); assert.ok(r.reasons.includes('material unknowns remain'));});
test('contradiction blocks diagnosis',()=>{const p=payload({contradictions:[{statementA:'sales increased',statementB:'sales decreased'}]}); assert.equal(diagnosisReadiness(p).ready,false);});
test('relationship requires explicit evidence support',()=>{const p=payload({relationships:[{id:'r1',signalAId:'s1',signalBId:'e5',relationship:'CAUSES'}]}); assert.equal(diagnosisReadiness(p).ready,false);});
test('fully supported state opens diagnosis',()=>{const p=payload(); const r=diagnosisReadiness(p); assert.equal(r.ready,true); const out=gateStage('diagnose',{firstPrinciple:{},invisibleBottleneck:{},thesis:{thesis:'supported'}},p); assert.equal(out.gate.status,'OPEN');});
test('downstream stages block without diagnosis readiness',()=>{const p=payload({evidence:baseEvidence.slice(0,2),signals:[],relationships:[]}); assert.equal(gateStage('transition',{},p).gate.status,'BLOCKED'); assert.equal(gateStage('behavior',{},p).gate.status,'BLOCKED'); assert.equal(gateStage('stakeholder',{},p).gate.status,'BLOCKED');});
