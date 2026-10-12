function renderOverUnder(root,d,c,last,n){
  const e=overUnderEvidence(d,state.selectedDigit,state.selectedSide);
  const setup=state.selectedSide+" "+state.selectedDigit;
  const activeSignal=e.signal==="SIGNAL"||e.signal==="STRONG SIGNAL";
  const entry=activeSignal&&!e.probabilityConflict?overUnderEntry(d,state.selectedDigit,state.selectedSide):null;
  state.ouEntrySnapshot={key:ouValidationKey(),active:!!entry,digits:entry?entry.entries.map(x=>x.digit):[]};
  let reason;
  if(e.probabilityConflict)reason="Probability Comparison is blocking the selected setup because the complementary setup has stronger live probability evidence.";
  else if(e.signal==="AVOID")reason="The selected setup does not have enough aligned A-Setup evidence.";
  else if(e.signal==="WAIT")reason="The selected setup is still building enough independent evidence across the required analysis windows.";
  else if(e.signal==="STRONG SIGNAL")reason="Probability, momentum, trend, transitions, reaction behavior, recency, consistency and context are aligned for "+setup+".";
  else reason="The selected setup has sufficient multi-factor evidence, but the evidence is not strong enough for a STRONG SIGNAL.";
  const entryDisplay=activeSignal?(entry||{main:"NO VALID ENTRY",confidence:"—",status:"NO ENTRY",reason:"No candidate digit passed the required sample-size, transition, reaction and consistency checks.",evidence:"Candidate evaluation completed"}):{main:"NO ACTIVE ENTRY",confidence:"—",status:"INACTIVE",reason:"Entry Engine activates only when the selected Final Signal is SIGNAL or STRONG SIGNAL.",evidence:"Waiting for an active signal"};
  root.innerHTML=panel(e.signal,reason,entryDisplay,[
    "Selected setup: "+setup,
    "Probability Comparison: "+Math.round(e.selectedRate*100)+"% vs complement "+Math.round(e.oppositeRate*100)+"% • baseline "+Math.round(e.baseline*100)+"%",
    "Windows 20/50/100/250/500: "+[e.recentRate,e.short50,e.mediumRate,e.mid250,e.longRate].map(x=>Math.round(x*100)+"%").join(" / "),
    "A-Setup alignment: probability "+Math.round(e.probability*100)+" • momentum "+Math.round(e.momentum*100)+" • trend "+Math.round(e.trend*100)+" • transitions "+Math.round(e.transition*100),
    "Reaction "+Math.round(e.reaction*100)+" • clustering "+Math.round(e.cluster*100)+" • recency "+Math.round(e.recency*100)+" • consistency "+Math.round(e.consistency*100),
    "Historical "+Math.round(e.historical*100)+" • current context "+Math.round(e.context*100)+" • evidence "+Math.round(e.evidence*100),
    e.probabilityConflict?"× Complementary probability conflict — selected setup blocked":entry?"✓ Entry candidates "+entry.main+" passed historical reaction filters":"× Entry candidates remain inactive or did not pass validation",
    ouValidationSummary()
  ],n);
}
const WS_URLS=["wss://api.derivws.com/trading/v1/options/ws/public","wss://ws.binaryws.com/websockets/v3","wss://ws.binaryws.com/websockets/v3?app_id=1089","wss://ws.derivws.com/websockets/v3?app_id=1089"];
const MAX_TICKS=2000, STREAM_SIZE=80;
const state={socket:null,markets:[],symbol:"R_100",marketName:"R_100",pipSize:null,ticks:[],digits:[],engine:"overunder",selectedDigit:2,selectedSide:"OVER",selectedParity:"EVEN",selectedRiseFall:"RISE",connected:false,lastTickAt:0,reconnectTimer:null,reconnectDelay:1000,req:0,endpointIndex:0,connectTimer:null,marketStarted:false,lastMessage:"—",lastError:"—",ouValidation:{key:"",pending:[],completed:{1:{n:0,hits:0},2:{n:0,hits:0},3:{n:0,hits:0}},lastTrigger:"—"},ouValidationBook:{},ouPayoutPercent:95,ouEntrySnapshot:null,ouSignalSnapshot:null,deepScanner:{data:{},historyRequests:{},subscribeRequests:{},subscriptions:{},enabled:true,autoLoaded:false,manualOverride:false,startedAt:0,lastScanAt:0,lastLoadedSymbol:"",lastLoadedScore:0,lastSetupKey:"",switchAfter:0}};

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
    state.connected=true; state.reconnectDelay=1000; state.lastError="—";renderSubscribedMarketStatus("switching");
    setStatus("live","LIVE — testing R_100 feed");
    state.lastMessage="WebSocket OPEN";
    request({ping:1,req_id:nextReq()});
    request({active_symbols:"brief",req_id:nextReq()});
    startMarket(true);
  };
  ws.onmessage=e=>{try{const msg=JSON.parse(e.data);state.lastMessage=msg.msg_type||"unknown";if($("diagMessage"))$("diagMessage").textContent=state.lastMessage;if($("diagLastMessageAt"))$("diagLastMessageAt").textContent=new Date().toLocaleTimeString();handleMessage(msg)}catch(err){state.lastError=String(err.message||err);if($("diagError"))$("diagError").textContent=state.lastError;console.warn("Invalid WebSocket message",err)}};
  ws.onerror=()=>{
    clearTimeout(state.connectTimer);
    state.connected=false;
    state.lastError="Browser WebSocket error";
    setStatus("error","WebSocket error — switching endpoint");
  };
  ws.onclose=e=>{
    clearTimeout(state.connectTimer);
    state.connected=false;
    state.lastError=`Close ${e.code}${e.reason?": "+e.reason:""}${e.code===1006?" — abnormal close before a WebSocket close frame":""}`;renderSubscribedMarketStatus("switching");
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
  if(d.msg_type==="ping"){$("diagSocket").textContent="OPEN • PING OK";return}
  if(d.msg_type==="active_symbols")loadMarkets(d.active_symbols||[]);
  if(d.msg_type==="history"){
    const req=d.req_id, sym=req!=null?state.deepScanner.historyRequests[req]:null;
    if(sym){delete state.deepScanner.historyRequests[req];const rec=state.deepScanner.data[sym];if(rec){const prices=d.history?.prices||[],times=d.history?.times||[],pip=d.history?.pip_size??d.pip_size??rec.pipSize;rec.pipSize=pip;rec.ticks=prices.map((p,i)=>({quote:Number(p),epoch:times[i]||0})).filter(x=>Number.isFinite(x.quote)).slice(-MAX_TICKS);rec.digits=rec.ticks.map(x=>digitFromQuote(x.quote,rec.pipSize)).filter(Number.isInteger);rec.historyReady=true;rec.lastHistoryAt=Date.now();}renderDeepScanner();deepScannerEvaluate(false);return}
    loadHistory(d.history?.prices||[],d.history?.times||[],d.history?.pip_size??d.pip_size??state.pipSize);return
  }
  if(d.msg_type==="tick"){
    const t=d.tick;
    if(t&&t.symbol===state.symbol){
      renderSubscribedMarketStatus("connected");
      const r=state.deepScanner.data[t.symbol];
      const pending=Object.entries(state.deepScanner.subscribeRequests).find(([,sym])=>sym===t.symbol);
      const scannerSub=!!(r?.subscriptionId&&t.subscription?.id===r.subscriptionId)||(!!pending&&String(t.req_id)===String(pending[0]));
      if(scannerSub){if(pending)delete state.deepScanner.subscribeRequests[pending[0]];if(t.subscription?.id){request({forget:t.subscription.id,req_id:nextReq()});delete state.deepScanner.subscriptions[t.symbol];}if(r){r.subscriptionId=null;r.subscribed=false;}return;}
      receiveTick(t);syncCurrentIntoScanner(t);
    }else receiveScannerTick(t);
  }
}
function normalizeMarket(m){
  const symbol=m.underlying_symbol||m.symbol; const name=m.underlying_symbol_name||m.display_name||symbol;
  return {symbol,name,market:m.market||"",submarket:m.submarket||"",subgroup:m.subgroup||"",pipSize:m.pip_size??m.pip??null};
}
function loadMarkets(raw){
  const all=raw.map(normalizeMarket).filter(m=>m.symbol);
  const preferred=all.filter(m=>/volatility|jump/i.test(m.market+" "+m.name+" "+m.submarket+" "+m.subgroup)||/^R_|^JD|^1HZ/i.test(m.symbol));
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
  const selected=state.markets.find(m=>m.symbol===state.symbol);if(selected?.pipSize!=null)state.pipSize=selected.pipSize;
  state.ticks=[];state.digits=[];state.lastTickAt=0;renderSubscribedMarketStatus("switching");$("lastPrice").textContent="—";$("lastDigit").textContent="—";renderStream();renderEngine();
  request({ticks_history:state.symbol,end:"latest",count:1000,style:"ticks",req_id:nextReq()});
  request({ticks:state.symbol,subscribe:1,req_id:nextReq()});
  if($("diagSubscription"))$("diagSubscription").textContent=`Requested ${state.symbol}`;
  syncDeepScannerSubscriptions();
}
function loadHistory(prices,times,pipSize=null){
  if(pipSize!=null)state.pipSize=pipSize;
  const arr=prices.map((p,i)=>({quote:p,epoch:times[i]||0})).filter(x=>Number.isFinite(Number(x.quote)));
  state.ticks=arr.slice(-MAX_TICKS);state.digits=arr.map(x=>digitFromQuote(x.quote,state.pipSize)).filter(Number.isInteger).slice(-MAX_TICKS);
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
  if(state.ticks.length){r.ticks=state.ticks.slice(-MAX_TICKS);r.digits=state.digits.slice(-MAX_TICKS);r.pipSize=state.pipSize;r.historyReady=r.digits.length>=100;}
  if(t&&t.symbol===state.symbol){const sig=String(t.epoch||"")+":"+String(t.quote);r.lastSeen=sig;r.lastTickAt=Date.now();}
  else if(state.lastTickAt)r.lastTickAt=state.lastTickAt;
}
function syncDeepScannerSubscriptions(){
  const ds=state.deepScanner;if(!ds.enabled||!state.markets.length||!state.connected)return;
  for(const m of state.markets){
    const r=scannerRecord(m);
    if(m.symbol===state.symbol){
      if(r.subscriptionId){request({forget:r.subscriptionId,req_id:nextReq()});delete ds.subscriptions[m.symbol];r.subscriptionId=null;r.subscribed=false;}
      continue;
    }
    if(!r.historyReady&&!Object.values(ds.historyRequests).includes(m.symbol)){
      const req=nextReq();ds.historyRequests[req]=m.symbol;request({ticks_history:m.symbol,end:"latest",count:500,style:"ticks",req_id:req});
    }
    if(!r.subscribed&&!Object.values(ds.subscribeRequests).includes(m.symbol)){
      const req=nextReq();ds.subscribeRequests[req]=m.symbol;r.subscribeReq=req;request({ticks:m.symbol,subscribe:1,req_id:req});
    }
  }
}
function receiveScannerTick(t){
  if(!t||!t.symbol||t.symbol===state.symbol)return;
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
}
function scannerRisk(r){
  if(!state.connected||!r.lastTickAt||Date.now()-r.lastTickAt>60000)return {level:"UNKNOWN",reason:"No sufficiently fresh live ticks"};
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
  syncCurrentIntoScanner();
  const setup=deepScannerSetupKey();
  if(ds.lastSetupKey!==setup){ds.lastSetupKey=setup;ds.autoLoaded=false;ds.manualOverride=false;ds.lastLoadedSymbol="";ds.lastLoadedScore=0;ds.startedAt=Date.now();}
  const rows=[];
  for(const m of state.markets){
    const r=scannerRecord(m),risk=scannerRisk(r);
    if(r.digits.length<100||risk.level==="HIGH"||risk.level==="UNKNOWN")continue;
    const a=overUnderEvidence(r.digits,state.selectedDigit,state.selectedSide);
    if(!(a.signal==="SIGNAL"||a.signal==="STRONG SIGNAL")||a.probabilityConflict)continue;
    const entry=overUnderEntry(r.digits,state.selectedDigit,state.selectedSide);
    if(!entry||!entry.entries?.length)continue;
    const top=entry.entries[0],score=Math.round(a.evidence*60+Math.min(100,top.score||0)*.30+(risk.level==="LOW"?10:3));
    rows.push({symbol:m.symbol,name:m.name,score,signal:a.signal,evidence:Math.round(a.evidence*100),entry:top.digit,entryScore:top.score||0,sample:r.digits.length,risk:risk.level,riskReason:risk.reason,reason:a.signal==="STRONG SIGNAL"?"Strong multi-factor Over/Under evidence with a qualifying entry-digit reaction":"Qualified Over/Under evidence and entry-digit reaction"});
  }
  rows.sort((a,b)=>b.score-a.score||b.evidence-a.evidence||b.sample-a.sample);
  ds.lastScanAt=Date.now();
  ds.strongestCandidate=rows[0]||null;
  renderDeepScanner(rows);
  return rows;
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
  const total=state.markets.length,ready=state.markets.filter(m=>(ds.data[m.symbol]?.digits.length||0)>=100).length;
  const status=$("deepScannerStatus");if(status)status.textContent=!state.connected?"FEED OFFLINE":best?"STRONG SETUP READY":ready+"/"+total+" READY";
  const progress=$("scannerProgress");if(progress)progress.textContent=ready+" of "+total+" markets checked internally • Setup "+state.selectedSide+" "+state.selectedDigit;
  const setup=$("scannerSetup");if(setup)setup.textContent=state.selectedSide+" "+state.selectedDigit;
  const winner=$("scannerWinner");
  if(winner){
    if(best)winner.innerHTML="<strong>STRONGEST ELIGIBLE SETUP READY</strong><span>Signal "+esc(best.signal)+" • Evidence "+best.evidence+"% • Entry digit "+best.entry+" • Risk "+esc(best.risk)+". Press LOAD STRONGEST MARKET to switch your active market.</span>";
    else winner.innerHTML="<strong>NO STRONG MARKET READY</strong><span>The scanner continues checking markets privately. Your current market selection will not change unless you press LOAD STRONGEST MARKET.</span>";
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
    if(p.market!==state.symbol){v.pending.splice(i,1);continue;}
    p.steps++;
    p.hits.push(p.side==="OVER"?digit>p.selectedDigit:digit<p.selectedDigit);
    const key=ouValidationRecordKey(p.market,p.selectedDigit,p.side,p.candidate);
    const rec=state.ouValidationBook[key];
    if(rec){
      for(const horizon of [1,2,3]){
        if(p.steps===horizon){
          rec[horizon].n++;
          if(p.hits.slice(0,horizon).every(Boolean))rec[horizon].hits++;
        }
      }
      rec.lastUpdated=Date.now();
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
  if(!snap||!snap.active||snap.key!==ouValidationKey()||!snap.digits.includes(digit))return;
  const signature=state.symbol+"|"+state.selectedDigit+"|"+state.selectedSide+"|"+digit+"|"+state.ticks.length;
  const key=ouValidationRecordKey(state.symbol,state.selectedDigit,state.selectedSide,digit);
  if(!state.ouValidationBook[key]){
    state.ouValidationBook[key]={market:state.symbol,selectedDigit:state.selectedDigit,side:state.selectedSide,candidate:digit,1:{n:0,hits:0},2:{n:0,hits:0},3:{n:0,hits:0},triggers:0,lastUpdated:Date.now()};
  }
  state.ouValidationBook[key].triggers++;
  state.ouValidation.pending.push({digit,candidate:digit,selectedDigit:state.selectedDigit,side:state.selectedSide,market:state.symbol,steps:0,hits:[],signature});
  state.ouValidation.lastTrigger="Entry digit "+digit+" triggered at tick "+state.ticks.length;
}
function ouValidationSummary(){
  resetOUValidationIfNeeded();
  const c=state.ouValidation.completed;
  const fmt=x=>x.n?Math.round(x.hits/x.n*100)+"% ("+x.hits+"/"+x.n+")":"collecting (0)";
  return "Live entry validation — next 1 tick: "+fmt(c[1])+" • next 2 consecutive ticks: "+fmt(c[2])+" • next 3 consecutive ticks: "+fmt(c[3]);
}
function renderOUValidationPanel(){
  const card=$("ouValidationCard"),out=$("ouValidationResults");
  if(!card||!out)return;
  card.style.display=state.engine==="overunder"?"":"none";
  const prefix=state.symbol+"|"+state.selectedDigit+"|"+state.selectedSide+"|";
  const rows=Object.values(state.ouValidationBook).filter(r=>ouValidationRecordKey(r.market,r.selectedDigit,r.side,r.candidate).startsWith(prefix)).sort((a,b)=>b.triggers-a.triggers).slice(0,5);
  const payout=Math.max(1,Math.min(500,Number(state.ouPayoutPercent)||95));
  const breakeven=100/(1+payout/100);
  const fmt=x=>x.n?Math.round(x.hits/x.n*100)+"% ("+x.hits+"/"+x.n+")":"—";
  const roi=x=>x.n?(((x.hits*payout-(x.n-x.hits)*100)/x.n)>=0?"+":"")+(((x.hits*payout-(x.n-x.hits)*100)/x.n).toFixed(1))+"%":"—";
  out.innerHTML='<div class="ou-validation-note">Session-only tracking • only live entry-digit triggers count • no trades are placed. Assumed win profit is editable and is a what-if estimate, not Deriv live payout.</div>'+
    '<div class="ou-validation-breakeven">Assumed profit per win: <strong>'+payout.toFixed(1)+'%</strong> of stake • break-even hit rate: <strong>'+breakeven.toFixed(1)+'%</strong></div>'+
    (rows.length?'<div class="ou-validation-table"><div class="ou-validation-row ou-validation-head"><span>ENTRY</span><span>TRIGGERS</span><span>1 TICK</span><span>2 IN A ROW</span><span>3 IN A ROW</span><span>EST. ROI*</span></div>'+rows.map(r=>{const selected=[1,2,3].reduce((best,h)=>r[h].n>best.n?r[h]:best,r[1]);return '<div class="ou-validation-row"><strong>'+r.candidate+'</strong><span>'+r.triggers+'</span><span>'+fmt(r[1])+'</span><span>'+fmt(r[2])+'</span><span>'+fmt(r[3])+'</span><span>'+roi(selected)+'</span></div>'}).join("")+'</div><div class="ou-validation-note">*ROI uses the best-sampled horizon for that digit, assumes the entered profit rate and a 100% stake loss on misses. Change payout assumption to match a real quoted contract before interpreting it.</div>':'<div class="ou-validation-empty">No qualifying entry-digit triggers recorded for '+esc(state.symbol)+' • '+state.selectedSide+' '+state.selectedDigit+' yet. Keep the live stream running; the table fills as entry digits trigger and their next ticks complete.</div>');
}
function receiveTick(t){
  if(!t||t.symbol!==state.symbol)return;
  const quote=t.quote;if(!Number.isFinite(Number(quote)))return;
  if(t.pip_size!=null)state.pipSize=t.pip_size;
  const digit=digitFromQuote(quote,state.pipSize);if(!Number.isInteger(digit))return;
  processOUValidationTick(digit);
  state.ticks.push({quote:Number(quote),epoch:t.epoch||Math.floor(Date.now()/1000)});state.digits.push(digit);
  if(state.ticks.length>MAX_TICKS)state.ticks.shift();if(state.digits.length>MAX_TICKS)state.digits.shift();
  state.lastTickAt=Date.now();
  $("lastPrice").textContent=String(quote);$("lastDigit").textContent=digit;
  $("tickCount").textContent=state.ticks.length.toLocaleString()+" ticks";$("updatedAt").textContent="Updated "+new Date().toLocaleTimeString();
  $("diagTicks").textContent=state.ticks.length;updateQuality();renderStream();renderEngine();refreshOUTradeSnapshot();processAutoTradeTick(digit);recordOUValidationTrigger(digit);
}
function updateQuality(){
  const n=state.digits.length,pill=$("qualityPill");
  if(n>=500){pill.textContent="GOOD";pill.className="quality-pill good"}
  else if(n>=100){pill.textContent="BUILDING";pill.className="quality-pill"}
  else {pill.textContent="INSUFFICIENT";pill.className="quality-pill bad"}
  $("diagAge").textContent=state.lastTickAt?Math.round((Date.now()-state.lastTickAt)/1000)+"s":"—";
}
function renderStream(){
  const d=state.digits.slice(-STREAM_SIZE);$("streamInfo").textContent=d.length+" digits";
  $("digitStream").innerHTML=d.map((x,i)=>`<span class="digit ${i===d.length-1?"latest":""}">${x}</span>`).join("");
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
  // Score each horizon only when that many future ticks exist. A missing 3-tick
  // follow-through must never erase valid 1- or 2-tick evidence.
  for(let i=0;i<d.length;i++){
    if(d[i]!==candidate)continue;
    occurrences++;
    if(i+1<d.length){n1++;const a=qualifies(d[i+1]);if(a)r1++;
      if(i+2<d.length){n2++;const b=qualifies(d[i+2]);if(a&&b)r2++;
        if(i+3<d.length){n3++;const c=qualifies(d[i+3]);if(a&&b&&c)r3++;if(!a&&b&&c)recovery++;}
      }
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
function overUnderEvidence(d,selectedDigit,selectedSide){
  const n=d.length;
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
  let signal="WAIT";
  if(n<100)signal="WAIT";
  else if(probabilityConflict)signal="AVOID";
  else if(evidence>=.68&&selectedRate>=baseline-.03&&selected.weightedTransitionRate>=Math.max(.48,baseline-.05)&&consistency>=.58&&n>=200)signal="STRONG SIGNAL";
  else if(evidence>=.54&&selectedRate>=baseline-.07&&consistency>=.45)signal="SIGNAL";
  else if(evidence<.38||selectedRate<baseline-.16)signal="AVOID";
  return {oppositeDigit,selectedRate,oppositeRate,baseline,probability,momentum:momentumScore,trend:trendScore,transition,cluster:selected.cluster,reaction,recency,consistency,historical,context,evidence,probabilityConflict,signal,recentRate:selected.recent,mediumRate:selected.medium,longRate:selected.long,short50:selected.short50,mid250:selected.mid250,weightedTransitionRate:selected.weightedTransitionRate,transitions:selected.transitions,streak:selected.streak};
}
function overUnderEntry(d,selectedDigit,selectedSide){
  const candidates=[];
  const baseline=selectedSide==="OVER"?(9-selectedDigit)/10:selectedDigit/10;
  for(let candidate=0;candidate<=9;candidate++){
    // Exclude spike-prone extreme entry digits for the selected direction.
    if((selectedSide==="UNDER"&&(candidate===0||candidate===1))||(selectedSide==="OVER"&&(candidate===8||candidate===9)))continue;
    const t=ouTransitionStats(d,candidate,selectedDigit,selectedSide);
    if(t.total<20||t.recentTotal<5)continue;
    const sample=Math.min(1,t.total/100),recentWeight=Math.min(1,t.recentTotal/40);
    const continuation=t.r1*.45+t.r2*.35+t.r3*.20;
    const immediateAdvantage=Math.max(0,Math.min(1,.5+(t.r1-baseline)*3.5));
    const twoTickAdvantage=Math.max(0,Math.min(1,.5+(t.r2-baseline)*3));
    const threeTickAdvantage=Math.max(0,Math.min(1,.5+(t.r3-baseline)*2.5));
    const directionalAdvantage=Math.max(0,Math.min(1,.5+(t.weightedRate-baseline)*3));
    const recentAdvantage=Math.max(0,Math.min(1,.5+(t.recentRate-baseline)*3));
    const stability=Math.max(0,Math.min(1,1-Math.abs(t.rate-t.recentRate)-Math.abs(t.r1-t.r2)*.35-Math.abs(t.r2-t.r3)*.25));
    const consistency=Math.max(0,Math.min(1,1-Math.abs(t.r1-t.r2)-Math.abs(t.r2-t.r3)));
    const score=Math.round(100*(directionalAdvantage*.24+recentAdvantage*.18+continuation*.28+immediateAdvantage*.10+twoTickAdvantage*.07+threeTickAdvantage*.03+stability*.05+consistency*.03+sample*.01+recentWeight*.01));
    candidates.push({...t,candidate,baseline,score,continuation,stability,consistency});
  }
  candidates.sort((a,b)=>b.score-a.score);
  if(!candidates.length)return null;
  const setupDepth=Math.min(selectedDigit,9-selectedDigit),middleBias=Math.max(0,Math.min(1,(setupDepth-1)/3));
  const minTotal=Math.round(20-4*middleBias),recentMin=.49+.02*middleBias,scoreMin=55-3*middleBias;
  const qualified=candidates.filter(c=>{
    const hasContinuation=c.r1>=.54||c.r2>=.52;
    const hasDirectionalReaction=c.recentRate>=recentMin&&(c.weightedRate>=baseline-.02||c.r1>=.56||c.r2>=.54);
    return c.total>=minTotal&&c.recentTotal>=5&&hasDirectionalReaction&&hasContinuation&&c.stability>=.56&&c.consistency>=.45&&c.score>=scoreMin;
  }).slice(0,2);
  if(!qualified.length)return null;
  const entries=qualified.map(c=>{
    let score=c.score;
    const status=score>=78?"STRONG CANDIDATE":score>=66?"MODERATE CANDIDATE":"EARLY CANDIDATE";
    let reason;
    if(c.r1>=.56&&c.r2>=.54&&c.r3>=.50)reason="Historical triggers show follow-through across 1–3 ticks toward the selected setup.";
    else if(c.r1>=.54&&c.r2>=.52)reason="Historical triggers show immediate reaction and 2-tick continuation toward the selected setup.";
    else if(c.r1>=.54)reason="Historical triggers show immediate reaction; longer continuation is less consistent.";
    else reason="Historical triggers show favorable 2-tick continuation despite weaker immediate reaction.";
    return {digit:c.candidate,score,status,reason,evidence:c.total+" historical triggers; "+c.recentTotal+" recent triggers"};
  });
  return {main:entries.map(e=>String(e.digit)).join("  •  "),meta:entries.length===2?"Digit "+entries[0].digit+": score "+entries[0].score+"/100 • Digit "+entries[1].digit+": score "+entries[1].score+"/100":"Digit "+entries[0].digit+": score "+entries[0].score+"/100 • Second digit: no candidate passed validation. Scores rank candidates; they are not win probabilities.",status:entries.length===2?"2 VALID CANDIDATES":"1 VALID CANDIDATE",reason:entries.map(e=>"Digit "+e.digit+": "+e.reason).join(" "),evidence:entries.map(e=>"Digit "+e.digit+" — "+e.evidence).join(" • "),entries};
}
function renderParityControls(){
  document.querySelectorAll(".parity-side").forEach(btn=>btn.classList.toggle("active",btn.dataset.parity===state.selectedParity)); const label=$("paritySetupLabel"); if(label)label.textContent=state.selectedParity;
}
function renderOUControls(){
  const setupLabel=$("ouSetupLabel");
  if(setupLabel)setupLabel.textContent=state.selectedSide+" "+state.selectedDigit;
  document.querySelectorAll(".ou-digit").forEach(btn=>{
    const d=Number(btn.dataset.digit);
    const qualifies=state.selectedSide==="OVER"?d>state.selectedDigit:d<state.selectedDigit;
    btn.classList.toggle("active",d===state.selectedDigit);
    btn.classList.toggle("qualifying",d!==state.selectedDigit&&qualifies);
    btn.classList.toggle("nonqualifying",d!==state.selectedDigit&&!qualifies);
  });
  document.querySelectorAll(".ou-side").forEach(btn=>btn.classList.toggle("active",btn.dataset.side===state.selectedSide));
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
  banner.innerHTML='<strong>'+esc(r.title)+'</strong><div>'+esc(r.reason)+'</div>';
  const panelRoot=root.querySelector(".engine-panel");
  if(!panelRoot)return;
  const kicker=panelRoot.querySelector(".panel-kicker");
  if(kicker)kicker.insertAdjacentElement("afterend",banner);else panelRoot.prepend(banner);
  if(r.level==="HIGH"||r.level==="UNKNOWN"){
    const signal=panelRoot.querySelector(".state");
    if(signal){signal.textContent="ENTRY BLOCKED";signal.className="state none"}
    const reason=panelRoot.querySelector(".reason");
    if(reason)reason.textContent="The analysis may still show a directional setup, but the shared spike-risk protection layer is blocking new entry recommendations.";
    const entry=panelRoot.querySelector(".entry");
    if(entry)entry.innerHTML='<div class="entry-head">ENTRY PROTECTION</div><div class="entry-main">NO ENTRY — '+esc(r.title)+'</div><div class="entry-meta">'+esc(r.reason)+'</div>';
    const why=panelRoot.querySelector(".why ul");
    if(why){const li=document.createElement("li");li.className="block";li.textContent="× Shared spike-risk protection blocked entry eligibility.";why.prepend(li)}
  }else if(r.level==="MODERATE"){
    const why=panelRoot.querySelector(".why ul");
    if(why){const li=document.createElement("li");li.textContent="! Moderate spike risk: confidence is reduced; wait for conditions to normalize.";why.prepend(li)}
  }
}

function renderEngine(){
  const d=state.digits, n=d.length, c=counts(d), last=d.at(-1);
  const root=$("engineRoot");
  const ou=$("overUnderControls"),parity=$("evenOddControls");
  if(ou)ou.style.display=state.engine==="overunder"?"":"none";
  renderOUValidationPanel();
  if(parity)parity.style.display=state.engine==="evenodd"?"":"none";
  const rf=$("riseFallControls");if(rf)rf.style.display=state.engine==="risefall"?"":"none";
  if(n<30){root.innerHTML=panel("INSUFFICIENT DATA","Collecting more validated market data before analysis.",null,["At least 30 recent digits are required","Live data stream is active when ticks are arriving"],n);return}
  if(state.engine==="overunder")renderOverUnder(root,d,c,last,n);
  if(state.engine==="evenodd")renderEvenOdd(root,d,last,n);
  if(state.engine==="risefall")renderRiseFall(root,last,n);
  applySpikeRiskProtection(root);
}
function panel(stateText,reason,entry,why,n){
  const cls=stateText==="STRONG SIGNAL"?"strong":stateText==="SIGNAL"?"signal":stateText==="NO SIGNAL"||stateText==="NO ENTRY"?"none":"wait";
  return `<section class="engine-panel"><div class="decision-summary"><div class="panel-kicker">FINAL SIGNAL</div><div class="state ${cls}">${esc(stateText)}</div><div class="reason">${esc(reason)}</div>${entry?entryHtml(entry):""}</div><div class="why"><div class="why-title">WHY THIS STATE?</div><ul>${why.map(x=>`<li class="${x[0]==="×"?"block":""}">${esc(x)}</li>`).join("")}</ul></div><details class="analysis-details"><summary>Detailed analysis</summary><div class="stats"><div class="stat"><span>Sample</span><strong>${n}</strong></div><div class="stat"><span>Evidence</span><strong>${entry?.evidence||"Building"}</strong></div><div class="stat"><span>Data quality</span><strong>${n>=500?"GOOD":n>=100?"BUILDING":"INSUFFICIENT"}</strong></div><div class="stat"><span>Last digit</span><strong>${state.digits?.at(-1)??"—"}</strong></div></div></details></section>`;
}
function entryHtml(e){const cards=Array.isArray(e.entries)?'<div class="entry-candidates">'+e.entries.map(x=>'<div class="entry-candidate"><strong>ENTRY DIGIT '+esc(x.digit)+'</strong><span>SCORE '+esc(x.score)+'/100</span><small>'+esc(x.status)+'</small></div>').join("")+'</div>':'<div class="entry-main">'+esc(e.main)+'</div>';return '<div class="entry"><div class="entry-head">ENTRY DIGITS • RANKING SCORE, NOT WIN PROBABILITY</div>'+cards+'<div class="entry-meta">'+esc(e.meta||e.reason||"Qualifying setup")+'</div></div>'}
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
  const conflict=Math.abs(recent-(1-recent))>.20&&recent<.5;
  let signal="WAIT";
  const n=d.length;
  if(n<100)signal="WAIT";
  else if(conflict)signal="AVOID";
  else if(evidence>=.68&&recent>=.53&&recentTransitionRate>=.50&&consistency>=.58&&n>=200)signal="STRONG SIGNAL";
  else if(evidence>=.54&&recent>=.50&&consistency>=.45)signal="SIGNAL";
  else if(evidence<.38||recent<.44)signal="AVOID";
  return {windows,recent,short50,medium,mid250,long,momentum,trend,transitionRate,recentTransitionRate,transitions,recentTransitions,streak,clustering,consistency,probability,momentumScore,trendScore,transition,historical,recency,context,evidence,signal,target,other};
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
  const entry=entryActive?selectParityEntry(d,state.selectedParity):null;
  const entryDisplay=entry||{main:entryActive?"NO STRONG ENTRY":"NO ACTIVE ENTRY",confidence:"—",reason:entryActive?"No trigger has enough conditional lift toward the selected Final Signal.":"Entry activates only when the selected parity has SIGNAL or STRONG SIGNAL."};
  const pattern=d.slice(-6).map(x=>x%2===0?"E":"O").join(" → ");
  const reason=e.signal==="STRONG SIGNAL"?"Multiple parity evidence layers are aligned for "+state.selectedParity+".":e.signal==="SIGNAL"?"The selected parity has sufficient multi-factor evidence, but it is not at STRONG SIGNAL level.":e.signal==="AVOID"?"The selected parity has unfavorable or conflicting evidence.":"Evidence for the selected parity is still developing.";
  root.innerHTML=panel(e.signal,reason,entryDisplay,[
    "Selected parity: "+state.selectedParity,
    "Recent parity: "+pattern,
    "20/50/100/250/500 rates: "+e.windows.map(x=>Math.round(x.rate*100)+"%").join(" / "),
    "Probability "+Math.round(e.probability*100)+" • momentum "+Math.round(e.momentumScore*100)+" • trend "+Math.round(e.trendScore*100)+" • transitions "+Math.round(e.transition*100),
    "Clustering "+Math.round(e.clustering*100)+" • recency "+Math.round(e.recency*100)+" • consistency "+Math.round(e.consistency*100),
    "Streak "+e.streak+" • evidence "+Math.round(e.evidence*100),
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
  let signal="WAIT";
  if(clean.length<100||recentDirectional.length<15||stats.some(x=>x.size<=100&&x.directional<10))signal="WAIT";
  else if(recentTarget<.43||shortTarget<.42||persistence<.38)signal="AVOID";
  else if(evidence>=.67&&recentTarget>=.57&&shortTarget>=.54&&midTarget>=.51&&persistence>=.53&&clean.length>=200)signal="STRONG SIGNAL";
  else if(evidence>=.55&&recentTarget>=.51&&shortTarget>=.49&&persistence>=.45)signal="SIGNAL";
  else if(evidence<.43)signal="AVOID";
  return {selected:state.selectedRiseFall,stats,recentRate,recentMove,trendRate,momentum,persistence,streak,reversalPressure,evidence,signal,recentTarget,shortTarget,midTarget,longTarget};
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
  const entry=riseFallEntry(prices,a);
  const entryDisplay=entry||{
    main:a.signal==="SIGNAL"||a.signal==="STRONG SIGNAL"?"NO CONFIRMED ENTRY":"NO ACTIVE ENTRY",
    confidence:"—",
    reason:a.signal==="SIGNAL"||a.signal==="STRONG SIGNAL"
      ?"Waiting for the historical trigger pattern to match the live stream and show qualified 1–3 move follow-through toward "+a.selected+"."
      :"Entry activates only when the selected direction reaches SIGNAL or STRONG SIGNAL."
  };
  const latest=a.stats.map(x=>x.directional>=10?Math.round(x.rate*100)+"% RISE":"—").join(" / ");
  const recentPattern=prices.slice(-8).reduce((acc,x,i,arr)=>i===0?acc:acc.concat(x>arr[i-1]?"R":x<arr[i-1]?"F":"X"),[]).join(" → ");
  const reason=a.signal==="STRONG SIGNAL"
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
    entry?"✓ Confirmed entry: historical trigger matched the live stream with qualified follow-through toward "+a.selected:"× No entry confirmed yet; historical patterns alone cannot trigger an entry"
  ],n);
}
document.querySelectorAll(".parity-side").forEach(btn=>btn.addEventListener("click",()=>{state.selectedParity=btn.dataset.parity;renderParityControls();renderEngine()}));
document.querySelectorAll(".rise-fall-side").forEach(btn=>btn.addEventListener("click",()=>{state.selectedRiseFall=btn.dataset.direction;renderRiseFallControls();renderEngine()}));
document.querySelectorAll(".ou-digit").forEach(btn=>btn.addEventListener("click",()=>{state.selectedDigit=Number(btn.dataset.digit);state.deepScanner.autoLoaded=false;state.deepScanner.manualOverride=false;state.deepScanner.strongestCandidate=null;renderOUControls();renderEngine();deepScannerEvaluate(true)}));
document.querySelectorAll(".ou-side").forEach(btn=>btn.addEventListener("click",()=>{state.selectedSide=btn.dataset.side;state.deepScanner.autoLoaded=false;state.deepScanner.manualOverride=false;state.deepScanner.strongestCandidate=null;renderOUControls();renderEngine();deepScannerEvaluate(true)}));
document.querySelectorAll(".engine-tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".engine-tab").forEach(b=>{b.classList.remove("active");b.setAttribute("aria-selected","false")});btn.classList.add("active");btn.setAttribute("aria-selected","true");state.engine=btn.dataset.engine;const current=document.getElementById("workspaceCurrent");if(current)current.textContent=btn.textContent.trim();renderEngine()}));
const scanNowBtn=$("scanNowBtn");if(scanNowBtn)scanNowBtn.addEventListener("click",()=>{deepScannerEvaluate(true)});const loadStrongestBtn=$("loadStrongestBtn");if(loadStrongestBtn)loadStrongestBtn.addEventListener("click",loadStrongestScannerMarket);
const payoutInput=$("ouPayoutPercent");if(payoutInput)payoutInput.addEventListener("input",()=>{state.ouPayoutPercent=Math.max(1,Math.min(500,Number(payoutInput.value)||95));renderOUValidationPanel()});
marketSelect.addEventListener("change",()=>{const m=state.markets.find(x=>x.symbol===marketSelect.value);if(m){autoTradeMarketChanged();state.symbol=m.symbol;state.marketName=m.name;$("marketName").textContent=m.name;renderSubscribedMarketStatus("switching");state.marketStarted=false;startMarket(true);syncDeepScannerSubscriptions();renderDeepScanner();}});
let touchX=0,touchY=0;
document.querySelector(".engine-nav").addEventListener("touchstart",e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY},{passive:true});
document.querySelector(".engine-nav").addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)){const names=["overunder","evenodd","risefall"],i=names.indexOf(state.engine),next=names[Math.max(0,Math.min(2,i+(dx<0?1:-1)))];document.querySelector(`[data-engine="${next}"]`).click()}},{passive:true});
setInterval(()=>{if(state.deepScanner.enabled&&Date.now()-state.deepScanner.lastScanAt>4000)deepScannerEvaluate(false);if(state.lastTickAt){$("diagAge").textContent=Math.round((Date.now()-state.lastTickAt)/1000)+"s";if(Date.now()-state.lastTickAt>15000&&state.connected)setStatus("offline","Waiting for data")}const root=$("engineRoot");if(root&&root.querySelector(".engine-panel"))applySpikeRiskProtection(root)},1000);
connect();
// Deep Scanner floating popup controls
(function setupDeepScannerPopup(){
  const fab=document.getElementById("deepScannerFab"),modal=document.getElementById("deepScannerModal"),close=document.getElementById("closeDeepScanner"),dot=document.getElementById("deepScannerFabDot");
  if(!fab||!modal||!close)return;
  const open=()=>{modal.classList.add("open");modal.setAttribute("aria-hidden","false");fab.setAttribute("aria-expanded","true");document.body.style.overflow="hidden";close.focus();};
  const shut=()=>{modal.classList.remove("open");modal.setAttribute("aria-hidden","true");fab.setAttribute("aria-expanded","false");document.body.style.overflow="";fab.focus();};
  fab.addEventListener("click",open);close.addEventListener("click",shut);
  modal.querySelectorAll("[data-close-scanner]").forEach(el=>el.addEventListener("click",shut));
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal.classList.contains("open"))shut();});
  const updateDot=()=>{const b=document.getElementById("loadStrongestBtn");if(dot&&b&&!b.disabled)dot.classList.add("ready");else if(dot)dot.classList.remove("ready");};
  setInterval(updateDot,1200);updateDot();
})();

