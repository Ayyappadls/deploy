const http = require('http');
const PORT = process.env.PORT || 8793;
function callReason(payload){
  return new Promise((resolve,reject)=>{
    const body = JSON.stringify({stage:'discover',language:'English',payload});
    const req = http.request({host:'localhost',port:PORT,path:'/api/reason',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d));}catch(e){reject(e);}});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}
function emptyReality(){return {evidence:[],signals:[],relationships:[],knowledgeGaps:[],contradictions:[]};}
async function main(){
  const turns = [
    'We run a small saree and clothing shop.',
    'customers usually ask for credit, they say they will pay within a month',
    'some of them havent paid for three to six months now',
    'i also owe money to my suppliers, so it is tight both ways',
    'I am trying to decide what to do about the credit situation before it gets worse',
    'I guess I need to figure out a plan for collecting what is owed',
  ];
  const conv=[]; const r=emptyReality(); let turnIndex=0;
  for(const t of turns){
    conv.push({role:'owner',text:t});
    const transcript = conv.map(x=>(x.role==='owner'?'Owner: ':'DLSMirror: ')+x.text).join('\n');
    const json = await callReason({
      conversationTranscript: transcript,
      evidenceOnFile: r.evidence.map(e=>({id:e.id,statement:e.normalizedMeaning,layer:e.layer,evidenceStatus:e.evidenceStatus})),
      signalsOnFile: r.signals.map(s=>({id:s.id,signal:s.signal,severity:s.severity,relatedLayers:s.relatedLayers,supportingEvidenceIds:s.supportingEvidenceIds})),
      relationshipsOnFile: r.relationships,
      openGaps: r.knowledgeGaps.filter(g=>!g.resolved),
      contradictionsOnFile: r.contradictions.filter(c=>!c.resolved),
      turnIndex,
    });
    turnIndex += 1;
    if(!json.ok){ console.log('ERROR:', JSON.stringify(json)); break; }
    const d = json.data;
    (d.evidence||[]).forEach(e=>r.evidence.push({id:e.id,normalizedMeaning:e.normalizedMeaning,layer:e.layer,evidenceStatus:e.evidenceStatus}));
    (d.signals||[]).forEach(s=>r.signals.push({id:s.id,signal:s.signal,severity:s.severity,relatedLayers:s.relatedLayers,supportingEvidenceIds:s.supportingEvidenceIds}));
    (d.knowledge_gaps||[]).forEach(g=>{ if(!r.knowledgeGaps.find(x=>x.question===g.question)) r.knowledgeGaps.push(Object.assign({},g,{resolved:false})); });
    (d.contradictions||[]).forEach(c=>r.contradictions.push(Object.assign({},c,{resolved:false})));
    const knownSig = r.signals.map(s=>s.id);
    (d.relationships||[]).forEach(rel=>{ if(knownSig.includes(rel.signalAId)&&knownSig.includes(rel.signalBId)&&!r.relationships.some(x=>x.id===rel.id)) r.relationships.push(rel); });
    conv.push({role:'mirror', text:(d.next_question&&d.next_question.text)||''});
    console.log('  RAW relationships this turn:', JSON.stringify(d.relationships));
    console.log('turn:', t.slice(0,45),'-> complete:', d.discoveryState.complete, ' next:', d.next_question&&d.next_question.text);
    if(d.discoveryState.complete){ console.log('COMPLETE. Final discoveryState:', JSON.stringify(d.discoveryState,null,2)); break; }
  }
  console.log('\nFinal evidence layers:', [...new Set(r.evidence.map(e=>e.layer))]);
  console.log('Final signals:', r.signals.map(s=>s.signal));
  console.log('Final relationships:', r.relationships.map(x=>x.relationship+' ['+x.status+']'));
}
main().catch(e=>{ console.error('SCRIPT ERROR:', e); process.exit(1); });
