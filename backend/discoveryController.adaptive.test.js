const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDiscoveryState } = require('./discoveryController');

function state(transcript, evidenceOnFile = [], signals = [], openGaps = [], contradictions = [], relationships = []) {
  return computeDiscoveryState({ transcript, evidenceOnFile, signals, openGaps, contradictions, relationships });
}

test('SaaS discovery moves from known context to customer economics instead of product template', () => {
  const transcript = [
    'Owner: We run a SaaS platform for small businesses. Revenue is increasing from ₹40 lakh to ₹48 lakh a month, but profit and cash retention are not improving.',
    'DLSMirror: When the money comes in, what usually takes it back out again?',
    'Owner: Salaries, engineering, acquisition, cloud, support and implementation costs are taking more of it.',
    'DLSMirror: What has become harder to deliver or manage day to day?',
    'Owner: Customers require more onboarding, customization and support, and engineering spends more time on customer-specific work.',
    'DLSMirror: Is this extra customer complexity materially increasing the cost or team capacity required to serve each customer?',
    'Owner: Yes. Implementation takes longer, support demand is higher, and engineering spends more time per customer. We have not quantified the exact cost increase.'
  ].join('\n');
  const evidence = [
    {id:'e1',normalizedMeaning:'SaaS platform for small businesses.',layer:'offer',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e2',normalizedMeaning:'Revenue increased from ₹40 lakh to ₹48 lakh monthly.',layer:'revenue',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e3',normalizedMeaning:'Profit and cash retention are not improving.',layer:'finance',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e4',normalizedMeaning:'Support and implementation costs are increasing.',layer:'operations',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e5',normalizedMeaning:'Customers require more customization and support.',layer:'customer',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e6',normalizedMeaning:'Engineering spends more time on customer-specific work.',layer:'operations',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e7',normalizedMeaning:'Implementation and support take more team time per customer.',layer:'operations',evidenceStatus:'OWNER-PROVIDED'}
  ];
  const signals = [
    {id:'s1',signal:'Revenue is increasing',severity:'medium',relatedLayers:['revenue']},
    {id:'s2',signal:'Profit and cash are not improving',severity:'high',relatedLayers:['finance','revenue']},
    {id:'s3',signal:'Customer complexity is increasing',severity:'high',relatedLayers:['customer','operations']},
    {id:'s4',signal:'Delivery effort is increasing',severity:'high',relatedLayers:['operations','finance']}
  ];
  const s = state(transcript,evidence,signals);
  assert.notEqual(s.nextBestQuestion?.objective,'material_gap');
  assert.doesNotMatch(s.nextBestQuestion?.text||'',/what do you mainly sell|who usually buys/i);
  assert.ok(['test_customer_economics','quantify_cost_to_serve','test_reusability','test_relationship'].includes(s.nextBestQuestion?.objective));
});

test('known product and customer facts block template re-entry', () => {
  const transcript = 'Owner: We sell a SaaS platform. Customers are growing and asking for more customization. Revenue is growing but profit is flat.\nDLSMirror: What do you mainly sell or provide?\nOwner: A SaaS platform for small businesses.\nDLSMirror: Who usually buys from you?\nOwner: Small businesses are our customers.';
  const evidence = [
    {id:'e1',normalizedMeaning:'SaaS platform for small businesses.',layer:'offer',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e2',normalizedMeaning:'Customers are growing and asking for more customization.',layer:'customer',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e3',normalizedMeaning:'Revenue is growing but profit is flat.',layer:'revenue',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e4',normalizedMeaning:'Small businesses are customers.',layer:'customer',evidenceStatus:'OWNER-PROVIDED'}
  ];
  const signals = [
    {id:'s1',signal:'Revenue is growing',severity:'medium',relatedLayers:['revenue']},
    {id:'s2',signal:'Profit is flat',severity:'high',relatedLayers:['finance']},
    {id:'s3',signal:'Customization is increasing',severity:'high',relatedLayers:['customer','operations']}
  ];
  const s = state(transcript,evidence,signals);
  assert.doesNotMatch(s.nextBestQuestion?.text||'',/what do you mainly sell|who usually buys/i);
});

test('different business realities produce different next objectives', () => {
  const saas = state('Owner: Revenue is growing but customer-specific engineering and support are consuming more capacity.',[
    {id:'e1',normalizedMeaning:'Revenue is growing.',layer:'revenue',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e2',normalizedMeaning:'Customer-specific engineering and support consume more capacity.',layer:'operations',evidenceStatus:'OWNER-PROVIDED'}
  ],[
    {id:'s1',signal:'Revenue growth',severity:'medium',relatedLayers:['revenue']},
    {id:'s2',signal:'Delivery capacity pressure',severity:'high',relatedLayers:['operations']}
  ]);
  const retail = state('Owner: Sales are down, customers buy less, and slow-moving inventory is tying up cash.',[
    {id:'e1',normalizedMeaning:'Sales are down.',layer:'revenue',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e2',normalizedMeaning:'Customers buy less.',layer:'customer',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e3',normalizedMeaning:'Slow-moving inventory is tying up cash.',layer:'finance',evidenceStatus:'OWNER-PROVIDED'}
  ],[
    {id:'s1',signal:'Sales are down',severity:'high',relatedLayers:['revenue','customer']},
    {id:'s2',signal:'Cash pressure',severity:'high',relatedLayers:['finance']}
  ]);
  assert.notEqual(saas.nextBestQuestion?.text,retail.nextBestQuestion?.text);
});

test('material knowledge gap outranks low-value ontology coverage', () => {
  const transcript='Owner: Revenue is growing, profit is flat, and implementation effort is rising.';
  const evidence=[
    {id:'e1',normalizedMeaning:'Revenue is growing.',layer:'revenue',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e2',normalizedMeaning:'Profit is flat.',layer:'finance',evidenceStatus:'OWNER-PROVIDED'},
    {id:'e3',normalizedMeaning:'Implementation effort is rising.',layer:'operations',evidenceStatus:'OWNER-PROVIDED'}
  ];
  const signals=[
    {id:'s1',signal:'Revenue growth',severity:'medium',relatedLayers:['revenue']},
    {id:'s2',signal:'Flat profit',severity:'high',relatedLayers:['finance']},
    {id:'s3',signal:'Implementation effort rising',severity:'high',relatedLayers:['operations']}
  ];
  const gaps=[{question:'Which customer types drive the implementation effort?',importance:'high',diagnosticImpact:'high',decisionImpact:'high',relationshipImpact:'high'}];
  const s=state(transcript,evidence,signals,gaps);
  assert.equal(s.nextBestQuestion.objective,'open_gap');
  assert.equal(s.nextBestQuestion.text,'Which customer types drive the implementation effort?');
});
