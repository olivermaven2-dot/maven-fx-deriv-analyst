function overUnderCoverageReport(d){
  const rows=[];
  for(const side of ["OVER","UNDER"]){
    for(let digit=0;digit<=9;digit++){
      const e=overUnderEvidence(d,digit,side);
      let status=e.signal,reason="";
      if(!e.distribution.ready){status="COLLECTING";reason="Needs 1,000 live ticks for the distribution gate ("+e.distribution.total+"/1,000).";}
      else if(!e.distribution.pass){
        const failures=(e.distribution.failures||[]).map(x=>"digit "+x.digit+" ("+x.percent.toFixed(1)+"%"+(x.most?", highest frequency":"")+(x.least?", lowest frequency":"")+")");
        reason="Distribution gate: "+failures.join(", ")+".";
      }else if(e.probabilityConflict)reason="Complementary setup has a rate more than 4 percentage points higher.";
      else if(e.windowConflict)reason="Recent and longer-window evidence conflict.";
      else if(e.signal==="WAIT")reason="Evidence thresholds or independent-factor agreement are not yet sufficient.";
      else if(e.signal==="AVOID")reason="Current evidence is weak or below the setup baseline.";
      else reason="Setup passed current signal checks.";
      rows.push({setup:side+" "+digit,status,selected:side===state.selectedSide&&digit===state.selectedDigit,rate:Math.round(e.selectedRate*100)+"%",baseline:Math.round(e.baseline*100)+"%",reason});
    }
  }
  return rows;
}
function renderOverUnderCoverage(root,d){
  const button=root.querySelector("#ouCoverageCheck");
  const output=root.querySelector("#ouCoverageOutput");
  if(!button||!output)return;
  if(state.ouCoverageHtml){
    output.innerHTML=state.ouCoverageHtml;
    output.hidden=false;
    button.textContent="Refresh setup coverage";
  }
  button.addEventListener("click",()=>{
    button.disabled=true;
    button.textContent="Evaluating 20 setups…";
    // Run only on request so the live tick-render loop and mobile performance are unaffected.
    const rows=overUnderCoverageReport(state.digits);
    state.ouCoverageHtml='<div class="ou-coverage-table-wrap"><table class="ou-coverage-table"><thead><tr><th>Setup</th><th>Status</th><th>Observed rate</th><th>Baseline</th><th>Why / gate result</th></tr></thead><tbody>'+
      rows.map(r=>'<tr'+(r.selected?' class="is-selected"':'')+'><td><strong>'+r.setup+'</strong>'+(r.selected?' <span>(selected)</span>':'')+'</td><td>'+r.status+'</td><td>'+r.rate+'</td><td>'+r.baseline+'</td><td>'+r.reason.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</td></tr>').join("")+
      '</tbody></table></div><p class="ou-coverage-note">This report diagnoses all 20 setups using the existing rules. It does not relax thresholds or create extra signals. Results reflect the tick buffer at the time you pressed the button.</p>';
    output.innerHTML=state.ouCoverageHtml;
    output.hidden=false;
    button.disabled=false;
    button.textContent="Refresh setup coverage";
  });
}
function renderOverUnder(root,d,c,last,n){
  const e=overUnderEvidence(d,state.selectedDigit,state.selectedSide);
  const setup=state.selectedSide+" "+state.selectedDigit;
  const activeSignal=e.signal==="SIGNAL"||e.signal==="STRONG SIGNAL";
  const rawEntry=activeSignal&&!e.probabilityConflict?overUnderEntry(d,state.selectedDigit,state.selectedSide):null;
  const entry=mavenAIReviewEntry("overunder",rawEntry,e.aiDecision);
  state.ouEntrySnapshot={key:ouValidationKey(),tickCount:state.liveTickSequence,active:!!entry,digits:entry?entry.entries.map(x=>x.digit):[],validationDigits:entry?entry.entries.map(x=>x.digit):[],confidence:Number(e.aiDecision?.confidence)};
  state.ouSignalSnapshot={key:ouValidationKey(),active:activeSignal&&!e.probabilityConflict,signal:e.signal,probabilityConflict:!!e.probabilityConflict,tickCount:state.digits.length};
  setSignalValidationForecast("overunder",state.selectedSide+" "+state.selectedDigit,e.probabilityConflict?"WAIT":e.signal,state.liveTickSequence,e.aiDecision?.confidence,{selectedDigit:state.selectedDigit,side:state.selectedSide});
  autoTradeUpdateLiveFields();
  let reason;
  if(e.aiDecision)reason=e.aiDecision.reason+" "+(e.probabilityConflict?"Probability Comparison also blocks the entry until complementary evidence aligns.":"");
  if(e.probabilityConflict)reason="WAIT: Probability Comparison conflicts with the selected setup because the complementary setup has stronger observed live frequency. The entry is blocked until evidence aligns.";
  else if(e.windowConflict)reason="WAIT: Recent and longer-window behaviour conflict. The AI is withholding the signal until the windows align more clearly.";
  else if(e.transitions<20)reason="WAIT: only "+e.transitions+" selected-digit reaction samples are available; at least 20 are required before this setup can qualify.";
  else if(e.signal==="AVOID")reason="The selected setup does not have enough aligned A-Setup evidence.";
  else if(e.signal==="WAIT")reason="The selected setup is still building enough independent evidence across the required analysis windows.";
  else if(e.signal==="STRONG SIGNAL")reason="Probability, momentum, trend, transitions, reaction behavior, recency, consistency and context are aligned for "+setup+".";
  else reason="The selected setup has sufficient multi-factor evidence, but the evidence is not strong enough for a STRONG SIGNAL.";
  const entryDisplay=activeSignal?(entry||{main:"NO VALID ENTRY",confidence:"—",status:"NO ENTRY",reason:"No candidate digit passed the current entry-selection checks.",evidence:"Candidate evaluation completed"}):{main:"NO ACTIVE ENTRY",confidence:"—",status:"INACTIVE",reason:"Entry Engine activates only when the selected Final Signal is SIGNAL or STRONG SIGNAL.",evidence:"Waiting for an active signal"};
  root.innerHTML=panel(e.signal,reason,entryDisplay,[
    "Selected setup: "+setup,
    "Probability Comparison: "+Math.round(e.selectedRate*100)+"% vs complement "+Math.round(e.oppositeRate*100)+"% • baseline "+Math.round(e.baseline*100)+"%",
    "Windows 20/50/100/250/500: "+[e.recentRate,e.short50,e.mediumRate,e.mid250,e.longRate].map(x=>Math.round(x*100)+"%").join(" / "),
    "A-Setup alignment: probability "+Math.round(e.probability*100)+" • momentum "+Math.round(e.momentum*100)+" • trend "+Math.round(e.trend*100)+" • transitions "+Math.round(e.transition*100),
    "Reaction "+Math.round(e.reaction*100)+" • clustering "+Math.round(e.cluster*100)+" • recency "+Math.round(e.recency*100)+" • consistency "+Math.round(e.consistency*100),
    "Historical "+Math.round(e.historical*100)+" • current context "+Math.round(e.context*100)+" • evidence "+Math.round(e.evidence*100),
    "Maven AI decision: "+e.aiDecision.baseSignal+" → "+e.aiDecision.signal+" • confidence "+Math.round(e.aiDecision.confidence*100)+"% • "+e.aiDecision.reason,
    e.probabilityConflict?"× Complementary probability conflict — waiting for stronger agreement":e.windowConflict?"× Recent and long-window evidence conflict — waiting for alignment":entry?"✓ Entry candidates "+entry.main+" passed historical reaction filters":"× Entry candidates remain inactive or did not pass validation",
    ouValidationSummary()
  ],n);
  root.insertAdjacentHTML("beforeend",'<section class="ou-coverage-card"><div class="ou-coverage-head"><div><strong>OVER / UNDER SETUP COVERAGE</strong><p>Diagnose all 20 setups without changing signal rules.</p></div><button id="ouCoverageCheck" type="button">Evaluate all 20 setups</button></div><div id="ouCoverageOutput" hidden></div></section>');
  renderOverUnderCoverage(root,d);
}
const WS_URLS=["wss://api.derivws.com/trading/v1/options/ws/public","wss://ws.binaryws.com/websockets/v3","wss://ws.binaryws.com/websockets/v3?app_id=1089","wss://ws.derivws.com/websockets/v3?app_id=1089"];
const MAX_TICKS=2000, STREAM_SIZE=80;
let lastDistributionRenderAt=0;
let lastMobileEngineRenderAt=0;
const MOBILE_ENGINE_RENDER_INTERVAL=650;
function shouldRenderEngineForCurrentTick(){
  const mobile=window.matchMedia&&window.matchMedia("(max-width: 600px)").matches;
  if(!mobile||autoTrade.enabled)return true;
  const now=Date.now();
  if(now-lastMobileEngineRenderAt<MOBILE_ENGINE_RENDER_INTERVAL)return false;
  lastMobileEngineRenderAt=now;
  return true;
}
const state={socket:null,markets:[],symbol:"R_100",marketName:"R_100",pipSize:null,ticks:[],digits:[],liveTickSequence:0,lastTickSignature:"",primarySubscriptionId:null,primarySubscriptionSymbol:"",primaryHistoryRequests:{},primarySubscribeRequests:{},lastPongAt:0,engine:"overunder",selectedDigit:2,selectedSide:"OVER",selectedParity:"EVEN",selectedRiseFall:"RISE",connected:false,lastTickAt:0,reconnectTimer:null,reconnectDelay:1000,req:0,endpointIndex:0,connectTimer:null,marketStarted:false,lastMessage:"—",lastError:"—",ouValidation:{key:"",pending:[],completed:{1:{n:0,hits:0},2:{n:0,hits:0},3:{n:0,hits:0}},lastTrigger:"—"},ouValidationBook:{},ouPayoutPercent:95,ouEntrySnapshot:null,ouSignalSnapshot:null,otherValidation:{snapshot:null,pending:[],book:{}},signalValidation:{snapshot:null,book:{}},validationDirty:false,deepScanner:{data:{},historyRequests:{},subscribeRequests:{},subscriptions:{},enabled:true,autoLoaded:false,manualOverride:false,startedAt:0,lastScanAt:0,lastLoadedSymbol:"",lastLoadedScore:0,lastSetupKey:"",switchAfter:0}};

const VALIDATION_STORAGE_KEY="mavenFx.validationStats.v1";
function cleanValidationBook(value,kind){
  if(!value||typeof value!=="object"||Array.isArray(value))return {};
  const out={};
  for(const [key,r] of Object.entries(value).slice(-500)){
    if(!r||typeof r!=="object"||typeof r.market!=="string")continue;
    if(kind==="ou"&&(!Number.isInteger(Number(r.selectedDigit))||!["OVER","UNDER"].includes(r.side)||!Number.isInteger(Number(r.candidate))))continue;
    if(kind==="other"&&(!["evenodd","risefall"].includes(r.engine)||typeof r.target!=="string"))continue;
    const rec={market:r.market};
    if(kind==="ou"){rec.selectedDigit=Number(r.selectedDigit);rec.side=r.side;rec.candidate=Number(r.candidate);}
    else{rec.engine=r.engine;rec.target=r.target;}
    rec.triggers=Math.max(0,Math.floor(Number(r.triggers)||0));
    rec.confidenceSum=Math.max(0,Number(r.confidenceSum)||0);
    rec.confidenceN=Math.max(0,Math.floor(Number(r.confidenceN)||0));
    rec.recentOutcomes={};
    for(const h of [1,2,3]){
      const x=r[h]&&typeof r[h]==="object"?r[h]:{};
      rec[h]={n:Math.max(0,Math.floor(Number(x.n)||0)),hits:Math.max(0,Math.min(Math.floor(Number(x.n)||0),Math.floor(Number(x.hits)||0))),failureStreak:Math.max(0,Math.floor(Number(x.failureStreak)||0)),maxFailureStreak:Math.max(0,Math.floor(Number(x.maxFailureStreak)||0))};
      rec.recentOutcomes[h]=Array.isArray(r.recentOutcomes?.[h])?r.recentOutcomes[h].slice(-30).map(Boolean):[];
    }
    rec.lastUpdated=Number(r.lastUpdated)||0;
    out[key]=rec;
  }
  return out;
}
function cleanSignalValidationBook(value){
  if(!value||typeof value!=="object"||Array.isArray(value))return {};
  const out={};
  for(const [key,r] of Object.entries(value).slice(-300)){
    if(!r||typeof r!=="object"||typeof r.market!=="string"||!["overunder","evenodd","risefall"].includes(r.engine)||typeof r.target!=="string")continue;
    const n=Math.max(0,Math.floor(Number(r.n)||0)),hits=Math.max(0,Math.min(n,Math.floor(Number(r.hits)||0)));
    out[key]={market:r.market,engine:r.engine,target:r.target,n,hits,confidenceSum:Math.max(0,Number(r.confidenceSum)||0),confidenceN:Math.max(0,Math.floor(Number(r.confidenceN)||0)),lastUpdated:Number(r.lastUpdated)||0};
  }
  return out;
}
function loadValidationData(){
  try{
    const raw=localStorage.getItem(VALIDATION_STORAGE_KEY);
    if(!raw)return;
    const data=JSON.parse(raw);
    if(!data||data.version!==1)return;
    state.ouValidationBook=cleanValidationBook(data.overUnder,"ou");
    state.otherValidation.book=cleanValidationBook(data.other,"other");
    state.signalValidation.book=cleanSignalValidationBook(data.signal);
    state.ouPayoutPercent=Math.max(1,Math.min(100,Number(data.payoutPercent)||95));
  }catch(e){console.warn("Maven FX validation history could not be loaded.",e);}
}
function persistValidationData(){
  if(!state.validationDirty)return;
  state.validationDirty=false;
  try{
    localStorage.setItem(VALIDATION_STORAGE_KEY,JSON.stringify({version:1,overUnder:state.ouValidationBook,other:state.otherValidation.book,signal:state.signalValidation.book,payoutPercent:state.ouPayoutPercent}));
  }catch(e){console.warn("Maven FX validation history could not be saved in this browser.",e);}
}
loadValidationData();
const $=id=>document.getElementById(id);
const statusBadge=$("statusBadge"),statusText=$("statusText"),marketSelect=$("marketSelect");
function setStatus(kind,text){statusBadge.className="status "+kind;statusText.textContent=text;$("diagConnection").textContent=text;$("diagSocket").textContent=state.socket?state.socket.readyState===1?"OPEN":"CLOSED":"—";if($("diagEndpoint"))$("diagEndpoint").textContent=WS_URLS[state.endpointIndex%WS_URLS.length];if($("diagMessage"))$("diagMessage").textContent=state.lastMessage;if($("diagError"))$("diagError").textContent=state.lastError}
function fmtPrice(v){return Number(v).toFixed(Math.max(0,Math.min(8,decimalPlaces(v))))}
function decimalPlaces(v){const s=String(v);return s.includes(".")?s.split(".")[1].length:0}
function pipDecimals(pip){const n=Number(pip);if(!Number.isFinite(n))return null;if(Number.isInteger(n)&&n>=0&&n<=8)return n;if(n>0&&n<1)return Math.max(0,Math.round(-Math.log10(n)));return null}
function digitFromQuote(quote,pipSize=state.pipSize){
  const raw=String(quote);
  const decimals=pipDecimals(pipSize);
  if(decimals!==null){
    const fixed=Number(quote).toFixed(decimals);
    const fractional=fixed.includes(".")?fixed.split(".")[1]:"";
    if(fractional.length)return Number(fractional.at(-1));
  }
  if(raw.includes(".")){
    const fractional=raw.split(".")[1].replace(/[^0-9]/g,"");
    if(fractional.length)return Number(fractional.at(-1));
  }
  const clean=raw.replace(/[^0-9]/g,"");
  return clean?Number(clean.at(-1)):null;
}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

function connect(){
  if(state.socket){try{state.socket.onclose=null;state.socket.close()}catch{}}
  clearTimeout(state.connectTimer); clearTimeout(state.reconnectTimer);
  state.connected=false;
  setStatus("connecting","Connecting to Deriv");
  const url=WS_URLS[state.endpointIndex%WS_URLS.length];
  let ws;
  try{ws=new WebSocket(url);state.socket=ws;}
  catch(err){state.lastError=`WebSocket constructor: ${err.message||err}`;setStatus("error","Browser blocked WebSocket");state.endpointIndex=(state.endpointIndex+1)%WS_URLS.length;scheduleRerenderOUControls();
connect();return;}
  state.connectTimer=setTimeout(()=>{
    if(ws.readyState!==WebSocket.OPEN){
      try{ws.onclose=null;ws.close()}catch{}
      state.endpointIndex=(state.endpointIndex+1)%WS_URLS.length;
      setStatus("offline","Connection timeout — switching endpoint");
      scheduleReconnect();
    }
  },12000);
  ws.onopen=()=>{
    clearTimeout(state.connectTimer);
    resetDeepScannerSubscriptions();
    state.connected=true; state.reconnectDelay=1000; state.lastPongAt=Date.now();state.primarySubscriptionId=null;state.primarySubscriptionSymbol="";state.primaryHistoryRequests={};state.primarySubscribeRequests={};state.lastError="—";renderSubscribedMarketStatus("switching");
    setStatus("connecting",`Connected — requesting ${state.marketName||state.symbol}`);
    state.lastMessage="WebSocket OPEN";
    request({ping:1,req_id:nextReq()});
    request({active_symbols:"full",req_id:nextReq()});
    startMarket(true);
  };
  ws.onmessage=e=>{try{const msg=JSON.parse(e.data);state.lastMessage=msg.msg_type||"unknown";if($("diagMessage"))$("diagMessage").textContent=state.lastMessage;if($("diagLastMessageAt"))$("diagLastMessageAt").textContent=new Date().toLocaleTimeString();handleMessage(msg)}catch(err){state.lastError=String(err.message||err);if($("diagError"))$("diagError").textContent=state.lastError;console.warn("Invalid WebSocket message",err)}};
  ws.onerror=()=>{
    clearTimeout(state.connectTimer);
    state.connected=false;
    state.lastError="Browser WebSocket error";
    renderSubscribedMarketStatus("error");
    setStatus("error","WebSocket error — switching endpoint");
  };
  ws.onclose=e=>{
    clearTimeout(state.connectTimer);
    state.connected=false;state.primarySubscriptionId=null;state.primarySubscriptionSymbol="";state.primaryHistoryRequests={};state.primarySubscribeRequests={};
    state.lastError=`Close ${e.code}${e.reason?": "+e.reason:""}${e.code===1006?" — abnormal close before a WebSocket close frame":""}`;renderSubscribedMarketStatus("offline");
    state.endpointIndex=(state.endpointIndex+1)%WS_URLS.length;
    setStatus("offline",`Disconnected (${e.code}) — switching endpoint`);
    scheduleReconnect();
  };
}
function scheduleReconnect(){
  clearTimeout(state.reconnectTimer);
  setStatus("offline","Reconnecting");
  state.reconnectTimer=setTimeout(()=>{state.reconnectDelay=Math.min(state.reconnectDelay*1.8,15000);connect()},state.reconnectDelay);
}
function nextReq(){return ++state.req}
function request(obj){if(state.socket?.readyState===WebSocket.OPEN)state.socket.send(JSON.stringify(obj))}

function handleMessage(d){
  if(d.error){
    const req=d.req_id;
    if(req!=null&&state.deepScanner.historyRequests[req]){const sym=state.deepScanner.historyRequests[req];delete state.deepScanner.historyRequests[req];const rec=state.deepScanner.data[sym];if(rec){rec.historyReady=false;rec.error=d.error.message||"History unavailable"}renderDeepScanner();return}
    if(req!=null&&state.deepScanner.subscribeRequests[req]){const sym=state.deepScanner.subscribeRequests[req];delete state.deepScanner.subscribeRequests[req];const rec=state.deepScanner.data[sym];if(rec)rec.error=d.error.message||"Subscription unavailable";renderDeepScanner();return}
    state.lastError=`${d.error.code||"API"}: ${d.error.message||"Deriv data error"}`;if($("diagError"))$("diagError").textContent=state.lastError;console.warn("Deriv API error:",d.error);setStatus("error",d.error.message||"Deriv data error");return
  }
  if(d.msg_type==="ping"){state.lastPongAt=Date.now();$("diagSocket").textContent="OPEN • PING OK";return}
  if(d.msg_type==="active_symbols")loadMarkets(d.active_symbols||[]);
  if(d.msg_type==="history"){
    const req=d.req_id, sym=req!=null?state.deepScanner.historyRequests[req]:null;
    if(sym){delete state.deepScanner.historyRequests[req];const rec=state.deepScanner.data[sym];if(rec){const prices=d.history?.prices||[],times=d.history?.times||[],pip=d.history?.pip_size??d.pip_size??rec.pipSize;rec.pipSize=pip;rec.ticks=prices.map((p,i)=>({quote:Number(p),epoch:times[i]||0})).filter(x=>Number.isFinite(x.quote)).slice(-MAX_TICKS);rec.digits=rec.ticks.map(x=>digitFromQuote(x.quote,rec.pipSize)).filter(Number.isInteger);rec.historyReady=true;rec.lastHistoryAt=Date.now();}renderDeepScanner();deepScannerEvaluate(false);return}
    if(req!=null&&Object.prototype.hasOwnProperty.call(state.primaryHistoryRequests,req)){
      const requestedSymbol=state.primaryHistoryRequests[req];delete state.primaryHistoryRequests[req];
      if(requestedSymbol!==state.symbol)return; // Ignore delayed history for a market that is no longer selected.
      loadHistory(d.history?.prices||[],d.history?.times||[],d.history?.pip_size??d.pip_size??state.pipSize);return;
    }
    return;
  }
  if(d.msg_type==="tick"){
    const raw=d.tick,sub=d.subscription||raw?.subscription,req=d.req_id;
    if(!raw)return;
    const t={...raw,subscription:sub,req_id:req};
    if(t.symbol===state.symbol){
      const r=state.deepScanner.data[t.symbol];
      const pending=Object.entries(state.deepScanner.subscribeRequests).find(([,sym])=>sym===t.symbol);
      const scannerSub=!!(r?.subscriptionId&&sub?.id===r.subscriptionId)||(!!pending&&String(req)===String(pending[0]));
      if(scannerSub){if(pending)delete state.deepScanner.subscribeRequests[pending[0]];if(sub?.id){request({forget:sub.id,req_id:nextReq()});delete state.deepScanner.subscriptions[t.symbol];}if(r){r.subscriptionId=null;r.subscribed=false;}return;}
      if(sub?.id){state.primarySubscriptionId=sub.id;state.primarySubscriptionSymbol=t.symbol;}
      if(req!=null&&state.primarySubscribeRequests[req]===t.symbol)delete state.primarySubscribeRequests[req];
      receiveTick(t);
      if(state.primarySubscriptionSymbol===t.symbol && state.primarySubscriptionId && !$("subscribedMarketStatus")?.classList.contains("connected"))renderSubscribedMarketStatus("connected");
      syncCurrentIntoScanner(t);
    }else receiveScannerTick(t);
  }
}
function normalizeMarket(m){
  const symbol=m.underlying_symbol||m.symbol; const name=m.underlying_symbol_name||m.display_name||symbol;
  return {symbol,name,market:m.market||"",submarket:m.submarket||"",subgroup:m.subgroup||"",pipSize:m.pip_size??m.pip??null};
}
function loadMarkets(raw){
  const all=raw.map(normalizeMarket).filter(m=>m.symbol);
  const preferred=all.filter(m=>/volatility|jump/i.test(m.market+" "+m.name+" "+m.submarket+" "+m.subgroup)||/^(?:R_|1HZ\d+V|JD\d+)/i.test(m.symbol));
  state.markets=(preferred.length?preferred:all).sort((a,b)=>a.name.localeCompare(b.name));
  marketSelect.innerHTML="";
  const groups={};
  for(const m of state.markets){const key=/jump/i.test(m.market+" "+m.name+" "+m.submarket+" "+m.subgroup)?"JUMP INDICES":/volatility/i.test(m.market+" "+m.name+" "+m.submarket+" "+m.subgroup)||/^R_|^1HZ/i.test(m.symbol)?"VOLATILITY INDICES":"OTHER MARKETS";(groups[key]??=[]).push(m)}
  for(const [g,items] of Object.entries(groups)){const og=document.createElement("optgroup");og.label=g;for(const m of items){const o=document.createElement("option");o.value=m.symbol;o.textContent=m.name;o.dataset.name=m.name;og.appendChild(o)}marketSelect.appendChild(og)}
  marketSelect.disabled=!state.markets.length;
  const selected=state.markets.find(m=>m.symbol===state.symbol)||state.markets[0];
  if(selected){state.symbol=selected.symbol;state.marketName=selected.name;state.pipSize=selected.pipSize;marketSelect.value=selected.symbol;$("marketName").textContent=selected.name;renderSubscribedMarketStatus("switching");if(!state.marketStarted)startMarket(true)}
  startDeepScanner();
}
function startMarket(force=false){
  if(!force && state.marketStarted && state.symbol==="R_100")return;
  state.marketStarted=true;
  // Replace the previous primary tick subscription instead of leaving stale subscriptions running.
  if(state.primarySubscriptionId&&state.socket?.readyState===WebSocket.OPEN){request({forget:state.primarySubscriptionId,req_id:nextReq()});}
  state.primarySubscriptionId=null;state.primarySubscriptionSymbol="";
  const selected=state.markets.find(m=>m.symbol===state.symbol);if(selected?.pipSize!=null)state.pipSize=selected.pipSize;
  state.ticks=[];state.digits=[];state.lastTickSignature="";state.lastTickAt=0;renderSubscribedMarketStatus("switching");$("lastPrice").textContent="—";$("lastDigit").textContent="—";renderStream();renderEngine();
  const historyReq=nextReq();state.primaryHistoryRequests[historyReq]=state.symbol;
  request({ticks_history:state.symbol,end:"latest",count:1000,style:"ticks",req_id:historyReq});
  const subscribeReq=nextReq();state.primarySubscribeRequests[subscribeReq]=state.symbol;
  request({ticks:state.symbol,subscribe:1,req_id:subscribeReq});
  if($("diagSubscription"))$("diagSubscription").textContent=`Requested ${state.symbol}`;
  syncDeepScannerSubscriptions();
}
function loadHistory(prices,times,pipSize=null){
  if(pipSize!=null)state.pipSize=pipSize;
  const arr=prices.map((p,i)=>({quote:p,epoch:times[i]||0})).filter(x=>Number.isFinite(Number(x.quote)));
  state.ticks=arr.slice(-MAX_TICKS);state.digits=arr.map(x=>digitFromQuote(x.quote,state.pipSize)).filter(Number.isInteger).slice(-MAX_TICKS);
  const latestHistoryTick=state.ticks.at(-1);state.lastTickSignature=latestHistoryTick?String(latestHistoryTick.epoch||"")+":"+String(latestHistoryTick.quote):"";
  $("diagHistory").textContent=String(arr.length);updateQuality();renderStream();renderEngine();syncCurrentIntoScanner();
}

function scannerRecord(m){
  const s=m.symbol;
  if(!state.deepScanner.data[s])state.deepScanner.data[s]={symbol:s,name:m.name,market:m.market,submarket:m.submarket,subgroup:m.subgroup,pipSize:m.pipSize,ticks:[],digits:[],lastTickAt:0,lastHistoryAt:0,historyReady:false,subscribed:false,seen:"",error:""};
  const r=state.deepScanner.data[s];r.name=m.name;r.market=m.market;r.submarket=m.submarket;r.subgroup=m.subgroup;if(m.pipSize!=null)r.pipSize=m.pipSize;return r;
}
function resetDeepScannerSubscriptions(){
  const ds=state.deepScanner;
  ds.historyRequests={};ds.subscribeRequests={};ds.subscriptions={};
  for(const r of Object.values(ds.data)){r.subscribed=false;r.subscriptionId=null;r.historyReady=false;r.lastTickAt=0;r.seen="";}
}
function startDeepScanner(){
  const ds=state.deepScanner;if(!state.markets.length)return;
  if(!ds.startedAt)ds.startedAt=Date.now();
  for(const m of state.markets)scannerRecord(m);
  syncCurrentIntoScanner();
  syncDeepScannerSubscriptions();
  renderDeepScanner();
}
function syncCurrentIntoScanner(t=null){
  if(!state.symbol)return;
  const m=state.markets.find(x=>x.symbol===state.symbol);if(!m)return;
  const r=scannerRecord(m);
  r.pipSize=state.pipSize;
  if(t&&t.symbol===state.symbol){
    const sig=String(t.epoch||"")+":"+String(t.quote);
    const last=r.ticks.at(-1);
    const lastSig=last?String(last.epoch||"")+":"+String(last.quote):"";
    if(sig!==r.lastSeen&&sig!==lastSig){
      const quote=Number(t.quote),digit=digitFromQuote(quote,r.pipSize);
      if(Number.isFinite(quote)&&Number.isInteger(digit)){
        r.ticks.push({quote,epoch:t.epoch||0});
        r.digits.push(digit);
        if(r.ticks.length>MAX_TICKS)r.ticks.shift();
        if(r.digits.length>MAX_TICKS)r.digits.shift();
      }
    }
    r.lastSeen=sig;
    r.lastTickAt=Date.now();
    r.historyReady=r.digits.length>=100;
  }else{
    if(state.ticks.length){r.ticks=state.ticks.slice(-MAX_TICKS);r.digits=state.digits.slice(-MAX_TICKS);r.historyReady=r.digits.length>=100;}
    if(state.lastTickAt)r.lastTickAt=state.lastTickAt;
  }
}
function isMobileDevice(){return !!(window.matchMedia&&window.matchMedia("(max-width: 600px)").matches)}
function isDeepScannerOpen(){const modal=$("deepScannerModal");return !!(modal&&modal.classList.contains("open"))}
function pauseDeepScannerSubscriptions(){
  const ds=state.deepScanner;
  for(const [symbol,id] of Object.entries(ds.subscriptions)){if(id)request({forget:id,req_id:nextReq()});const r=ds.data[symbol];if(r){r.subscriptionId=null;r.subscribed=false;}}
  ds.subscriptions={};ds.subscribeRequests={};
}
function syncDeepScannerSubscriptions(){
  const ds=state.deepScanner;if(!ds.enabled||!state.markets.length||!state.connected)return;
  // On phones, scan other markets only while the scanner popup is open; keep the primary live feed uninterrupted.
  if(isMobileDevice()&&!isDeepScannerOpen())return;
  for(const m of state.markets){
    const r=scannerRecord(m);
    if(m.symbol===state.symbol){
      if(r.subscriptionId){request({forget:r.subscriptionId,req_id:nextReq()});delete ds.subscriptions[m.symbol];r.subscriptionId=null;r.subscribed=false;}
      continue;
    }
    if(!r.historyReady&&!Object.values(ds.historyRequests).includes(m.symbol)){
      const req=nextReq();ds.historyRequests[req]=m.symbol;request({ticks_history:m.symbol,end:"latest",count:1000,style:"ticks",req_id:req});
    }
    if(!r.subscribed&&!Object.values(ds.subscribeRequests).includes(m.symbol)){
      const req=nextReq();ds.subscribeRequests[req]=m.symbol;r.subscribeReq=req;request({ticks:m.symbol,subscribe:1,req_id:req});
    }
  }
}
function receiveScannerTick(t){
  if(!t||!t.symbol||t.symbol===state.symbol)return;
  if(isMobileDevice()&&!isDeepScannerOpen()){if(t.subscription?.id)request({forget:t.subscription.id,req_id:nextReq()});const rec=state.deepScanner.data[t.symbol];if(rec){rec.subscriptionId=null;rec.subscribed=false;}delete state.deepScanner.subscriptions[t.symbol];return;}
  for(const [req,sym] of Object.entries(state.deepScanner.subscribeRequests))if(sym===t.symbol)delete state.deepScanner.subscribeRequests[req];
  const r=state.deepScanner.data[t.symbol];if(!r)return;
  const quote=Number(t.quote);if(!Number.isFinite(quote))return;
  const epoch=t.epoch||Math.floor(Date.now()/1000),sig=String(epoch)+":"+String(quote);
  if(r.seen===sig)return;r.seen=sig;
  if(t.pip_size!=null)r.pipSize=t.pip_size;
  const digit=digitFromQuote(quote,r.pipSize);if(!Number.isInteger(digit))return;
  r.ticks.push({quote,epoch});r.digits.push(digit);
  if(r.ticks.length>MAX_TICKS)r.ticks.shift();if(r.digits.length>MAX_TICKS)r.digits.shift();
  r.lastTickAt=Date.now();r.historyReady=r.digits.length>=100;r.error="";
  if(t.subscription?.id){r.subscriptionId=t.subscription.id;r.subscribed=true;state.deepScanner.subscriptions[t.symbol]=t.subscription.id;}
  // Re-evaluate on incoming live scanner ticks; deepScannerEvaluate throttles full scoring to once per 10 seconds.
  deepScannerEvaluate(false);
}
function scannerRisk(r){
  // Use the timestamp of the latest real Deriv tick, whether it came from the initial
  // ticks_history snapshot or the live subscription. A fresh history alone is enough
  // to compare markets while subscriptions are warming up.
  const latestEpoch=Number(r.ticks.at(-1)?.epoch)||0;
  const latestTickAt=r.lastTickAt&&Date.now()-r.lastTickAt<=60000?r.lastTickAt:(latestEpoch?latestEpoch*1000:0);
  if(!state.connected||!latestTickAt||Date.now()-latestTickAt>60000)return {level:"UNKNOWN",reason:"No sufficiently fresh Deriv ticks"};
  if(r.ticks.length<100)return {level:"UNKNOWN",reason:"Fewer than 100 price samples"};
  const moves=[];for(let i=1;i<r.ticks.length;i++)moves.push(Math.abs(r.ticks[i].quote-r.ticks[i-1].quote));
  const nonzero=moves.filter(x=>x>0);if(nonzero.length<40)return {level:"UNKNOWN",reason:"Insufficient movement baseline"};
  const sorted=nonzero.slice().sort((a,b)=>a-b),base=sorted[Math.floor(sorted.length*.5)]||0;
  if(!base)return {level:"UNKNOWN",reason:"No stable movement baseline"};
  const ratios=moves.slice(-12).map(x=>x/base),extreme=ratios.filter(x=>x>=5).length,elevated=ratios.filter(x=>x>=3.2).length;
  let reversals=0,adjacent=0,dirs=[];
  for(let i=Math.max(1,r.ticks.length-13);i<r.ticks.length;i++){const d=r.ticks[i].quote-r.ticks[i-1].quote;if(d)dirs.push(Math.sign(d))}
  for(let i=1;i<dirs.length;i++){adjacent++;if(dirs[i]!==dirs[i-1])reversals++}
  const reversalRate=adjacent?reversals/adjacent:0;
  if(extreme>=2||ratios.at(-1)>=7||(elevated>=4&&reversalRate>=.65))return {level:"HIGH",reason:"Unusual or clustered price movement"};
  if(elevated>=2||reversalRate>=.8)return {level:"MODERATE",reason:"Elevated movement or reversals"};
  return {level:"LOW",reason:"Movement is within its recent market-specific baseline"};
}
function deepScannerSetupKey(){return state.selectedDigit+"|"+state.selectedSide}
function deepScannerEvaluate(force=false){
  const ds=state.deepScanner;if(!ds.enabled||!state.markets.length)return [];
  if(isMobileDevice()&&!isDeepScannerOpen())return ds.lastScanRows||[];
  // Keep live tick collection immediate while avoiding repeated full-market analysis on lower-powered phones.
  if(!force&&ds.lastScanAt&&Date.now()-ds.lastScanAt<10000)return ds.lastScanRows||[];
  syncCurrentIntoScanner();
  const setup=deepScannerSetupKey();
  if(ds.lastSetupKey!==setup){ds.lastSetupKey=setup;ds.autoLoaded=false;ds.manualOverride=false;ds.lastLoadedSymbol="";ds.lastLoadedScore=0;ds.startedAt=Date.now();}
  const counts={history:0,risk:0,distribution:0,probability:0,signal:0,entry:0};
  const rows=[];
  for(const m of state.markets){
    const r=scannerRecord(m);
    // The distribution gate needs all 1,000 real ticks. Do not report a candidate from a partial window.
    if(r.digits.length<1000){counts.history++;continue;}
    const risk=scannerRisk(r);
    if(risk.level==="HIGH"||risk.level==="UNKNOWN"){counts.risk++;continue;}
    const a=overUnderEvidence(r.digits,state.selectedDigit,state.selectedSide);
    if(!a.distribution?.ready){counts.history++;continue;}
    if(!a.distribution.pass){counts.distribution++;continue;}
    if(a.probabilityConflict){counts.probability++;continue;}
    if(!(a.signal==="SIGNAL"||a.signal==="STRONG SIGNAL")){counts.signal++;continue;}
    const entry=overUnderEntry(r.digits,state.selectedDigit,state.selectedSide);
    if(!entry||!entry.entries?.length){counts.entry++;continue;}
    const top=entry.entries[0],score=Math.round(a.evidence*60+Math.min(100,top.score||0)*.30+(risk.level==="LOW"?10:3));
    rows.push({symbol:m.symbol,name:m.name,score,signal:a.signal,evidence:Math.round(a.evidence*100),entry:top.digit,entryScore:top.score||0,sample:r.digits.length,risk:risk.level,riskReason:risk.reason,reason:a.signal==="STRONG SIGNAL"?"Strong multi-factor Over/Under evidence with a qualifying entry-digit reaction":"Qualified Over/Under evidence and entry-digit reaction"});
  }
  rows.sort((a,b)=>b.score-a.score||b.evidence-a.evidence||b.sample-a.sample);
  ds.lastScanAt=Date.now();
  ds.lastScanRows=rows;
  ds.strongestCandidate=rows[0]||null;
  ds.lastScanDiagnostics={...counts,total:state.markets.length,qualified:rows.length,at:Date.now()};
  renderDeepScanner(rows);
  return rows;
}
function startDeepScan(){
  const ds=state.deepScanner;
  if(!ds.enabled||!state.connected||!state.markets.length){
    renderDeepScanner();
    const progress=$("scannerProgress");
    if(progress)progress.textContent=!state.connected?"Waiting for the live Deriv connection…":"No eligible markets are available yet.";
    return;
  }
  // Explicit Scan Now starts a fresh history pass across every other available market.
  ds.lastScanAt=0;
  ds.strongestCandidate=null;
  ds.lastScanRows=[];
  ds.scanRequestedAt=Date.now();
  syncDeepScannerSubscriptions();
  for(const m of state.markets){
    if(m.symbol===state.symbol)continue;
    if(Object.values(ds.historyRequests).includes(m.symbol))continue;
    const req=nextReq();
    ds.historyRequests[req]=m.symbol;
    request({ticks_history:m.symbol,end:"latest",count:1000,style:"ticks",req_id:req});
  }
  renderDeepScanner();
  const winner=$("scannerWinner");
  if(winner)winner.innerHTML="<strong>SCANNING MARKETS NOW</strong><span>Refreshing live Deriv histories and evaluating your selected "+esc(state.selectedSide)+" "+state.selectedDigit+" setup. Your active market will not change automatically.</span>";
  const btn=$("loadStrongestBtn");
  if(btn){btn.disabled=true;btn.textContent="SCANNING MARKETS…";}
  deepScannerEvaluate(true);
}
function loadStrongestScannerMarket(){
  const ds=state.deepScanner;
  const best=ds.strongestCandidate;
  if(!best){deepScannerEvaluate(true);return;}
  loadScannerMarket(best.symbol,true,best.score);
  ds.lastLoadedSymbol=best.symbol;ds.lastLoadedScore=best.score;ds.autoLoaded=false;ds.manualOverride=true;
  renderDeepScanner([best]);
  const winner=$("scannerWinner");
  if(winner)winner.innerHTML="<strong>MARKET LOADED • "+esc(best.name)+"</strong><span>"+esc(best.symbol)+" loaded into the Over/Under engine. Analysis will refresh using this market's own live data.</span>";
}
function loadScannerMarket(symbol,manual=false,score=0){
  // Hard safety gate: scanner market changes are allowed only through the explicit LOAD STRONGEST MARKET action.
  if(manual!==true)return;
  const m=state.markets.find(x=>x.symbol===symbol);if(!m)return;
  state.deepScanner.lastLoadedSymbol=symbol;state.deepScanner.lastLoadedScore=score;state.deepScanner.switchAfter=Date.now();
  if(manual){state.deepScanner.manualOverride=true;state.deepScanner.autoLoaded=false;}
  if(state.symbol===symbol){renderDeepScanner();return}
  state.symbol=m.symbol;state.marketName=m.name;state.pipSize=m.pipSize;marketSelect.value=m.symbol;$("marketName").textContent=m.name;state.marketStarted=false;startMarket(true);syncDeepScannerSubscriptions();renderDeepScanner();
}
function renderDeepScanner(rows=null){
  const card=$("deepScannerCard");if(!card)return;
  const ds=state.deepScanner;rows=rows||[];
  const best=rows.find(r=>r.score>0)||ds.strongestCandidate||null;
  const total=state.markets.length,ready=state.markets.filter(m=>(ds.data[m.symbol]?.digits.length||0)>=1000).length;
  const status=$("deepScannerStatus");if(status)status.textContent=!state.connected?"FEED OFFLINE":best?"STRONG SETUP READY":ready+"/"+total+" FULL DATA";
  const progress=$("scannerProgress");if(progress)progress.textContent=ready+" of "+total+" markets have 1,000 ticks • Setup "+state.selectedSide+" "+state.selectedDigit;
  const setup=$("scannerSetup");if(setup)setup.textContent=state.selectedSide+" "+state.selectedDigit;
  const winner=$("scannerWinner");
  if(winner){
    if(best)winner.innerHTML="<strong>STRONGEST ELIGIBLE SETUP READY</strong><span>Signal "+esc(best.signal)+" • Evidence "+best.evidence+"% • Entry digit "+best.entry+" • Risk "+esc(best.risk)+". Press LOAD STRONGEST MARKET to switch your active market.</span>";
    else {
      const d=ds.lastScanDiagnostics;
      let why="";
      if(d){
        const reasons=[];
        if(d.history)reasons.push(d.history+" awaiting 1,000 ticks");
        if(d.risk)reasons.push(d.risk+" excluded by spike/freshness risk");
        if(d.distribution)reasons.push(d.distribution+" blocked by distribution rules");
        if(d.probability)reasons.push(d.probability+" blocked by complementary probability");
        if(d.signal)reasons.push(d.signal+" did not reach SIGNAL strength");
        if(d.entry)reasons.push(d.entry+" had no qualified entry digit");
        why=reasons.length?" Scan results: "+reasons.join("; ")+".":" No eligible candidate passed every rule.";
      }
      winner.innerHTML="<strong>NO STRONG MARKET READY</strong><span>"+esc("The scanner keeps markets private and will not switch automatically."+why)+"</span>";
    }
  }
  const loadBtn=$("loadStrongestBtn");if(loadBtn){loadBtn.disabled=!best;loadBtn.textContent=best?"LOAD STRONGEST MARKET":"NO STRONG MARKET READY";}
  const results=$("deepScannerResults");if(results){results.innerHTML="";results.hidden=true;}
  const count=$("scannerResultCount");if(count)count.textContent="";
}
function ouValidationKey(){
  return state.symbol+"|"+state.selectedDigit+"|"+state.selectedSide;
}
function resetOUValidationIfNeeded(){
  const key=ouValidationKey();
  if(state.ouValidation.key!==key){
    state.ouValidation={key,pending:state.ouValidation.pending||[],completed:{1:{n:0,hits:0},2:{n:0,hits:0},3:{n:0,hits:0}},lastTrigger:"—"};
  }
}
function ouValidationRecordKey(market,digit,side,candidate){
  return market+"|"+digit+"|"+side+"|"+candidate;
}
function processOUValidationTick(digit){
  resetOUValidationIfNeeded();
  const v=state.ouValidation;
  for(let i=v.pending.length-1;i>=0;i--){
    const p=v.pending[i];
    if(p.market!==state.symbol){v.pending.splice(i,1);continue}
    p.steps++;
    p.hits.push(p.side==="OVER"?digit>p.selectedDigit:digit<p.selectedDigit);
    const key=ouValidationRecordKey(p.market,p.selectedDigit,p.side,p.candidate);
    const rec=state.ouValidationBook[key];
    if(rec){
      if(!rec.recentOutcomes)rec.recentOutcomes={1:[],2:[],3:[]};
      for(const horizon of [1,2,3]){
        if(p.steps===horizon){
          const won=p.hits.slice(0,horizon).every(Boolean);
          rec[horizon].n++;
          if(horizon===1&&Number.isFinite(p.confidence)){rec.confidenceSum=(Number(rec.confidenceSum)||0)+Math.max(0,Math.min(1,p.confidence));rec.confidenceN=(Number(rec.confidenceN)||0)+1;}
          if(won){rec[horizon].hits++;rec[horizon].failureStreak=0}
          else{rec[horizon].failureStreak=(rec[horizon].failureStreak||0)+1;rec[horizon].maxFailureStreak=Math.max(rec[horizon].maxFailureStreak||0,rec[horizon].failureStreak)}
          const outcomes=rec.recentOutcomes[horizon]||(rec.recentOutcomes[horizon]=[]);
          outcomes.push(won);if(outcomes.length>30)outcomes.splice(0,outcomes.length-30);
        }
      }
      rec.lastUpdated=Date.now();state.validationDirty=true;
    }
    if(p.selectedDigit===state.selectedDigit&&p.side===state.selectedSide){
      for(const horizon of [1,2,3]){
        if(p.steps===horizon){
          v.completed[horizon].n++;
          if(p.hits.slice(0,horizon).every(Boolean))v.completed[horizon].hits++;
        }
      }
    }
    if(p.steps>=3)v.pending.splice(i,1);
  }
}
function recordOUValidationTrigger(digit){
  resetOUValidationIfNeeded();
  const snap=state.ouEntrySnapshot;
  // Only score a candidate from the analysis snapshot rendered for this exact live tick.
  // Mobile render throttling and engine switches must not reuse stale entry candidates.
  if(state.engine!=="overunder"||!snap||snap.tickCount!==state.liveTickSequence-1||!snap.active||snap.key!==ouValidationKey()||!(Array.isArray(snap.validationDigits)?snap.validationDigits:snap.digits).includes(digit))return;
  const signature=state.symbol+"|"+state.selectedDigit+"|"+state.selectedSide+"|"+digit+"|"+state.ticks.length;
  const key=ouValidationRecordKey(state.symbol,state.selectedDigit,state.selectedSide,digit);
  if(!state.ouValidationBook[key]){
    state.ouValidationBook[key]={market:state.symbol,selectedDigit:state.selectedDigit,side:state.selectedSide,candidate:digit,confidenceSum:0,confidenceN:0,1:{n:0,hits:0,failureStreak:0,maxFailureStreak:0},2:{n:0,hits:0,failureStreak:0,maxFailureStreak:0},3:{n:0,hits:0,failureStreak:0,maxFailureStreak:0},recentOutcomes:{1:[],2:[],3:[]},triggers:0,lastUpdated:Date.now()};
  }
  state.ouValidationBook[key].triggers++;
  state.ouValidation.pending.push({digit,candidate:digit,selectedDigit:state.selectedDigit,side:state.selectedSide,market:state.symbol,steps:0,hits:[],confidence:Number(snap.confidence),signature});
  state.ouValidation.lastTrigger="Entry digit "+digit+" triggered at tick "+state.ticks.length;state.validationDirty=true;
}
function otherValidationKey(engine,target,market=state.symbol){return market+"|"+engine+"|"+target;}
function setOtherValidationForecast(engine,target,signal,hasEntry,tickCount,confidence){
  const active=(signal==="SIGNAL"||signal==="STRONG SIGNAL")&&hasEntry;
  state.otherValidation.snapshot=active?{engine,target,market:state.symbol,tickCount,confidence:Number(confidence),active:true}:null;
}
function signalValidationKey(engine,target,market=state.symbol){return market+"|"+engine+"|"+target;}
function setSignalValidationForecast(engine,target,signal,tickCount,confidence,extra={}){
  const active=signal==="SIGNAL"||signal==="STRONG SIGNAL";
  state.signalValidation.snapshot=active?{engine,target,market:state.symbol,tickCount,confidence:Number(confidence),active:true,...extra}:null;
}
function processSignalValidationTick(digit,quote,previousQuote){
  const sv=state.signalValidation,snap=sv.snapshot;sv.snapshot=null;
  if(!snap||!snap.active||snap.market!==state.symbol||snap.engine!==state.engine||snap.tickCount!==state.liveTickSequence-1)return;
  let hit=false;
  if(snap.engine==="overunder")hit=snap.side==="OVER"?digit>snap.selectedDigit:digit<snap.selectedDigit;
  else if(snap.engine==="evenodd")hit=(digit%2===0?"EVEN":"ODD")===snap.target;
  else if(snap.engine==="risefall")hit=(quote>previousQuote?"RISE":quote<previousQuote?"FALL":"FLAT")===snap.target;
  const key=signalValidationKey(snap.engine,snap.target,snap.market);
  if(!sv.book[key])sv.book[key]={market:snap.market,engine:snap.engine,target:snap.target,n:0,hits:0,confidenceSum:0,confidenceN:0,lastUpdated:0};
  const rec=sv.book[key];rec.n++;if(hit)rec.hits++;
  if(Number.isFinite(snap.confidence)){rec.confidenceSum+=Math.max(0,Math.min(1,snap.confidence));rec.confidenceN++;}
  rec.lastUpdated=Date.now();state.validationDirty=true;
}
function scoreOtherValidationPending(p,digit,quote,previousQuote){
  let hit=false;
  if(p.engine==="evenodd")hit=(digit%2===0?"EVEN":"ODD")===p.target;
  else if(p.engine==="risefall"){
    const move=quote>previousQuote?"RISE":quote<previousQuote?"FALL":"FLAT";
    hit=move===p.target;
  }
  p.steps++;p.hits.push(hit);
  const rec=state.otherValidation.book[otherValidationKey(p.engine,p.target,p.market)];
  if(rec){
    const h=rec[p.steps];
    h.n++;
    if(p.steps===1&&Number.isFinite(p.confidence)){rec.confidenceSum=(Number(rec.confidenceSum)||0)+Math.max(0,Math.min(1,p.confidence));rec.confidenceN=(Number(rec.confidenceN)||0)+1;}
    if(p.hits.slice(0,p.steps).every(Boolean)){h.hits++;h.failureStreak=0;}
    else{h.failureStreak=(h.failureStreak||0)+1;h.maxFailureStreak=Math.max(h.maxFailureStreak||0,h.failureStreak);}
    rec.lastUpdated=Date.now();state.validationDirty=true;
  }
}
function processOtherValidationTick(digit,quote,previousQuote){
  const ov=state.otherValidation;
  for(let i=ov.pending.length-1;i>=0;i--){
    const p=ov.pending[i];
    if(p.market!==state.symbol){ov.pending.splice(i,1);continue;}
    scoreOtherValidationPending(p,digit,quote,previousQuote);
    if(p.steps>=3)ov.pending.splice(i,1);
  }
  const snap=ov.snapshot;
  ov.snapshot=null;
  if(!snap||!snap.active||snap.market!==state.symbol||snap.engine!==state.engine||snap.tickCount!==state.liveTickSequence-1)return;
  const key=otherValidationKey(snap.engine,snap.target,snap.market);
  if(!ov.book[key])ov.book[key]={market:snap.market,engine:snap.engine,target:snap.target,triggers:0,confidenceSum:0,confidenceN:0,1:{n:0,hits:0,failureStreak:0,maxFailureStreak:0},2:{n:0,hits:0,failureStreak:0,maxFailureStreak:0},3:{n:0,hits:0,failureStreak:0,maxFailureStreak:0},lastUpdated:Date.now()};
  ov.book[key].triggers++;state.validationDirty=true;
  const p={market:snap.market,engine:snap.engine,target:snap.target,steps:0,hits:[],confidence:snap.confidence};
  scoreOtherValidationPending(p,digit,quote,previousQuote);
  if(p.steps<3)ov.pending.push(p);
}
function ouValidationSummary(){
  resetOUValidationIfNeeded();
  const c=state.ouValidation.completed;
  const fmt=x=>x.n?Math.round(x.hits/x.n*100)+"% ("+x.hits+"/"+x.n+")":"collecting (0)";
  return "Live entry validation — next 1 tick: "+fmt(c[1])+" • next 2 consecutive ticks: "+fmt(c[2])+" • next 3 consecutive ticks: "+fmt(c[3]);
}
function getSignalValidationReliability(engine){
  const target=engine==="overunder"?state.selectedSide+" "+state.selectedDigit:engine==="evenodd"?state.selectedParity:state.selectedRiseFall;
  const rec=state.signalValidation.book[signalValidationKey(engine,target)];
  const forecasts=rec?.n||0,hits=rec?.hits||0,rate=forecasts?hits/forecasts:null;
  const confidenceN=rec?.confidenceN||0,averageConfidence=confidenceN?rec.confidenceSum/confidenceN:null;
  const calibrationGap=rate!==null&&averageConfidence!==null?Math.abs(rate-averageConfidence):null;
  const smoothedRate=(hits+10)/(forecasts+20),learningWeight=forecasts/(forecasts+30);
  const adaptiveAdjustment=forecasts>=10?Math.max(-.08,Math.min(.08,(smoothedRate-.5)*.8*learningWeight)):0;
  return {forecasts,hits,rate,status:forecasts<10?"TOO LITTLE DATA":forecasts<30?"EARLY SAMPLE":"SAMPLE AVAILABLE",confidenceN,averageConfidence,calibrationGap,smoothedRate,learningWeight,adaptiveAdjustment};
}
function getValidationReliability(engine){
  let records=[];
  if(engine==="overunder"){
    const prefix=state.symbol+"|"+state.selectedDigit+"|"+state.selectedSide+"|";
    records=Object.values(state.ouValidationBook).filter(r=>ouValidationRecordKey(r.market,r.selectedDigit,r.side,r.candidate).startsWith(prefix));
  }else{
    const target=engine==="evenodd"?state.selectedParity:state.selectedRiseFall;
    const rec=state.otherValidation.book[otherValidationKey(engine,target)];
    if(rec)records=[rec];
  }
  const forecasts=records.reduce((sum,r)=>sum+(r[1]?.n||0),0);
  const hits=records.reduce((sum,r)=>sum+(r[1]?.hits||0),0);
  const rate=forecasts?hits/forecasts:null;
  const status=forecasts<10?"TOO LITTLE DATA":forecasts<30?"EARLY SAMPLE":"SAMPLE AVAILABLE";
  const confidenceN=records.reduce((sum,r)=>sum+(r.confidenceN||0),0);
  const confidenceSum=records.reduce((sum,r)=>sum+(r.confidenceSum||0),0);
  const averageConfidence=confidenceN?confidenceSum/confidenceN:null;
  const calibrationGap=rate!==null&&averageConfidence!==null?Math.abs(rate-averageConfidence):null;
  // Smooth small samples toward a neutral 50% prior so a few wins/losses do not dominate.
  const smoothedRate=(hits+10)/(forecasts+20);
  const learningWeight=forecasts/(forecasts+30);
  const adaptiveAdjustment=forecasts>=10?Math.max(-.08,Math.min(.08,(smoothedRate-.5)*.8*learningWeight)):0;
  return {forecasts,hits,rate,status,confidenceN,averageConfidence,calibrationGap,smoothedRate,learningWeight,adaptiveAdjustment};
}
function validationReliabilityNote(engine){
  const v=getValidationReliability(engine);
  const calibration=v.confidenceN>=10&&v.calibrationGap!==null?" Forecast confidence averaged "+Math.round(v.averageConfidence*100)+"% versus "+Math.round(v.rate*100)+"% observed 1-tick hit rate (gap "+Math.round(v.calibrationGap*100)+" points; "+v.confidenceN+" paired outcomes).":" Confidence calibration is still collecting paired forecasts and outcomes.";
  const learning=v.forecasts>=10?" Adaptive feedback: "+Math.round(v.smoothedRate*100)+"% smoothed hit rate; its influence is weighted by sample size and capped at ±8 confidence points.":" Adaptive feedback is neutral until at least 10 outcomes are recorded.";
  if(v.forecasts<10)return "AI feedback: too little outcome data ("+v.forecasts+" scored 1-tick outcomes). Do not treat this setup as historically validated."+calibration+learning;
  if(v.forecasts<30)return "AI feedback: early sample ("+v.forecasts+" scored 1-tick outcomes, "+Math.round(v.rate*100)+"% hit rate). Keep confidence provisional; this is not a profitability guarantee."+calibration+learning;
  return "AI feedback: "+v.forecasts+" scored 1-tick outcomes, "+Math.round(v.rate*100)+"% hit rate."+calibration+learning+" Historical sample is saved in this browser and does not guarantee future results.";
}
function wilsonInterval(hits,total,z=1.96){
  if(!Number.isFinite(hits)||!Number.isFinite(total)||total<=0||hits<0||hits>total)return null;
  const p=hits/total,z2=z*z,den=1+z2/total,center=(p+z2/(2*total))/den;
  const margin=z*Math.sqrt((p*(1-p)+z2/(4*total))/total)/den;
  return {low:Math.max(0,center-margin),high:Math.min(1,center+margin)};
}
function signalEntryMetricsMarkup(engine){
  const signal=getSignalValidationReliability(engine),entry=getValidationReliability(engine);
  const pct=x=>x===null||x===undefined?"Collecting":Math.round(x*100)+"%";
  const falseSignal=signal.rate===null?null:1-signal.rate,falseEntry=entry.rate===null?null:1-entry.rate;
  const sampleNote=n=>n<10?"Small sample — learning neutral":n<30?"Early sample — treat cautiously":"Scored live outcomes";
  const ci=(v)=>{const x=v.forecasts?wilsonInterval(v.hits,v.forecasts):null;return x?Math.round(x.low*100)+"–"+Math.round(x.high*100)+"% 95% interval":"95% interval unavailable";};
  return '<div class="signal-entry-metrics"><div class="signal-entry-metric"><strong>FALSE-SIGNAL RATE</strong><b>'+pct(falseSignal)+'</b><span>'+signal.forecasts+' scored</span><small>'+esc(sampleNote(signal.forecasts))+'</small><small>Hit-rate uncertainty: '+esc(ci(signal))+'</small></div><div class="signal-entry-metric"><strong>FALSE-ENTRY RATE</strong><b>'+pct(falseEntry)+'</b><span>'+entry.forecasts+' scored</span><small>'+esc(sampleNote(entry.forecasts))+'</small><small>Hit-rate uncertainty: '+esc(ci(entry))+'</small></div></div><div class="ou-validation-note">95% Wilson intervals show sampling uncertainty; they do not guarantee future outcomes. Signal learning adjusts Final Signal confidence from signal-only outcomes. Entry learning adjusts entry strength/ranking from entry outcomes. False rates are not profitability measures.</div>';
}
function renderOUValidationPanel(){
  const card=$("ouValidationCard"),out=$("ouValidationResults"),payoutControl=$("ouPayoutControl");
  if(!card||!out)return;
  card.style.display="";
  if(payoutControl)payoutControl.style.display=state.engine==="overunder"?"":"none";
  if(state.engine!=="overunder"){
    const engine=state.engine,target=engine==="evenodd"?state.selectedParity:state.selectedRiseFall;
    const key=otherValidationKey(engine,target),rec=state.otherValidation.book[key];
    const fmt=x=>x.n?Math.round(x.hits/x.n*100)+"% ("+x.hits+"/"+x.n+")":"—";
    const label=engine==="evenodd"?"EVEN/ODD":"RISE/FALL";
    out.innerHTML=signalEntryMetricsMarkup(engine)+'<div class="ou-validation-note">Saved walk-forward validation • '+label+' forecasts count only when Final Signal and Entry Engine both qualify. Outcomes use future live ticks; this is a prediction hit rate, not proof of profitability.</div><div class="ou-validation-breakeven">'+esc(validationReliabilityNote(engine))+'</div>'+
      (rec?'<div class="ou-validation-table"><div class="ou-validation-row engine-validation-row ou-validation-head"><span>SETUP</span><span>FORECASTS</span><span>1 TICK</span><span>2 IN A ROW</span><span>3 IN A ROW</span><span>MAX FAILS</span></div><div class="ou-validation-row engine-validation-row"><strong>'+esc(target)+'</strong><span>'+rec.triggers+'</span><span>'+fmt(rec[1])+'</span><span>'+fmt(rec[2])+'</span><span>'+fmt(rec[3])+'</span><span>'+Math.max(rec[1].maxFailureStreak||0,rec[2].maxFailureStreak||0,rec[3].maxFailureStreak||0)+'</span></div></div><div class="ou-validation-note">Even/Odd checks the next digit parity. Rise/Fall checks the next real quote movement; unchanged prices count as misses. A 2- or 3-tick success requires every consecutive outcome in that horizon to match.</div>':
      '<div class="ou-validation-empty">No qualifying '+label+' forecasts recorded for '+esc(state.symbol)+' · '+esc(target)+' yet. Keep the live stream running and leave this engine selected while valid signals and entries appear.</div>');
    return;
  }
  const prefix=state.symbol+"|"+state.selectedDigit+"|"+state.selectedSide+"|";
  const rows=Object.values(state.ouValidationBook).filter(r=>ouValidationRecordKey(r.market,r.selectedDigit,r.side,r.candidate).startsWith(prefix)).sort((a,b)=>b.triggers-a.triggers).slice(0,5);
  const payout=Math.max(1,Math.min(500,Number(state.ouPayoutPercent)||95));
  const breakeven=100/(1+payout/100);
  const fmt=x=>x.n?Math.round(x.hits/x.n*100)+"% ("+x.hits+"/"+x.n+")":"—";
  const roi=x=>x.n?(((x.hits*payout-(x.n-x.hits)*100)/x.n)>=0?"+":"")+(((x.hits*payout-(x.n-x.hits)*100)/x.n).toFixed(1))+"%":"—";
  const entryStats=getValidationReliability("overunder"),entryCI=entryStats.forecasts?wilsonInterval(entryStats.hits,entryStats.forecasts):null;
  const edgeAssessment=!entryCI?"Not enough scored entries to assess the break-even threshold.":entryCI.low*100>breakeven?"Observed lower 95% bound is above assumed break-even; keep validating on unseen data.":entryCI.high*100<breakeven?"Observed upper 95% bound is below assumed break-even; current sample is unfavourable at this assumed payout.":"The 95% interval overlaps assumed break-even; edge is not established.";
  out.innerHTML=signalEntryMetricsMarkup("overunder")+'<div class="ou-validation-note">Saved locally in this browser • only live entry-digit triggers count • no trades are placed. Assumed win profit is editable and is a what-if estimate, not Deriv live payout.</div><div class="ou-validation-breakeven">'+esc(validationReliabilityNote("overunder"))+'</div>'+
    '<div class="ou-validation-breakeven">Assumed profit per win: <strong>'+payout.toFixed(1)+'%</strong> of stake • break-even hit rate: <strong>'+breakeven.toFixed(1)+'%</strong><br>'+esc(edgeAssessment)+'</div>'+
    (rows.length?'<div class="ou-validation-table"><div class="ou-validation-row ou-validation-head"><span>ENTRY</span><span>TRIGGERS</span><span>1 TICK</span><span>2 IN A ROW</span><span>3 IN A ROW</span><span>MAX FAILS</span><span>EST. ROI*</span></div>'+rows.map(r=>{const selected=[1,2,3].reduce((best,h)=>r[h].n>best.n?r[h]:best,r[1]);return '<div class="ou-validation-row"><strong>'+r.candidate+'</strong><span>'+r.triggers+'</span><span>'+fmt(r[1])+'</span><span>'+fmt(r[2])+'</span><span>'+fmt(r[3])+'</span><span>'+((selected.maxFailureStreak||0))+'</span><span>'+roi(selected)+'</span></div>'}).join("")+'</div><div class="ou-validation-note">*ROI uses the best-sampled horizon for that digit, assumes the entered profit rate and a 100% stake loss on misses. Change payout assumption to match a real quoted contract before interpreting it.</div>':'<div class="ou-validation-empty">No qualifying entry-digit triggers recorded for '+esc(state.symbol)+' • '+state.selectedSide+' '+state.selectedDigit+' yet. Keep the live stream running; the table fills as entry digits trigger and their next ticks complete.</div>');
}
function receiveTick(t){
  if(!t||t.symbol!==state.symbol)return;
  const quote=t.quote;if(!Number.isFinite(Number(quote)))return;
  const epoch=t.epoch||Math.floor(Date.now()/1000),signature=String(epoch)+":"+String(quote);
  if(signature===state.lastTickSignature)return;
  if(t.pip_size!=null)state.pipSize=t.pip_size;
  const digit=digitFromQuote(quote,state.pipSize);if(!Number.isInteger(digit))return;

  state.lastTickSignature=signature;
  state.liveTickSequence++;
  state.ticks.push({quote:Number(quote),epoch});state.digits.push(digit);
  if(state.ticks.length>MAX_TICKS)state.ticks.shift();if(state.digits.length>MAX_TICKS)state.digits.shift();
  state.lastTickAt=Date.now();
  // Score previously registered forecasts only against this newly received live tick.
  processOUValidationTick(digit);
  const previousQuote=state.ticks.length>1?Number(state.ticks[state.ticks.length-2].quote):Number.NaN;
  processSignalValidationTick(digit,Number(quote),previousQuote);
  processOtherValidationTick(digit,Number(quote),previousQuote);
  recordOUValidationTrigger(digit);
  persistValidationData();
  $("lastPrice").textContent=String(quote);$("lastDigit").textContent=digit;
  $("tickCount").textContent=state.ticks.length.toLocaleString()+" ticks";$("updatedAt").textContent="Updated "+new Date().toLocaleTimeString();
  $("diagTicks").textContent=state.ticks.length;
  updateQuality();renderStream(true);
  if(shouldRenderEngineForCurrentTick())renderEngine();else renderOUValidationPanel();
  if(autoTrade.enabled&&state.engine==="overunder"){
    // FAST and Standard use the same live-tick entry checks. Never replay ticks received
    // while a quote/contract or two-run cycle is busy; the next eligible live tick can trigger.
    processAutoTradeTick(digit);
  }
}
function updateQuality(){
  const n=state.digits.length,pill=$("qualityPill");
  if(n>=500){pill.textContent="GOOD";pill.className="quality-pill good"}
  else if(n>=100){pill.textContent="BUILDING";pill.className="quality-pill"}
  else {pill.textContent="INSUFFICIENT";pill.className="quality-pill bad"}
  $("diagAge").textContent=state.lastTickAt?Math.round((Date.now()-state.lastTickAt)/1000)+"s":"—";
}
function renderStream(incremental=false){
  const d=state.digits.slice(-STREAM_SIZE),host=$("digitStream");
  $("streamInfo").textContent=d.length+" digits";
  const expectedPreviousCount=d.length<STREAM_SIZE?Math.max(0,d.length-1):STREAM_SIZE;
  if(incremental&&host.children.length===expectedPreviousCount&&d.length>0){
    const previous=host.lastElementChild;if(previous)previous.classList.remove("latest");
    if(host.children.length>=STREAM_SIZE)host.firstElementChild.remove();
    const node=document.createElement("span");node.className="digit latest";node.textContent=String(d[d.length-1]);host.appendChild(node);
  }else{
    host.innerHTML=d.map((x,i)=>`<span class="digit ${i===d.length-1?"latest":""}">${x}</span>`).join("");
  }
  const now=Date.now();
  if(!incremental||now-lastDistributionRenderAt>=2500){renderDigitDistribution();lastDistributionRenderAt=now;}
}
function renderDigitDistribution(){
  const windowDigits=state.digits.slice(-1000);
  const host=$("digitDistribution"),info=$("distributionInfo");
  if(!host||!info)return;
  const total=windowDigits.length;
  info.textContent=total.toLocaleString()+" / 1,000 ticks";
  if(!total){host.innerHTML='<div class="distribution-empty">Waiting for live Deriv ticks…</div>';return;}
  const freq=Array(10).fill(0);
  for(const digit of windowDigits)if(Number.isInteger(digit)&&digit>=0&&digit<=9)freq[digit]++;
  const percentages=freq.map(count=>count/total*100);
  const max=Math.max(...freq),min=Math.min(...freq),maxPct=Math.max(...percentages);
  host.innerHTML=freq.map((count,digit)=>{
    const pct=percentages[digit],isMost=count===max,isLeast=count===min;
    const kind=isMost?' most':isLeast?' least':'',tag=isMost?'MOST':isLeast?'LEAST':'';
    const share=maxPct?pct/maxPct*100:0,active=digit===state.selectedDigit;
    const qualifies=state.selectedSide==="OVER"?digit>state.selectedDigit:digit<state.selectedDigit;
    const relation=digit===state.selectedDigit?' selected':qualifies?' qualifies':' nonqualifying';
    return '<button type="button" class="distribution-cell distribution-digit'+kind+relation+(active?' active':'')+'" data-digit="'+digit+'" aria-label="Select digit '+digit+'" aria-pressed="'+active+'"><span class="distribution-circle" style="--share:'+share.toFixed(2)+'%"><span>'+digit+'</span></span><span class="distribution-percent">'+pct.toFixed(1)+'%</span><span class="distribution-tag">'+tag+'</span></button>';
  }).join('');
  host.querySelectorAll(".distribution-digit").forEach(btn=>btn.addEventListener("click",()=>selectOverUnderDigit(Number(btn.dataset.digit))));
}
function counts(d){return d.reduce((a,x)=>(a[x]=(a[x]||0)+1,a),{})}
function rate(a,b){return b?Math.round(a/b*100):0}
function ouRate(arr,digit,side){
  if(!arr.length)return 0;
  return arr.filter(x=>side==="OVER"?x>digit:x<digit).length/arr.length;
}
function ouWindowRates(d,digit,side){
  const sizes=[20,50,100,250,500];
  return sizes.map(size=>{
    const a=d.slice(-size);
    return {size,n:a.length,rate:a.length?ouRate(a,digit,side):0};
  }).filter(x=>x.n);
}
function ouTrend(rates){
  if(rates.length<3)return 0;
  const pts=rates.map((x,i)=>({x:i,y:x.rate}));
  const mx=(pts.length-1)/2;
  const my=pts.reduce((a,p)=>a+p.y,0)/pts.length;
  let num=0,den=0;
  for(const p of pts){num+=(p.x-mx)*(p.y-my);den+=(p.x-mx)*(p.x-mx)}
  return den?num/den:0;
}
function ouRuns(arr,digit,side){
  if(!arr.length)return {favorableRuns:0,unfavorableRuns:0,longest:0,last:0};
  const ok=x=>side==="OVER"?x>digit:x<digit;
  let favorableRuns=0,unfavorableRuns=0,longest=0,last=0,run=0,prev=null;
  for(const x of arr){
    const v=ok(x);
    if(v){if(!prev)favorableRuns++;run++;longest=Math.max(longest,run)}
    else{if(prev)unfavorableRuns++;run=0}
    prev=v;
  }
  for(let i=arr.length-1;i>=0&&ok(arr[i]);i--)last++;
  return {favorableRuns,unfavorableRuns,longest,last};
}
function ouClusterScore(arr,digit,side){
  if(arr.length<6)return .5;
  const ok=x=>side==="OVER"?x>digit:x<digit;
  const run=ouRuns(arr,digit,side);
  const blocks=Math.max(1,Math.floor(arr.length/10));
  const blockRates=[];
  for(let i=0;i<arr.length;i+=10){
    const b=arr.slice(i,i+10);
    if(b.length>=5)blockRates.push(b.filter(ok).length/b.length);
  }
  const mean=blockRates.length?blockRates.reduce((a,x)=>a+x,0)/blockRates.length:.5;
  const variance=blockRates.length?blockRates.reduce((a,x)=>a+(x-mean)**2,0)/blockRates.length:0;
  const persistence=Math.min(1,(run.longest/Math.max(2,arr.length*.12)));
  const dispersion=Math.max(0,1-Math.sqrt(variance)*2);
  const streakContext=Math.min(1,run.last/4);
  return Math.max(0,Math.min(1,.4+mean*.25+dispersion*.15+persistence*.1+streakContext*.1));
}
function ouTransitionStats(d,candidate,selectedDigit,selectedSide){
  const qualifies=x=>selectedSide==="OVER"?x>selectedDigit:x<selectedDigit;
  const windows=[500,250,100,50];
  let total=0,favorable=0,weighted=0,weightTotal=0;
  const recent={total:0,favorable:0},matrix=Array(10).fill(null).map(()=>Array(10).fill(0));
  for(let i=0;i<d.length-1;i++){
    if(d[i]!==candidate)continue;
    const next=d[i+1],ok=qualifies(next),age=d.length-1-i;
    total++;if(ok)favorable++;
    const w=age<=50?1.6:age<=100?1.35:age<=250?1.15:1;
    weighted+=ok?w:0;weightTotal+=w;matrix[candidate][next]++;
    if(age<=250){recent.total++;if(ok)recent.favorable++}
  }
  const recentRate=recent.total?recent.favorable/recent.total:(total?favorable/total:0);
  const rate=total?favorable/total:0;
  const weightedRate=weightTotal?weighted/weightTotal:rate;
  const persistence=ouReactionDepth(d,candidate,selectedDigit,selectedSide);
  return {total,favorable,rate,weightedRate,recentRate,recentTotal:recent.total,matrixRow:matrix[candidate],...persistence};
}
function ouReactionDepth(d,candidate,selectedDigit,selectedSide){
  const qualifies=x=>selectedSide==="OVER"?x>selectedDigit:x<selectedDigit;
  let occurrences=0,n1=0,n2=0,n3=0,r1=0,r2=0,r3=0,recovery=0;
  // r2/r3 measure conditional continuation after prior favorable ticks, not joint rates.
  for(let i=0;i<d.length;i++){
    if(d[i]!==candidate)continue;
    occurrences++;
    if(i+1<d.length){
      n1++;const a=qualifies(d[i+1]);if(a)r1++;
      if(a&&i+2<d.length){
        n2++;const b=qualifies(d[i+2]);if(b)r2++;
        if(b&&i+3<d.length){n3++;if(qualifies(d[i+3]))r3++}
      }else if(!a&&i+3<d.length&&qualifies(d[i+2])&&qualifies(d[i+3]))recovery++;
    }
  }
  return {occurrences,n1,n2,n3,r1:n1?r1/n1:0,r2:n2?r2/n2:0,r3:n3?r3/n3:0,recovery:n3?recovery/n3:0};
}
function ouStats(d,digit,side){
  const rates=ouWindowRates(d,digit,side);
  const recent=rates.find(x=>x.size===20)?.rate??0;
  const medium=rates.find(x=>x.size===100)?.rate??recent;
  const long=rates.find(x=>x.size===500)?.rate??rates.at(-1)?.rate??recent;
  const short50=rates.find(x=>x.size===50)?.rate??recent;
  const mid250=rates.find(x=>x.size===250)?.rate??long;
  const momentum=recent-long;
  const trend=ouTrend(rates);
  const cluster=ouClusterScore(d.slice(-100),digit,side);
  const run=ouRuns(d.slice(-100),digit,side);
  const trans=ouTransitionStats(d,digit,digit,side);
  return {rates,recent,short50,medium,mid250,long,momentum,trend,cluster,streak:run.last,transitions:trans.total,favorable:trans.favorable,transitionRate:trans.rate,weightedTransitionRate:trans.weightedRate};
}
function distributionGate(d,selectedDigit,selectedSide){
  const windowDigits=d.slice(-1000);
  if(windowDigits.length<1000)return {ready:false,pass:false,reason:"Distribution gate requires a complete 1,000-tick window.",checks:[],total:windowDigits.length};
  const freq=Array(10).fill(0);
  for(const digit of windowDigits)if(Number.isInteger(digit)&&digit>=0&&digit<=9)freq[digit]++;
  const pct=freq.map(count=>count/windowDigits.length*100);
  const max=Math.max(...freq),min=Math.min(...freq);
  const most=freq.map((count,digit)=>count===max?digit:null).filter(x=>x!==null);
  const least=freq.map((count,digit)=>count===min?digit:null).filter(x=>x!==null);
  const relevant=[];
  for(let digit=0;digit<=9;digit++){
    const included=selectedSide==="OVER"?digit<=selectedDigit:digit>=selectedDigit;
    if(included)relevant.push({digit,percent:pct[digit],most:most.includes(digit),least:least.includes(digit)});
  }
  const failures=relevant.filter(x=>x.percent>=10.5||x.most||x.least);
  return {ready:true,pass:failures.length===0,total:windowDigits.length,checks:relevant,failures,
    reason:failures.length?"Distribution gate blocked: every digit in the selected-side group must be below 10.5% and have neither the most-appearing nor least-appearing highlight.":"Distribution gate passed: all required digits are below 10.5% with no most-appearing or least-appearing highlight."};
}

function mavenAIDecisionLayer(engine,baseSignal,evidence,alignment,conflict,hardGate,sample){
  const validation=getSignalValidationReliability(engine);
  // Apply saved outcome learning to every normalized evidence factor and the aggregate analysis score.
  // Small samples remain neutral; the adjustment is capped by getValidationReliability at +/-8 points.
  const adjustment=validation.forecasts>=10?validation.adaptiveAdjustment:0;
  const factors=(Array.isArray(alignment)?alignment:[]).filter(Number.isFinite);
  const adjustedFactors=factors.map(x=>Math.max(0,Math.min(1,x+adjustment*.5)));
  const rawAgreement=factors.length?factors.filter(x=>x>=.55).length/factors.length:.5;
  const agreement=adjustedFactors.length?adjustedFactors.filter(x=>x>=.55).length/adjustedFactors.length:.5;
  const adjustedEvidence=Math.max(0,Math.min(1,(Number(evidence)||0)+adjustment));
  let confidence=Math.max(0,Math.min(1,adjustedEvidence*.75+agreement*.25));
  if(validation.forecasts>=30&&Number.isFinite(validation.rate)&&validation.rate<.40){
    confidence=Math.max(0,confidence-.04);
  }
  let decision=baseSignal,reason="AI evidence review agrees with the rule-based result.";
  if(hardGate){reason="AI review preserved a mandatory data/distribution gate; the AI layer cannot override it.";}
  else if(conflict){decision="WAIT";reason="AI review detected conflicting evidence and withheld a directional decision.";}
  else if(validation.forecasts>=30&&validation.rate<.40){
    if(decision==="STRONG SIGNAL")decision="SIGNAL";
    else if(decision==="SIGNAL")decision="WAIT";
    reason="AI review reduced confidence because the setup's saved walk-forward outcomes are weak ("+Math.round(validation.rate*100)+"% across "+validation.forecasts+" scored outcomes).";
  }else if(decision==="STRONG SIGNAL"&&(confidence<.58||agreement<.45)){
    decision="SIGNAL";reason="AI review downgraded the signal because the evidence factors do not agree strongly enough.";
  }else if(decision==="SIGNAL"&&(confidence<.47||agreement<.30)){
    decision="WAIT";reason="AI review withheld the signal because too few independent evidence factors support it.";
  }else if(decision==="SIGNAL"&&confidence>=.76&&agreement>=.78&&sample>=200){
    decision="STRONG SIGNAL";reason="AI review upgraded the signal after strong factor agreement and a sufficiently large live sample.";
  }else{
    reason="AI review combined live evidence, cross-factor agreement and sample size";
    if(validation.forecasts>=10)reason+=" with conservatively weighted market/setup outcome learning ("+Math.round(validation.smoothedRate*100)+"% smoothed hit rate from "+validation.forecasts+" forecasts)";
    reason+=".";
  }
  return {signal:decision,baseSignal,confidence,agreement,rawAgreement,adjustedEvidence,adjustedAlignment:adjustedFactors,analysisAdjustment:adjustment,validationForecasts:validation.forecasts,validationRate:validation.rate,validationSmoothedRate:validation.smoothedRate,learningWeight:validation.learningWeight,adaptiveAdjustment:validation.adaptiveAdjustment,reason};
}
function mavenAIReviewEntry(engine,entry,signalDecision){
  if(!entry||!signalDecision||!["SIGNAL","STRONG SIGNAL"].includes(signalDecision.signal))return null;
  let entryStrength=.55;
  if(Array.isArray(entry.entries)&&entry.entries.length){
    entryStrength=entry.entries.reduce((sum,x)=>sum+Math.max(0,Math.min(1,(Number(x.score)||0)/100)),0)/entry.entries.length;
  }else{
    const conf=Number.parseFloat(String(entry.confidence||"").replace("%",""));
    if(Number.isFinite(conf))entryStrength=Math.max(0,Math.min(1,conf/100));
    else if(Number.isFinite(Number(entry.score)))entryStrength=Math.max(0,Math.min(1,Number(entry.score)>10?Number(entry.score)/100:Number(entry.score)/10));
  }
  const entryValidation=getValidationReliability(engine);
  const validationAdjustment=entryValidation.forecasts>=10?entryValidation.adaptiveAdjustment:0;
  // Entry strength learns from entry outcomes, separately from signal accuracy.
  entryStrength=Math.max(0,Math.min(1,entryStrength+validationAdjustment*.5));
  const confidence=Number(signalDecision.confidence)||.5;
  const combined=entryStrength*.65+confidence*.35;
  if(entryStrength<.43||combined<.49)return null;
  const note="Maven AI entry review: "+Math.round(combined*100)+"% combined entry/evidence score; "+Math.round(entryStrength*100)+"% entry strength and "+Math.round(confidence*100)+"% signal confidence.";
  if(Array.isArray(entry.entries)){
    entry={...entry,entries:entry.entries.map(x=>({...x,aiScore:Math.max(0,Math.min(100,Math.round((Number(x.score)||0)*.65+confidence*35+validationAdjustment*32.5)))})).sort((a,b)=>b.aiScore-a.aiScore)};
    if(engine==="overunder"){
      entry.main=entry.entries.map(x=>String(x.digit)).join("  •  ");
      entry.meta=entry.entries.map(x=>"Digit "+x.digit+": AI score "+x.aiScore+"/100").join(" • ");
    }else{
      entry.main=entry.entries.map(x=>String(x.digit)).join("  •  ");
      entry.meta=entry.entries.map(x=>"Digit "+x.digit+": AI score "+x.aiScore+"/100").join(" • ");
    }
  }
  return {...entry,aiReview:{entryStrength,confidence,combined,adaptiveAdjustment:validationAdjustment,validationForecasts:entryValidation.forecasts},reason:(entry.reason?entry.reason+" ":"")+note,evidence:(entry.evidence?entry.evidence+" • ":"")+note};
}
function overUnderEvidence(d,selectedDigit,selectedSide){
  const n=d.length;
  const distribution=distributionGate(d,selectedDigit,selectedSide);
  const oppositeDigit=9-selectedDigit;
  const selected=ouStats(d,selectedDigit,selectedSide);
  const opposite=ouStats(d,oppositeDigit,selectedSide==="OVER"?"UNDER":"OVER");
  const selectedRate=ouRate(d,selectedDigit,selectedSide);
  const oppositeRate=ouRate(d,oppositeDigit,selectedSide==="OVER"?"UNDER":"OVER");
  const probabilityConflict=oppositeRate>selectedRate+.04;
  const baseline=selectedSide==="OVER"?(9-selectedDigit)/10:selectedDigit/10;
  const probability=Math.max(0,Math.min(1,.5+(selectedRate-baseline)*4));
  const momentumScore=Math.max(0,Math.min(1,.5+selected.momentum*4));
  const trendScore=Math.max(0,Math.min(1,.5+selected.trend*18));
  const transition=Math.max(0,Math.min(1,.5+(selected.weightedTransitionRate-baseline)*2.5));
  const historical=Math.max(0,Math.min(1,.5+(selected.long-baseline)*3));
  const recency=Math.max(0,Math.min(1,.5+(selected.recent-selected.long)*4));
  const consistency=Math.max(0,Math.min(1,1-Math.abs(selected.recent-selected.long)*2-Math.abs(selected.short50-selected.mid250)));
  const context=Math.max(0,Math.min(1,(selected.cluster*.55)+(Math.min(1,selected.streak/4)*.2)+(selected.recent>=selected.short50?.15:0)+(selected.recent>=selected.long?.1:0)));
  const reaction=selected.transitions>=8?Math.max(0,Math.min(1,.5+(selected.transitionRate-baseline)*2.5)):0;
  const evidence=probability*.20+momentumScore*.10+trendScore*.08+transition*.14+selected.cluster*.08+reaction*.10+recency*.10+consistency*.08+historical*.07+context*.05;
  const windowConflict=(selected.recent<baseline-.08&&selected.long>baseline+.08)||(Math.abs(selected.recent-selected.long)>=.18&&selected.recent<baseline);
  const evidenceConflict=probabilityConflict||windowConflict;
  const reactionSampleReady=selected.transitions>=20;
  const positiveLift=selectedRate-baseline;
  const transitionLift=selected.weightedTransitionRate-baseline;
  let signal="WAIT";
  if(n<100)signal="WAIT";
  else if(!distribution.ready)signal="WAIT";
  else if(!distribution.pass)signal="AVOID";
  else if(evidenceConflict)signal="WAIT";
  else if(!reactionSampleReady)signal="WAIT";
  else if(evidence>=.68&&positiveLift>=.025&&transitionLift>=.015&&consistency>=.58&&n>=250&&selected.transitions>=35)signal="STRONG SIGNAL";
  else if(evidence>=.56&&positiveLift>=.01&&transitionLift>=-.005&&consistency>=.50&&selected.transitions>=20)signal="SIGNAL";
  else if(evidence<.38||positiveLift<-.10)signal="AVOID";
  const aiDecision=mavenAIDecisionLayer("overunder",signal,evidence,[probability,momentumScore,trendScore,transition,selected.cluster,reaction,recency,consistency,historical,context],evidenceConflict,n<100||!distribution.ready||!distribution.pass||!reactionSampleReady,n);signal=aiDecision.signal;
  return {oppositeDigit,selectedRate,oppositeRate,baseline,probability:aiDecision.adjustedAlignment[0]??probability,momentum:aiDecision.adjustedAlignment[1]??momentumScore,trend:aiDecision.adjustedAlignment[2]??trendScore,transition:aiDecision.adjustedAlignment[3]??transition,cluster:aiDecision.adjustedAlignment[4]??selected.cluster,reaction:aiDecision.adjustedAlignment[5]??reaction,recency:aiDecision.adjustedAlignment[6]??recency,consistency:aiDecision.adjustedAlignment[7]??consistency,historical:aiDecision.adjustedAlignment[8]??historical,context:aiDecision.adjustedAlignment[9]??context,evidence:aiDecision.adjustedEvidence,probabilityConflict,windowConflict,evidenceConflict,distribution,signal,baseSignal:aiDecision.baseSignal,aiDecision,recentRate:selected.recent,mediumRate:selected.medium,longRate:selected.long,short50:selected.short50,mid250:selected.mid250,weightedTransitionRate:selected.weightedTransitionRate,transitions:selected.transitions,streak:selected.streak};
}
function distributionBarFlags(d){
  const windowDigits=d.slice(-1000);
  const freq=Array(10).fill(0);
  for(const digit of windowDigits)if(Number.isInteger(digit)&&digit>=0&&digit<=9)freq[digit]++;
  const max=Math.max(...freq),min=Math.min(...freq);
  return {
    total:windowDigits.length,
    most:freq.map(count=>count===max),
    least:freq.map(count=>count===min),
    percentages:freq.map(count=>windowDigits.length?count/windowDigits.length*100:0)
  };
}
function ouWilsonLowerBound(hits,n,z=1.96){
  if(!n)return 0;
  const p=hits/n,z2=z*z,den=1+z2/n;
  return Math.max(0,(p+z2/(2*n)-z*Math.sqrt((p*(1-p)/n)+(z2/(4*n*n))))/den);
}
function overUnderEntry(d,selectedDigit,selectedSide,onlyCandidates=null){
  const candidates=[];
  const entryBars=distributionBarFlags(d);
  const baseline=selectedSide==="OVER"?(9-selectedDigit)/10:selectedDigit/10;
  const smooth=(hits,n,prior=baseline,priorN=8)=>(hits+prior*priorN)/(n+priorN);
  for(let candidate=0;candidate<=9;candidate++){
    if(Array.isArray(onlyCandidates)&&!onlyCandidates.includes(candidate))continue;
    if((selectedSide==="UNDER"&&(candidate===0||candidate===1))||(selectedSide==="OVER"&&(candidate===8||candidate===9)))continue;
    if(entryBars.most[candidate]||entryBars.least[candidate])continue;
    const t=ouTransitionStats(d,candidate,selectedDigit,selectedSide);
    if(t.total<30||t.recentTotal<8)continue;
    const key=ouValidationRecordKey(state.symbol,selectedDigit,selectedSide,candidate);
    const validation=state.ouValidationBook[key]||null;
    const h1=validation?.[1]||{n:0,hits:0,failureStreak:0};
    const recent1=Array.isArray(validation?.recentOutcomes?.[1])?validation.recentOutcomes[1]:[];
    const recentHits1=recent1.filter(Boolean).length;
    const observedRate=smooth(h1.hits,h1.n);
    const rawObservedRate=h1.n?h1.hits/h1.n:0;
    const recentRate=smooth(recentHits1,recent1.length,baseline,5);
    if(recent1.length>=12&&recentRate<baseline-.06)continue;
    if(h1.n>=20&&observedRate<baseline-.07)continue;
    if(recent1.length>=8&&h1.failureStreak>=5&&recentRate<baseline)continue;
    const sample=Math.min(1,t.total/100);
    const directionalLift=Math.max(0,Math.min(1,.5+(t.r1-baseline)*3.5));
    const recentLift=Math.max(0,Math.min(1,.5+(t.recentRate-baseline)*3.5));
    const secondLift=Math.max(0,Math.min(1,.5+(t.r2-baseline)*3));
    const thirdLift=Math.max(0,Math.min(1,.5+(t.r3-baseline)*2));
    const validationLift=recent1.length>=6?Math.max(0,Math.min(1,.5+(recentRate-baseline)*3.5)):.5;
    const stability=Math.max(0,Math.min(1,1-Math.abs(t.rate-t.recentRate)-Math.abs(t.r1-t.r2)*.20-Math.abs(t.r2-t.r3)*.15));
    const consistency=Math.max(0,Math.min(1,1-Math.abs(t.r1-t.r2)*.7-Math.abs(t.r2-t.r3)*.3));
    const validationWeight=recent1.length>=12?.16:recent1.length>=6?.10:0;
    const recentWeight=.12-validationWeight;
    const score=Math.round(100*(directionalLift*.25+recentLift*.20+secondLift*.13+thirdLift*.07+stability*.10+consistency*.07+sample*.06+validationLift*validationWeight+Math.min(1,t.recentTotal/40)*recentWeight));
    const recentObservedRate=recent1.length?recentHits1/recent1.length:0;
    candidates.push({...t,candidate,baseline,score,stability,consistency,validation:{n:h1.n,hits:h1.hits,rate:observedRate,observedRate:rawObservedRate,recentN:recent1.length,recentHits:recentHits1,recentRate,recentObservedRate,failureStreak:h1.failureStreak,lowerBound:ouWilsonLowerBound(h1.hits,h1.n)}});
  }
  candidates.sort((a,b)=>b.score-a.score);
  if(!candidates.length)return null;
  const watchCandidates=candidates.filter(c=>{
    const hasDirectionalReaction=c.r1>=baseline-.04&&c.recentRate>=baseline-.05;
    const hasContinuation=c.r2>=baseline-.06||c.r1>=baseline+.015;
    return c.total>=30&&c.recentTotal>=8&&hasDirectionalReaction&&hasContinuation&&c.stability>=.42&&c.consistency>=.30&&c.score>=55;
  }).slice(0,2);
  if(!watchCandidates.length)return null;
  const entries=watchCandidates.map(c=>{
    const validationText=c.validation.n>=1
      ?"Live validation "+Math.round(c.validation.observedRate*100)+"% ("+c.validation.hits+"/"+c.validation.n+")"+(c.validation.recentN>=5?"; last "+c.validation.recentN+": "+Math.round(c.validation.recentObservedRate*100)+"%":"")
      :"Live validation collecting — 0 scored triggers";
    let reason;
    if(c.r1>=baseline+.04&&c.r2>=baseline+.02)reason="Historical 1-tick reaction and conditional continuation both exceed the setup baseline.";
    else if(c.r1>=baseline-.02&&c.r2>=baseline+.03)reason="Immediate reaction is near baseline; conditional 2-tick follow-through is stronger.";
    else reason="Passed historical reaction, continuation and consistency checks.";
    return {digit:c.candidate,score:c.score,targetReady:true,status:"ENTRY CANDIDATE",reason,evidence:c.total+" historical triggers; recent transition rate "+Math.round(c.recentRate*100)+"%; "+validationText,validation:c.validation};
  });
  const main=entries.map(e=>String(e.digit)).join("  •  ");
  const meta=entries.map(e=>"Digit "+e.digit+": entry score "+e.score+"/100").join(" • ")+" • Rank scores are not win probabilities.";
  return {main,meta,status:entries.length+" ENTRY CANDIDATE"+(entries.length===1?"":" DIGITS"),reason:entries.map(e=>"Digit "+e.digit+": "+e.reason).join(" "),evidence:entries.map(e=>"Digit "+e.digit+" — "+e.evidence).join(" • "),entries};
}
function intersectPredictiveEntryCandidates(manualDigits,predictiveEntries){
  const qualified=new Set((Array.isArray(predictiveEntries)?predictiveEntries:[]).map(entry=>Number(typeof entry==="object"?entry?.digit:entry)).filter(digit=>Number.isInteger(digit)&&digit>=0&&digit<=9));
  return (Array.isArray(manualDigits)?manualDigits:[]).filter(digit=>qualified.has(Number(digit)));
}
function autoTradeEntrySelection(){
  if(!$("autoTradeManualEntriesEnabled")?.checked){autoTrade.lastManualBlockReason="";const snap=state.ouEntrySnapshot;return snap?.active&&Array.isArray(snap.validationDigits)?snap.validationDigits:(snap?.active&&Array.isArray(snap.digits)?snap.digits:[]);}
  const firstRaw=$("autoTradeManualDigit1")?.value,secondRaw=$("autoTradeManualDigit2")?.value;
  if(firstRaw==null||String(firstRaw).trim()===""||secondRaw==null||String(secondRaw).trim()===""){autoTrade.lastManualBlockReason="Enter both manual entry digits.";return [];}
  const first=Number(firstRaw),second=Number(secondRaw);
  if(!Number.isInteger(first)||first<0||first>9||!Number.isInteger(second)||second<0||second>9){autoTrade.lastManualBlockReason="Manual entry digits must be whole numbers from 0 to 9.";return [];}
  if(first===second){autoTrade.lastManualBlockReason="Manual entry digits must be different.";return [];}
  // Manual digits must pass both the visible distribution-bar rule and the same predictive qualification used by automatic entries.
  const bars=distributionBarFlags(state.digits);
  const valid=[first,second].filter(digit=>!bars.most[digit]&&!bars.least[digit]);
  const blocked=[first,second].filter(digit=>bars.most[digit]||bars.least[digit]).map(digit=>"digit "+digit+(bars.most[digit]&&bars.least[digit]?" has a red and green distribution bar":bars.most[digit]?" has a green distribution bar":" has a red distribution bar"));
  if(!valid.length){autoTrade.lastManualBlockReason=blocked.join("; ")+". No manual digit is eligible until it has neither bar.";return [];}
  const prediction=overUnderEntry(state.digits,state.selectedDigit,state.selectedSide,valid);
  const reviewedPrediction=mavenAIReviewEntry("overunder",prediction,{signal:state.ouSignalSnapshot?.signal,confidence:state.ouEntrySnapshot?.confidence});
  const qualified=intersectPredictiveEntryCandidates(valid,reviewedPrediction?.entries);
  const unqualified=valid.filter(digit=>!qualified.includes(digit)).map(digit=>"digit "+digit+" failed predictive Entry Engine qualification");
  const reasons=[...blocked,...unqualified];
  autoTrade.lastManualBlockReason=reasons.length?reasons.join("; ")+(qualified.length?". Using only the remaining predictive, distribution-eligible digit(s).":". No manual digit currently passes all entry-quality checks."):"";
  return qualified;
}
function renderParityControls(){
  document.querySelectorAll(".parity-side").forEach(btn=>btn.classList.toggle("active",btn.dataset.parity===state.selectedParity)); const label=$("paritySetupLabel"); if(label)label.textContent=state.selectedParity;
}
function selectOverUnderDigit(digit){
  if(!Number.isInteger(digit)||digit<0||digit>9)return;
  state.selectedDigit=digit;
  autoTradeSetupChanged();
  state.deepScanner.autoLoaded=false;state.deepScanner.manualOverride=false;state.deepScanner.strongestCandidate=null;
  renderOUControls();renderDigitDistribution();renderEngine();deepScannerEvaluate(true);
}
function renderOUControls(){
  document.querySelectorAll(".distribution-digit").forEach(btn=>{
    const d=Number(btn.dataset.digit),active=d===state.selectedDigit;
    const qualifies=state.selectedSide==="OVER"?d>state.selectedDigit:d<state.selectedDigit;
    btn.classList.toggle("active",active);
    btn.classList.toggle("selected",active);
    btn.classList.toggle("qualifies",d!==state.selectedDigit&&qualifies);
    btn.classList.toggle("nonqualifying",d!==state.selectedDigit&&!qualifies);
    btn.setAttribute("aria-pressed",String(active));
  });
  document.querySelectorAll("#overUnderControls .ou-side").forEach(btn=>{
    const active=btn.dataset.side===state.selectedSide;
    btn.classList.toggle("active",active);btn.setAttribute("aria-pressed",String(active));
  });
}

function spikeRiskAssessment(){
  const prices=state.ticks.map(t=>Number(t.quote)).filter(Number.isFinite);
  const age=state.lastTickAt?Date.now()-state.lastTickAt:Infinity;
  if(!state.connected||age>15000)return {level:"UNKNOWN",title:"SPIKE RISK UNKNOWN",reason:"Live feed is disconnected or stale. New entries are blocked until fresh live ticks resume."};
  if(prices.length<100)return {level:"UNKNOWN",title:"SPIKE RISK UNKNOWN",reason:"At least 100 live/history price points are needed to establish a market-specific movement baseline."};
  const moves=[];
  for(let i=1;i<prices.length;i++)moves.push(Math.abs(prices[i]-prices[i-1]));
  const nonzero=moves.filter(x=>x>0);
  if(nonzero.length<40)return {level:"UNKNOWN",title:"SPIKE RISK UNKNOWN",reason:"Not enough non-zero price changes to estimate abnormal movement reliably."};
  const sorted=nonzero.slice().sort((a,b)=>a-b);
  const median=sorted[Math.floor(sorted.length*.5)]||0;
  const baseline=median||sorted[Math.floor(sorted.length*.75)]||0;
  if(!(baseline>0))return {level:"UNKNOWN",title:"SPIKE RISK UNKNOWN",reason:"A stable movement baseline cannot be estimated from the current sample."};
  const recent=moves.slice(-12);
  const ratios=recent.map(x=>x/baseline);
  const extreme=ratios.filter(x=>x>=5).length;
  const elevated=ratios.filter(x=>x>=3.2).length;
  let reversals=0,adjacent=0;
  const signed=[];
  for(let i=Math.max(1,prices.length-13);i<prices.length;i++){
    const delta=prices[i]-prices[i-1];
    if(delta!==0)signed.push(Math.sign(delta));
  }
  for(let i=1;i<signed.length;i++){adjacent++;if(signed[i]!==signed[i-1])reversals++}
  const reversalRate=adjacent?reversals/adjacent:0;
  if(extreme>=2||ratios.at(-1)>=7|| (elevated>=4&&reversalRate>=.65))
    return {level:"HIGH",title:"HIGH SPIKE RISK",reason:"Recent price movement is unusually large or clustered, or volatility is unstable. New entry recommendations are blocked."};
  if(extreme===1||elevated>=2||reversalRate>=.78)
    return {level:"MODERATE",title:"MODERATE SPIKE RISK",reason:"Movement is elevated or reversals are frequent. Treat signals cautiously; stronger confirmation is required."};
  return {level:"LOW",title:"LOW DETECTED SPIKE RISK",reason:"No current spike trigger was detected against the recent market-specific baseline. This is not a guarantee of safety."};
}
function applySpikeRiskProtection(root){
  const r=spikeRiskAssessment();
  const old=root.querySelector(".spike-risk-banner");if(old)old.remove();
  const banner=document.createElement("div");
  banner.className="spike-risk-banner spike-risk-"+r.level.toLowerCase();
  banner.innerHTML='<strong>SPIKE STATUS: '+esc(r.level==="UNKNOWN"?"CHECKING":r.title.replace(" SPIKE RISK","").replace(" DETECTED",""))+'</strong>';
  const panelRoot=root.querySelector(".engine-panel");
  if(!panelRoot)return;
  const reasonNode=panelRoot.querySelector(".spike-risk-reason");
  if(reasonNode)reasonNode.textContent=r.reason;
  const kicker=panelRoot.querySelector(".panel-kicker");
  if(kicker)kicker.insertAdjacentElement("afterend",banner);else panelRoot.prepend(banner);
  const why=panelRoot.querySelector(".why ul");
  // This runs on a one-second refresh; keep risk notes idempotent rather than stacking duplicates.
  panelRoot.querySelectorAll(".spike-risk-note").forEach(node=>node.remove());
  if(r.level==="HIGH"||r.level==="UNKNOWN"){
    // Spike risk blocks entry eligibility only. Preserve the engine's independent Final Signal and reason.
    let entry=panelRoot.querySelector(".entry");
    if(!entry){
      entry=document.createElement("div");
      entry.className="entry";
      const summary=panelRoot.querySelector(".decision-summary");
      if(summary)summary.appendChild(entry);else panelRoot.prepend(entry);
    }
    entry.innerHTML='<div class="entry-head">ENTRY DIGITS</div><div class="entry-main">NO ENTRY — SPIKE RISK</div>';
    if(why){const li=document.createElement("li");li.className="block spike-risk-note";li.textContent="× Shared spike-risk protection blocked entry eligibility; Final Signal remains the engine analysis.";why.prepend(li)}
  }else if(r.level==="MODERATE"){
    if(why){const li=document.createElement("li");li.className="spike-risk-note";li.textContent="! Moderate spike risk: treat signals cautiously and wait for conditions to normalize.";why.prepend(li)}
  }
}


window.mavenAIGetContext=function(){
  const digits=state.digits.slice();
  const context={market:state.marketName||state.symbol||"Unknown",symbol:state.symbol||"Unknown",connected:!!state.connected,tickCount:digits.length,lastDigit:digits.length?digits[digits.length-1]:null,engine:state.engine,selectedDigit:state.selectedDigit,selectedSide:state.selectedSide,selectedParity:state.selectedParity,selectedRiseFall:state.selectedRiseFall};
  const bars=distributionBarFlags(digits);
  context.distribution={total:bars.total,percentages:bars.percentages,most:bars.most.map((v,i)=>v?i:null).filter(v=>v!==null),least:bars.least.map((v,i)=>v?i:null).filter(v=>v!==null)};
  // Compute all three engine summaries only when the user asks Maven AI; never on every incoming tick.
  context.engines={};
  if(digits.length>=30){
    const ou=overUnderEvidence(digits,state.selectedDigit,state.selectedSide);
    context.engines.overunder={value:ou.signal,evidence:ou.evidence,aiDecision:ou.aiDecision,reason:ou.probabilityConflict?"Complementary probability is stronger":ou.windowConflict?"Recent and longer-window evidence conflict":ou.distribution.ready&&!ou.distribution.pass?"Distribution gate blocked":ou.signal==="WAIT"?"Evidence is still building":ou.signal==="AVOID"?"Evidence is weak":"Evidence checks passed",probabilityConflict:ou.probabilityConflict,windowConflict:ou.windowConflict,distributionReady:ou.distribution.ready,distributionPass:ou.distribution.pass};
    const parity=parityStats(digits,state.selectedParity);
    context.engines.evenodd={value:parity.signal,evidence:parity.evidence,aiDecision:parity.aiDecision,reason:parity.conflict?"Recent and longer-window parity evidence conflict":parity.signal==="WAIT"?"Evidence is still building":parity.signal==="AVOID"?"Evidence is weak":"Parity evidence checks passed",conflict:parity.conflict};
    const rf=riseFallAnalysis(state.ticks.map(t=>t.quote));
    if(rf)context.engines.risefall={value:rf.signal,evidence:rf.evidence,aiDecision:rf.aiDecision,reason:rf.conflict?"Recent and longer-term direction conflict":rf.signal==="WAIT"?"Evidence is still building":rf.signal==="AVOID"?"Directional evidence is weak":"Directional evidence checks passed",conflict:rf.conflict};
  }else{
    context.engines={overunder:{value:"WAIT",reason:"At least 30 live digits required"},evenodd:{value:"WAIT",reason:"At least 30 live digits required"},risefall:{value:"WAIT",reason:"At least 30 live price ticks required"}};
  }
  if(state.engine==="overunder"&&digits.length>=30){
    const evidence=overUnderEvidence(digits,state.selectedDigit,state.selectedSide);
    const entry=(evidence.signal==="SIGNAL"||evidence.signal==="STRONG SIGNAL")&&!evidence.probabilityConflict?overUnderEntry(digits,state.selectedDigit,state.selectedSide):null;
    context.signal={value:evidence.signal,reason:evidence.distribution.reason,distributionReady:evidence.distribution.ready,distributionPass:evidence.distribution.pass,failures:evidence.distribution.failures||[],selectedRate:evidence.selectedRate,oppositeRate:evidence.oppositeRate,probabilityConflict:evidence.probabilityConflict,windowConflict:evidence.windowConflict,evidence:evidence.evidence,entries:entry?entry.entries.map(x=>({digit:x.digit,score:x.score,status:x.status})):[]};
  }else if(state.engine==="overunder"){
    context.signal={value:"WAIT",reason:"At least 30 live digits are needed before the engine can analyze this setup.",distributionReady:bars.total===1000,distributionPass:false,failures:[],entries:[]};
  }
  context.aiDecision=context.engines[state.engine]?.aiDecision||null;
  context.validation=getValidationReliability(state.engine);
  context.validation.note=validationReliabilityNote(state.engine);
  return context;
};

function renderEngine(){
  const d=state.digits, n=d.length, c=counts(d), last=d.at(-1);
  const root=$("engineRoot");
  const ou=$("overUnderControls"),parity=$("evenOddControls");
  if(ou)ou.style.display=state.engine==="overunder"?"":"none";
  if(parity)parity.style.display=state.engine==="evenodd"?"":"none";
  const rf=$("riseFallControls");if(rf)rf.style.display=state.engine==="risefall"?"":"none";
  if(n<30){state.ouSignalSnapshot={key:ouValidationKey(),active:false,signal:"WAIT",probabilityConflict:false,tickCount:n};state.ouEntrySnapshot={key:ouValidationKey(),active:false,digits:[]};state.otherValidation.snapshot=null;root.innerHTML=panel("INSUFFICIENT DATA","Collecting more validated market data before analysis.",null,["At least 30 recent digits are required","Live data stream is active when ticks are arriving"],n);renderOUValidationPanel();return}
  if(state.engine==="overunder")renderOverUnder(root,d,c,last,n);
  if(state.engine==="evenodd")renderEvenOdd(root,d,last,n);
  if(state.engine==="risefall")renderRiseFall(root,last,n);
  applySpikeRiskProtection(root);
  renderOUValidationPanel();
}
function panel(stateText,reason,entry,why,n){
  const cls=stateText==="STRONG SIGNAL"?"strong":stateText==="SIGNAL"?"signal":stateText==="NO SIGNAL"||stateText==="NO ENTRY"?"none":"wait";
  const entryReason=entry?(entry.reason||entry.meta||"No qualifying entry was produced."):"Entry analysis is not active yet.";
  const entryEvidence=entry?.evidence||"Building";
  return `<section class="engine-panel"><div class="decision-summary"><div class="panel-kicker">FINAL SIGNAL</div><div class="state ${cls}">${esc(stateText)}</div><div class="spike-risk-banner spike-risk-unknown"><strong>SPIKE STATUS: CHECKING</strong></div>${entry?entryHtml(entry):""}</div><details class="why-details"><summary>Why this state?</summary><div class="why-content"><div class="why-section"><strong>Signal reason</strong><p class="reason">${esc(reason)}</p></div><div class="why-section"><strong class="spike-reason-label">Spike assessment</strong><p class="spike-risk-reason">Checking recent market movement.</p></div><div class="why-section"><strong>Entry reason</strong><p class="entry-reason">${esc(entryReason)}</p><p class="entry-evidence">${esc(entryEvidence)}</p></div><div class="why"><div class="why-title">Analysis checks</div><ul>${why.map(x=>`<li class="${x[0]==="×"?"block":""}">${esc(x)}</li>`).join("")}</ul></div><details class="analysis-details"><summary>Technical details</summary><div class="stats"><div class="stat"><span>Sample</span><strong>${n}</strong></div><div class="stat"><span>Evidence</span><strong>${entryEvidence}</strong></div><div class="stat"><span>Data quality</span><strong>${n>=500?"GOOD":n>=100?"BUILDING":"INSUFFICIENT"}</strong></div><div class="stat"><span>Last digit</span><strong>${state.digits?.at(-1)??"—"}</strong></div></div></details></div></details></section>`;
}
function entryHtml(e){
  let cards;
  if(Array.isArray(e.entries)){
    const candidateCards=e.entries.map(x=>'<div class="entry-candidate"><strong>'+esc(x.digit)+'</strong><span>SCORE '+esc(x.score)+'/100</span></div>').join("");
    const secondSlotMissing=e.status==="1 VALID CANDIDATE"&&e.entries.length===1;
    const pendingCard=secondSlotMissing?'<div class="entry-candidate entry-pending"><strong>—</strong><span>SECOND DIGIT NOT QUALIFIED</span></div>':"";
    const status=e.status?'<div class="entry-status">'+esc(e.status)+'</div>':"";
    cards=status+'<div class="entry-candidates">'+candidateCards+pendingCard+'</div>';
  }else{
    cards='<div class="entry-candidates"><div class="entry-candidate"><strong>'+esc(e.main||"NO ENTRY")+'</strong>'+(Number.isFinite(Number(e.score))&&e.score!==""?'<span>SCORE '+esc(Math.round(Number(e.score)))+'/100</span>':Number.isFinite(Number.parseFloat(e.confidence))&&Number.parseFloat(e.confidence)>0?'<span>SCORE '+esc(Math.round(Number.parseFloat(e.confidence)))+'/100</span>':'')+'</div></div>';
  }
  return '<div class="entry"><div class="entry-head">ENTRY DIGITS</div>'+cards+'</div>';
}
function parityStats(d,selectedSide){
  const key=x=>x%2===0?"EVEN":"ODD";
  const target=selectedSide,other=target==="EVEN"?"ODD":"EVEN";
  const sizes=[20,50,100,250,500];
  const windows=sizes.map(size=>{
    const a=d.slice(-size),hits=a.filter(x=>key(x)===target).length;
    return {size,n:a.length,rate:a.length?hits/a.length:0};
  }).filter(x=>x.n);
  const recent=windows.find(x=>x.size===20)?.rate??0;
  const short50=windows.find(x=>x.size===50)?.rate??recent;
  const medium=windows.find(x=>x.size===100)?.rate??recent;
  const mid250=windows.find(x=>x.size===250)?.rate??medium;
  const long=windows.find(x=>x.size===500)?.rate??windows.at(-1)?.rate??recent;
  const momentum=recent-long;
  const trend=((recent-short50)+(short50-mid250)+(mid250-long))/3;
  let transitions=0,favorable=0,recentTransitions=0,recentFavorable=0;
  for(let i=0;i<d.length-1;i++){
    if(key(d[i])!==target)continue;
    transitions++;
    if(key(d[i+1])===target)favorable++;
    if(i>=Math.max(0,d.length-251)){recentTransitions++;if(key(d[i+1])===target)recentFavorable++}
  }
  const transitionRate=transitions?favorable/transitions:.5;
  const recentTransitionRate=recentTransitions?recentFavorable/recentTransitions:transitionRate;
  let streak=0;for(let i=d.length-1;i>=0&&key(d[i])===target;i--)streak++;
  const recentArr=d.slice(-100).map(key);
  const blocks=[];
  for(let i=0;i<recentArr.length;i+=10){const b=recentArr.slice(i,i+10);if(b.length>=5)blocks.push(b.filter(x=>x===target).length/b.length)}
  const mean=blocks.length?blocks.reduce((a,x)=>a+x,0)/blocks.length:.5;
  const variance=blocks.length?blocks.reduce((a,x)=>a+(x-mean)**2,0)/blocks.length:0;
  const clustering=Math.max(0,Math.min(1,.5+mean*.25+(1-Math.sqrt(variance))*0.2+Math.min(1,streak/5)*.05));
  const consistency=Math.max(0,Math.min(1,1-Math.abs(recent-long)*1.8-Math.abs(short50-mid250)));
  const baseline=.5;
  const probability=Math.max(0,Math.min(1,.5+(recent-baseline)*4));
  const momentumScore=Math.max(0,Math.min(1,.5+momentum*4));
  const trendScore=Math.max(0,Math.min(1,.5+trend*5));
  const transition=Math.max(0,Math.min(1,.5+(recentTransitionRate-baseline)*2.5));
  const historical=Math.max(0,Math.min(1,.5+(long-baseline)*3));
  const recency=Math.max(0,Math.min(1,.5+(recent-long)*3));
  const context=Math.max(0,Math.min(1,clustering*.65+Math.min(1,streak/5)*.2+(recent>=short50?.15:0)));
  const evidence=probability*.20+momentumScore*.12+trendScore*.08+transition*.15+clustering*.10+recency*.10+consistency*.10+historical*.08+context*.07;
  const conflict=(recent<.43&&long>.53)||(Math.abs(recent-long)>=.16&&recent<.5)||(recent<.45&&short50>.56);
  const transitionSampleReady=transitions>=30&&recentTransitions>=10;
  let signal="WAIT";
  const n=d.length;
  if(n<100)signal="WAIT";
  else if(conflict)signal="WAIT";
  else if(!transitionSampleReady)signal="WAIT";
  else if(evidence>=.68&&recent>=.56&&short50>=.53&&long>=.49&&recentTransitionRate>=.52&&consistency>=.58&&n>=250&&transitions>=50)signal="STRONG SIGNAL";
  else if(evidence>=.56&&recent>=.53&&short50>=.50&&recentTransitionRate>=.50&&consistency>=.50&&transitions>=30)signal="SIGNAL";
  else if(evidence<.38||recent<.44)signal="AVOID";
  const aiDecision=mavenAIDecisionLayer("evenodd",signal,evidence,[probability,momentumScore,trendScore,transition,clustering,recency,consistency,historical,context],conflict,n<100||!transitionSampleReady,n);signal=aiDecision.signal;
  return {windows,recent,short50,medium,mid250,long,momentum,trend,transitionRate,recentTransitionRate,transitions,recentTransitions,streak,clustering,consistency,probability:aiDecision.adjustedAlignment[0]??probability,momentumScore:aiDecision.adjustedAlignment[1]??momentumScore,trendScore:aiDecision.adjustedAlignment[2]??trendScore,transition:aiDecision.adjustedAlignment[3]??transition,historical:aiDecision.adjustedAlignment[7]??historical,recency:aiDecision.adjustedAlignment[5]??recency,context:aiDecision.adjustedAlignment[8]??context,evidence:aiDecision.adjustedEvidence,conflict,signal,baseSignal:aiDecision.baseSignal,aiDecision,target,other};
}
function parityEntryCandidates(d,selectedSide){
  const key=x=>x%2===0?"E":"O";
  const target=selectedSide==="EVEN"?"E":"O";
  const recent=d.slice(-500).map(key);
  const baseline=recent.length?recent.filter(x=>x===target).length/recent.length:.5;
  const candidates=[];

  for(let len=1;len<=3;len++){
    const seen=new Map();
    for(let i=0;i+len+2<recent.length;i++){
      const pattern=recent.slice(i,i+len).join(" → ");
      let p=seen.get(pattern);
      if(!p){p={pattern,len,total:0,r1:0,r2:0,r3:0,recentTotal:0,recentR1:0};seen.set(pattern,p)}
      p.total++;
      const a=recent[i+len]===target;
      const b=recent[i+len+1]===target;
      const cc=recent[i+len+2]===target;
      if(a)p.r1++;
      if(a&&b)p.r2++;
      if(a&&b&&cc)p.r3++;
      if(i>=recent.length-160){p.recentTotal++;if(a)p.recentR1++}
    }
    for(const p of seen.values()){
      if(p.total<8)continue;
      p.r1/=p.total;p.r2/=p.total;p.r3/=p.total;
      p.recentRate=p.recentTotal?p.recentR1/p.recentTotal:p.r1;
      const lift1=p.r1-baseline,lift2=p.r2-baseline*baseline,lift3=p.r3-Math.pow(baseline,3);
      const recentLift=p.recentRate-baseline;
      p.score=100*(Math.max(0,lift1)*.38+Math.max(0,lift2)*.28+Math.max(0,lift3)*.10+Math.max(0,recentLift)*.16+Math.min(1,p.total/60)*.08);
      p.strong=(p.total>=10&&(lift1>=.06||lift2>=.08)&&recentLift>=.02&&p.score>=6);
      candidates.push(p);
    }
  }
  return {target,baseline,candidates};
}

function parityPatternStats(d,selectedSide){
  const x=parityEntryCandidates(d,selectedSide);
  const valid=x.candidates.filter(p=>p.strong);
  valid.sort((a,b)=>b.score-a.score||b.total-a.total);
  const best=valid[0],second=valid[1];
  if(!best)return null;
  if(second&&best.score-second.score<.8)return null;

  let confidence=Math.round(74+Math.min(10,best.score)+Math.min(6,best.total/20));
  if(best.r3>=Math.pow(x.baseline,3)+.05)confidence+=4;
  confidence=Math.max(74,Math.min(94,confidence));
  let reason;
  if(best.r1>=x.baseline+.10&&best.r2>=x.baseline*x.baseline+.08)
    reason="Strong pattern trigger: after this pattern is hit, "+selectedSide+" follows with a clear 1–2 tick lift over its current baseline.";
  else if(best.r1>=x.baseline+.06)
    reason="Strong pattern trigger: its next parity favors "+selectedSide+" materially above the current market baseline.";
  else
    reason="Strong pattern trigger: its 2-tick continuation lifts the probability of "+selectedSide+" above baseline.";

  return {type:"PATTERN",status:"STRONG ENTRY",main:best.pattern+" → "+selectedSide,confidence:confidence+"%",score:best.score,reason,evidence:best.total+" pattern observations • baseline "+Math.round(x.baseline*100)+"% • "+(best.r3>=Math.pow(x.baseline,3)+.05?"3-tick confirmation supported.":"3-tick confirmation not required.")};
}

function parityReactionEntry(d,selectedSide){
  const key=x=>x%2===0?"E":"O";
  const target=selectedSide==="EVEN"?"E":"O";
  const recent=d.slice(-500).map(key);
  const baseline=recent.length?recent.filter(x=>x===target).length/recent.length:.5;
  const candidates=[];
  for(const trigger of ["E","O"]){
    let total=0,r1=0,r2=0,r3=0,recentTotal=0,recentR1=0;
    for(let i=0;i+3<recent.length;i++){
      if(recent[i]!==trigger)continue;
      total++;
      const a=recent[i+1]===target,b=recent[i+2]===target,cc=recent[i+3]===target;
      if(a)r1++;if(a&&b)r2++;if(a&&b&&cc)r3++;
      if(i>=recent.length-160){recentTotal++;if(a)recentR1++}
    }
    if(total<10)continue;
    const rate1=r1/total,rate2=r2/total,rate3=r3/total,recentRate=recentTotal?recentR1/recentTotal:rate1;
    const lift1=rate1-baseline,lift2=rate2-baseline*baseline,lift3=rate3-Math.pow(baseline,3),recentLift=recentRate-baseline;
    const stability=Math.max(0,1-Math.abs(rate1-rate2)*.6-Math.abs(rate2-rate3)*.25);
    const score=100*(Math.max(0,lift1)*.40+Math.max(0,lift2)*.28+Math.max(0,lift3)*.10+Math.max(0,recentLift)*.14+stability*.08);
    candidates.push({trigger,total,rate1,rate2,rate3,recentRate,lift1,lift2,lift3,recentLift,stability,score});
  }
  candidates.sort((a,b)=>b.score-a.score||b.total-a.total);
  const best=candidates[0],second=candidates[1];
  if(!best)return null;
  const strong=best.total>=10&&(best.lift1>=.06||best.lift2>=.08)&&best.recentLift>=.02&&best.stability>=.45&&best.score>=6&&(!second||best.score-second.score>=.8);
  if(!strong)return null;
  let confidence=Math.round(74+Math.min(10,best.score)+Math.min(6,best.total/20)+best.stability*4);
  if(best.lift3>=.05)confidence+=4;
  confidence=Math.max(74,Math.min(94,confidence));
  const triggerLabel=best.trigger==="E"?"EVEN":"ODD";
  const reason=best.rate1>=baseline+.10&&best.rate2>=baseline*baseline+.08
    ?"Strong "+triggerLabel+" trigger: its hit materially increases the chance of "+selectedSide+" over 1–2 ticks."
    :best.rate1>=baseline+.06
    ?"Strong "+triggerLabel+" trigger: the next parity favors "+selectedSide+" above the current baseline."
    :"Strong "+triggerLabel+" trigger: 2-tick continuation lifts "+selectedSide+" above baseline.";
  return {type:"REACTION",status:"STRONG ENTRY",trigger:best.trigger,main:"ENTER ON "+triggerLabel+" → "+selectedSide,confidence:confidence+"%",score:best.score,reason,evidence:best.total+" trigger observations • baseline "+Math.round(baseline*100)+"% • "+(best.lift3>=.05?"3-tick confirmation supported.":"3-tick confirmation not required.")};
}

function selectParityEntry(d,selectedSide){
  const pattern=parityPatternStats(d,selectedSide),reaction=parityReactionEntry(d,selectedSide);
  if(!pattern&&!reaction)return null;
  const candidate=!pattern?reaction:!reaction?pattern:(reaction.score>=pattern.score?reaction:pattern);
  // Live follow-through is a confidence booster, not a rigid 3-tick gate.
  // Statistical trigger quality remains mandatory; weaker evidence cannot use this relaxation.
  const key=x=>(x%2===0?"E":"O");
  const recent=d.slice(-500).map(key);
  const triggerPattern=candidate.type==="PATTERN"?String(candidate.main).split(" → ").slice(0,-1):[candidate.trigger];
  const score=Number(candidate.score)||0;
  const confidence=parseInt(candidate.confidence,10)||0;
  const strongHistorical=score>=6&&confidence>=78;
  let depth=0;
  for(const k of [3,2,1]){
    if(recent.length<triggerPattern.length+k)continue;
    const start=recent.length-triggerPattern.length-k;
    const matched=triggerPattern.every((v,i)=>recent[start+i]===v);
    const follow=recent.slice(start+triggerPattern.length);
    if(matched&&follow.length===k&&follow.every(v=>v===(selectedSide==="EVEN"?"E":"O"))){depth=k;break;}
  }
  if(!strongHistorical||!depth||(depth<2&&score<8)||(depth<3&&score<7))return null;
  const confirmation=depth===3?"3-tick live follow-through confirmed":depth===2?"2-tick live follow-through confirmed":"1-tick live follow-through confirmed; 2–3 ticks remain confidence boosters";
  return {...candidate,reason:candidate.reason+" Current trigger pattern and "+confirmation+" for "+selectedSide+".",evidence:candidate.evidence+" • live trigger matched • "+confirmation+"."};
}

function renderEvenOdd(root,d,last,n){
  const e=parityStats(d,state.selectedParity);
  const entryActive=e.signal==="SIGNAL"||e.signal==="STRONG SIGNAL";
  const rawEntry=entryActive?selectParityEntry(d,state.selectedParity):null;
  const entry=mavenAIReviewEntry("evenodd",rawEntry,e.aiDecision);
  setOtherValidationForecast("evenodd",state.selectedParity,e.signal,!!entry,state.liveTickSequence,e.aiDecision?.confidence);
  setSignalValidationForecast("evenodd",state.selectedParity,e.signal,state.liveTickSequence,e.aiDecision?.confidence);
  const entryDisplay=entry||{main:entryActive?"NO STRONG ENTRY":"NO ACTIVE ENTRY",confidence:"—",reason:entryActive?"No trigger has enough conditional lift toward the selected Final Signal.":"Entry activates only when the selected parity has SIGNAL or STRONG SIGNAL."};
  const pattern=d.slice(-6).map(x=>x%2===0?"E":"O").join(" → ");
  const reason=e.conflict?"WAIT: recent and longer-window parity behaviour conflict. The AI will wait for stronger agreement.":e.transitions<30||e.recentTransitions<10?"WAIT: parity continuation sample is still small ("+e.transitions+" total and "+e.recentTransitions+" recent transitions; needs at least 30 total and 10 recent).":e.signal==="STRONG SIGNAL"?"Multiple parity evidence layers are aligned for "+state.selectedParity+".":e.signal==="SIGNAL"?"The selected parity has sufficient multi-factor evidence, but it is not at STRONG SIGNAL level.":e.signal==="AVOID"?"The selected parity has unfavorable evidence.":"Evidence for the selected parity is still developing.";
  root.innerHTML=panel(e.signal,reason,entryDisplay,[
    "Selected parity: "+state.selectedParity,
    "Recent parity: "+pattern,
    "20/50/100/250/500 rates: "+e.windows.map(x=>Math.round(x.rate*100)+"%").join(" / "),
    "Probability "+Math.round(e.probability*100)+" • momentum "+Math.round(e.momentumScore*100)+" • trend "+Math.round(e.trendScore*100)+" • transitions "+Math.round(e.transition*100),
    "Clustering "+Math.round(e.clustering*100)+" • recency "+Math.round(e.recency*100)+" • consistency "+Math.round(e.consistency*100),
    "Streak "+e.streak+" • evidence "+Math.round(e.evidence*100),
    "Maven AI decision: "+e.aiDecision.baseSignal+" → "+e.aiDecision.signal+" • confidence "+Math.round(e.aiDecision.confidence*100)+"% • "+e.aiDecision.reason,
    entry?"✓ STRONG ENTRY: trigger has measurable lift toward the Final Signal":"× No strong trigger passed conditional validation"
  ],n);
}

function riseFallAnalysis(prices){
  if(!Array.isArray(prices)||prices.length<30)return null;
  const clean=prices.map(Number).filter(Number.isFinite);
  if(clean.length<30)return null;
  const moves=[];
  for(let i=1;i<clean.length;i++){
    const delta=clean[i]-clean[i-1];
    moves.push({direction:delta>0?"R":delta<0?"F":"X",magnitude:Math.abs(delta)});
  }
  const directional=arr=>arr.filter(x=>x.direction!=="X");
  const rate=arr=>{const a=directional(arr);return a.length?a.filter(x=>x.direction==="R").length/a.length:.5};
  const sizes=[20,50,100,250,500];
  const stats=sizes.map(size=>{
    const a=moves.slice(-size),dir=directional(a);
    return {size,directional:dir.length,rate:rate(a),fallRate:dir.length?dir.filter(x=>x.direction==="F").length/dir.length:.5};
  });
  const recentMoves=moves.slice(-60),recentDirectional=directional(recentMoves);
  const recentRate=rate(recentMoves);
  const totalMagnitude=recentDirectional.reduce((sum,x)=>sum+x.magnitude,0);
  const recentMove=totalMagnitude?recentDirectional.filter(x=>x.direction==="R").reduce((sum,x)=>sum+x.magnitude,0)/totalMagnitude:.5;
  const shortRate=rate(moves.slice(-20)),midRate=rate(moves.slice(-100)),longRate=rate(moves.slice(-Math.min(500,moves.length)));
  const momentum=Math.max(0,Math.min(1,.5+(shortRate-longRate)*2));
  const trendRate=Math.max(0,Math.min(1,.5+(shortRate-midRate)*.7+(midRate-longRate)*.8));
  const recentTarget=state.selectedRiseFall==="RISE"?recentRate:1-recentRate;
  const shortTarget=state.selectedRiseFall==="RISE"?shortRate:1-shortRate;
  const midTarget=state.selectedRiseFall==="RISE"?midRate:1-midRate;
  const longTarget=state.selectedRiseFall==="RISE"?longRate:1-longRate;
  const targetMoves=directional(moves.slice(-20));
  let streak=0;
  const targetDir=state.selectedRiseFall==="RISE"?"R":"F";
  for(let i=moves.length-1;i>=0&&moves[i].direction===targetDir;i--)streak++;
  const persistence=targetMoves.length?targetMoves.filter(x=>x.direction===targetDir).length/targetMoves.length:.5;
  let reversals=0,adjacent=0;
  for(let i=Math.max(1,moves.length-60);i<moves.length;i++){
    if(moves[i].direction==="X"||moves[i-1].direction==="X")continue;
    adjacent++;if(moves[i].direction!==moves[i-1].direction)reversals++;
  }
  const reversalPressure=adjacent?reversals/adjacent:0;
  const evidence=Math.max(0,Math.min(1,
    .25*recentTarget+.20*shortTarget+.15*midTarget+.10*longTarget+
    .12*persistence+.10*(state.selectedRiseFall==="RISE"?recentMove:1-recentMove)+.08*(1-reversalPressure)
  ));
  const conflict=(recentTarget<.45&&longTarget>.55)||(Math.abs(recentTarget-longTarget)>=.16&&recentTarget<.5)||(shortTarget<.43&&midTarget>.56);
  let signal="WAIT";
  if(clean.length<100||recentDirectional.length<15||stats.some(x=>x.size<=100&&x.directional<10))signal="WAIT";
  else if(conflict)signal="WAIT";
  else if(recentTarget<.43||shortTarget<.42||persistence<.38)signal="AVOID";
  else if(evidence>=.67&&recentTarget>=.57&&shortTarget>=.54&&midTarget>=.51&&persistence>=.53&&clean.length>=200)signal="STRONG SIGNAL";
  else if(evidence>=.55&&recentTarget>=.51&&shortTarget>=.49&&persistence>=.45)signal="SIGNAL";
  else if(evidence<.43)signal="AVOID";
  const aiDecision=mavenAIDecisionLayer("risefall",signal,evidence,[recentTarget,shortTarget,midTarget,longTarget,persistence,1-reversalPressure,recentMove,trendRate,momentum],conflict,clean.length<100||recentDirectional.length<15||stats.some(x=>x.size<=100&&x.directional<10),clean.length);signal=aiDecision.signal;
  return {selected:state.selectedRiseFall,stats,recentRate,recentMove:aiDecision.adjustedAlignment[6]??recentMove,trendRate:aiDecision.adjustedAlignment[7]??trendRate,momentum:aiDecision.adjustedAlignment[8]??momentum,persistence:aiDecision.adjustedAlignment[4]??persistence,streak,reversalPressure, evidence:aiDecision.adjustedEvidence,conflict,signal,baseSignal:aiDecision.baseSignal,aiDecision,recentTarget:aiDecision.adjustedAlignment[0]??recentTarget,shortTarget:aiDecision.adjustedAlignment[1]??shortTarget,midTarget:aiDecision.adjustedAlignment[2]??midTarget,longTarget:aiDecision.adjustedAlignment[3]??longTarget};
}

function riseFallEntry(prices,analysis){
  if(!analysis||!(analysis.signal==="SIGNAL"||analysis.signal==="STRONG SIGNAL"))return null;
  const target=analysis.selected, targetDir=target==="RISE"?"R":"F";
  const recent=prices.slice(-500),dirs=[];
  for(let i=1;i<recent.length;i++)dirs.push(recent[i]>recent[i-1]?"R":recent[i]<recent[i-1]?"F":"X");
  const candidates=[];
  for(const len of [1,2,3]){
    const seen=new Map();
    for(let i=0;i+len+2<dirs.length;i++){
      const pattern=dirs.slice(i,i+len).join(" → ");
      let p=seen.get(pattern);
      if(!p){p={pattern,len,total:0,r1:0,r2:0,r3:0,recentTotal:0,recentR1:0};seen.set(pattern,p)}
      p.total++;
      if(dirs[i+len]===targetDir)p.r1++;
      if(dirs[i+len]===targetDir&&dirs[i+len+1]===targetDir)p.r2++;
      if(dirs[i+len]===targetDir&&dirs[i+len+1]===targetDir&&dirs[i+len+2]===targetDir)p.r3++;
      if(i>=Math.max(0,dirs.length-160)){p.recentTotal++;if(dirs[i+len]===targetDir)p.recentR1++}
    }
    for(const p of seen.values()){
      if(p.total<10)continue;
      p.r1/=p.total;p.r2/=p.total;p.r3/=p.total;
      p.recentRate=p.recentTotal?p.recentR1/p.recentTotal:p.r1;
      const baseline=.5;
      p.score=100*(Math.max(0,p.r1-baseline)*.35+Math.max(0,p.r2-baseline)*.25+Math.max(0,p.r3-baseline)*.10+Math.max(0,p.recentRate-baseline)*.20+Math.min(1,p.total/50)*.10)*2;
      candidates.push(p);
    }
  }
  candidates.sort((a,b)=>b.score-a.score||b.total-a.total);
  const best=candidates[0],second=candidates[1];
  if(!best)return null;
  const strong=(best.r1>=.55||best.r2>=.55)&&best.recentRate>=.52&&best.total>=10&&best.score>=55&&(!second||best.score-second.score>=1);
  if(!strong)return null;
  // Require the selected historical pattern to be present in the current stream,
  // followed by 1–3 target-direction moves. Follow-through is flexible, not a fixed 3-tick gate.
  const pattern=best.pattern.split(" → ");
  let depth=0;
  for(const k of [3,2,1]){
    if(dirs.length<pattern.length+k)continue;
    const start=dirs.length-pattern.length-k;
    const matched=pattern.every((v,i)=>dirs[start+i]===v);
    const follow=dirs.slice(start+pattern.length);
    if(matched&&follow.length===k&&follow.every(x=>x===targetDir)){depth=k;break;}
  }
  const historyStrong=best.total>=15&&best.score>=55&&best.recentRate>=.53&&(best.r1>=.54||best.r2>=.53);
  if(!historyStrong||!depth||(depth<2&&best.score<65)||(depth<3&&best.score<60))return null;
  let confidence=Math.round(70+(best.r1-.5)*45+(best.r2-.5)*35+(best.r3-.5)*15+(best.recentRate-.5)*25+Math.min(6,best.total/25));
  confidence=Math.max(60,Math.min(88,confidence));
  return {
    type:"PATTERN",status:"CONFIRMED ENTRY",main:best.pattern+" → "+target,
    confidence:confidence+"%",
    reason:"Historical trigger quality passed independent sample, reaction and recent-stability checks; current pattern matched with "+depth+" target-direction live move(s).",
    evidence:best.total+" trigger observations • r1 "+Math.round(best.r1*100)+"% • r2 "+Math.round(best.r2*100)+"% • recent "+Math.round(best.recentRate*100)+"% • live trigger matched • "+depth+"-tick follow-through."
  };
}

function renderRiseFallControls(){
  document.querySelectorAll(".rise-fall-side").forEach(btn=>btn.classList.toggle("active",btn.dataset.direction===state.selectedRiseFall));
  const label=$("riseFallSetupLabel");if(label)label.textContent=state.selectedRiseFall;
}

function renderRiseFall(root,last,n){
  const prices=state.ticks.map(t=>Number(t.quote)).filter(Number.isFinite);
  const a=riseFallAnalysis(prices);
  if(!a){
    root.innerHTML=panel("INSUFFICIENT DATA","Collect at least 30 real price ticks before Rise/Fall analysis.",null,["Uses actual live market prices, not last-digit parity","Selected direction: "+state.selectedRiseFall],n);
    return;
  }
  const rawEntry=riseFallEntry(prices,a);
  const entry=mavenAIReviewEntry("risefall",rawEntry,a.aiDecision);
  setOtherValidationForecast("risefall",state.selectedRiseFall,a.signal,!!entry,state.liveTickSequence,a.aiDecision?.confidence);
  setSignalValidationForecast("risefall",state.selectedRiseFall,a.signal,state.liveTickSequence,a.aiDecision?.confidence);
  const entryDisplay=entry||{
    main:a.signal==="SIGNAL"||a.signal==="STRONG SIGNAL"?"NO CONFIRMED ENTRY":"NO ACTIVE ENTRY",
    confidence:"—",
    reason:a.signal==="SIGNAL"||a.signal==="STRONG SIGNAL"
      ?"Waiting for the historical trigger pattern to match the live stream and show qualified 1–3 move follow-through toward "+a.selected+"."
      :"Entry activates only when the selected direction reaches SIGNAL or STRONG SIGNAL."
  };
  const latest=a.stats.map(x=>x.directional>=10?Math.round(x.rate*100)+"% RISE":"—").join(" / ");
  const recentPattern=prices.slice(-8).reduce((acc,x,i,arr)=>i===0?acc:acc.concat(x>arr[i-1]?"R":x<arr[i-1]?"F":"X"),[]).join(" → ");
  const reason=a.conflict
    ?"WAIT: short-term and longer-term price direction disagree. The AI is waiting for clearer confirmation."
    :a.signal==="STRONG SIGNAL"
    ?"Multi-window price direction, momentum, persistence and movement magnitude align for "+a.selected+"."
    :a.signal==="SIGNAL"
    ?"The selected direction has supporting price evidence, but it is below the strongest alignment level."
    :a.signal==="AVOID"
    ?"Recent price movement conflicts with the selected direction or lacks sufficient support."
    :"Evidence is still developing; wait for more validated live ticks.";
  root.innerHTML=panel(a.signal,reason,entryDisplay,[
    "Selected direction: "+a.selected,
    "Recent price moves: "+recentPattern,
    "20/50/100/250/500 windows (% RISE): "+latest,
    "Recent 60 moves: "+Math.round(a.recentRate*100)+"% RISE • "+Math.round((1-a.recentRate)*100)+"% FALL",
    "Selected-direction support: "+Math.round(a.recentTarget*100)+"% • movement-weighted rise: "+Math.round(a.recentMove*100)+"%",
    "Momentum "+Math.round(a.momentum*100)+" • persistence "+Math.round(a.persistence*100)+" • target streak "+a.streak,
    "Reversal pressure "+Math.round(a.reversalPressure*100)+" • evidence "+Math.round(a.evidence*100)+"%",
    "Maven AI decision: "+a.aiDecision.baseSignal+" → "+a.aiDecision.signal+" • confidence "+Math.round(a.aiDecision.confidence*100)+"% • "+a.aiDecision.reason,
    a.conflict?"× Directional windows conflict — waiting for stronger agreement":"✓ Directional conflict check passed",
    entry?"✓ Confirmed entry: historical trigger matched the live stream with qualified follow-through toward "+a.selected:"× No entry confirmed yet; historical patterns alone cannot trigger an entry"
  ],n);
}
document.querySelectorAll(".parity-side").forEach(btn=>btn.addEventListener("click",()=>{state.selectedParity=btn.dataset.parity;renderParityControls();renderEngine()}));
document.querySelectorAll(".rise-fall-side").forEach(btn=>btn.addEventListener("click",()=>{state.selectedRiseFall=btn.dataset.direction;renderRiseFallControls();renderEngine()}));

document.querySelectorAll("#overUnderControls .ou-side").forEach(btn=>btn.addEventListener("click",()=>{state.selectedSide=btn.dataset.side;autoTradeSetupChanged();state.deepScanner.autoLoaded=false;state.deepScanner.manualOverride=false;state.deepScanner.strongestCandidate=null;renderOUControls();renderEngine();deepScannerEvaluate(true)}));
document.querySelectorAll(".engine-tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".engine-tab").forEach(b=>{b.classList.remove("active");b.setAttribute("aria-selected","false")});btn.classList.add("active");btn.setAttribute("aria-selected","true");state.engine=btn.dataset.engine;const current=document.getElementById("workspaceCurrent");if(current)current.textContent=btn.textContent.trim();renderEngine()}));
const scanNowBtn=$("scanNowBtn");if(scanNowBtn)scanNowBtn.addEventListener("click",startDeepScan);const loadStrongestBtn=$("loadStrongestBtn");if(loadStrongestBtn)loadStrongestBtn.addEventListener("click",loadStrongestScannerMarket);
const payoutInput=$("ouPayoutPercent");if(payoutInput)payoutInput.addEventListener("input",()=>{state.ouPayoutPercent=Math.max(1,Math.min(500,Number(payoutInput.value)||95));renderOUValidationPanel()});
marketSelect.addEventListener("change",()=>{const m=state.markets.find(x=>x.symbol===marketSelect.value);if(m){autoTradeMarketChanged();state.symbol=m.symbol;state.marketName=m.name;$("marketName").textContent=m.name;renderSubscribedMarketStatus("switching");state.marketStarted=false;startMarket(true);syncDeepScannerSubscriptions();renderDeepScanner();}});
let touchX=0,touchY=0;
document.querySelector(".engine-nav").addEventListener("touchstart",e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY},{passive:true});
document.querySelector(".engine-nav").addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)){const names=["overunder","evenodd","risefall"],i=names.indexOf(state.engine),next=names[Math.max(0,Math.min(2,i+(dx<0?1:-1)))];document.querySelector(`[data-engine="${next}"]`).click()}},{passive:true});
setInterval(()=>{if(state.deepScanner.enabled&&(!isMobileDevice()||isDeepScannerOpen())&&Date.now()-state.deepScanner.lastScanAt>10000)deepScannerEvaluate(false);if(state.lastTickAt){$("diagAge").textContent=Math.round((Date.now()-state.lastTickAt)/1000)+"s";if(Date.now()-state.lastTickAt>15000&&state.connected){setStatus("offline","Waiting for data");renderSubscribedMarketStatus("stale")}}const root=$("engineRoot");if(root&&root.querySelector(".engine-panel"))applySpikeRiskProtection(root)},1000);
// Keep the WebSocket alive with Deriv protocol pings and recover if its heartbeat stops.
setInterval(()=>{
  const ws=state.socket;if(!ws||ws.readyState!==WebSocket.OPEN||!state.connected)return;
  if(state.lastPongAt&&Date.now()-state.lastPongAt>45000){state.lastError="Deriv heartbeat timed out";if($("diagError"))$("diagError").textContent=state.lastError;try{ws.close()}catch{}return;}
  request({ping:1,req_id:nextReq()});
},15000);
connect();
// Deep Scanner floating popup controls
(function setupDeepScannerPopup(){
  const fab=document.getElementById("deepScannerFab"),modal=document.getElementById("deepScannerModal"),close=document.getElementById("closeDeepScanner"),dot=document.getElementById("deepScannerFabDot");
  if(!fab||!modal||!close)return;
  const open=()=>{modal.classList.add("open");modal.setAttribute("aria-hidden","false");fab.setAttribute("aria-expanded","true");document.body.style.overflow="hidden";syncDeepScannerSubscriptions();deepScannerEvaluate(true);close.focus();};
  const shut=()=>{modal.classList.remove("open");modal.setAttribute("aria-hidden","true");fab.setAttribute("aria-expanded","false");document.body.style.overflow="";if(isMobileDevice())pauseDeepScannerSubscriptions();fab.focus();};
  fab.addEventListener("click",open);close.addEventListener("click",shut);
  modal.querySelectorAll("[data-close-scanner]").forEach(el=>el.addEventListener("click",shut));
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal.classList.contains("open"))shut();});
  const updateDot=()=>{const b=document.getElementById("loadStrongestBtn");if(dot&&b&&!b.disabled)dot.classList.add("ready");else if(dot)dot.classList.remove("ready");};
  setInterval(updateDot,1200);updateDot();
})();