// Keep the extraction block explicit about the market whose tick feed is active.
function renderSubscribedMarketStatus(mode="switching"){
  const box=$("subscribedMarketStatus"),name=$("subscribedMarketName"),symbol=$("subscribedMarketSymbol");
  if(!box||!name||!symbol)return;
  const market=state.markets.find(m=>m.symbol===state.symbol);
  const label=market?.name||state.marketName||state.symbol||"No market selected";
  name.textContent=label;
  symbol.textContent="Symbol: "+(state.symbol||"—")+" · "+(mode==="connected"?"Live tick subscription active":mode==="switching"?"Switching / requesting live tick feed":"Waiting for live tick feed");
  box.classList.toggle("connected",mode==="connected");box.classList.toggle("switching",mode!=="connected");
}


/* Auto Trade: separate authenticated trading socket; never shares the public tick socket. */
const autoTrade={
  socket:null,authorized:false,account:null,enabled:false,realConfirmed:false,stake:0.35,martingale:2,takeProfit:2,stopLoss:3,
  nextStake:0.35,sessionProfit:0,wins:0,losses:0,runRemaining:0,runSymbol:"",runDigit:null,armed:true,lastDigit:null,
  activeContracts:{},settled:new Set(),requests:{},req:1000,currency:"",startedAt:0,logLines:[]
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
  if(!autoTrade.authorized||!autoTrade.account)return false;
  if(autoTrade.account.is_virtual)return true;
  return $("autoTradeRealCheck")?.checked===true&&$("autoTradeRealPhrase")?.value.trim()==="TRADE REAL";
}
function autoTradeRender(){
  const market=$("autoTradeMarket"),setup=$("autoTradeSetup"),entries=$("autoTradeEntries");
  if(market)market.textContent=state.symbol+" · "+state.marketName;
  if(setup)setup.textContent=state.selectedSide+" "+state.selectedDigit;
  if(entries)entries.textContent=state.ouEntrySnapshot?.active&&state.ouEntrySnapshot.digits?.length?state.ouEntrySnapshot.digits.join(" / "):"No valid entry";
  if($("autoTradeCurrency"))$("autoTradeCurrency").textContent=autoTrade.currency||"account currency";
  document.querySelectorAll(".autoTradeCurrencyText").forEach(x=>x.textContent=autoTrade.currency||"account currency");
  if($("autoTradeAccount"))$("autoTradeAccount").textContent=autoTrade.account?(autoTrade.account.loginid+" · "+(autoTrade.account.is_virtual?"DEMO":"REAL")+" · "+autoTrade.currency):"No account connected";
  if($("autoTradePnL"))$("autoTradePnL").textContent="Session P/L: "+autoTrade.sessionProfit.toFixed(2)+" "+(autoTrade.currency||"");
  if($("autoTradeNextStake"))$("autoTradeNextStake").textContent=autoTrade.nextStake.toFixed(2)+" "+(autoTrade.currency||"");
  if($("autoTradeRunProgress"))$("autoTradeRunProgress").textContent=autoTrade.runRemaining?((2-autoTrade.runRemaining)+"/2 settled"):autoTrade.enabled?"Waiting for entry":"Idle";
  const gate=$("autoTradeRealGate");if(gate)gate.hidden=!autoTrade.account||autoTrade.account.is_virtual;
  autoTradeStatus(autoTrade.enabled?"RUNNING":autoTrade.authorized?(autoTrade.account?.is_virtual?"DEMO CONNECTED":"REAL ACCOUNT LOCKED"):"DISCONNECTED",autoTrade.enabled?"running":autoTrade.authorized?"connected":"");
}
function refreshOUTradeSnapshot(){
  if(state.digits.length<30){state.ouSignalSnapshot={key:ouValidationKey(),active:false,signal:"WAIT",probabilityConflict:false};state.ouEntrySnapshot={key:ouValidationKey(),active:false,digits:[]};autoTradeRender();return}
  const e=overUnderEvidence(state.digits,state.selectedDigit,state.selectedSide);
  const active=e.signal==="SIGNAL"||e.signal==="STRONG SIGNAL";
  const entry=active&&!e.probabilityConflict?overUnderEntry(state.digits,state.selectedDigit,state.selectedSide):null;
  state.ouSignalSnapshot={key:ouValidationKey(),active:active&&!e.probabilityConflict,signal:e.signal,probabilityConflict:!!e.probabilityConflict};
  state.ouEntrySnapshot={key:ouValidationKey(),active:!!entry,digits:entry?entry.entries.map(x=>x.digit):[]};
  autoTradeRender();
}
function autoTradeMarketChanged(){
  autoTrade.armed=true;autoTrade.lastDigit=null;
  if(autoTrade.runRemaining){autoTradeLog("Market changed. Remaining contracts in the previous run were cancelled; open contracts will still settle.");autoTrade.runRemaining=0;autoTrade.runSymbol="";}
  if(autoTrade.enabled)autoTradeLog("Following selected market: new entries will use the new market after fresh signal and entry validation.");
  autoTradeRender();
}
function autoTradePause(reason){
  autoTrade.enabled=false;autoTrade.runRemaining=0;autoTrade.runSymbol="";
  autoTradeStatus("PAUSED");autoTradeLog("BOT PAUSED · "+reason);autoTradeRender();
}
function autoTradeStart(){
  if(!autoTradeCanStart()){autoTradeLog("Start blocked: connect an account; real accounts additionally require the checkbox and exact phrase TRADE REAL.");autoTradeRender();return}
  const stake=Number($("autoTradeStake").value),mg=Number($("autoTradeMartingale").value),tp=Number($("autoTradeTP").value),sl=Number($("autoTradeSL").value);
  if(!(stake>=0.35&&stake<=100&&mg>=1&&mg<=10&&tp>0&&sl>0)){autoTradeLog("Invalid risk settings. Stake must be 0.35–100, multiplier 1–10, and take-profit/stop-loss must be positive.");return}
  autoTrade.stake=stake;autoTrade.martingale=mg;autoTrade.takeProfit=tp;autoTrade.stopLoss=sl;autoTrade.nextStake=stake;
  autoTrade.sessionProfit=0;autoTrade.wins=0;autoTrade.losses=0;autoTrade.settled=new Set();autoTrade.enabled=true;autoTrade.armed=true;autoTrade.lastDigit=null;autoTrade.startedAt=Date.now();
  autoTradeLog("Bot started on "+state.symbol+" · "+state.selectedSide+" "+state.selectedDigit+" · stake "+stake+" "+autoTrade.currency+" · 2 contracts per trigger.");
  autoTradeRender();
}
function autoTradeReadyToEnter(digit){
  if(!autoTrade.enabled||!autoTrade.authorized||!state.connected||!state.lastTickAt||Date.now()-state.lastTickAt>15000)return {ok:false,reason:"live data disconnected or stale"};
  if(state.symbol!==state.ouEntrySnapshot?.key?.split("|")[0]||state.ouSignalSnapshot?.key!==ouValidationKey()||!state.ouSignalSnapshot?.active||!state.ouEntrySnapshot?.active)return {ok:false,reason:"Final Signal or Entry Engine is not valid"};
  const risk=spikeRiskAssessment();
  if(risk.level==="UNKNOWN"||risk.level==="HIGH")return {ok:false,reason:risk.title};
  if(risk.level==="MODERATE"&&state.ouSignalSnapshot.signal!=="STRONG SIGNAL")return {ok:false,reason:"moderate spike risk requires STRONG SIGNAL"};
  if(!state.ouEntrySnapshot.digits.includes(digit))return {ok:false,reason:"digit is not a current Entry Engine candidate"};
  return {ok:true};
}
function processAutoTradeTick(digit){
  autoTradeRender();
  if(!autoTrade.enabled)return;
  const candidates=state.ouEntrySnapshot?.digits||[];
  if(!candidates.includes(digit)){autoTrade.armed=true;autoTrade.lastDigit=digit;return}
  if(!autoTrade.armed){autoTrade.lastDigit=digit;return}
  const check=autoTradeReadyToEnter(digit);
  if(!check.ok){autoTradeLog("Entry blocked · "+check.reason);autoTrade.lastDigit=digit;return}
  autoTrade.armed=false;autoTrade.lastDigit=digit;autoTrade.runRemaining=2;autoTrade.runSymbol=state.symbol;autoTrade.runDigit=digit;
  autoTradeLog("ENTRY TRIGGER · "+state.symbol+" digit "+digit+" · "+state.selectedSide+" "+state.selectedDigit+" · starting 2-contract run.");
  autoTradePlaceNext();
}
function autoTradePlaceNext(){
  if(!autoTrade.enabled||!autoTrade.authorized||!autoTrade.runRemaining)return;
  if(state.symbol!==autoTrade.runSymbol){autoTrade.runRemaining=0;autoTradeLog("Run stopped because the selected market changed.");return}
  if(!state.connected||Date.now()-state.lastTickAt>15000){autoTradePause("live data stale or disconnected");return}
  if(!state.ouSignalSnapshot?.active||state.ouSignalSnapshot.key!==ouValidationKey()){autoTradePause("Over/Under signal no longer qualifies");return}
  if(autoTrade.sessionProfit>=autoTrade.takeProfit){autoTradePause("take-profit limit reached");return}
  if(autoTrade.sessionProfit<=-autoTrade.stopLoss){autoTradePause("stop-loss limit reached");return}
  const stake=Math.max(0.35,Math.min(100,Number(autoTrade.nextStake)||autoTrade.stake));
  const req={
    proposal:1,amount:Number(stake.toFixed(2)),basis:"stake",
    contract_type:state.selectedSide==="OVER"?"DIGITOVER":"DIGITUNDER",
    currency:autoTrade.currency,duration:1,duration_unit:"t",symbol:autoTrade.runSymbol,
    barrier:String(state.selectedDigit)
  };
  try{autoTradeReq(req,"proposal");autoTradeLog("Requesting 1-tick "+state.selectedSide+" "+state.selectedDigit+" proposal · stake "+stake.toFixed(2)+" "+autoTrade.currency+".")}
  catch(e){autoTradePause("proposal request failed: "+e.message)}
}
function autoTradeHandleMessage(d){
  if(d.error){
    const kind=autoTrade.requests[d.req_id];delete autoTrade.requests[d.req_id];
    autoTradeLog("Deriv API error"+(d.error.code?" ["+d.error.code+"]":"")+": "+(d.error.message||"Request failed"));
    if(kind==="authorize"){autoTrade.authorized=false;autoTrade.account=null;autoTradeStatus("AUTH FAILED")}
    if(kind==="proposal"||kind==="buy")autoTradePause("Deriv rejected a trade request");
    autoTradeRender();return;
  }
  const kind=autoTrade.requests[d.req_id];if(kind)delete autoTrade.requests[d.req_id];
  if(kind==="authorize"&&d.authorize){
    autoTrade.account={loginid:d.authorize.loginid,is_virtual:Number(d.authorize.is_virtual)===1};
    autoTrade.currency=d.authorize.currency||"USD";autoTrade.authorized=true;autoTrade.nextStake=autoTrade.stake;
    $("autoTradeToken").value="";
    autoTradeLog("Account authorized · "+autoTrade.account.loginid+" · "+(autoTrade.account.is_virtual?"DEMO":"REAL")+" · "+autoTrade.currency+".");
    if(!autoTrade.account.is_virtual)autoTradeLog("Real account detected. Trading stays locked until the in-panel confirmation is completed.");
    autoTradeRender();return;
  }
  if(kind==="proposal"&&d.proposal){
    try{autoTradeReq({buy:d.proposal.id,price:d.proposal.ask_price},"buy")}
    catch(e){autoTradePause("buy request failed: "+e.message)}
    return;
  }
  if(kind==="buy"&&d.buy){
    const id=String(d.buy.contract_id);autoTrade.activeContracts[id]={symbol:autoTrade.runSymbol,stake:Number(d.buy.buy_price)||autoTrade.nextStake};
    autoTradeLog("Contract purchased · #"+id+" · "+(autoTrade.runRemaining===2?"1st":"2nd")+" contract of run.");
    try{autoTradeReq({proposal_open_contract:1,contract_id:Number(id),subscribe:1},"open_contract")}
    catch(e){autoTradePause("contract tracking failed: "+e.message)}
    return;
  }
  if(d.msg_type==="proposal_open_contract"&&d.proposal_open_contract){
    const c=d.proposal_open_contract,id=String(c.contract_id);
    if(!c.is_sold||autoTrade.settled.has(id))return;
    autoTrade.settled.add(id);
    const profit=Number(c.profit)||0;autoTrade.sessionProfit+=profit;
    if(profit>=0){autoTrade.wins++;autoTrade.nextStake=autoTrade.stake;autoTradeLog("SETTLED WIN · "+profit.toFixed(2)+" "+autoTrade.currency+".")}
    else{autoTrade.losses++;autoTrade.nextStake=Math.min(100,Number((autoTrade.nextStake*autoTrade.martingale).toFixed(2)));autoTradeLog("SETTLED LOSS · "+profit.toFixed(2)+" "+autoTrade.currency+" · next stake "+autoTrade.nextStake.toFixed(2)+".")}
    if(c.subscription?.id){try{autoTradeReq({forget:c.subscription.id},"forget")}catch{}}
    delete autoTrade.activeContracts[id];
    if(autoTrade.sessionProfit>=autoTrade.takeProfit){autoTradePause("take-profit limit reached");return}
    if(autoTrade.sessionProfit<=-autoTrade.stopLoss){autoTradePause("stop-loss limit reached");return}
    if(autoTrade.runRemaining>0)autoTrade.runRemaining--;
    autoTradeRender();
    if(autoTrade.runRemaining>0){autoTradePlaceNext()}
    else if(autoTrade.enabled){autoTrade.runSymbol="";autoTradeLog("Two-contract run complete. Paused from entries until an entry digit leaves and appears again.");autoTradeRender()}
  }
}
function autoTradeConnect(){
  const token=$("autoTradeToken").value.trim();if(!token){autoTradeLog("Enter your own Deriv API token in this popup; never paste it into chat.");return}
  if(autoTrade.socket){try{autoTrade.socket.close()}catch{}}
  autoTrade.enabled=false;autoTrade.authorized=false;autoTrade.account=null;autoTrade.requests={};
  let ws;
  try{ws=new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089")}
  catch(e){autoTradeLog("Could not create secure Deriv connection: "+e.message);return}
  autoTrade.socket=ws;autoTradeStatus("CONNECTING");
  ws.onopen=()=>{autoTradeLog("Secure trading WebSocket connected. Authorizing account…");try{autoTradeReq({authorize:token},"authorize")}catch(e){autoTradeLog(e.message)}};
  ws.onmessage=e=>{try{autoTradeHandleMessage(JSON.parse(e.data))}catch(err){autoTradeLog("Response handling error: "+err.message)}};
  ws.onerror=()=>{autoTradeLog("Trading WebSocket error. Bot is paused.");autoTradePause("trading WebSocket error")};
  ws.onclose=()=>{const wasEnabled=autoTrade.enabled;autoTrade.enabled=false;autoTrade.authorized=false;autoTrade.account=null;autoTradeStatus("DISCONNECTED");if(wasEnabled)autoTradeLog("Trading connection closed; no new contracts will be placed.");autoTradeRender()};
  $("autoTradeToken").value="";
}
function autoTradeDisconnect(){
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
  $("autoTradeStop").addEventListener("click",()=>autoTradePause("paused by user"));
  $("autoTradeRealCheck").addEventListener("change",()=>{autoTradeRender()});
  $("autoTradeRealPhrase").addEventListener("input",()=>{autoTradeRender()});
  ["autoTradeStake","autoTradeMartingale","autoTradeTP","autoTradeSL"].forEach(id=>$(id).addEventListener("input",()=>{if(!autoTrade.enabled){autoTrade.stake=Number($("autoTradeStake").value)||0.35;autoTrade.nextStake=autoTrade.stake;autoTradeRender()}}));
  autoTradeRender();
})();
