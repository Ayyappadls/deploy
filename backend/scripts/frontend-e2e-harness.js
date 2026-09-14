// Faithful port of backend/index.html's rewritten startOrContinueDiscovery,
// against the REAL /api/reason endpoint, to prove the full frontend+backend
// loop actually works end to end - not just the backend in isolation.
const http = require('http');
const HOST = 'localhost', PORT = process.env.PORT || 8792;

function emptyReality(){ return { evidence:[], signals:[], relationships:[], knowledgeGaps:[], contradictions:[] }; }
function genId(prefix){ return prefix+'_'+Math.random().toString(36).slice(2,8); }

function callReason(stage, payload){
  return new Promise((resolve, reject)=>{
    const body = JSON.stringify({ stage, language:'English', payload });
    const req = http.request({ host:HOST, port:PORT, path:'/api/reason', method:'POST',
      headers:{ 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) } }, res=>{
      let data=''; res.on('data', c=>data+=c); res.on('end', ()=>{
        try{ const json = JSON.parse(data); if(!json.ok){ return reject(new Error('provider error: '+JSON.stringify(json))); } resolve(json.data); }
        catch(e){ reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function runTurn(state, ownerText){
  const r = state.reality;
  const answeredGapId = state.pendingGapId;
  state.conversation.push({role:'owner', text: ownerText});

  const outPayload = {
    conversationTranscript: state.conversation.map(t=>(t.role==='owner'?'Owner: ':'DLSMirror: ')+t.text).join('\n'),
    evidenceOnFile: r.evidence.map(e=>({id:e.id, statement:e.normalizedMeaning, layer:e.layer, evidenceStatus:e.evidenceStatus})),
    signalsOnFile: r.signals.map(s=>({id:s.id, signal:s.signal, severity:s.severity, relatedLayers:s.relatedLayers, supportingEvidenceIds:s.supportingEvidenceIds})),
    relationshipsOnFile: r.relationships.map(x=>({id:x.id, signalAId:x.signalAId, signalBId:x.signalBId, type:x.type, relationship:x.relationship, supportingEvidenceIds:x.supportingEvidenceIds, status:x.status})),
    openGaps: r.knowledgeGaps.filter(g=>!g.resolved).map(g=>({question:g.question, missingInformation:g.missingInformation, importance:g.importance})),
    contradictionsOnFile: r.contradictions.filter(c=>!c.resolved).map(c=>({statementA:c.statementA, statementB:c.statementB, note:c.note})),
    turnIndex: state.turnIndex,
  };
  state.turnIndex += 1;
  if(process.env.DEBUG_HARNESS) console.log('OUTGOING PAYLOAD:', JSON.stringify(outPayload, null, 2));
  const result = await callReason('discover', outPayload);

  // 1) resolve answered gap
  if(answeredGapId){
    const gap = r.knowledgeGaps.find(g=>g.id===answeredGapId);
    if(gap){
      gap.resolved = true;
      if(gap.verifiesEvidenceId){ const ev=r.evidence.find(e=>e.id===gap.verifiesEvidenceId); if(ev) ev.evidenceStatus='VERIFIED'; }
      if(gap.resolvesContradictionId){ const c=r.contradictions.find(x=>x.id===gap.resolvesContradictionId); if(c) c.resolved=true; }
    }
  }

  // 2) commit evidence using the BACKEND's own id
  (result.evidence||[]).slice(0,3).forEach(e=>{
    if(!e || !e.id || !e.normalizedMeaning || !e.layer) return;
    r.evidence.push({ id:e.id, normalizedMeaning:e.normalizedMeaning, layer:e.layer, evidenceStatus:e.evidenceStatus||'OWNER-PROVIDED' });
    if((e.evidenceStatus==='INFERRED'||e.evidenceStatus==='HYPOTHESIS') && e.verificationQuestion){
      r.knowledgeGaps.push({ id:genId('gap'), question:e.verificationQuestion, resolved:false, importance:'high', verifiesEvidenceId:e.id });
    }
  });

  // 3) commit signals using the BACKEND's own id
  const validEvIds = r.evidence.map(e=>e.id);
  (result.signals||[]).slice(0,2).forEach(s=>{
    if(!s || !s.id || !s.signal) return;
    r.signals.push({ id:s.id, signal:s.signal, severity:s.severity, relatedLayers:s.relatedLayers||[], supportingEvidenceIds:(s.supportingEvidenceIds||[]).filter(id=>validEvIds.includes(id)), status:'active' });
  });

  // 4) commit gaps
  (result.knowledge_gaps||[]).slice(0,2).forEach(g=>{
    if(!g || !g.question) return;
    if(!r.knowledgeGaps.find(x=>x.question===g.question)){
      r.knowledgeGaps.push({ id:g.id||genId('gap'), question:g.question, resolved:false, importance:g.importance||'medium',
        diagnosticImpact:g.diagnosticImpact||'medium', decisionImpact:g.decisionImpact||'medium', relationshipImpact:g.relationshipImpact||'low' });
    }
  });

  // 5) commit contradictions
  (result.contradictions||[]).forEach(c=>{
    r.contradictions.push({ id:genId('contra'), statementA:c.statementA, statementB:c.statementB, note:c.note, resolved:false });
  });

  // 5b) commit relationships from THIS turn, using backend ids, requiring
  // both signal ids to already be known (real, not hallucinated)
  const knownSigIds = r.signals.map(s=>s.id);
  (result.relationships||[]).forEach(rel=>{
    if(!rel || !rel.id || !rel.signalAId || !rel.signalBId) return;
    if(!knownSigIds.includes(rel.signalAId) || !knownSigIds.includes(rel.signalBId)) return;
    if(r.relationships.some(x=>x.id===rel.id)) return;
    const citedIds = (rel.supportingEvidenceIds||[]).filter(id=>validEvIds.includes(id));
    r.relationships.push({ id:rel.id, signalAId:rel.signalAId, signalBId:rel.signalBId, relationship:rel.relationship||'',
      type:rel.type||'CORRELATES_WITH', supportingEvidenceIds:citedIds, status: citedIds.length>=2 ? 'supported' : 'hypothesis' });
  });

  // 6) mirror the BACKEND's own completion decision - no local re-derivation
  const backendState = result.discoveryState || {};
  const assessment = { sufficient: !!backendState.complete, backend:true, nextObjective: backendState.nextBestQuestion ? backendState.nextBestQuestion.objective : null };
  r.discoveryAssessment = assessment;
  if(assessment.sufficient){ state.discoveryStep='sufficient'; state.pendingGapId=null; }
  else {
    const open = r.knowledgeGaps.filter(g=>!g.resolved);
    state.pendingGapId = open.length ? open[0].id : null;
    state.conversation.push({role:'mirror', text:(result.next_question&&result.next_question.text)||''});
    state.discoveryStep='question';
  }
  return { result, assessment };
}

function printState(label, state, result){
  const r = state.reality;
  console.log(`\n=== after: "${label}" ===`);
  console.log('nextQuestion:', result && result.next_question ? result.next_question.text : '(none)');
  console.log('evidence:', r.evidence.map(e=>`[${e.evidenceStatus}] (${e.layer}) ${e.normalizedMeaning}`));
  console.log('signals:', r.signals.map(s=>`${s.signal} [support=${s.supportingEvidenceIds.length}]`));
  console.log('relationships:', r.relationships.map(x=>`[${x.status}] ${x.relationship} (support=${x.supportingEvidenceIds.length})`));
  console.log('discoveryState.complete:', result.discoveryState && result.discoveryState.complete);
  console.log('discoveryStep ->', state.discoveryStep);
}

async function main(turns){
  const state = { conversation:[], reality: emptyReality(), pendingGapId:null, discoveryStep:'question', turnIndex:0 };
  for(const t of turns){
    const { result } = await runTurn(state, t);
    printState(t, state, result);
    if(state.discoveryStep==='sufficient'){ console.log('\n>>> DISCOVERY COMPLETE (backend-driven) -- stopping.'); break; }
  }
  console.log('\nfinal discoveryStep:', state.discoveryStep);
}

const SCENARIOS = {
  literal: ['im running sareee business'],
  saree: [
    'im running sareee business',
    'customers usually ask for credit, they say they will pay within a month',
    'some of them havent paid for three to six months now',
    'i also owe money to my suppliers, so it is tight both ways',
    'not really anything else going on, business is otherwise normal',
  ],
  hardware: [
    "Sales are okay but I don't really know where the money is going.",
    "We're a hardware and building materials shop. Maybe 20 to 40 customers a month.",
    "Some months it's five lakh, some months up to twelve lakh, depends on construction season.",
    "A lot of regular customers buy on credit and pay me back later, that's normal in this business.",
    "Honestly I'd guess fifty thousand to a lakh is outstanding at any time, but I don't track it closely.",
    "A few of them are three to six months overdue, if I'm being honest.",
    "My supplier payments have been stretched too, I'm paying them later than I used to.",
    "There are two customers I have a bad feeling about but I keep putting off calling them.",
    "I'm not totally sure why - the balance isn't clear in my head, and it feels awkward to ask, and I don't want them to stop buying from me.",
  ],
};
const scenario = process.argv[2] || 'saree';
main(SCENARIOS[scenario] || SCENARIOS.saree).catch(e=>{ console.error('HARNESS ERROR:', e); process.exit(1); });