// Show the primary WebSocket's confirmed feed, not just the selected dropdown value.
function renderSubscribedMarketStatus(mode="switching"){
  const box=$("subscribedMarketStatus"),name=$("subscribedMarketName"),symbol=$("subscribedMarketSymbol");
  if(!box||!name||!symbol)return;
  const activeSymbol=state.primarySubscriptionSymbol;
  const market=state.markets.find(m=>m.symbol===activeSymbol);
  const selected=state.markets.find(m=>m.symbol===state.symbol);
  const label=market?.name||(activeSymbol===state.symbol?(state.marketName||state.symbol):activeSymbol)||selected?.name||state.marketName||state.symbol||"No market selected";
  const age=state.lastTickAt?Date.now()-state.lastTickAt:Infinity;
  if(mode==="connected"&&(!state.connected||activeSymbol!==state.symbol||age>15000))mode=age>15000?"stale":"switching";
  name.textContent=label;
  if(mode==="connected"&&activeSymbol===state.symbol&&state.primarySubscriptionId){
    symbol.textContent="Subscribed: "+activeSymbol+" · Confirmed by matching live ticks";
    setStatus("live",`LIVE — ${label} feed`);
  }else if(mode==="stale"){
    symbol.textContent="Subscribed: "+(activeSymbol||"—")+" · No fresh ticks for "+(Number.isFinite(age)?Math.floor(age/1000)+"s":"15s+")+" · Feed may be stalled";
  }else if(mode==="offline"||mode==="error"){
    symbol.textContent="Feed "+(mode==="error"?"error":"disconnected")+" · Selected market: "+(state.symbol||"—")+" · Waiting to reconnect";
  }else{
    symbol.textContent="Selected: "+(state.symbol||"—")+" · Waiting for matching live ticks to confirm subscription";
  }
  box.classList.toggle("connected",mode==="connected");
  box.classList.toggle("switching",mode!=="connected");
  box.classList.toggle("stale",mode==="stale"||mode==="offline"||mode==="error");
}


