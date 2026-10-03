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
function renderOverUnder(root,d,c,last,n){
  const high=d.filter(x=>x>=5).length, low=d.filter(x=>x<=4).length, side=high>=low?"OVER":"UNDER", share=Math.max(high,low)/n;
  const signal=share>=.62&&n>=100, strong=share>=.68&&n>=500;
  const st=strong?"STRONG SIGNAL":signal?"SIGNAL":"WAIT";
  const entry=signal?{main:side==="OVER"?"5–9":"0–4",meta:"Current side has qualifying recent dominance",evidence:Math.round(share*100)+"/100"}:null;
  root.innerHTML=panel(st,signal?`Recent digit distribution currently leans ${side}.`:"Evidence is currently inconclusive; keep collecting data.",entry,[
    `${side} group rate: ${Math.round(share*100)}%`,
    n>=100?"Sample size is sufficient for the current screen":"× Sample size is still building",
    "Live digit stream is being monitored",
    strong?"Evidence strength is high":signal?"Evidence strength is moderate":"× Evidence strength is not yet qualifying"
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
document.querySelectorAll(".engine-tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".engine-tab").forEach(b=>b.classList.remove("active"));btn.classList.add("active");state.engine=btn.dataset.engine;renderEngine()}));
marketSelect.addEventListener("change",()=>{const m=state.markets.find(x=>x.symbol===marketSelect.value);if(m){state.symbol=m.symbol;state.marketName=m.name;$("marketName").textContent=m.name;state.marketStarted=false;startMarket(true)}});
let touchX=0,touchY=0;
document.querySelector(".engine-nav").addEventListener("touchstart",e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY},{passive:true});
document.querySelector(".engine-nav").addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)){const names=["overunder","evenodd","risefall"],i=names.indexOf(state.engine),next=names[Math.max(0,Math.min(2,i+(dx<0?1:-1)))];document.querySelector(`[data-engine="${next}"]`).click()}},{passive:true});
setInterval(()=>{if(state.lastTickAt){$("diagAge").textContent=Math.round((Date.now()-state.lastTickAt)/1000)+"s";if(Date.now()-state.lastTickAt>15000&&state.connected)setStatus("offline","Waiting for data")}},1000);
connect();