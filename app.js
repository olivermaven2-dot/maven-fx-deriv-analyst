function renderOverUnder(root,d,c,last,n){
  const e=overUnderEvidence(d,state.selectedDigit,state.selectedSide);
  const setup=state.selectedSide+" "+state.selectedDigit;
  const activeSignal=e.signal==="SIGNAL"||e.signal==="STRONG SIGNAL";
  const entry=activeSignal&&!e.probabilityConflict?overUnderEntry(d,state.selectedDigit,state.selectedSide):null;
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
    e.probabilityConflict?"× Complementary probability conflict — selected setup blocked":entry?"✓ Entry candidate "+entry.main+" passed independent reaction validation":activeSignal?"× No candidate passed all entry validation requirements":"× Entry remains inactive until the Final Signal becomes SIGNAL or STRONG SIGNAL"
  ],n);
}
const WS_URLS=["wss://api.derivws.com/trading/v1/options/ws/public","wss://ws.binaryws.com/websockets/v3","wss://ws.binaryws.com/websockets/v3?app_id=1089","wss://ws.derivws.com/websockets/v3?app_id=1089"];
const MAX_TICKS=2000, STREAM_SIZE=80;
const state={socket:null,markets:[],symbol:"R_100",marketName:"R_100",pipSize:null,ticks:[],digits:[],engine:"overunder",selectedDigit:2,selectedSide:"OVER",selectedParity:"EVEN",connected:false,lastTickAt:0,reconnectTimer:null,reconnectDelay:1000,req:0,endpointIndex:0,connectTimer:null,marketStarted:false,lastMessage:"—",lastError:"—"};

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
  let occurrences=0,r1=0,r2=0,r3=0,recovery=0;
  for(let i=0;i<d.length-3;i++){
    if(d[i]!==candidate)continue;
    occurrences++;
    const a=qualifies(d[i+1]),b=qualifies(d[i+2]),c=qualifies(d[i+3]);
    if(a)r1++;if(a&&b)r2++;if(a&&b&&c)r3++;if(!a&&b&&c)recovery++;
  }
  return {occurrences,r1:occurrences?r1/occurrences:0,r2:occurrences?r2/occurrences:0,r3:occurrences?r3/occurrences:0,recovery:occurrences?recovery/occurrences:0};
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
  const qualifies=x=>selectedSide==="OVER"?x>selectedDigit:x<selectedDigit;

  for(let candidate=0;candidate<=9;candidate++){
    const t=ouTransitionStats(d,candidate,selectedDigit,selectedSide);
    if(t.total<10)continue;

    // The entry digit is a TRIGGER: when it appears, the following digits
    // must show a measurable tendency toward the selected Over/Under zone.
    const sample=Math.min(1,t.total/80);
    const recentWeight=Math.min(1,t.recentTotal/35);

    // 1-tick reaction is the strongest immediate signal. 2-tick confirms
    // continuation. 3-tick is additional confirmation, NOT a hard gate.
    const continuation=t.r1*.45+t.r2*.35+t.r3*.20;
    const immediateAdvantage=Math.max(0,Math.min(1,.5+(t.r1-baseline)*3.5));
    const twoTickAdvantage=Math.max(0,Math.min(1,.5+(t.r2-baseline)*3));
    const threeTickAdvantage=Math.max(0,Math.min(1,.5+(t.r3-baseline)*2.5));
    const directionalAdvantage=Math.max(0,Math.min(1,.5+(t.weightedRate-baseline)*3));
    const recentAdvantage=Math.max(0,Math.min(1,.5+(t.recentRate-baseline)*3));

    const stability=Math.max(0,Math.min(1,
      1-Math.abs(t.rate-t.recentRate)-Math.abs(t.r1-t.r2)*.35-Math.abs(t.r2-t.r3)*.25
    ));
    const consistency=Math.max(0,Math.min(1,
      1-Math.abs(t.r1-t.r2)-Math.abs(t.r2-t.r3)
    ));

    // Primary emphasis is trigger -> directional reaction. 1/2/3 tick
    // continuation contributes progressively, with no automatic 3-tick veto.
    const score=100*(
      directionalAdvantage*.24+
      recentAdvantage*.18+
      continuation*.28+
      immediateAdvantage*.10+
      twoTickAdvantage*.07+
      threeTickAdvantage*.03+
      stability*.05+
      consistency*.03+
      sample*.01+
      recentWeight*.01
    );

    const confidenceBase=Math.min(1,t.total/120);
    candidates.push({
      ...t,
      candidate,
      baseline,
      score,
      continuation,
      immediateAdvantage,
      twoTickAdvantage,
      threeTickAdvantage,
      directionalAdvantage,
      recentAdvantage,
      consistency,
      stability,
      confidenceBase,
      p:Math.min(1,Math.max(0,t.r1*.5+t.r2*.3+t.r3*.2))
    });
  }

  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0],second=candidates[1];
  if(!best)return null;

  const gap=second?best.score-second.score:0;
  const setupDepth=Math.min(selectedDigit,9-selectedDigit);
  const middleBias=Math.max(0,Math.min(1,(setupDepth-1)/3));

  // Middle setups remain slightly more permissive, while the trigger
  // direction itself must still be supported by actual follow-through.
  const minTotal=Math.round(10-2*middleBias);
  const recentMin=.47+.02*middleBias;
  const scoreMin=53-3*middleBias;
  const gapMin=.8;

  // A candidate can qualify through strong 1-tick reaction OR strong
  // 2-tick continuation. 3-tick continuation only improves the result.
  const passesOneTick=best.r1>=.54;
  const passesTwoTick=best.r2>=.52;
  const hasDirectionalReaction=best.recentRate>=recentMin&&
    (best.weightedRate>=baseline-.03||best.r1>=.56||best.r2>=.54);
  const hasContinuation=passesOneTick||passesTwoTick;
  const valid=best.total>=minTotal&&
    hasDirectionalReaction&&
    hasContinuation&&
    best.stability>=.54&&
    best.consistency>=.42&&
    best.score>=scoreMin&&
    gap>=gapMin;

  if(!valid)return null;

  let confidence=Math.round(
    50+
    best.confidenceBase*14+
    best.continuation*18+
    best.stability*6+
    best.consistency*5+
    Math.min(7,gap)
  );

  // 3-tick confirmation increases confidence but is never required.
  if(best.r3>=.50)confidence+=4;
  else if(best.r3<.40)confidence-=3;

  confidence=Math.max(52,Math.min(94,confidence));

  let reason;
  if(best.r1>=.56&&best.r2>=.54&&best.r3>=.50){
    reason="Strong trigger reaction with consistent 1–3 tick movement toward the selected setup.";
  }else if(best.r1>=.54&&best.r2>=.52){
    reason="The trigger shows strong immediate reaction and 2-tick continuation toward the selected setup.";
  }else if(best.r1>=.54){
    reason="The trigger shows a strong immediate move toward the selected setup; longer continuation is less consistent.";
  }else if(best.r2>=.52){
    reason="The trigger shows favorable 2-tick continuation toward the selected setup despite weaker immediate reaction.";
  }else{
    reason="The trigger has aligned directional reaction and supporting recent transition evidence.";
  }

  const status=confidence>=82?"STRONG ENTRY":confidence>=68?"MODERATE ENTRY":"WEAK ENTRY";
  const continuationNote=best.r3>=.50
    ?"3-tick confirmation supported."
    :"3-tick confirmation is not required and is only reducing confidence.";

  return {
    main:String(best.candidate),
    confidence:confidence+"%",
    status,
    reason,
    evidence:best.total+" trigger observations • "+continuationNote
  };
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
function renderEngine(){
  const d=state.digits, n=d.length, c=counts(d), last=d.at(-1);
  const root=$("engineRoot");
  const ou=$("overUnderControls"),parity=$("evenOddControls");
  if(ou)ou.style.display=state.engine==="overunder"?"":"none";
  if(parity)parity.style.display=state.engine==="evenodd"?"":"none";
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
function parityPatternStats(d,selectedSide){
  const key=x=>x%2===0?"E":"O";
  const target=selectedSide==="EVEN"?"E":"O";
  const targetLabel=selectedSide;
  const recent=d.slice(-400).map(key);
  const patterns=[];

  // A pattern is an ENTRY TRIGGER only when a hit is followed by the
  // selected Final Signal parity more often than the neutral 50% baseline.
  for(let len=1;len<=3;len++){
    const seen=new Map();
    for(let i=0;i+len+2<recent.length;i++){
      const sequence=recent.slice(i,i+len);
      const pattern=sequence.join(" → ");
      let p=seen.get(pattern);
      if(!p){p={pattern,len,occurrences:0,r1:0,r2:0,r3:0,recovery:0,recentTotal:0,recentR1:0};seen.set(pattern,p)}
      p.occurrences++;
      const a=recent[i+len]===target;
      const b=recent[i+len+1]===target;
      const cc=recent[i+len+2]===target;
      if(a)p.r1++;
      if(a&&b)p.r2++;
      if(a&&b&&cc)p.r3++;
      if(!a&&b&&cc)p.recovery++;
      if(i>=Math.max(0,recent.length-160)){
        p.recentTotal++;
        if(a)p.recentR1++;
      }
    }
    for(const p of seen.values()){
      if(p.occurrences>=8){
        p.r1/=p.occurrences;p.r2/=p.occurrences;p.r3/=p.occurrences;p.recovery/=p.occurrences;
        p.recentRate=p.recentTotal?p.recentR1/p.recentTotal:p.r1;
        patterns.push(p);
      }
    }
  }
  if(!patterns.length)return null;

  const score=p=>{
    const edge1=Math.max(-.5,Math.min(.5,p.r1-.5));
    const edge2=Math.max(-.5,Math.min(.5,p.r2-.5));
    const edge3=Math.max(-.5,Math.min(.5,p.r3-.5));
    const recentEdge=Math.max(-.5,Math.min(.5,p.recentRate-.5));
    const persistence=p.r1*.45+p.r2*.30+p.r3*.10+p.recentRate*.15;
    return 100*(.45*(edge1+.5)+.25*(edge2+.5)+.10*(edge3+.5)+.20*(recentEdge+.5))*.70
      +100*persistence*.30;
  };
  patterns.sort((a,b)=>score(b)-score(a)||b.occurrences-a.occurrences);
  const best=patterns[0],second=patterns[1];
  const s=score(best),gap=second?s-score(second):5;

  const edge1=best.r1-.5,edge2=best.r2-.5,edge3=best.r3-.5,recentEdge=best.recentRate-.5;
  const passesOne=edge1>=.05;
  const passesTwo=edge2>=.05;
  const meaningfulDirection=passesOne||passesTwo;
  const strongEvidence=
    best.occurrences>=10&&
    meaningfulDirection&&
    recentEdge>=.02&&
    s>=58&&
    gap>=1.0;

  if(!strongEvidence)return null;

  let confidence=Math.round(
    66+Math.max(0,edge1)*55+Math.max(0,edge2)*45+Math.max(0,edge3)*20+
    Math.max(0,recentEdge)*30+Math.min(8,best.occurrences/20)+Math.min(6,gap)
  );
  if(best.r3>=.50)confidence+=4;
  else if(best.r3<.38)confidence-=2;
  confidence=Math.max(72,Math.min(94,confidence));

  let reason;
  if(best.r1>=.56&&best.r2>=.55&&best.r3>=.50){
    reason="Strong trigger pattern: when hit, it shows consistent 1–3 tick movement toward "+targetLabel+".";
  }else if(best.r1>=.55&&best.r2>=.55){
    reason="Strong trigger pattern: hits are followed by favorable 1–2 tick movement toward "+targetLabel+".";
  }else if(best.r1>=.55){
    reason="Strong immediate trigger reaction toward "+targetLabel+"; longer continuation is less consistent.";
  }else{
    reason="Strong 2-tick trigger continuation toward "+targetLabel+" despite a weaker first tick.";
  }

  return {
    type:"PATTERN",
    status:"STRONG ENTRY",
    main:best.pattern+" → "+targetLabel,
    confidence:confidence+"%",
    score:s,
    reason,
    evidence:best.occurrences+" pattern observations • "+
      (best.r3>=.50?"3-tick confirmation supported.":"3-tick confirmation not required.")
  };
}

function parityReactionEntry(d,selectedSide){
  const key=x=>x%2===0?"E":"O";
  const target=selectedSide==="EVEN"?"E":"O";
  const targetLabel=selectedSide;
  const recent=d.slice(-500).map(key);
  const candidates=[];

  for(const trigger of ["E","O"]){
    let total=0,r1=0,r2=0,r3=0,recentTotal=0,recentR1=0;
    for(let i=0;i<recent.length-3;i++){
      if(recent[i]!==trigger)continue;
      total++;
      const a=recent[i+1]===target,b=recent[i+2]===target,cc=recent[i+3]===target;
      if(a)r1++;if(a&&b)r2++;if(a&&b&&cc)r3++;
      if(i>=Math.max(0,recent.length-160)){recentTotal++;if(a)recentR1++;}
    }
    if(total<8)continue;

    const rate1=r1/total,rate2=r2/total,rate3=r3/total;
    const recentRate=recentTotal?recentR1/recentTotal:rate1;
    const edge1=rate1-.5,edge2=rate2-.5,edge3=rate3-.5,recentEdge=recentRate-.5;
    const score=100*(
      Math.max(0,edge1)*.34+
      Math.max(0,edge2)*.26+
      Math.max(0,edge3)*.10+
      Math.max(0,recentEdge)*.20+
      Math.min(1,total/50)*.10
    )*2+50;
    const stability=Math.max(0,1-Math.abs(rate1-rate2)*.7-Math.abs(rate2-rate3)*.35);
    candidates.push({trigger,total,rate1,rate2,rate3,recentRate,edge1,edge2,edge3,recentEdge,score,stability});
  }

  candidates.sort((a,b)=>b.score-a.score||b.total-a.total);
  const best=candidates[0],second=candidates[1];
  if(!best)return null;

  // Strong Entry: 1- or 2-tick directional evidence may qualify.
  // 3-tick confirmation adds strength but never acts as a hard gate.
  const passesOne=best.edge1>=.05;
  const passesTwo=best.edge2>=.05;
  const strongEvidence=
    best.total>=10&&
    (passesOne||passesTwo)&&
    best.recentEdge>=.02&&
    best.stability>=.45&&
    best.score>=58&&
    (!second||best.score-second.score>=1.0);

  if(!strongEvidence)return null;

  let confidence=Math.round(
    68+Math.max(0,best.edge1)*55+Math.max(0,best.edge2)*45+
    Math.max(0,best.edge3)*20+Math.max(0,best.recentEdge)*30+
    best.stability*6+Math.min(6,best.total/25)
  );
  if(best.rate3>=.50)confidence+=4;
  else if(best.rate3<.38)confidence-=2;
  confidence=Math.max(72,Math.min(94,confidence));

  const triggerLabel=best.trigger==="E"?"EVEN":"ODD";
  let reason;
  if(best.rate1>=.56&&best.rate2>=.55&&best.rate3>=.50){
    reason="Strong "+triggerLabel+" trigger: when hit, the next parity consistently moves toward "+targetLabel+" across 1–3 ticks.";
  }else if(best.rate1>=.55&&best.rate2>=.55){
    reason="Strong "+triggerLabel+" trigger: hits favor "+targetLabel+" on both the immediate and 2-tick reaction.";
  }else if(best.rate1>=.55){
    reason="Strong "+triggerLabel+" trigger: the next parity strongly favors "+targetLabel+"; longer continuation is mixed.";
  }else{
    reason="Strong "+triggerLabel+" trigger: the 2-tick reaction favors "+targetLabel+" even though the first tick is less consistent.";
  }

  return {
    type:"REACTION",
    status:"STRONG ENTRY",
    trigger:best.trigger,
    main:"ENTER ON "+triggerLabel+" → "+targetLabel,
    confidence:confidence+"%",
    score:best.score,
    reason,
    evidence:best.total+" trigger observations • "+
      (best.r3>=.50?"3-tick confirmation supported.":"3-tick confirmation not required.")
  };
}

function selectParityEntry(d,selectedSide){
  const pattern=parityPatternStats(d,selectedSide);
  const reaction=parityReactionEntry(d,selectedSide);
  if(!pattern&&!reaction)return null;
  if(!pattern)return reaction;
  if(!reaction)return pattern;

  const winner=reaction.score>=pattern.score?reaction:pattern;
  const agreement=pattern.type!==reaction.type &&
    (reaction.trigger==="E"?"EVEN":"ODD")===selectedSide;
  if(agreement){
    return {...winner,
      confidence:Math.min(94,parseInt(winner.confidence,10)+3)+"%",
      reason:winner.reason+" Pattern and reaction evidence also agree with the selected signal."
    };
  }
  return winner;
}

function renderEvenOdd(root,d,last,n){
  const e=parityStats(d,state.selectedParity);
  const entryActive=e.signal==="SIGNAL"||e.signal==="STRONG SIGNAL";
  const entry=entryActive?selectParityEntry(d,state.selectedParity):null;
  const entryDisplay=entry||{
    main:entryActive?"NO STRONG ENTRY":"NO ACTIVE ENTRY",
    confidence:"—",
    reason:entryActive
      ?"No trigger has strong enough evidence of moving toward the selected Final Signal parity."
      :"Entry activates only when the selected parity has SIGNAL or STRONG SIGNAL."
  };
  const pattern=d.slice(-6).map(x=>x%2===0?"E":"O").join(" → ");
  const reason=e.signal==="STRONG SIGNAL"?"Multiple parity evidence layers are aligned for "+state.selectedParity+".":e.signal==="SIGNAL"?"The selected parity has sufficient multi-factor evidence, but it is not at STRONG SIGNAL level.":e.signal==="AVOID"?"The selected parity has unfavorable or conflicting evidence.":"Evidence for the selected parity is still developing.";
  root.innerHTML=panel(e.signal,reason,entryDisplay,[
    "Selected parity: "+state.selectedParity,
    "Recent parity: "+pattern,
    "20/50/100/250/500 rates: "+e.windows.map(x=>Math.round(x.rate*100)+"%").join(" / "),
    "Probability "+Math.round(e.probability*100)+" • momentum "+Math.round(e.momentumScore*100)+" • trend "+Math.round(e.trendScore*100)+" • transitions "+Math.round(e.transition*100),
    "Clustering "+Math.round(e.clustering*100)+" • recency "+Math.round(e.recency*100)+" • consistency "+Math.round(e.consistency*100)+" • historical "+Math.round(e.historical*100),
    "Streak "+e.streak+" • evidence "+Math.round(e.evidence*100),
    entry?"✓ STRONG ENTRY: "+entry.type+" trigger passed independent validation":entryActive?"× No strong pattern or reaction trigger passed validation":"× Entry inactive until SIGNAL or STRONG SIGNAL"
  ],n);
}
function riseFallAnalysis(d){
  if(d.length<25)return null;

  const windows=[20,50,100,250,500];
  const stats=[];
  for(const size of windows){
    const a=d.slice(-Math.min(size,d.length));
    let rise=0,fall=0,flat=0,upMove=0,downMove=0;
    for(let i=1;i<a.length;i++){
      const delta=a[i]-a[i-1];
      if(delta>0){rise++;upMove+=delta}
      else if(delta<0){fall++;downMove+=-delta}
      else flat++;
    }
    const directional=rise+fall;
    const rate=directional?rise/directional:.5;
    const moveTotal=upMove+downMove;
    const moveRate=moveTotal?upMove/moveTotal:.5;
    stats.push({size,available:a.length,rise,fall,flat,rate,moveRate,upMove,downMove,directional});
  }

  const usable=stats.filter(x=>x.directional>=10);
  if(!usable.length)return null;

  // Combine direction frequency with actual price movement. Recent windows
  // matter more, while the 500-tick window provides long-context stability.
  const weights=[.34,.26,.19,.13,.08];
  let directionScore=.5,moveScore=.5,totalWeight=0;
  for(let i=0;i<stats.length;i++){
    const s=stats[i],w=weights[i];
    if(s.directional<10)continue;
    directionScore+=w*(s.rate-.5);
    moveScore+=w*(s.moveRate-.5);
    totalWeight+=w;
  }
  directionScore=.5+(directionScore-.5)/Math.max(.01,totalWeight);
  moveScore=.5+(moveScore-.5)/Math.max(.01,totalWeight);

  const recent=d.slice(-60);
  let r=0,f=0,upMagnitude=0,downMagnitude=0;
  const dirs=[];
  for(let i=1;i<recent.length;i++){
    const delta=recent[i]-recent[i-1];
    if(delta>0){r++;upMagnitude+=delta;dirs.push("R")}
    else if(delta<0){f++;downMagnitude+=-delta;dirs.push("F")}
  }
  const directional=r+f;
  const recentRate=directional?r/directional:.5;
  const recentMove=(upMagnitude+downMagnitude)?upMagnitude/(upMagnitude+downMagnitude):.5;

  // Trend persistence: how often the current direction continues instead of
  // immediately reversing.
  let continuation=0,reversals=0,transitions=0;
  for(let i=1;i<dirs.length;i++){
    if(dirs[i]===dirs[i-1])continuation++;
    else reversals++;
    transitions++;
  }
  const persistence=transitions?continuation/transitions:.5;

  let streak=0;
  const lastDir=dirs.at(-1)||null;
  if(lastDir){
    for(let i=dirs.length-1;i>=0&&dirs[i]===lastDir;i--)streak++;
  }

  // Momentum uses both direction and average move size, normalized against the
  // recent movement distribution so a large price jump matters.
  const moves=[];
  for(let i=1;i<recent.length;i++)moves.push(Math.abs(recent[i]-recent[i-1]));
  const avgMove=moves.length?moves.reduce((a,b)=>a+b,0)/moves.length:0;
  const lastMove=recent.length>1?Math.abs(recent.at(-1)-recent.at(-2)):0;
  const impulse=avgMove?Math.min(1,lastMove/(avgMove*2.5)):.5;
  const momentum=(
    recentRate*.45+
    recentMove*.35+
    (lastDir==="R"?0.5+0.5*impulse:lastDir==="F"?0.5-0.5*impulse:.5)*.20
  );

  const trendRate=.55*directionScore+.45*moveScore;
  const trendSide=trendRate>=.5?"RISE":"FALL";
  const trendStrength=Math.abs(trendRate-.5)*2;
  const persistenceSide=lastDir==="R"?"RISE":lastDir==="FALL"?"FALL":trendSide;

  // Independent reversal pressure: if the latest streak is long but the
  // surrounding transitions are mostly reversals, reduce confidence.
  const reversalPressure=transitions?reversals/transitions:.5;
  const streakRisk=Math.min(1,Math.max(0,(streak-3)/5));
  const aligned=persistenceSide===trendSide;
  const evidence=Math.max(0,Math.min(1,
    trendStrength*.34+
    Math.abs(recentRate-.5)*2*.22+
    Math.abs(recentMove-.5)*2*.16+
    Math.abs(momentum-.5)*2*.12+
    persistence*.10
  ));

  const selected=trendSide;
  const selectedRate=selected==="RISE"?recentRate:1-recentRate;
  const selectedMove=selected==="RISE"?recentMove:1-recentMove;
  const selectedMomentum=selected==="RISE"?momentum:1-momentum;

  let signal="WAIT";
  if(evidence>=.64&&selectedRate>=.59&&selectedMove>=.56&&aligned&&usable.length>=3)signal="STRONG SIGNAL";
  else if(evidence>=.50&&selectedRate>=.55&&selectedMove>=.53&&usable.length>=2)signal="SIGNAL";
  else if(evidence<.25||selectedRate<.47||selectedMove<.47)signal="AVOID";

  // A reversal-heavy regime prevents a false strong signal.
  if(signal==="STRONG SIGNAL"&&reversalPressure>.68&&streakRisk>.45)signal="SIGNAL";

  return {
    signal,selected,stats,recentRate,recentMove,persistence,streak,lastDir,
    momentum,trendRate,trendStrength,evidence,reversalPressure,selectedRate,
    selectedMove,selectedMomentum,aligned,usableCount:usable.length
  };
}

function riseFallEntry(d,analysis){
  if(!analysis||!(analysis.signal==="SIGNAL"||analysis.signal==="STRONG SIGNAL"))return null;
  const target=analysis.selected;
  const key=(a,b)=>b>a?"R":b<a?"F":"X";
  const recent=d.slice(-500);
  const dirs=[];
  for(let i=1;i<recent.length;i++)dirs.push(key(recent[i-1],recent[i]));

  const candidates=[];
  for(const len of [1,2,3]){
    const seen=new Map();
    for(let i=0;i+len+2<dirs.length;i++){
      const pattern=dirs.slice(i,i+len).join(" → ");
      let p=seen.get(pattern);
      if(!p){p={pattern,len,total:0,r1:0,r2:0,r3:0,recentTotal:0,recentR1:0};seen.set(pattern,p)}
      p.total++;
      if(dirs[i+len]===(target==="RISE"?"R":"F"))p.r1++;
      if(dirs[i+len]===(target==="RISE"?"R":"F")&&dirs[i+len+1]===(target==="RISE"?"R":"F"))p.r2++;
      if(dirs[i+len]===(target==="RISE"?"R":"F")&&dirs[i+len+1]===(target==="RISE"?"R":"F")&&dirs[i+len+2]===(target==="RISE"?"R":"F"))p.r3++;
      if(i>=Math.max(0,dirs.length-160)){
        p.recentTotal++;
        if(dirs[i+len]===(target==="RISE"?"R":"F"))p.recentR1++;
      }
    }
    for(const p of seen.values()){
      if(p.total<8)continue;
      p.r1/=p.total;p.r2/=p.total;p.r3/=p.total;
      p.recentRate=p.recentTotal?p.recentR1/p.recentTotal:p.r1;
      const edge1=p.r1-.5,edge2=p.r2-.5,edge3=p.r3-.5,recentEdge=p.recentRate-.5;
      p.score=100*(Math.max(0,edge1)*.35+Math.max(0,edge2)*.25+Math.max(0,edge3)*.10+Math.max(0,recentEdge)*.20+Math.min(1,p.total/50)*.10)*2;
      candidates.push(p);
    }
  }
  candidates.sort((a,b)=>b.score-a.score||b.total-a.total);
  const best=candidates[0],second=candidates[1];
  if(!best)return null;
  const strong=(best.r1>=.55||best.r2>=.55)&&best.recentRate>=.52&&best.total>=10&&best.score>=55&&(!second||best.score-second.score>=1);
  if(!strong)return null;

  let confidence=Math.round(70+(best.r1-.5)*55+(best.r2-.5)*45+(best.r3-.5)*20+(best.recentRate-.5)*30+Math.min(6,best.total/25));
  if(best.r3>=.50)confidence+=4;
  else if(best.r3<.38)confidence-=2;
  confidence=Math.max(72,Math.min(94,confidence));

  return {
    type:"PATTERN",status:"STRONG ENTRY",
    main:best.pattern+" → "+target,
    confidence:confidence+"%",
    reason:best.r1>=.55&&best.r2>=.55
      ?"Strong price-direction trigger with favorable immediate and 2-tick continuation toward "+target+"."
      :best.r1>=.55
      ?"Strong immediate trigger reaction toward "+target+"; longer continuation is mixed."
      :"Strong 2-tick trigger continuation toward "+target+" despite a weaker first move.",
    evidence:best.total+" trigger observations • "+(best.r3>=.50?"3-tick confirmation supported.":"3-tick confirmation not required.")
  };
}

function renderRiseFall(root,d,last,n){
  const a=riseFallAnalysis(d);
  if(!a){
    root.innerHTML=panel("INSUFFICIENT DATA","More live price ticks are required for reliable Rise/Fall analysis.",null,["Need at least 25 price ticks","Analysis uses actual price movement, not last-digit parity"],n);
    return;
  }

  const entry=riseFallEntry(d,a);
  const entryDisplay=entry||{
    main:a.signal==="SIGNAL"||a.signal==="STRONG SIGNAL"?"NO STRONG ENTRY":"NO ACTIVE ENTRY",
    confidence:"—",
    reason:a.signal==="SIGNAL"||a.signal==="STRONG SIGNAL"
      ?"No price-direction trigger has strong enough follow-through evidence yet."
      :"Entry activates only when Rise/Fall reaches SIGNAL or STRONG SIGNAL."
  };

  const latest=a.stats.map(x=>x.directional>=10
    ?Math.round((x.rate*100))+"% R"
    :"—").join(" / ");

  const side=a.selected;
  const reason=a.signal==="STRONG SIGNAL"
    ?"Multi-window price direction, movement magnitude, momentum and persistence are aligned for "+side+"."
    :a.signal==="SIGNAL"
    ?"Price direction currently favors "+side+", but evidence is below the strongest alignment level."
    :a.signal==="AVOID"
    ?"Price movement is conflicting or unfavorable for a reliable directional setup."
    :"Rise/Fall evidence is still developing.";

  const recentPattern=d.slice(-8).reduce((acc,x,i,a)=>{
    if(i===0)return acc;
    const p=a[i-1];
    return acc.concat(x>p?"R":x<p?"F":"X");
  },[]).join(" → ");

  root.innerHTML=panel(a.signal,reason,entryDisplay,[
    "Selected direction: "+side,
    "Recent price direction: "+recentPattern,
    "20/50/100/250/500 direction rates: "+latest,
    "Recent 60: "+Math.round(a.recentRate*100)+"% RISE • "+Math.round((1-a.recentRate)*100)+"% FALL",
    "Movement-weighted: "+Math.round(a.recentMove*100)+"% RISE • trend score "+Math.round(a.trendRate*100)+"%",
    "Momentum "+Math.round(a.momentum*100)+" • persistence "+Math.round(a.persistence*100)+" • streak "+a.streak,
    "Reversal pressure "+Math.round(a.reversalPressure*100)+" • evidence "+Math.round(a.evidence*100)+"%",
    entry?"✓ STRONG ENTRY: price-direction trigger passed validation":a.signal==="SIGNAL"||a.signal==="STRONG SIGNAL"?"× No strong price-direction trigger yet":"× Entry inactive until SIGNAL or STRONG SIGNAL"
  ],n);
}
document.querySelectorAll(".parity-side").forEach(btn=>btn.addEventListener("click",()=>{state.selectedParity=btn.dataset.parity;renderParityControls();renderEngine()}));
document.querySelectorAll(".ou-digit").forEach(btn=>btn.addEventListener("click",()=>{state.selectedDigit=Number(btn.dataset.digit);renderOUControls();renderEngine()}));
document.querySelectorAll(".ou-side").forEach(btn=>btn.addEventListener("click",()=>{state.selectedSide=btn.dataset.side;renderOUControls();renderEngine()}));
document.querySelectorAll(".engine-tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".engine-tab").forEach(b=>b.classList.remove("active"));btn.classList.add("active");state.engine=btn.dataset.engine;renderEngine()}));
marketSelect.addEventListener("change",()=>{const m=state.markets.find(x=>x.symbol===marketSelect.value);if(m){state.symbol=m.symbol;state.marketName=m.name;$("marketName").textContent=m.name;state.marketStarted=false;startMarket(true)}});
let touchX=0,touchY=0;
document.querySelector(".engine-nav").addEventListener("touchstart",e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY},{passive:true});
document.querySelector(".engine-nav").addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)){const names=["overunder","evenodd","risefall"],i=names.indexOf(state.engine),next=names[Math.max(0,Math.min(2,i+(dx<0?1:-1)))];document.querySelector(`[data-engine="${next}"]`).click()}},{passive:true});
setInterval(()=>{if(state.lastTickAt){$("diagAge").textContent=Math.round((Date.now()-state.lastTickAt)/1000)+"s";if(Date.now()-state.lastTickAt>15000&&state.connected)setStatus("offline","Waiting for data")}},1000);
connect();