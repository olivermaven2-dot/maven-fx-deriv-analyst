const WS_URLS=["wss://api.derivws.com/trading/v1/options/ws/public","wss://ws.binaryws.com/websockets/v3","wss://ws.binaryws.com/websockets/v3?app_id=1089","wss://ws.derivws.com/websockets/v3?app_id=1089"];
const MAX_TICKS=2000, STREAM_SIZE=80;
const state={socket:null,markets:[],symbol:"R_100",marketName:"R_100",pipSize:null,ticks:[],digits:[],engine:"overunder",connected:false,lastTickAt:0,reconnectTimer:null,reconnectDelay:1000,req:0,endpointIndex:0,connectTimer:null,marketStarted:false,lastMessage:"—",lastError:"—"};

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
  catch(err){state.lastError=`WebSocket constructor: ${err.message||err}`;setStatus("error","Browser blocked WebSocket");state.endpointIndex=(state.endpointIndex+1)%WS_URLS.length;scheduleReconnect();return;}
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
function receiveTick(t){
  if(!t||t.symbol!==state.symbol)return;
  const quote=t.quote;if(!Number.isFinite(Number(quote)))return;
  if(t.pip_size!=null)state.pipSize=t.pip_size;
  const digit=digitFromQuote(quote,state.pipSize);if(!Number.isInteger(digit))return;
  state.ticks.push({quote:Number(quote),epoch:t.epoch||Math.floor(Date.now()/1000)});state.digits.push(digit);
  if(state.ticks.length>MAX_TICKS)state.ticks.shift();if(state.digits.length>MAX_TICKS)state.digits.shift();
  state.lastTickAt=Date.now();
  $("lastPrice").textContent=String(quote);$("lastDigit").textContent=digit;
  $("tickCount").textContent=state.ticks.length.toLocaleString()+" ticks";$("updatedAt").textContent="Updated "+new Date().toLocaleTimeString();
  $("diagTicks").textContent=state.ticks.length;updateQuality();renderStream();renderEngine();
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
function renderEngine(){
  const d=state.digits, n=d.length, c=counts(d), last=d.at(-1);
  const root=$("engineRoot");
  if(n<30){root.innerHTML=panel("INSUFFICIENT DATA","Collecting more validated market data before analysis.",null,["At least 30 recent digits are required","Live data stream is active when ticks are arriving"],n);return}
  if(state.engine==="overunder")renderOverUnder(root,d,c,last,n);
  if(state.engine==="evenodd")renderEvenOdd(root,d,last,n);
  if(state.engine==="risefall")renderRiseFall(root,d,last,n);
}
function panel(stateText,reason,entry,why,n){
  const cls=stateText==="STRONG SIGNAL"?"strong":stateText==="SIGNAL"?"signal":stateText==="NO SIGNAL"||stateText==="NO ENTRY"?"none":"wait";
  return `<section class="engine-panel"><div class="panel-kicker">CURRENT ANALYSIS</div><div class="state ${cls}">${esc(stateText)}</div><div class="reason">${esc(reason)}</div>${entry?entryHtml(entry):""}<div class="why"><div class="why-title">WHY THIS STATE?</div><ul>${why.map(x=>`<li class="${x[0]==="×"?"block":""}">${esc(x)}</li>`).join("")}</ul></div><details class="analysis-details"><summary>Detailed analysis</summary><div class="stats"><div class="stat"><span>Sample</span><strong>${n}</strong></div><div class="stat"><span>Evidence</span><strong>${entry?.evidence||"Building"}</strong></div><div class="stat"><span>Data quality</span><strong>${n>=500?"GOOD":n>=100?"BUILDING":"INSUFFICIENT"}</strong></div><div class="stat"><span>Last digit</span><strong>${state.digits?.at(-1)??"—"}</strong></div></div></details></section>`;
}
function entryHtml(e){return `<div class="entry"><div class="entry-head">ENTRY</div><div class="entry-main">${esc(e.main)}</div><div class="entry-meta">${esc(e.meta||"Qualifying setup")}</div></div>`}
function windowStats(values, predicate){
  const sizes=[20,50,100].filter(s=>values.length>=s);
  return sizes.map(size=>{
    const w=values.slice(-size), hits=w.filter(predicate).length;
    return {size,hits,rate:hits/size};
  });
}
function consensusStats(stats){
  if(!stats.length)return {rate:0,agree:0};
  const rates=stats.map(x=>x.rate), avg=rates.reduce((a,b)=>a+b,0)/rates.length;
  const agree=rates.filter(r=>r>=.5).length===rates.length||rates.filter(r=>r<.5).length===rates.length;
  return {rate:avg,agree:agree?1:0};
}
function transitionEntry(d,predicate){
  const score=Array(10).fill(null).map(()=>({seen:0,qualifying:0}));
  for(let i=0;i<d.length-1;i++){
    const digit=d[i], next=d[i+1];
    score[digit].seen++;
    if(predicate(next))score[digit].qualifying++;
  }
  return score.map((x,digit)=>({...x,digit,rate:x.seen?x.qualifying/x.seen:0}))
    .filter(x=>x.seen>=4)
    .sort((a,b)=>b.rate-a.rate||b.seen-a.seen)[0]||null;
}
function signalFromEvidence(consensus,latestRate,minSample){
  if(minSample<100)return "WAIT";
  const distance=Math.abs(consensus.rate-.5);
  if(consensus.agree&&distance>=.18&&latestRate>=.65&&minSample>=500)return "STRONG SIGNAL";
  if(consensus.agree&&distance>=.12&&latestRate>=.60)return "SIGNAL";
  return "WAIT";
}
function renderOverUnder(root,d,c,last,n){
  const over=x=>x>=5, under=x=>x<5;
  const overStats=windowStats(d,over), underStats=windowStats(d,under);
  const overLatest=overStats.at(-1)?.rate||0, underLatest=underStats.at(-1)?.rate||0;
  const side=overLatest>=underLatest?"OVER":"UNDER";
  const chosen=side==="OVER"?overStats:underStats;
  const consensus=consensusStats(chosen);
  const st=signalFromEvidence(consensus,Math.max(overLatest,underLatest),n);
  const entry=st==="SIGNAL"||st==="STRONG SIGNAL"?transitionEntry(d,side==="OVER"?over:under):null;
  const why=[
    \`Rolling \${chosen.at(-1)?.size||0}-digit \${side} rate: \${Math.round(consensus.rate*100)}%\`,
    \`Rolling windows agree: \${consensus.agree?"YES":"NO"}\`,
    \`Opposite side rate: \${Math.round((1-consensus.rate)*100)}%\`
  ];
  if(!consensus.agree)why.push("× Multi-window evidence is conflicting");
  if(entry)why.push(\`Best transition entry: digit \${entry.digit} → \${Math.round(entry.rate*100)}% \${side} follow-through (\${entry.seen} observations)\`);
  else if(st==="WAIT")why.push("× No entry digit is released until the final state qualifies");
  const entryView=entry&&entry.rate>=.65?{
    main:String(entry.digit),
    meta:\`Entry digit • next-tick \${side} follow-through \${Math.round(entry.rate*100)}%\`,
    evidence:\`\${entry.seen} transitions\`
  }:null;
  root.innerHTML=panel(st,st==="WAIT"?"Multi-window evidence is not yet strong and aligned.":\`Validated rolling evidence currently leans \${side}.\`,entryView,why,n);
}
function renderEvenOdd(root,d,last,n){
  const even=x=>x%2===0, odd=x=>x%2!==0;
  const eStats=windowStats(d,even), oStats=windowStats(d,odd);
  const e=eStats.at(-1)?.rate||0, o=oStats.at(-1)?.rate||0, side=e>=o?"EVEN":"ODD";
  const chosen=side==="EVEN"?eStats:oStats, consensus=consensusStats(chosen);
  const st=signalFromEvidence(consensus,Math.max(e,o),n);
  const pattern=d.slice(-6).join(" → ");
  const why=[\`Rolling \${chosen.at(-1)?.size||0}-digit \${side} rate: \${Math.round(consensus.rate*100)}%\`,
    \`Rolling windows agree: \${consensus.agree?"YES":"NO"}\`,\`Recent digits: \${pattern}\`];
  if(!consensus.agree)why.push("× Multi-window parity evidence is conflicting");
  root.innerHTML=panel(st,st==="WAIT"?"Parity evidence is still mixed or below the release threshold.":\`Validated rolling parity evidence currently leans \${side}.\`,
    st==="SIGNAL"||st==="STRONG SIGNAL"?{main:side,meta:"Qualifying parity direction",evidence:Math.round(consensus.rate*100)+"%"}:null,why,n);
}
function renderRiseFall(root,d,last,n){
  if(d.length<30){root.innerHTML=panel("INSUFFICIENT DATA","More ticks are required to measure directional movement.",null,["Waiting for a larger validated sequence"],n);return}
  const recent=d.slice(-100), rises=[], falls=[];
  for(let i=1;i<recent.length;i++){if(recent[i]>recent[i-1])rises.push(1);else if(recent[i]<recent[i-1])falls.push(1)}
  const total=rises.length+falls.length;
  const riseRate=total?rises.length/total:0, fallRate=total?falls.length/total:0;
  const side=riseRate>=fallRate?"RISE":"FALL", chosenRate=Math.max(riseRate,fallRate);
  const st=signalFromEvidence({rate:chosenRate,agree:1},chosenRate,n);
  const pat=recent.slice(-6).map((x,i,a)=>i?x>a[i-1]?"R":x<a[i-1]?"F":"=":x).join(" → ");
  const why=[\`Directional sample: \${total}\`,\`Rise rate: \${Math.round(riseRate*100)}% • Fall rate: \${Math.round(fallRate*100)}%\`,
    \`Recent direction: \${pat}\`];
  if(total<30)why.push("× Directional sample is still building");
  root.innerHTML=panel(st,st==="WAIT"?"Directional evidence is not yet strong enough.":\`Recent validated movement currently leans \${side}.\`,
    st==="SIGNAL"||st==="STRONG SIGNAL"?{main:side,meta:"Qualifying directional movement",evidence:Math.round(chosenRate*100)+"%"}:null,why,n);
}
document.querySelectorAll(".engine-tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".engine-tab").forEach(b=>b.classList.remove("active"));btn.classList.add("active");state.engine=btn.dataset.engine;renderEngine()}));
marketSelect.addEventListener("change",()=>{const m=state.markets.find(x=>x.symbol===marketSelect.value);if(m){state.symbol=m.symbol;state.marketName=m.name;$("marketName").textContent=m.name;state.marketStarted=false;startMarket(true)}});
let touchX=0,touchY=0;
document.querySelector(".engine-nav").addEventListener("touchstart",e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY},{passive:true});
document.querySelector(".engine-nav").addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)){const names=["overunder","evenodd","risefall"],i=names.indexOf(state.engine),next=names[Math.max(0,Math.min(2,i+(dx<0?1:-1)))];document.querySelector(`[data-engine="${next}"]`).click()}},{passive:true});
setInterval(()=>{if(state.lastTickAt){$("diagAge").textContent=Math.round((Date.now()-state.lastTickAt)/1000)+"s";if(Date.now()-state.lastTickAt>15000&&state.connected)setStatus("offline","Waiting for data")}},1000);
connect();