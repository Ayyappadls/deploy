require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { selectProvider } = require('./providerSelect');
const { reason } = require('./orchestrator');
const { validateReasonRequest } = require('./requestValidation');
const { createRateLimiter } = require('./rateLimiter');
const { logReasoningEvent, genRequestId } = require('./logger');
const { MirrorStore } = require('./store');
const { computeDiscoveryState, applyController } = require('./discoveryController');
const { gateStage, supportedEvidence } = require('./methodologyGate');
function isNonBusinessGreeting(text) { return /^(hi|hii|hiii|hello|hey|heyy|yo|sup|namaste|hola|good morning|good afternoon|good evening)[.!?\s]*$/i.test(String(text || '').trim()); }
function latestOwnerMessage(transcript) { const lines=String(transcript||'').split(/\r?\n/).filter(line=>/^Owner:\s*/i.test(line)); return lines.length?lines[lines.length-1].replace(/^Owner:\s*/i,'').trim():''; }
function greetingDiscoveryResponse(language) { const lang=String(language||'English').toLowerCase(); const text=lang.includes('telugu')?'హాయ్. బిజినెస్‌లో ప్రస్తుతం ఏమి జరుగుతుందో మీ మాటల్లో చెప్పండి. ఎక్కడి నుంచైనా మొదలుపెట్టవచ్చు.':lang.includes('hindi')?'हाय। अभी बिज़नेस में क्या हो रहा है, अपने शब्दों में बताइए। आप कहीं से भी शुरू कर सकते हैं।':lang.includes('tamil')?'ஹாய். இப்போது business-ல் என்ன நடக்கிறது என்பதை உங்கள் சொற்களில் சொல்லுங்கள். எங்கிருந்தும் தொடங்கலாம்.':lang.includes('kannada')?'ಹಾಯ್. ಈಗ business ನಲ್ಲಿ ಏನು ನಡೆಯುತ್ತಿದೆ ಎಂಬುದನ್ನು ನಿಮ್ಮದೇ ಮಾತಿನಲ್ಲಿ ಹೇಳಿ. ಎಲ್ಲಿಂದ ಬೇಕಾದರೂ ಆರಂಭಿಸಬಹುದು.':lang.includes('malayalam')?'ഹായ്. ഇപ്പോൾ business-ൽ എന്താണ് നടക്കുന്നത് എന്ന് നിങ്ങളുടെ വാക്കുകളിൽ പറയൂ. എവിടെനിന്നുമെങ്കിലും ആരംഭിക്കാം.':lang.includes('marathi')?'हाय. सध्या व्यवसायात काय चालले आहे ते तुमच्या शब्दांत सांगा. कुठूनही सुरुवात करू शकता.':lang.includes('gujarati')?'હાય. હાલમાં બિઝનેસમાં શું ચાલી રહ્યું છે તે તમારા શબ્દોમાં કહો. તમે ક્યાંથી પણ શરૂઆત કરી શકો છો.':'Hi. Tell me what is happening in the business, in your own words. You can start anywhere.'; return {contradictions:[],evidence:[],signals:[],knowledge_gaps:[],next_question:{text,why:'I need actual business context before I can responsibly explore what matters.',replies:[]}}; }
function buildFrontendIndex(){
 const file=path.join(__dirname,'index.html');
 let html=fs.readFileSync(file,'utf8');
 const gate='''
<script>
(function(){
  const originalCallDLSReasoning = window.callDLSReasoning;
  if(typeof originalCallDLSReasoning !== 'function') return;
  window.callDLSReasoning = async function(stage,payload){
    if(stage==='discover'){
      payload = Object.assign({}, payload, {
        signals: (typeof state!=='undefined' && state.reality && state.reality.signals) ? state.reality.signals.map(s=>({id:s.id,signal:s.signal,severity:s.severity,relatedLayers:s.relatedLayers})) : [],
        relationships: (typeof state!=='undefined' && state.reality && state.reality.relationships) ? state.reality.relationships : [],
        contradictions: (typeof state!=='undefined' && state.reality && state.reality.contradictions) ? state.reality.contradictions : []
      });
    }
    const result = await originalCallDLSReasoning(stage,payload);
    if(stage==='discover' && result && result.discoveryState) window.__dlsBackendDiscoveryState = result.discoveryState;
    return result;
  };
  window.__dlsDiscoveryAssessment = function(){
    const s=window.__dlsBackendDiscoveryState;
    if(!s) return null;
    return {
      sufficient: !!s.complete,
      reason: s.complete ? 'The business reality and its key relationships are sufficiently established to move forward.' : 'A key relationship, evidence gap, contradiction, or decision context still needs to be investigated.',
      confidence: s.complete ? 0.75 : 0.35,
      backend: true
    };
  };
})();
</script>'''
 html=html.replace('</body>',gate+'\n</body>');
 const marker='function evaluateDiscoverySufficiency(){';
 const replacement=marker+'\n  const backendAssessment=window.__dlsDiscoveryAssessment&&window.__dlsDiscoveryAssessment();\n  if(backendAssessment) return backendAssessment;';
 html=html.replace(marker,replacement);
 return html;
}
function createApp({ provider, providerLabel, rateLimit, store, nodeEnv }) {
 const app=express(); app.use(express.json({limit:'256kb'}));
 app.get('/backend/index.html',(req,res)=>{try{res.type('html').send(buildFrontendIndex());}catch(err){res.status(500).send('DLSMirror frontend unavailable.');}});
 app.use(express.static(__dirname));
 app.post('/api/mirror/init',(req,res)=>{const {businessId,mirrorId}=store.createBusiness();res.status(201).json({ok:true,businessId,mirrorId});});
 app.get('/api/mirror/:businessId',(req,res)=>{const record=store.get(req.params.businessId);if(!record)return res.status(404).json({ok:false,error:{code:'INVALID_REQUEST',message:'No Business Mirror found for that id.'}});res.json({ok:true,businessId:record.businessId,mirrorId:record.mirrorId,updatedAt:record.updatedAt,state:record.state});});
 app.post('/api/mirror/:businessId',(req,res)=>{const {state}=req.body||{};if(typeof state!=='object'||state===null)return res.status(400).json({ok:false,error:{code:'INVALID_REQUEST',message:'state must be an object.'}});const saved=store.save(req.params.businessId,state);if(!saved)return res.status(404).json({ok:false,error:{code:'INVALID_REQUEST',message:'No Business Mirror found for that id.'}});res.json({ok:true,businessId:saved.businessId,updatedAt:saved.updatedAt});});
 app.post('/api/reason',async(req,res)=>{const requestId=genRequestId(),sessionId=req.headers['x-dls-session-id']||'unknown',startedAt=Date.now(),ip=req.ip||req.connection?.remoteAddress||'unknown';const limitResult=rateLimit(ip);if(limitResult.limited)return res.status(429).json({ok:false,requestId,error:{code:'RATE_LIMITED',message:'DLSMirror is receiving requests faster than it can process them right now. Please wait a moment and try again.'}});const invalidReason=validateReasonRequest(req.body);if(invalidReason)return res.status(400).json({ok:false,requestId,error:{code:'INVALID_REQUEST',message:'This request is not valid: '+invalidReason}});const {stage,language,payload}=req.body;if(!provider)return res.status(500).json({ok:false,requestId,error:{code:'AUTHENTICATION_ERROR',message:'DLSMirror reasoning is not configured on this server.'}});if(stage==='discover'&&isNonBusinessGreeting(latestOwnerMessage(payload?.conversationTranscript))){const data=greetingDiscoveryResponse(language);logReasoningEvent({requestId,sessionId,stage,startedAt,success:true,provider:'input-gate'});return res.status(200).json({ok:true,requestId,data});}
 try { const result=await reason(stage,language||'English',payload,provider); logReasoningEvent({requestId,sessionId,stage,startedAt,success:result.ok,errorCode:result.ok?undefined:result.error.code,provider:providerLabel}); if(!result.ok){const statusMap={SCHEMA_VALIDATION_FAILED:502,INVALID_MODEL_RESPONSE:502,PROVIDER_UNAVAILABLE:503,PROVIDER_TIMEOUT:504,RATE_LIMITED:429,AUTHENTICATION_ERROR:500,INVALID_REQUEST:400};return res.status(statusMap[result.error.code]||500).json({ok:false,requestId,error:result.error});}
 let data=result.data;
 if(stage==='discover'){
   const discovery=computeDiscoveryState({transcript:payload?.conversationTranscript||'',evidenceOnFile:payload?.evidenceOnFile||[],signals:payload?.signals||[],openGaps:payload?.openGaps||[],contradictions:data.contradictions||payload?.contradictions||[],relationships:payload?.relationships||[]});
   const combinedEvidence=[...(payload?.evidenceOnFile||[]),...(data.evidence||[])];
   data.relationships=(data.relationships||[]).filter(r=>supportedEvidence(r,{evidence:combinedEvidence,evidenceOnFile:combinedEvidence}));
   data=applyController(data,discovery);
   data.discoveryState={stage:discovery.stage,evidenceCount:discovery.evidenceCount,factCount:discovery.factCount,activeSignalCount:discovery.activeSignalCount,materialUnknownCount:discovery.materialUnknownCount,contradictionCount:discovery.contradictionCount,relationshipReadiness:discovery.relationshipReadiness,decisionContextReady:discovery.decisionContextReady,coreContextReady:discovery.coreContextReady,complete:discovery.complete,nextObjective:discovery.nextBestQuestion?.objective||null,nextLayer:discovery.nextBestQuestion?.layer||null};
 }
 else {const gated=gateStage(stage,data,payload||{});data=gated.data;data.methodologyGate=data.methodologyGate||gated.gate;}
 return res.status(200).json({ok:true,requestId,data});
 } catch(err){logReasoningEvent({requestId,sessionId,stage,startedAt,success:false,errorCode:'INTERNAL_ERROR',provider:providerLabel});return res.status(500).json({ok:false,requestId,error:{code:'INTERNAL_ERROR',message:'DLSMirror reasoning is temporarily unavailable.'}});}
 });
 app.get('/api/health',(req,res)=>res.json({ok:true,env:nodeEnv,provider:providerLabel})); return app;
}
module.exports={createApp};
if(require.main===module){const PORT=process.env.PORT||8787,NODE_ENV=process.env.NODE_ENV||'development',ANTHROPIC_API_KEY=process.env.ANTHROPIC_API_KEY||'',ANTHROPIC_MODEL=process.env.ANTHROPIC_MODEL||'claude-sonnet-4-6',OPENAI_API_KEY=process.env.OPENAI_API_KEY||'',OPENAI_MODEL=process.env.OPENAI_MODEL||'gpt-5.6-luna',RATE_LIMIT_WINDOW_MS=Number(process.env.RATE_LIMIT_WINDOW_MS||5*60*1000),RATE_LIMIT_MAX=Number(process.env.RATE_LIMIT_MAX||60),DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data'),forceLocal=process.env.MOCK_MODE==='true'||process.env.FORCE_LOCAL==='true';const {provider,label:providerLabel}=selectProvider({anthropicApiKey:ANTHROPIC_API_KEY,openaiApiKey:OPENAI_API_KEY,forceLocal,model:ANTHROPIC_MODEL,openaiModel:OPENAI_MODEL});const rateLimit=createRateLimiter({windowMs:RATE_LIMIT_WINDOW_MS,max:RATE_LIMIT_MAX});const store=new MirrorStore({dataDir:DATA_DIR});const app=createApp({provider,providerLabel,rateLimit,store,nodeEnv:NODE_ENV});app.listen(PORT,'0.0.0.0',()=>console.log(`DLSMirror backend listening on port ${PORT} (env=${NODE_ENV}, provider=${providerLabel}, data=${DATA_DIR})`));}