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
const state={socket:null,markets:[],symbol:"R_100",marketName:"R_100",pipSize:null,ticks:[],digits:[],engine:"overunder",selectedDigit:2,selectedSide:"OVER",selectedParity:"EVEN",selectedRiseFall:"RISE",connected:false,lastTickAt:0,reconnectTimer:null,reconnectDelay:1000,req:0,endpointIndex:0,connectTimer:null,marketStarted:false,lastMessage:"—",lastError:"—",ouValidation:{key:"",pending:[],completed:{1:{n:0,hits:0},2:{n:0,hits:0},3:{n:0,hits:0}},lastTrigger:"—"},ouValidationBook:{},ouPayoutPercent:95,ouEntrySnapshot:null};

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
    state.connected=true; state.reconnectDelay=1000; state.lastError="—";
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
    state.lastError=`Close ${e.code}${e.reason?": "+e.reason:""}${e.code===1006?" — abnormal close before a WebSocket close frame":""}`;
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
  if(d.error){state.lastError=`${d.error.code||"API"}: ${d.error.message||"Deriv data error"}`;if($("diagError"))$("diagError").textContent=state.lastError;console.warn("Deriv API error:",d.error);setStatus("error",d.error.message||"Deriv data error");return}
  if(d.msg_type==="ping"){$("diagSocket").textContent="OPEN • PING OK";return}
  if(d.msg_type==="active_symbols")loadMarkets(d.active_symbols||[]);
  if(d.msg_type==="history")loadHistory(d.history?.prices||[],d.history?.times||[],d.history?.pip_size??d.pip_size??state.pipSize);
  if(d.msg_type==="tick")receiveTick(d.tick);
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
  if(selected){state.symbol=selected.symbol;state.marketName=selected.name;state.pipSize=selected.pipSize;marketSelect.value=selected.symbol;$("marketName").textContent=selected.name;if(!state.marketStarted)startMarket(true)}
}
function startMarket(force=false){
  if(!force && state.marketStarted && state.symbol==="R_100")return;
  state.marketStarted=true;
  const selected=state.markets.find(m=>m.symbol===state.symbol);if(selected?.pipSize!=null)state.pipSize=selected.pipSize;
  state.ticks=[];state.digits=[];$("lastPrice").textContent="—";$("lastDigit").textContent="—";renderStream();renderEngine();
  request({ticks_history:state.symbol,end:"latest",count:1000,style:"ticks",req_id:nextReq()});
  request({ticks:state.symbol,subscribe:1,req_id:nextReq()});
  if($("diagSubscription"))$("diagSubscription").textContent=`Requested ${state.symbol}`;
}
function loadHistory(prices,times,pipSize=null){
  if(pipSize!=null)state.pipSize=pipSize;
  const arr=prices.map((p,i)=>({quote:p,epoch:times[i]||0})).filter(x=>Number.isFinite(Number(x.quote)));
  state.ticks=arr.slice(-MAX_TICKS);state.digits=arr.map(x=>digitFromQuote(x.quote,state.pipSize)).filter(Number.isInteger).slice(-MAX_TICKS);
  $("diagHistory").textContent=String(arr.length);updateQuality();renderStream();renderEngine();
}
function ouValidationKey(){
  return state.symbol+"|"+state.selectedDigit+"|"+state.selectedSide;
}
function resetOUValidationIfNeeded(){
  const key=ouValidationKey();
  if(state.ouValidation.key!==key){
    state.ouValidation={key,pending:[],completed:{1:{n:0,hits:0},2:{n:0,hits:0},3:{n:0,hits:0}},lastTrigger:"—"};
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
    for(const horizon of [1,2,3]){
      if(p.steps===horizon){
        v.completed[horizon].n++;
        if(p.hits.slice(0,horizon).every(Boolean))v.completed[horizon].hits++;
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
  $("diagTicks").textContent=state.ticks.length;updateQuality();renderStream();renderEngine();recordOUValidationTrigger(digit);
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
  return `<section class="engine-panel"><div class="panel-kicker">CURRENT ANALYSIS</div><div class="state ${cls}">${esc(stateText)}</div><div class="reason">${esc(reason)}</div>${entry?entryHtml(entry):""}<div class="why"><div class="why-title">WHY THIS STATE?</div><ul>${why.map(x=>`<li class="${x[0]==="×"?"block":""}">${esc(x)}</li>`).join("")}</ul></div><details class="analysis-details"><summary>Detailed analysis</summary><div class="stats"><div class="stat"><span>Sample</span><strong>${n}</strong></div><div class="stat"><span>Evidence</span><strong>${entry?.evidence||"Building"}</strong></div><div class="stat"><span>Data quality</span><strong>${n>=500?"GOOD":n>=100?"BUILDING":"INSUFFICIENT"}</strong></div><div class="stat"><span>Last digit</span><strong>${state.digits?.at(-1)??"—"}</strong></div></div></details></section>`;
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
    if(matched&&follow.length===k&&follow.every(v=>v===selectedSide)){depth=k;break;}
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
document.querySelectorAll(".ou-digit").forEach(btn=>btn.addEventListener("click",()=>{state.selectedDigit=Number(btn.dataset.digit);renderOUControls();renderEngine()}));
document.querySelectorAll(".ou-side").forEach(btn=>btn.addEventListener("click",()=>{state.selectedSide=btn.dataset.side;renderOUControls();renderEngine()}));
document.querySelectorAll(".engine-tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".engine-tab").forEach(b=>b.classList.remove("active"));btn.classList.add("active");state.engine=btn.dataset.engine;renderEngine()}));
const payoutInput=$("ouPayoutPercent");if(payoutInput)payoutInput.addEventListener("input",()=>{state.ouPayoutPercent=Math.max(1,Math.min(500,Number(payoutInput.value)||95));renderOUValidationPanel()});
marketSelect.addEventListener("change",()=>{const m=state.markets.find(x=>x.symbol===marketSelect.value);if(m){state.symbol=m.symbol;state.marketName=m.name;$("marketName").textContent=m.name;state.marketStarted=false;startMarket(true)}});
let touchX=0,touchY=0;
document.querySelector(".engine-nav").addEventListener("touchstart",e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY},{passive:true});
document.querySelector(".engine-nav").addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)){const names=["overunder","evenodd","risefall"],i=names.indexOf(state.engine),next=names[Math.max(0,Math.min(2,i+(dx<0?1:-1)))];document.querySelector(`[data-engine="${next}"]`).click()}},{passive:true});
setInterval(()=>{if(state.lastTickAt){$("diagAge").textContent=Math.round((Date.now()-state.lastTickAt)/1000)+"s";if(Date.now()-state.lastTickAt>15000&&state.connected)setStatus("offline","Waiting for data")}const root=$("engineRoot");if(root&&root.querySelector(".engine-panel"))applySpikeRiskProtection(root)},1000);
connect();