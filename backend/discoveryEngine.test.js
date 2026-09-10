const test=require('node:test');
const assert=require('node:assert/strict');
const {generateCandidateObjectives,scoreObjective,selectObjective}=require('./discoveryEngine');

function state(overrides={}){return {evidence:[],signals:{},knowledge:{},hypotheses:{},askedObjectives:[],...overrides};}

test('sales slowing plus cash pressure creates a cash-driver objective',()=>{
 const s=state({evidence:[
  {id:'e1',normalizedMeaning:'Sales are slowing down',evidenceStatus:'OWNER-PROVIDED'},
  {id:'e2',normalizedMeaning:'The business is under pressure with cash',evidenceStatus:'OWNER-PROVIDED'}
 ],signals:{a:{id:'a',signal:'Sales are declining',confidence:.8},b:{id:'b',signal:'Cash pressure is increasing',confidence:.8}}});
 const candidates=generateCandidateObjectives(s); assert.ok(candidates.some(x=>x.id==='cash-driver'));
 const chosen=selectObjective(s); assert.equal(chosen.id,'cash-driver');
});

test('owner dependency is not invented when it is absent',()=>{
 const s=state({evidence:[{id:'e1',normalizedMeaning:'Sales are slowing down',evidenceStatus:'OWNER-PROVIDED'},{id:'e2',normalizedMeaning:'Cash is tight',evidenceStatus:'OWNER-PROVIDED'}],signals:{a:{id:'a',signal:'Sales declining'},b:{id:'b',signal:'Cash pressure increasing'}}});
 assert.equal(generateCandidateObjectives(s).some(x=>x.id==='test:owner_dependency'),false);
});

test('known offer does not create an offer candidate',()=>{
 const s=state({evidence:[{id:'e1',normalizedMeaning:'We sell software',evidenceStatus:'OWNER-PROVIDED'}],knowledge:{offer:{topic:'offer',sufficiency:.9,lastEvidenceAt:Date.now(),decays:false}}});
 assert.equal(generateCandidateObjectives(s).some(x=>x.targetsKnowledgeGaps.includes('offer')),false);
});

test('complexity economics outranks generic knowledge when live signals support it',()=>{
 const s=state({evidence:[
  {id:'e1',normalizedMeaning:'Revenue is growing',evidenceStatus:'OWNER-PROVIDED'},
  {id:'e2',normalizedMeaning:'Profit is flat',evidenceStatus:'OWNER-PROVIDED'},
  {id:'e3',normalizedMeaning:'Customers need more customization and support',evidenceStatus:'OWNER-PROVIDED'},
  {id:'e4',normalizedMeaning:'Engineering spends more time on customer-specific work',evidenceStatus:'OWNER-PROVIDED'}
 ],signals:{a:{id:'a',signal:'Revenue increasing'},b:{id:'b',signal:'Profit flat'},c:{id:'c',signal:'Customer complexity increasing'},d:{id:'d',signal:'Engineering effort increasing'}}});
 const chosen=selectObjective(s); assert.equal(chosen.id,'customer-complexity-economics');
});

test('recently asked objective is penalized and excluded from candidates',()=>{
 const s=state({evidence:[{id:'e1',normalizedMeaning:'Sales are slowing and cash is tight',evidenceStatus:'OWNER-PROVIDED'}],signals:{a:{id:'a',signal:'Sales declining'},b:{id:'b',signal:'Cash pressure increasing'}},askedObjectives:[{objectiveId:'cash-driver',turnIndex:1}]});
 assert.equal(generateCandidateObjectives(s).some(x=>x.id==='cash-driver'),false);
});
