const WS_URLS=["wss://api.derivws.com/trading/v1/options/ws/public","wss://ws.binaryws.com/websockets/v3","wss://ws.binaryws.com/websockets/v3?app_id=1089","wss://ws.derivws.com/websockets/v3?app_id=1089"];
const MAX_TICKS=2000, STREAM_SIZE=80;
const state={socket:null,markets:[],symbol:"R_100",marketName:"R_100",pipSize:null,ticks:[],digits:[],engine:"overunder",selectedDigit:2,selectedSide:"OVER",connected:false,lastTickAt:0,reconnectTimer:null,reconnectDelay:1000,req:0,endpointIndex:0,connectTimer:null,marketStarted:false,lastMessage:"—",lastError:"—"};

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
function overUnderEvidence(d,selectedDigit,selectedSide){
  const n=d.length;
  const oppositeDigit=9-selectedDigit;
  const selectedHits=d.filter(x=>selectedSide==="OVER"?x>selectedDigit:x<selectedDigit).length;
  const oppositeHits=d.filter(x=>selectedSide==="OVER"?x<oppositeDigit:x>oppositeDigit).length;
  const selectedRate=n?selectedHits/n:0, oppositeRate=n?oppositeHits/n:0;
  const recent=d.slice(-50), recentHits=recent.filter(x=>selectedSide==="OVER"?x>selectedDigit:x<selectedDigit).length;
  const recentRate=recent.length?recentHits/recent.length:0;
  let transitions=0,favorable=0;
  for(let i=0;i<n-1;i++){
    if(d[i]===selectedDigit){transitions++;if(selectedSide==="OVER"?d[i+1]>selectedDigit:d[i+1]<selectedDigit)favorable++;}
  }
  const transitionRate=transitions?favorable/transitions:0;
  let streak=0;for(let i=n-1;i>=0;i--){if(selectedSide==="OVER"?d[i]>selectedDigit:d[i]<selectedDigit)streak++;else break;}
  const recentAgreement=Math.abs(recentRate-selectedRate)<=0.12;
  const probabilityConflict=oppositeRate>selectedRate+0.03;
  const sample=n>=500?"GOOD":n>=100?"BUILDING":"INSUFFICIENT";
  let signal="WAIT";
  if(n<100)signal="WAIT";
  else if(probabilityConflict)signal="AVOID";
  else if(selectedRate>=0.62&&recentRate>=0.58&&recentAgreement)signal="STRONG SIGNAL";
  else if(selectedRate>=0.55&&recentRate>=0.52)signal="SIGNAL";
  else if(selectedRate<0.45)signal="AVOID";
  return {oppositeDigit,selectedRate,oppositeRate,recentRate,transitionRate,transitions,streak,probabilityConflict,sample,signal};
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
function overUnderEntry(d,selectedDigit,selectedSide){
  const candidates=[];
  const qualifies=x=>selectedSide==="OVER"?x>selectedDigit:x<selectedDigit;
  for(let candidate=0;candidate<=9;candidate++){
    if(candidate===selectedDigit||!qualifies(candidate))continue;
    let occurrences=0,followThrough=0;
    for(let i=0;i<d.length-3;i++){
      if(d[i]!==candidate)continue;
      occurrences++;
      if(qualifies(d[i+1])&&qualifies(d[i+2])&&qualifies(d[i+3]))followThrough++;
    }
    if(occurrences<3)continue;
    const rate=followThrough/occurrences;
    candidates.push({candidate,occurrences,followThrough,rate});
  }
  candidates.sort((a,b)=>b.rate-a.rate||b.followThrough-a.followThrough||b.occurrences-a.occurrences);
  const best=candidates[0];
  if(!best||best.followThrough<3||best.rate<0.67)return null;
  const confidence=Math.min(95,Math.round(55+best.rate*35+Math.min(best.occurrences,10)));
  return {main:String(best.candidate),meta:`${confidence}% confidence • 3-tick follow-through ${Math.round(best.rate*100)}% (${best.followThrough}/${best.occurrences})`,evidence:`${best.occurrences} historical reactions`,reason:`Candidate ${best.candidate} repeatedly produces 3 consecutive ticks supporting ${selectedSide} ${selectedDigit}.`};
}
function renderOverUnder(root,d,c,last,n){
  const e=overUnderEvidence(d,state.selectedDigit,state.selectedSide), setup=`${state.selectedSide} ${state.selectedDigit}`;
  const entry=(e.signal==="SIGNAL"||e.signal==="STRONG SIGNAL")&&!e.probabilityConflict?overUnderEntry(d,state.selectedDigit,state.selectedSide):null;
  const reason=e.probabilityConflict?`Probability conflict: ${state.selectedSide} ${state.selectedDigit} is weaker than its complementary setup ${state.selectedSide==="OVER"?"UNDER":"OVER"} ${e.oppositeDigit}.`:e.signal==="AVOID"?"The selected setup is not supported strongly enough by current evidence.":e.signal==="WAIT"?"Evidence is developing; continue collecting live data.":`The selected setup ${setup} has aligned recent and historical evidence.`;
  const entryDisplay=entry||((e.signal==="SIGNAL"||e.signal==="STRONG SIGNAL")?{main:"NO VALID ENTRY",meta:"No candidate passed the 3-tick follow-through test",evidence:"No qualifying candidate"}:null);
  root.innerHTML=panel(e.signal,reason,entryDisplay,[
    `Selected setup: ${setup}`,
    `Selected probability: ${Math.round(e.selectedRate*100)}% • Complement: ${Math.round(e.oppositeRate*100)}%`,
    `Recent probability: ${Math.round(e.recentRate*100)}% • Transition support: ${e.transitions?Math.round(e.transitionRate*100)+"%" :"not enough occurrences"}`,
    e.probabilityConflict?`× Probability Gate blocked by ${state.selectedSide==="OVER"?"UNDER":"OVER"} ${e.oppositeDigit}`:entry?`Entry candidate ${entry.main} passed the 3-tick follow-through test`:e.signal==="STRONG SIGNAL"?"Signal is strong, but no entry candidate passed the required confirmation":"× Evidence is not yet aligned"
  ],n);
}
function renderEvenOdd(root,d,last,n){
  const even=d.filter(x=>x%2===0).length, odd=n-even, side=even>=odd?"EVEN":"ODD", share=Math.max(even,odd)/n;
  const signal=share>=.62&&n>=100,strong=share>=.68&&n>=500,st=strong?"STRONG SIGNAL":signal?"SIGNAL":"WAIT";
  const pattern=d.slice(-4).join(" → ");
  root.innerHTML=panel(st,signal?`Recent parity distribution currently leans ${side}.`:"Recent parity evidence is inconclusive.",signal?{main:side,meta:"Qualifying parity bias",evidence:Math.round(share*100)+"/100"}:null,[`Recent pattern: ${pattern}`,`Even rate: ${rate(even,n)}% • Odd rate: ${rate(odd,n)}%`,n>=100?"Sample size is sufficient":"× Sample size is still building"],n);
}
function renderRiseFall(root,d,last,n){
  if(d.length<3){root.innerHTML=panel("INSUFFICIENT DATA","More ticks are required to measure direction.",null,["Waiting for a larger sequence"],n);return}
  const recent=d.slice(-100);let rise=0,fall=0;
  for(let i=1;i<recent.length;i++){if(recent[i]>recent[i-1])rise++;else if(recent[i]<recent[i-1])fall++}
  const total=rise+fall, side=rise>=fall?"RISE":"FALL",share=total?Math.max(rise,fall)/total:0,signal=share>=.62&&total>=30,strong=share>=.68&&total>=80,st=strong?"STRONG SIGNAL":signal?"SIGNAL":"WAIT";
  const pat=recent.slice(-4).map((x,i,a)=>i?x>a[i-1]?"R":"F":x).join(" → ");
  root.innerHTML=panel(st,signal?`Recent directional movement currently leans ${side}.`:"Recent directional evidence is inconclusive.",signal?{main:side,meta:"Qualifying directional continuation",evidence:Math.round(share*100)+"/100"}:null,[`Recent sequence: ${pat}`,`Rise: ${rise} • Fall: ${fall}`,total>=30?"Directional sample is sufficient":"× Directional sample is still building"],n);
}
document.querySelectorAll(".ou-digit").forEach(btn=>btn.addEventListener("click",()=>{state.selectedDigit=Number(btn.dataset.digit);renderOUControls();renderEngine()}));
document.querySelectorAll(".ou-side").forEach(btn=>btn.addEventListener("click",()=>{state.selectedSide=btn.dataset.side;renderOUControls();renderEngine()}));
document.querySelectorAll(".engine-tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".engine-tab").forEach(b=>b.classList.remove("active"));btn.classList.add("active");state.engine=btn.dataset.engine;renderEngine()}));
marketSelect.addEventListener("change",()=>{const m=state.markets.find(x=>x.symbol===marketSelect.value);if(m){state.symbol=m.symbol;state.marketName=m.name;$("marketName").textContent=m.name;state.marketStarted=false;startMarket(true)}});
let touchX=0,touchY=0;
document.querySelector(".engine-nav").addEventListener("touchstart",e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY},{passive:true});
document.querySelector(".engine-nav").addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)){const names=["overunder","evenodd","risefall"],i=names.indexOf(state.engine),next=names[Math.max(0,Math.min(2,i+(dx<0?1:-1)))];document.querySelector(`[data-engine="${next}"]`).click()}},{passive:true});
setInterval(()=>{if(state.lastTickAt){$("diagAge").textContent=Math.round((Date.now()-state.lastTickAt)/1000)+"s";if(Date.now()-state.lastTickAt>15000&&state.connected)setStatus("offline","Waiting for data")}},1000);
connect();