/* Auto Trade: separate authenticated trading socket; never shares the public tick socket. */
const autoTrade={
  socket:null,tradingHeartbeatTimer:null,authorized:false,account:null,availableAccounts:[],accountBalances:{},enabled:false,speedMode:"STANDARD",realConfirmed:false,stake:0.35,martingale:2,takeProfit:2,stopLoss:3,
  nextStake:0.35,sessionProfit:0,wins:0,losses:0,runRemaining:0,nextEntryAllowedAt:0,entryCooldownMs:5000,runSymbol:"",runDigit:null,runSide:"OVER",runSelectedDigit:2,armed:true,lastDigit:null,
  recoveryEnabled:false,recoveryMode:"SMART_NET",recoveryBalance:0,recoveryPairProfit:0,recoveryPhase:0,recoveryDigit1:2,recoveryDigit2:5,recoverySide1:"DEFAULT",recoverySide2:"DEFAULT",
  activeContracts:{},settled:new Set(),requests:{},req:1000,currency:"",startedAt:0,runSettled:0,waitingForFreshData:false,fastTickQueue:[],fastTickQueueLimit:500,fastTickQueueStaleMs:3000,fastTickQueueDrainActive:false,logLines:[],lastManualBlockReason:"",lastManualLoggedReason:"",demoTestActive:false,demoTestContractId:null,demoTestSide:"OVER",demoTestDigit:2,demoTestSymbol:"",demoTestPendingParameters:null,pendingBuyQuotes:{}
};
function autoTradeLog(message){
  const stamp=new Date().toLocaleTimeString();
  autoTrade.logLines.unshift(stamp+" · "+message);autoTrade.logLines=autoTrade.logLines.slice(0,35);
  const log=$("autoTradeLog");if(log)log.innerHTML=autoTrade.logLines.map(x=>"<div>"+esc(x)+"</div>").join("");
}
function autoTradeStatus(text,kind=""){
  const el=$("autoTradeStatus");if(el){el.textContent=text;el.className="auto-trade-status "+kind}
  const dot=$("autoTradeDot");if(dot){dot.classList.toggle("ready",autoTrade.authorized);dot.classList.toggle("running",autoTrade.enabled)}
  const start=$("autoTradeStart"),stop=$("autoTradeStop");
  if(start)start.disabled=!autoTrade.authorized||autoTrade.enabled||!autoTradeCanStart();
  if(stop)stop.disabled=!autoTrade.enabled;
  const dis=$("autoTradeDisconnect");if(dis)dis.disabled=!autoTrade.socket;
}
function autoTradeReq(obj,kind){
  if(!autoTrade.socket||autoTrade.socket.readyState!==WebSocket.OPEN)throw new Error("Trading connection is not open");
  const id=++autoTrade.req;autoTrade.requests[id]=kind;obj.req_id=id;autoTrade.socket.send(JSON.stringify(obj));return id;
}
function autoTradeCanStart(){
  // Maven FX Bot is demo-only; real-account execution remains disabled.
  return !!autoTrade.authorized&&!!autoTrade.account&&autoTrade.account.is_virtual===true;
}
function autoTradeRenderPnL(){
  const el=$("autoTradePnL");if(!el)return;
  const pnl=Number(autoTrade.sessionProfit)||0;
  el.textContent="Session P/L: "+pnl.toFixed(2)+" "+(autoTrade.currency||"");
  el.classList.toggle("pnl-positive",pnl>0);
  el.classList.toggle("pnl-negative",pnl<0);
  el.classList.toggle("pnl-neutral",pnl===0);
  el.setAttribute("aria-label",(pnl>0?"Profit":pnl<0?"Loss":"No profit or loss")+", session P/L "+pnl.toFixed(2)+" "+(autoTrade.currency||""));
}
function autoTradeRenderBalances(){
  const host=$("autoTradeBalances");if(!host)return;
  const accounts=autoTrade.availableAccounts||[];
  if(!accounts.length){host.innerHTML='<div class="balance-empty">Connect a token with access to your Demo and Real accounts to view available balances.</div>';return}
  host.innerHTML=accounts.map(a=>{
    const entry=autoTrade.accountBalances[a.id]||{status:"pending"};
    const kind=a.demo?"DEMO":"REAL";
    let value=entry.status==="loaded"?(Number(entry.balance).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+" "+(entry.currency||a.currency||"")):entry.status==="pending"?"Checking balance…":entry.status==="unavailable"?"Unavailable for this token":"Waiting for account";
    return '<div class="balance-card '+(a.demo?"demo":"real")+'"><div><strong>'+kind+'</strong><small>'+esc(a.id)+'</small></div><span>'+esc(value)+'</span></div>';
  }).join("");
}
async function autoTradeFetchOtherBalances(token,headers,accounts,selectedId){
  for(const account of accounts){
    if(account.id===selectedId)continue;
    autoTrade.accountBalances[account.id]={status:"pending"};autoTradeRenderBalances();
    try{
      const response=await fetch("https://api.derivws.com/trading/v1/options/accounts/"+encodeURIComponent(account.id)+"/otp",{method:"POST",headers});
      let payload={};try{payload=await response.json()}catch{}
      if(!response.ok)throw new Error("OTP unavailable");
      const url=payload?.data?.url||payload?.url;
      if(typeof url!=="string"||!url.startsWith("wss://api.derivws.com/trading/v1/options/ws/"))throw new Error("Invalid balance connection URL");
      await new Promise((resolve)=>{
        let done=false, ws=null;
        const finish=(entry)=>{if(done)return;done=true;clearTimeout(timer);if(ws){ws.onmessage=null;ws.onerror=null;ws.onclose=null;try{ws.close()}catch{}}autoTrade.accountBalances[account.id]=entry;autoTradeRenderBalances();resolve()};
        const timer=setTimeout(()=>finish({status:"unavailable"}),10000);
        try{
          ws=new WebSocket(url);
          ws.onopen=()=>{try{ws.send(JSON.stringify({balance:1,req_id:1}))}catch{finish({status:"unavailable"})}};
          ws.onmessage=(event)=>{let data;try{data=JSON.parse(event.data)}catch{return}
            if(data.error){finish({status:"unavailable"});return}
            if(data.balance){finish({status:"loaded",balance:Number(data.balance.balance),currency:data.balance.currency||account.currency});return}
          };
          ws.onerror=()=>finish({status:"unavailable"});
          ws.onclose=()=>{if(!done)finish({status:"unavailable"})};
        }catch{finish({status:"unavailable"})}
      });
    }catch{autoTrade.accountBalances[account.id]={status:"unavailable"};autoTradeRenderBalances()}
  }
}
function autoTradeRender(){
  const market=$("autoTradeMarket"),setup=$("autoTradeSetup"),entries=$("autoTradeEntries");
  if(market)market.textContent=state.symbol+" · "+state.marketName;
  if(setup)setup.textContent=state.selectedSide+" "+state.selectedDigit;
  if(entries){
    const chosen=autoTradeEntrySelection();
    const manual=$("autoTradeManualEntriesEnabled")?.checked;
    const candidates=state.ouEntrySnapshot?.active&&Array.isArray(state.ouEntrySnapshot.validationDigits)?state.ouEntrySnapshot.validationDigits:[];
    entries.textContent=chosen.length?chosen.join(" / "):manual?(autoTrade.lastManualBlockReason||"Manual digits not qualified"):candidates.length?"Entry digits: "+candidates.join(" / "):"No validated entry digits yet";
  }
  if($("autoTradeCurrency"))$("autoTradeCurrency").textContent=autoTrade.currency||"account currency";
  document.querySelectorAll(".autoTradeCurrencyText").forEach(x=>x.textContent=autoTrade.currency||"account currency");
  if($("autoTradeAccount"))$("autoTradeAccount").textContent=autoTrade.account?(autoTrade.account.loginid+" · "+(autoTrade.account.is_virtual?"DEMO":"REAL")+" · "+autoTrade.currency):"No account connected";
  autoTradeRenderBalances();
  autoTradeRenderPnL();
  if($("autoTradeNextStake"))$("autoTradeNextStake").textContent=autoTrade.nextStake.toFixed(2)+" "+(autoTrade.currency||"");
  if($("autoTradeRunProgress"))$("autoTradeRunProgress").textContent=autoTrade.runSymbol?(autoTrade.runSettled+"/2 settled"):autoTrade.enabled?"Waiting for entry":"Idle";
  const gate=$("autoTradeRealGate");if(gate)gate.hidden=!autoTrade.account||autoTrade.account.is_virtual;
  autoTradeStatus(autoTrade.enabled?"RUNNING":autoTrade.authorized?(autoTrade.account?.is_virtual?"DEMO CONNECTED":"REAL ACCOUNT LOCKED"):"DISCONNECTED",autoTrade.enabled?"running":autoTrade.authorized?"connected":"");
}
function autoTradeUpdateLiveFields(){
  const modal=$("autoTradeModal");if(!modal||!modal.classList.contains("open"))return;
  const market=$("autoTradeMarket"),setup=$("autoTradeSetup"),entries=$("autoTradeEntries");
  if(market)market.textContent=state.symbol+" · "+state.marketName;
  if(setup)setup.textContent=state.selectedSide+" "+state.selectedDigit;
  if(entries){
    const chosen=autoTradeEntrySelection();
    const manual=$("autoTradeManualEntriesEnabled")?.checked;
    const candidates=state.ouEntrySnapshot?.active&&Array.isArray(state.ouEntrySnapshot.validationDigits)?state.ouEntrySnapshot.validationDigits:[];
    entries.textContent=chosen.length?chosen.join(" / "):manual?(autoTrade.lastManualBlockReason||"Manual digits not qualified"):candidates.length?"Entry digits: "+candidates.join(" / "):"No validated entry digits yet";
  }
}
function autoTradeMarketChanged(){
  autoTrade.lastDigit=null;
  if(autoTrade.runSymbol||autoTrade.runRemaining||Object.keys(autoTrade.pendingBuyQuotes).length||Object.keys(autoTrade.activeContracts).length){
    autoTradePause("market changed during an entry sequence; no overlapping entry will be started");
    return;
  }
  autoTrade.armed=true;
  if(autoTrade.enabled)autoTradeLog("Following selected market: new entries will use the new market after fresh signal and entry validation.");
  autoTradeRender();
}
function autoTradeSetupChanged(){
  autoTrade.lastDigit=null;
  if(autoTrade.runSymbol||autoTrade.runRemaining||Object.keys(autoTrade.pendingBuyQuotes).length||Object.keys(autoTrade.activeContracts).length){
    autoTradePause("Over/Under setup changed during an entry sequence; no overlapping entry will be started");
    return;
  }
  autoTrade.armed=true;
  autoTradeRender();
}
function autoTradeIsExecutionBusy(){
  return !!(autoTrade.runSymbol||Object.keys(autoTrade.pendingBuyQuotes).length||Object.keys(autoTrade.activeContracts).length);
}
function autoTradeDrainFastTickQueue(){
  if(autoTrade.fastTickQueueDrainActive||!autoTrade.enabled||autoTrade.speedMode!=="FAST"||state.engine!=="overunder"||autoTradeIsExecutionBusy())return;
  // Queued ticks happened while the approved two-run sequence was busy. They update analysis as received,
  // but replaying them now could create a late entry or bypass the rule to wait for a new digit hit.
  const waiting=autoTrade.fastTickQueue.length;
  if(waiting){
    autoTrade.fastTickQueue.length=0;
    autoTradeLog("FAST EXECUTION · cleared "+waiting+" ticks received while a contract/entry cycle was busy; waiting for the next live entry-digit hit after the cycle.");
  }
}
function autoTradePause(reason){
  autoTrade.enabled=false;autoTrade.runRemaining=0;autoTrade.runSymbol="";autoTrade.fastTickQueue.length=0;
  autoTradeStatus("PAUSED");autoTradeLog("BOT PAUSED · "+reason);autoTradeRender();
}
function autoTradeSetSpeedMode(mode,logChange=true){
  autoTrade.speedMode=mode==="FAST"?"FAST":"STANDARD";
  const button=$("autoTradeSpeedToggle");
  if(button){button.textContent=autoTrade.speedMode==="FAST"?"FAST EXECUTION: ON":"FAST EXECUTION: OFF";button.setAttribute("aria-pressed",autoTrade.speedMode==="FAST"?"true":"false");button.classList.toggle("fast-active",autoTrade.speedMode==="FAST");}
  if(autoTrade.speedMode!=="FAST"&&autoTrade.fastTickQueue.length){const cleared=autoTrade.fastTickQueue.length;autoTrade.fastTickQueue.length=0;if(logChange)autoTradeLog("FAST QUEUE CLEARED · "+cleared+" waiting ticks discarded because Standard mode was selected.");}
  const note=$("autoTradeSpeedNote");if(note)note.textContent=autoTrade.speedMode==="FAST"?"Checks each incoming live tick immediately using the same entry rules as Standard mode. Ticks arriving while a quote/contract or two-run cycle is busy cannot trigger late entries; Deriv/network speed itself is unchanged.":"Standard mode processes the current live tick directly. Both modes keep the same entry, risk and two-run rules.";
  if(logChange&&$("autoTradeLog"))autoTradeLog(autoTrade.speedMode==="FAST"?"FAST EXECUTION ON · incoming live ticks are checked immediately; same entry, risk and two-run rules as Standard mode.":"Execution speed set to STANDARD.");
}
function autoTradeStart(){
  if(!autoTradeCanStart()){autoTradeLog("Start blocked: connect an account; real accounts additionally require the checkbox and exact phrase TRADE REAL.");autoTradeRender();return}
  const stake=Number($("autoTradeStake").value),mg=Number($("autoTradeMartingale").value),tp=Number($("autoTradeTP").value),sl=Number($("autoTradeSL").value);
  if(!(stake>=0.35&&stake<=100&&mg>=1&&mg<=10&&tp>0&&sl>0)){autoTradeLog("Invalid risk settings. Stake must be 0.35–100, multiplier 1–10, and take-profit/stop-loss must be positive.");return}
  const recoveryMode=$("autoTradeRecoveryMode")?.value||"SMART_NET";
  if(!["SMART_NET","CLASSIC"].includes(recoveryMode)){autoTradeLog("Choose a valid recovery mode.");return}
  // Smart Net Recovery is always active; the checkbox only enables Classic Recovery.
  const recoveryEnabled=recoveryMode==="SMART_NET"||$("autoTradeRecoveryEnabled").checked;
  const manualEntriesEnabled=$("autoTradeManualEntriesEnabled").checked;
  const manualRaw1=$("autoTradeManualDigit1").value,manualRaw2=$("autoTradeManualDigit2").value;
  const manualDigit1=Number(manualRaw1),manualDigit2=Number(manualRaw2);
  if(manualEntriesEnabled&&(String(manualRaw1).trim()===""||String(manualRaw2).trim()===""||!Number.isInteger(manualDigit1)||manualDigit1<0||manualDigit1>9||!Number.isInteger(manualDigit2)||manualDigit2<0||manualDigit2>9||manualDigit1===manualDigit2)){autoTradeLog("Enter two different whole-number manual entry digits from 0 to 9. If one has a red/green bar, the other eligible digit can still be used.");return}
  const digit1=Number($("autoTradeRecoveryDigit1").value),digit2=Number($("autoTradeRecoveryDigit2").value);
  const recoverySide1=$("autoTradeRecoverySide1").value,recoverySide2=$("autoTradeRecoverySide2").value;
  if(!Number.isInteger(digit1)||digit1<0||digit1>9||!Number.isInteger(digit2)||digit2<0||digit2>9){autoTradeLog("Recovery digits must be whole numbers from 0 to 9.");return}
  if(!["DEFAULT","OVER","UNDER"].includes(recoverySide1)||!["DEFAULT","OVER","UNDER"].includes(recoverySide2)){autoTradeLog("Choose a valid side for each recovery attempt.");return}
  autoTrade.stake=stake;autoTrade.martingale=mg;autoTrade.takeProfit=tp;autoTrade.stopLoss=sl;autoTrade.nextStake=stake;
  autoTrade.recoveryEnabled=recoveryEnabled;autoTrade.recoveryMode=recoveryMode;autoTrade.recoveryBalance=0;autoTrade.recoveryPairProfit=0;autoTrade.recoveryPhase=0;autoTrade.recoveryDigit1=digit1;autoTrade.recoveryDigit2=digit2;autoTrade.recoverySide1=recoverySide1;autoTrade.recoverySide2=recoverySide2;
  autoTrade.sessionProfit=0;autoTrade.wins=0;autoTrade.losses=0;autoTrade.settled=new Set();autoTrade.enabled=true;autoTrade.armed=true;autoTrade.lastDigit=null;autoTrade.startedAt=Date.now();
  autoTradeLog("Bot started on "+state.symbol+" · "+state.selectedSide+" "+state.selectedDigit+" · entry digits "+(manualEntriesEnabled?"MANUAL":"AUTOMATIC")+" · stake "+stake+" "+autoTrade.currency+" · recovery "+(recoveryEnabled?"ON":"OFF")+" · mode "+(recoveryMode==="SMART_NET"?"SMART NET (base stake, combined P/L)":"CLASSIC (multiplier and custom recovery digits)")+".");
  autoTradeRender();
}
function autoTradeReadyToEnter(digit){
  if(!autoTrade.enabled||!autoTrade.authorized||!state.connected||!state.lastTickAt||Date.now()-state.lastTickAt>15000)return {ok:false,reason:"live data disconnected or stale"};
  const manualEntriesEnabled=!!$("autoTradeManualEntriesEnabled")?.checked;
  const signalIsCurrent=state.engine==="overunder"&&state.ouSignalSnapshot?.tickCount===state.digits.length&&state.ouSignalSnapshot?.key===ouValidationKey()&&!!state.ouSignalSnapshot?.active;
  const automaticEntryIsCurrent=manualEntriesEnabled||(state.symbol===state.ouEntrySnapshot?.key?.split("|")[0]&&!!state.ouEntrySnapshot?.active);
  // Manual digits use the same live Final Signal and risk gates, but must not depend on the automatic Entry Engine snapshot.
  if(!signalIsCurrent||!automaticEntryIsCurrent)return {ok:false,reason:"Final Signal or required entry validation is not valid"};
  const risk=spikeRiskAssessment();
  if(risk.level==="UNKNOWN"||risk.level==="HIGH")return {ok:false,reason:risk.title};
  if(risk.level==="MODERATE"&&state.ouSignalSnapshot.signal!=="STRONG SIGNAL")return {ok:false,reason:"moderate spike risk requires STRONG SIGNAL"};
  const selectedEntries=autoTradeEntrySelection();
  if((manualEntriesEnabled?(selectedEntries.length<1||selectedEntries.length>2):(selectedEntries.length!==2))||new Set(selectedEntries).size!==selectedEntries.length)return {ok:false,reason:manualEntriesEnabled?"neither manual digit currently passes the red/green distribution-bar rule":"exactly two distinct validated entry digits are required"};
  if(!selectedEntries.includes(digit))return {ok:false,reason:manualEntriesEnabled?"digit is not an eligible manual entry digit":"digit is not a current Entry Engine candidate"};
  return {ok:true};
}
function processAutoTradeTick(digit){
  if(!autoTrade.enabled)return;
  // Resume an already-approved sequence after the live analysis stream recovers; do not reinterpret it as a new entry.
  if(autoTrade.waitingForFreshData&&autoTrade.runSymbol&&autoTrade.runRemaining&&state.connected&&Date.now()-state.lastTickAt<=15000){
    autoTrade.waitingForFreshData=false;
    autoTradeLog("LIVE DATA RESTORED · resuming the pending "+(autoTrade.recoveryPhase>0?"RECOVERY "+autoTrade.recoveryPhase:"contract")+" for the existing entry sequence.");
    autoTradePlaceNext();
    return;
  }
  // Lock one entry sequence until its contracts settle and the sequence is explicitly completed.
  // Never let a fresh tick overwrite runSymbol/runSettled while a quote or contract is in flight.
  if(autoTrade.runSymbol||Object.keys(autoTrade.pendingBuyQuotes).length||Object.keys(autoTrade.activeContracts).length)return;
  // After a full two-run cycle, enforce a short cooldown. Ticks during the cooldown are
  // observed but cannot start trades; only a new live entry-digit hit after the cooldown can.
  if(Date.now()<autoTrade.nextEntryAllowedAt){autoTrade.lastDigit=digit;return}
  const manualEntriesEnabled=!!$("autoTradeManualEntriesEnabled")?.checked;
  const candidates=autoTradeEntrySelection();
  if(!candidates.includes(digit)){
    if(manualEntriesEnabled&&[$("autoTradeManualDigit1")?.value,$("autoTradeManualDigit2")?.value].some(raw=>String(raw??"").trim()!==""&&Number(raw)===digit)){
      const reason=autoTrade.lastManualBlockReason||"manual digits are not currently eligible under the red/green distribution-bar rule";
      if(autoTrade.lastManualLoggedReason!==reason){autoTradeLog("Manual entry waiting · "+reason);autoTrade.lastManualLoggedReason=reason;}
    }else if(manualEntriesEnabled&&candidates.length===2){autoTrade.lastManualLoggedReason="";}
    autoTrade.armed=true;autoTrade.lastDigit=digit;return
  }
  autoTrade.lastManualLoggedReason="";
  if(!autoTrade.armed){autoTrade.lastDigit=digit;return}
  const check=autoTradeReadyToEnter(digit);
  if(!check.ok){autoTradeLog("Entry blocked · "+check.reason);autoTrade.lastDigit=digit;return}
  autoTrade.armed=false;autoTrade.lastDigit=digit;autoTrade.runRemaining=1;autoTrade.runSettled=0;autoTrade.runSymbol=state.symbol;autoTrade.runDigit=digit;autoTrade.runSide=state.selectedSide;autoTrade.runSelectedDigit=state.selectedDigit;if(autoTrade.recoveryMode!=="SMART_NET")autoTrade.recoveryPhase=0;autoTrade.recoveryPairProfit=0;
  autoTradeLog("ENTRY TRIGGER · "+state.symbol+" digit "+digit+" · "+state.selectedSide+" "+state.selectedDigit+" · starting the two-run entry cycle at base stake.");
  autoTradePlaceNext();
}
function autoTradePlaceNext(){
  if(!autoTrade.enabled||!autoTrade.authorized||!autoTrade.runRemaining)return;
  if(state.symbol!==autoTrade.runSymbol){autoTradePause("selected market changed");return}
  const isRecovery=autoTrade.recoveryPhase>0;
  const isSmartRecovery=autoTrade.recoveryMode==="SMART_NET"&&autoTrade.recoveryEnabled&&autoTrade.recoveryBalance>0;
  if(!isRecovery&&(state.selectedSide!==autoTrade.runSide||state.selectedDigit!==autoTrade.runSelectedDigit)){autoTradePause("selected Over/Under setup changed");return}
  if(!state.connected||Date.now()-state.lastTickAt>15000){if(!autoTrade.waitingForFreshData)autoTradeLog("LIVE DATA STALE · holding the pending "+(isRecovery?"RECOVERY "+autoTrade.recoveryPhase:"contract")+" until fresh ticks resume; no new contract submitted.");autoTrade.waitingForFreshData=true;return}
  // Validate the live signal only before run 1. Run 2 belongs to the already-approved entry trigger and must not be cancelled just because the signal changes after run 1 settles.
  if(!isRecovery&&autoTrade.runSettled===0&&(state.engine!=="overunder"||state.ouSignalSnapshot?.tickCount!==state.digits.length||!state.ouSignalSnapshot?.active||state.ouSignalSnapshot.key!==ouValidationKey())){autoTradePause("Over/Under signal no longer qualifies before the first contract");return}
  if(autoTrade.sessionProfit>=autoTrade.takeProfit){autoTradePause("take-profit limit reached");return}
  if(autoTrade.sessionProfit<=-autoTrade.stopLoss){autoTradePause("stop-loss limit reached");return}
  const stake=Math.max(0.35,Math.min(100,autoTrade.recoveryMode==="SMART_NET"?autoTrade.stake:(Number(autoTrade.nextStake)||autoTrade.stake)));
  const side=autoTrade.recoveryMode==="SMART_NET"?autoTrade.runSide:(isRecovery?(autoTrade.recoveryPhase===1?(autoTrade.recoverySide1==="DEFAULT"?autoTrade.runSide:autoTrade.recoverySide1):(autoTrade.recoverySide2==="DEFAULT"?(autoTrade.runSide==="OVER"?"UNDER":"OVER"):autoTrade.recoverySide2)):autoTrade.runSide);
  const digit=autoTrade.recoveryMode==="SMART_NET"?autoTrade.runSelectedDigit:(isRecovery?(autoTrade.recoveryPhase===1?autoTrade.recoveryDigit1:autoTrade.recoveryDigit2):autoTrade.runSelectedDigit);
  const parameters={amount:Number(stake.toFixed(2)),basis:"stake",contract_type:side==="OVER"?"DIGITOVER":"DIGITUNDER",currency:autoTrade.currency,duration:1,duration_unit:"t",underlying_symbol:autoTrade.runSymbol,barrier:String(digit)};
  try{const reqId=autoTradeReq({proposal:1,...parameters},"proposal");autoTrade.pendingBuyQuotes[reqId]=parameters;autoTradeLog("Requesting "+(isRecovery?"RECOVERY "+autoTrade.recoveryPhase:"BASE")+" · "+side+" "+digit+" · stake "+stake.toFixed(2)+" "+autoTrade.currency+".")}
  catch(e){autoTradePause("proposal request failed: "+e.message)}
}
function autoTradeRunDemoTradeTest(){
  if(!autoTrade.authorized||!autoTrade.account||!autoTrade.account.is_virtual){autoTradeLog("DEMO TEST BLOCKED · connect a DEMO account first. Real-account test orders are not allowed.");return}
  if(!autoTrade.socket||autoTrade.socket.readyState!==WebSocket.OPEN){autoTradeLog("DEMO TEST BLOCKED · authenticated trading connection is not open.");return}
  if(autoTrade.enabled||autoTrade.demoTestActive||Object.keys(autoTrade.activeContracts).length){autoTradeLog("DEMO TEST BLOCKED · stop the bot and wait for any open contract to settle first.");return}
  if(typeof confirm==="function"&&!confirm("Place exactly ONE demo contract for 0.35 "+autoTrade.currency+"? This is a real demo purchase and may lose the stake. No follow-up or recovery trade will be placed.")){autoTradeLog("One-contract demo test cancelled. No trade was placed.");return}
  const side=state.selectedSide==="UNDER"?"UNDER":"OVER";
  const selectedDigit=Number(state.selectedDigit);
  const digit=side==="OVER"?Math.max(0,Math.min(8,Number.isInteger(selectedDigit)?selectedDigit:1)):Math.max(1,Math.min(9,Number.isInteger(selectedDigit)?selectedDigit:8));
  autoTrade.demoTestActive=true;autoTrade.demoTestContractId=null;autoTrade.demoTestSide=side;autoTrade.demoTestDigit=digit;autoTrade.demoTestSymbol=state.symbol;
  autoTrade.demoTestPendingParameters={amount:0.35,basis:"stake",contract_type:side==="OVER"?"DIGITOVER":"DIGITUNDER",currency:autoTrade.currency,duration:1,duration_unit:"t",underlying_symbol:state.symbol,barrier:String(digit)};
  try{
    autoTradeReq({proposal:1,...autoTrade.demoTestPendingParameters},"demo_test_proposal");
    autoTradeLog("ONE-CONTRACT DEMO TEST · requesting "+side+" "+digit+" on "+state.symbol+" for 0.35 "+autoTrade.currency+". No recovery or repeat trade.");
  }catch(e){autoTrade.demoTestActive=false;autoTradeLog("Demo test request failed: "+(e.message||e))}
}
function autoTradeRunProposalTest(){
  if(!autoTrade.authorized||!autoTrade.socket||autoTrade.socket.readyState!==WebSocket.OPEN){autoTradeLog("Proposal test skipped: authenticated bot connection is not open.");return}
  const side=state.selectedSide==="UNDER"?"UNDER":"OVER";
  const selectedDigit=Number(state.selectedDigit);
  const digit=side==="OVER"?Math.max(0,Math.min(8,Number.isInteger(selectedDigit)?selectedDigit:1)):Math.max(1,Math.min(9,Number.isInteger(selectedDigit)?selectedDigit:8));
  const stake=Math.max(0.35,Math.min(100,Number(autoTrade.stake)||0.35));
  const req={proposal:1,amount:Number(stake.toFixed(2)),basis:"stake",contract_type:side==="OVER"?"DIGITOVER":"DIGITUNDER",currency:autoTrade.currency,duration:1,duration_unit:"t",underlying_symbol:state.symbol,barrier:String(digit)};
  try{
    autoTradeReq(req,"proposal_test");
    autoTradeLog("READ-ONLY PROPOSAL TEST · requesting a "+side+" "+digit+" quote on "+state.symbol+" · "+stake.toFixed(2)+" "+autoTrade.currency+". No buy request will be sent.");
  }catch(e){autoTradeLog("Proposal test could not be sent: "+(e.message||e))}
}
function autoTradeHandleMessage(d){
  if(d.error){
    const kind=autoTrade.requests[d.req_id];delete autoTrade.requests[d.req_id];
    autoTradeLog("Deriv API error"+(d.error.code?" ["+d.error.code+"]":"")+": "+(d.error.message||"Request failed"));
    if(kind==="proposal_test")autoTradeLog("PROPOSAL TEST FAILED · quote rejected. No trade was placed.");
    if(kind==="demo_test_proposal"){autoTrade.demoTestActive=false;autoTrade.demoTestContractId=null;autoTradeLog("DEMO TEST PROPOSAL FAILED · Deriv rejected the quote request; no buy request was sent.");}
    if(kind==="demo_test_buy"){autoTrade.demoTestActive=false;autoTrade.demoTestContractId=null;autoTradeLog("DEMO TEST BUY FAILED · Deriv rejected the proposal ID at purchase time; no second buy request will be attempted. Check the error code above.");}
    if(kind==="authorize"){autoTrade.authorized=false;autoTrade.account=null;autoTradeStatus("AUTH FAILED")}
    if(kind==="proposal")delete autoTrade.pendingBuyQuotes[d.req_id];
    if(kind==="proposal"||kind==="buy")autoTradePause("Deriv rejected a trade request");
    if(kind==="open_contract")autoTradePause("contract tracking failed after purchase; check Deriv contract history");
    autoTradeRender();return;
  }
  const kind=autoTrade.requests[d.req_id];if(kind)delete autoTrade.requests[d.req_id];
  if(d.balance){
    const accountId=autoTrade.account?.accountId||autoTrade.account?.loginid;
    if(accountId){autoTrade.accountBalances[accountId]={status:"loaded",balance:Number(d.balance.balance),currency:d.balance.currency||autoTrade.currency};autoTradeRenderBalances()}
  }
  if(kind==="connection_test"&&d.balance){
    autoTradeLog("BOT CONNECTION TEST PASSED · authenticated account responded. No trade was placed.");
    autoTradeRunProposalTest();autoTradeRender();return
  }
  if(kind==="connection_test"&&!d.balance){autoTradeLog("Connection is open, but the account test response was not recognized. No trade was placed.");autoTradeRender();return}
  if(kind==="proposal_test"){
    if(d.proposal)autoTradeLog("PROPOSAL TEST PASSED · Deriv returned a valid quote for "+(d.proposal.longcode||d.proposal.contract_type||"the requested contract")+". Ask price: "+(d.proposal.ask_price??"not supplied")+" "+autoTrade.currency+". Quote only — no buy request was sent.");
    else autoTradeLog("PROPOSAL TEST RESPONSE RECEIVED, but no proposal quote was present. No trade was placed.");
    autoTradeRender();return
  }
  if(kind==="authorize"&&d.authorize){
    autoTrade.account={loginid:d.authorize.loginid,is_virtual:Number(d.authorize.is_virtual)===1};
    autoTrade.currency=d.authorize.currency||"USD";autoTrade.authorized=true;autoTrade.nextStake=autoTrade.stake;
    $("autoTradeToken").value="";
    autoTradeLog("Account authorized · "+autoTrade.account.loginid+" · "+(autoTrade.account.is_virtual?"DEMO":"REAL")+" · "+autoTrade.currency+".");
    if(!autoTrade.account.is_virtual)autoTradeLog("Real account detected. Trading stays locked until the in-panel confirmation is completed.");
    autoTradeRender();return;
  }
  if(kind==="demo_test_proposal"){
    if(!d.proposal){autoTrade.demoTestActive=false;autoTradeLog("ONE-CONTRACT DEMO TEST FAILED · no quote returned; no purchase sent.");autoTradeRender();return}
    if(!d.proposal.id||d.proposal.ask_price===undefined||d.proposal.ask_price===null){autoTrade.demoTestActive=false;autoTradeLog("DEMO TEST FAILED · quote response omitted its proposal ID or ask price; no purchase sent.");autoTradeRender();return}
    autoTradeLog("Demo quote received · sending one direct-parameter purchase with Deriv’s quoted maximum price.");
    try{const parameters=autoTrade.demoTestPendingParameters;if(!parameters)throw new Error("The matching demo-test contract parameters were not saved.");autoTradeReq({buy:"1",parameters:{...parameters},price:Number(d.proposal.ask_price)},"demo_test_buy")}
    catch(e){autoTrade.demoTestActive=false;autoTradeLog("Demo purchase request could not be sent: "+(e.message||e))}
    autoTradeRender();return;
  }
  if(kind==="proposal"&&d.proposal){
    try{
      const parameters=autoTrade.pendingBuyQuotes[d.req_id];
      if(!parameters)throw new Error("The matching contract parameters for this quote were not found.");
      delete autoTrade.pendingBuyQuotes[d.req_id];
      if(!autoTrade.enabled||!autoTrade.runSymbol){autoTradeLog("Quote ignored because the bot was paused before the quote arrived; no buy request was sent.");return}
      autoTradeReq({buy:"1",parameters:{...parameters},price:Number(d.proposal.ask_price)},"buy");
      autoTradeLog("Quote accepted · submitting the documented direct-parameter buy request at the quoted maximum price.");
    }catch(e){autoTradePause("buy request failed: "+e.message)}
    return;
  }
  if(kind==="proposal"&&!d.proposal){autoTradePause("proposal response contained no quote; no buy request was sent");return}
  if((kind==="buy"||kind==="demo_test_buy")&&!d.buy){if(kind==="demo_test_buy"){autoTrade.demoTestActive=false;autoTradeLog("DEMO TEST BUY RESPONSE INVALID · check Deriv contract history before trying again.");autoTradeRender()}else autoTradePause("buy response contained no contract details; check Deriv contract history");return}
  if(kind==="open_contract"&&!d.proposal_open_contract){autoTradePause("contract tracking response was not recognized; check Deriv contract history");return}
  if((kind==="buy"||kind==="demo_test_buy")&&d.buy){
    const id=String(d.buy.contract_id);
    if(kind==="demo_test_buy")autoTrade.demoTestContractId=id;
    autoTrade.activeContracts[id]={symbol:kind==="demo_test_buy"?autoTrade.demoTestSymbol:autoTrade.runSymbol,stake:Number(d.buy.buy_price)||(kind==="demo_test_buy"?0.35:autoTrade.nextStake)};
    autoTradeLog((kind==="demo_test_buy"?"ONE DEMO CONTRACT PURCHASED":"Contract purchased")+" · #"+id+". "+(kind==="demo_test_buy"?"Tracking settlement; no second trade will be placed.":""));
    try{autoTradeReq({proposal_open_contract:1,contract_id:Number(id),subscribe:1},"open_contract")}
    catch(e){if(kind==="demo_test_buy"){autoTrade.demoTestActive=false;autoTradeLog("Demo contract bought but tracking failed. Check Deriv contract history; do not retry until verified.")}autoTradePause("contract tracking failed: "+e.message)}
    return;
  }
  if(d.msg_type==="proposal_open_contract"&&d.proposal_open_contract){
    const c=d.proposal_open_contract,id=String(c.contract_id);
    if(!c.is_sold||autoTrade.settled.has(id))return;
    autoTrade.settled.add(id);
    const profit=Number(c.profit)||0;autoTrade.sessionProfit+=profit;
    if(autoTrade.demoTestActive&&id===String(autoTrade.demoTestContractId)){
      if(c.subscription?.id){try{autoTradeReq({forget:c.subscription.id},"forget")}catch{}}
      delete autoTrade.activeContracts[id];autoTrade.demoTestActive=false;autoTrade.runRemaining=0;
      if(profit>=0){autoTrade.wins++;autoTradeLog("ONE-CONTRACT DEMO TEST SETTLED · WIN · "+profit.toFixed(2)+" "+autoTrade.currency+". Test finished; no further trade will be placed.")}
      else{autoTrade.losses++;autoTradeLog("ONE-CONTRACT DEMO TEST SETTLED · LOSS · "+profit.toFixed(2)+" "+autoTrade.currency+". Test finished; no further trade will be placed.")}
      autoTradeRender();return;
    }
    const wasRecovery=autoTrade.recoveryPhase;
    const settledStake=Number(autoTrade.activeContracts[id]?.stake)||Number(autoTrade.nextStake)||autoTrade.stake;
    if(c.subscription?.id){try{autoTradeReq({forget:c.subscription.id},"forget")}catch{}}
    delete autoTrade.activeContracts[id];
    let runFinished=false;
    if(autoTrade.recoveryMode==="SMART_NET"){
      // Smart Net mode always completes both contracts for the same trigger at base stake.
      // Only the combined settled P/L of the pair changes the outstanding recovery balance.
      if(profit>=0){autoTrade.wins++}else{autoTrade.losses++}
      autoTrade.recoveryPairProfit=Number((autoTrade.recoveryPairProfit+profit).toFixed(2));
      autoTrade.nextStake=autoTrade.stake;
      runFinished=true;
      if(autoTrade.runSettled===1){
        const pairNet=autoTrade.recoveryPairProfit;
        // Smart Net is unconditional in SMART_NET mode, regardless of the Classic toggle.
        autoTrade.recoveryBalance=Number(Math.max(0,autoTrade.recoveryBalance-pairNet).toFixed(2));
        autoTrade.recoveryPhase=autoTrade.recoveryBalance>0?1:0;
        autoTradeLog("TWO-RUN NET RESULT · "+(pairNet>=0?"+":"")+pairNet.toFixed(2)+" "+autoTrade.currency+" · outstanding Smart Net recovery "+autoTrade.recoveryBalance.toFixed(2)+" "+autoTrade.currency+". "+(autoTrade.recoveryBalance>0?"Wait for a fresh qualified entry digit; next pair stays at base stake.":"Smart Net balance cleared; normal entries continue."));
        autoTrade.recoveryPairProfit=0;
      }else{
        autoTradeLog((profit>=0?"RUN 1 CONTRACT SETTLED WIN":"RUN 1 CONTRACT SETTLED LOSS")+" · "+profit.toFixed(2)+" "+autoTrade.currency+" · completing the second contract before calculating the pair result.");
      }
    }else if(profit>=0){
      autoTrade.wins++;autoTrade.recoveryPhase=0;autoTrade.nextStake=autoTrade.stake;
      autoTradeLog("SETTLED WIN · "+profit.toFixed(2)+" "+autoTrade.currency+". Current run's recovery progression reset.");
      runFinished=true;
    }else{
      autoTrade.losses++;
      if(!autoTrade.recoveryEnabled){
        autoTrade.recoveryPhase=0;autoTrade.nextStake=autoTrade.stake;runFinished=true;
        autoTradeLog("SETTLED LOSS · "+profit.toFixed(2)+" "+autoTrade.currency+" · recovery OFF; this attempt is finished at base stake. Continuing the two-run entry cycle unless a session limit is reached.");
      }
      if(wasRecovery<2){
        autoTrade.recoveryPhase=wasRecovery+1;
        autoTrade.nextStake=Number((settledStake*autoTrade.martingale).toFixed(2));
        autoTradeLog((wasRecovery===0?"BASE ATTEMPT LOST":("RECOVERY "+wasRecovery+" LOST"))+" · next attempt is RECOVERY "+autoTrade.recoveryPhase+" at "+autoTrade.nextStake.toFixed(2)+" "+autoTrade.currency+".");
      }else{
        autoTradeLog("RECOVERY 2 LOST · this run's recovery attempts are exhausted.");
        autoTrade.recoveryPhase=0;autoTrade.nextStake=autoTrade.stake;runFinished=true;
      }
    }
    if(autoTrade.sessionProfit>=autoTrade.takeProfit){autoTradePause("take-profit limit reached");return}
    if(autoTrade.sessionProfit<=-autoTrade.stopLoss){autoTradePause("stop-loss limit reached");return}
    autoTrade.runRemaining=0;
    if(autoTrade.enabled){
      if(runFinished){
        if(autoTrade.runSettled===0){
          autoTrade.runSettled=1;autoTrade.recoveryPhase=0;autoTrade.nextStake=autoTrade.stake;
          autoTradeLog("RUN 1 COMPLETE · starting RUN 2 at the base stake for the same entry trigger.");
        }else{
          autoTrade.runSettled=2;
          autoTrade.runSymbol="";if(autoTrade.recoveryMode!=="SMART_NET")autoTrade.recoveryPhase=0;autoTrade.nextStake=autoTrade.stake;autoTrade.recoveryPairProfit=0;autoTrade.armed=true;
          autoTrade.nextEntryAllowedAt=Date.now()+autoTrade.entryCooldownMs;
          autoTrade.lastDigit=state.digits.length?state.digits[state.digits.length-1]:autoTrade.lastDigit;
          autoTradeLog("RUN 2 COMPLETE · two-run entry finished. Cooling down for 5 seconds; then waiting for a fresh live entry-digit hit.");
        }
      }
      if(autoTrade.runSettled<2){
        autoTrade.runRemaining=1;autoTradeRender();autoTradePlaceNext();
      }else{
        // Ticks received before this cycle completed cannot become delayed entry triggers.
        // The next entry must be confirmed by a new live tick after the two-run cycle ends.
        const waitingTicks=autoTrade.fastTickQueue.length;
        autoTrade.fastTickQueue.length=0;
        autoTradeRender();
        if(waitingTicks&&autoTrade.speedMode==="FAST")autoTradeLog("FAST EXECUTION · accounted for live ticks during the completed run; cleared "+waitingTicks+" pre-completion ticks so none can cause a delayed/duplicate entry. Waiting for a fresh live entry-digit hit.");
      }
    }else{autoTradeRender()}
  }}
function autoTradeChooseAccount(choices){
  const host=$("autoTradeAccountChooser"),connectButton=$("autoTradeConnect");
  if(!host)return Promise.reject(new Error("Account selection panel is unavailable. Reload Maven FX and reconnect."));
  host.replaceChildren();
  const heading=document.createElement("strong");heading.className="account-chooser-title";heading.textContent="CHOOSE AN ACCOUNT";host.appendChild(heading);
  const note=document.createElement("small");note.textContent="Tap Demo for testing. Real-account trading stays locked until you complete the separate confirmation.";host.appendChild(note);
  const list=document.createElement("div");list.className="account-choice-list";host.appendChild(list);
  return new Promise(resolve=>{
    let finished=false;
    const finish=value=>{if(finished)return;finished=true;host.hidden=true;host.replaceChildren();if(connectButton)connectButton.disabled=false;resolve(value)};
    for(const account of choices){
      const button=document.createElement("button");button.type="button";button.className="account-choice"+(account.demo?" demo":" real");
      const title=document.createElement("strong");title.textContent=account.demo?"DEMO ACCOUNT":"REAL ACCOUNT";
      const detail=document.createElement("span");detail.textContent=(account.id||"Account ID unavailable")+" · "+(account.currency||"currency");
      const action=document.createElement("small");action.textContent=account.demo?"Recommended for testing":"Real money · extra confirmation required";
      button.append(title,detail,action);button.addEventListener("click",()=>finish(account));list.appendChild(button);
    }
    const cancel=document.createElement("button");cancel.type="button";cancel.className="account-choice-cancel";cancel.textContent="CANCEL";cancel.addEventListener("click",()=>finish(null));host.appendChild(cancel);
    host.hidden=false;if(connectButton)connectButton.disabled=true;
    host.scrollIntoView({behavior:"smooth",block:"nearest"});
  });
}
async function autoTradeConnect(){
  const token=$("autoTradeToken").value.trim()||(function(){try{return localStorage.getItem("mavenFxDerivApiToken")||""}catch{return ""}})();
  if(!token){autoTradeLog("Enter your Deriv Personal Access Token in this popup. Never paste it into chat.");return}
  const appId="34Fh3HjvIt4cTAcccHVi2";
  if($("autoTradeRemember").checked){try{localStorage.setItem("mavenFxDerivApiToken",token)}catch{autoTradeLog("Could not save token in this browser; connect for this session only.")}}
  else{try{localStorage.removeItem("mavenFxDerivApiToken")}catch{}}
  if(autoTrade.tradingHeartbeatTimer){clearInterval(autoTrade.tradingHeartbeatTimer);autoTrade.tradingHeartbeatTimer=null}
  if(autoTrade.socket){try{autoTrade.socket.onclose=null;autoTrade.socket.onerror=null;autoTrade.socket.close()}catch{}}
  autoTrade.enabled=false;autoTrade.authorized=false;autoTrade.account=null;autoTrade.requests={};
  autoTradeStatus("AUTHENTICATING");
  autoTradeLog("Checking PAT and retrieving available Options accounts…");
  const headers={"Authorization":"Bearer "+token,"Deriv-App-ID":appId,"Content-Type":"application/json"};
  try{
    const response=await fetch("https://api.derivws.com/trading/v1/options/accounts",{method:"GET",headers});
    let payload={};try{payload=await response.json()}catch{}
    if(!response.ok)throw new Error(payload?.errors?.[0]?.message||payload?.error?.message||("Accounts request failed (HTTP "+response.status+"). Check the PAT and App ID."));
    const accounts=Array.isArray(payload.data)?payload.data:(Array.isArray(payload.data?.accounts)?payload.data.accounts:(Array.isArray(payload.accounts)?payload.accounts:[]));
    if(!accounts.length)throw new Error("No Options accounts were returned for this PAT. Check that it has the trade scope and that your account has Options access.");
    const accountLabel=a=>{
      const id=a.account_id||a.id||a.loginid||a.accountId;
      const type=String(a.account_type||a.type||a.account_type_name||"").toLowerCase();
      const demo=type.includes("demo")||type.includes("virtual")||String(id||"").toUpperCase().startsWith("VRTC");
      return {id:String(id||""),raw:a,demo,currency:a.currency||a.currency_code||"USD",label:(demo?"DEMO":"REAL")+" · "+(id||"Account ID unavailable")+" · "+(a.currency||a.currency_code||"currency")};
    };
    const choices=accounts.map(accountLabel).filter(a=>a.id);
    autoTrade.availableAccounts=choices.map(a=>({id:a.id,demo:a.demo,currency:a.currency,label:a.label}));
    autoTrade.accountBalances={};
    autoTradeRenderBalances();
    if(!choices.length)throw new Error("Deriv returned accounts, but no account IDs were found. No connection was made.");
    const chosen=await autoTradeChooseAccount(choices);
    if(!chosen){autoTradeStatus("DISCONNECTED");autoTradeLog("Account selection cancelled.");return}
    autoTradeLog("Requesting a short-lived connection URL for "+chosen.label+"…");
    const otpResponse=await fetch("https://api.derivws.com/trading/v1/options/accounts/"+encodeURIComponent(chosen.id)+"/otp",{method:"POST",headers});
    let otpPayload={};try{otpPayload=await otpResponse.json()}catch{}
    if(!otpResponse.ok)throw new Error(otpPayload?.errors?.[0]?.message||otpPayload?.error?.message||("Could not prepare account connection (HTTP "+otpResponse.status+")."));
    const wsUrl=otpPayload?.data?.url||otpPayload?.url;
    if(typeof wsUrl!=="string"||!wsUrl.startsWith("wss://api.derivws.com/trading/v1/options/ws/"))throw new Error("Deriv did not return a valid authenticated WebSocket URL.");
    autoTrade.account={loginid:chosen.id,accountId:chosen.id,is_virtual:chosen.demo,currency:chosen.currency,account_type:chosen.demo?"demo":"real"};
    autoTrade.currency=chosen.currency;autoTrade.nextStake=autoTrade.stake;
    let ws;
    try{ws=new WebSocket(wsUrl);autoTrade.socket=ws}catch(e){throw new Error("Could not open the authenticated trading WebSocket: "+(e.message||e))}
    autoTradeStatus("CONNECTING");
    autoTradeLog("Opening authenticated "+(chosen.demo?"DEMO":"REAL")+" trading connection…");
    let settled=false;
    const timeout=setTimeout(()=>{if(!settled&&autoTrade.socket===ws){settled=true;try{ws.close()}catch{}autoTrade.authorized=false;autoTradeStatus("CONNECTION FAILED");autoTradeLog("Trading connection timed out. Reconnect and try again.")}},12000);
    ws.onopen=()=>{
      if(settled)return;settled=true;clearTimeout(timeout);
      autoTrade.authorized=true;autoTradeStatus("CONNECTED");
      $("autoTradeToken").value="";
      autoTradeLog("Authenticated trading connection opened · "+chosen.label+".");
      // Keep the separate trading socket alive even while the bot is waiting for an entry digit.
      // This heartbeat does not touch the analysis WebSocket or initiate any trade.
      if(autoTrade.tradingHeartbeatTimer)clearInterval(autoTrade.tradingHeartbeatTimer);
      autoTrade.tradingHeartbeatTimer=setInterval(()=>{
        if(autoTrade.socket!==ws||ws.readyState!==WebSocket.OPEN){clearInterval(autoTrade.tradingHeartbeatTimer);autoTrade.tradingHeartbeatTimer=null;return}
        try{ws.send(JSON.stringify({ping:1}))}catch(e){autoTradeLog("Trading heartbeat send failed: "+(e.message||e));try{ws.close()}catch{}}
      },15000);
      if(!chosen.demo)autoTradeLog("REAL account selected. Trading remains locked until the in-panel TRADE REAL confirmation is completed.");
      try{autoTradeReq({balance:1},"connection_test");autoTradeLog("Checking authenticated account response (no trade will be placed)…")}catch(e){autoTradeLog("Connection test could not be sent: "+(e.message||e))}
      autoTradeRender();
    };
    ws.onmessage=e=>{try{autoTradeHandleMessage(JSON.parse(e.data))}catch(err){autoTradeLog("Trading response handling error: "+(err.message||err))}};
    ws.onerror=()=>{if(!settled){clearTimeout(timeout);settled=true;autoTrade.authorized=false;autoTradeStatus("CONNECTION FAILED");autoTradeLog("Authenticated WebSocket failed to open. Check network access and reconnect.")}else autoTradeLog("Trading WebSocket reported a network error.")};
    ws.onclose=()=>{clearTimeout(timeout);if(autoTrade.tradingHeartbeatTimer){clearInterval(autoTrade.tradingHeartbeatTimer);autoTrade.tradingHeartbeatTimer=null}if(autoTrade.socket===ws){autoTrade.authorized=false;if(autoTrade.enabled)autoTradePause("trading connection closed");autoTradeStatus("DISCONNECTED");autoTradeRender();autoTradeLog("Trading WebSocket closed. Reconnect before starting the bot.")}};
    autoTradeFetchOtherBalances(token,headers,choices,chosen.id);
  }catch(e){
    autoTrade.authorized=false;autoTrade.account=null;autoTradeStatus("CONNECTION FAILED");
    autoTradeLog("PAT connection failed: "+(e.message||e));
    autoTradeRender();
  }
}
function autoTradeDisconnect(){
  if(autoTrade.tradingHeartbeatTimer){clearInterval(autoTrade.tradingHeartbeatTimer);autoTrade.tradingHeartbeatTimer=null}
  autoTradePause("manual disconnect");autoTrade.authorized=false;autoTrade.account=null;
  if(autoTrade.socket){try{autoTrade.socket.close()}catch{}autoTrade.socket=null}
  autoTradeStatus("DISCONNECTED");autoTradeRender();autoTradeLog("Disconnected. Any already-purchased contract may still settle on Deriv.");
}
(function setupAutoTrade(){
  const fab=$("autoTradeFab"),modal=$("autoTradeModal"),close=$("closeAutoTrade");
  if(!fab||!modal||!close)return;
  const open=()=>{modal.classList.add("open");modal.setAttribute("aria-hidden","false");fab.setAttribute("aria-expanded","true");document.body.style.overflow="hidden";autoTradeRender();close.focus()};
  const shut=()=>{modal.classList.remove("open");modal.setAttribute("aria-hidden","true");fab.setAttribute("aria-expanded","false");document.body.style.overflow="";fab.focus()};
  fab.addEventListener("click",open);close.addEventListener("click",shut);
  modal.querySelectorAll("[data-close-trade]").forEach(x=>x.addEventListener("click",shut));
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal.classList.contains("open"))shut()});
  $("autoTradeConnect").addEventListener("click",autoTradeConnect);
  $("autoTradeDisconnect").addEventListener("click",autoTradeDisconnect);
  $("autoTradeStart").addEventListener("click",autoTradeStart);
  $("autoTradeSpeedToggle").addEventListener("click",()=>autoTradeSetSpeedMode(autoTrade.speedMode==="FAST"?"STANDARD":"FAST"));
  const demoTestButton=document.createElement("button");
  demoTestButton.type="button";demoTestButton.id="autoTradeDemoOneShotTest";demoTestButton.className=$("autoTradeStart").className;demoTestButton.textContent="One-contract DEMO test";demoTestButton.style.marginTop="8px";demoTestButton.addEventListener("click",autoTradeRunDemoTradeTest);
  $("autoTradeStart").parentElement.insertBefore(demoTestButton,$("autoTradeStart").nextSibling);
  $("autoTradeStop").addEventListener("click",()=>autoTradePause("paused by user"));
  $("autoTradeRealCheck").addEventListener("change",()=>{autoTradeRender()});
  $("autoTradeRealPhrase").addEventListener("input",()=>{autoTradeRender()});
  const savedToken=(()=>{try{return localStorage.getItem("mavenFxDerivApiToken")||""}catch{return ""}})();
  if(savedToken){$("autoTradeToken").value=savedToken;$("autoTradeRemember").checked=true}
  $("autoTradeRemember").addEventListener("change",()=>{if(!$("autoTradeRemember").checked){try{localStorage.removeItem("mavenFxDerivApiToken")}catch{}}});
  const syncRecoveryFields=()=>{$("autoTradeRecoveryFields").hidden=!(($("autoTradeRecoveryMode")?.value||"SMART_NET")==="CLASSIC"&&$("autoTradeRecoveryEnabled").checked)};
  $("autoTradeRecoveryEnabled").addEventListener("change",syncRecoveryFields);
  $("autoTradeRecoveryMode").addEventListener("change",syncRecoveryFields);
  syncRecoveryFields();
  $("autoTradeManualEntriesEnabled").addEventListener("change",()=>{$("autoTradeManualEntryFields").hidden=!$("autoTradeManualEntriesEnabled").checked;autoTradeRender()});
  ["autoTradeManualDigit1","autoTradeManualDigit2"].forEach(id=>$(id).addEventListener("input",()=>autoTradeRender()));
  $("autoTradeRecoveryDigit1").value=String(state.selectedDigit);
  $("autoTradeRecoveryDigit1").addEventListener("focus",()=>{if(!$("autoTradeRecoveryDigit1").dataset.edited)$("autoTradeRecoveryDigit1").value=String(state.selectedDigit)});
  $("autoTradeRecoveryDigit1").addEventListener("input",()=>{$("autoTradeRecoveryDigit1").dataset.edited="1"});
  ["autoTradeStake","autoTradeMartingale","autoTradeTP","autoTradeSL"].forEach(id=>$(id).addEventListener("input",()=>{if(!autoTrade.enabled){autoTrade.stake=Number($("autoTradeStake").value)||0.35;autoTrade.nextStake=autoTrade.stake;autoTradeRender()}}));
  autoTradeRender();
})();
