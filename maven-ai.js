/* Maven FX local rule-based analyst. No network access or external AI provider. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const panel=$("mavenAIChat"),fab=$("mavenAIFab"),close=$("mavenAIClose"),form=$("mavenAIForm"),input=$("mavenAIInput"),messages=$("mavenAIMessages");
  if(!panel||!fab||!close||!form||!input||!messages)return;
  const escapeHtml=s=>String(s).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  function addMessage(text,who){
    const item=document.createElement("div");item.className="maven-ai-message "+who;item.textContent=text;messages.appendChild(item);messages.scrollTop=messages.scrollHeight;
  }
  function getContext(){
    try{return typeof window.mavenAIGetContext==="function"?window.mavenAIGetContext():null}catch{return null}
  }
  function explain(question){
    const q=String(question||"").trim().toLowerCase(),c=getContext();
    if(!q)return "Ask about the current signal, digit distribution, entry digits, or how Maven AI works.";
    if(/privacy|private|network|internet|send data|online|api key/.test(q))return "Maven AI runs locally in this page using deterministic rules and the live context already available in your browser. The AI feature makes no external requests and sends no tick history or signal data to an AI provider. Your existing Deriv connection and optional Auto Trade connection remain separate.";
    if(!c)return "The local analyst panel is ready, but the live analysis context is not available yet. Wait for the page to finish loading, then ask again.";
    const engine=String(c.engine||"").toUpperCase();
    if(/help|what can|commands|ask/.test(q))return "I can explain the current Over/Under signal, the 1,000-tick distribution gate, highlighted digits, entry-digit exclusions, and local privacy. I am a local rule-based/statistical analyst, not a remote generative model.";
    if(/distribution|10\.5|red|green|bar|highlight|most|least/.test(q)){
      const d=c.distribution||{},signal=c.signal;
      if(!d.total)return "No digits have arrived yet, so there is no distribution to inspect.";
      const fmt=i=>i+" ("+(Number(d.percentages?.[i]||0).toFixed(1))+"%)";
      const group=c.selectedSide==="OVER"?Array.from({length:c.selectedDigit+1},(_,i)=>i):Array.from({length:10-c.selectedDigit},(_,i)=>c.selectedDigit+i);
      const flagged=group.filter(i=>(d.most||[]).includes(i)||(d.least||[]).includes(i));
      const high=group.filter(i=>Number(d.percentages?.[i]||0)>=10.5);
      if(engine!=="OVERUNDER")return "The active engine is "+engine+". The rolling distribution currently contains "+d.total+" ticks. Most-highlighted digit(s): "+((d.most||[]).map(fmt).join(", ")||"none")+". Least-highlighted digit(s): "+((d.least||[]).map(fmt).join(", ")||"none")+".";
      return "For "+c.selectedSide+" "+c.selectedDigit+", the gate checks digits "+group.join(", ")+". It requires a complete 1,000-tick window; each required digit must be strictly below 10.5% and have no red LEAST or green MOST highlight. Current window: "+d.total+"/1,000. Digits at/above 10.5%: "+(high.map(fmt).join(", ")||"none")+". Highlighted digits in this group: "+(flagged.map(fmt).join(", ")||"none")+". Gate: "+(signal?(signal.distributionReady?(signal.distributionPass?"PASS":"BLOCKED"):"WAITING FOR 1,000 TICKS"):"not yet evaluated")+".";
    }
    if(/entry|candidate|entry digit/.test(q)){
      if(engine!=="OVERUNDER")return "Entry-digit bar exclusions currently apply to the Over/Under entry engine. The "+engine+" engine is unchanged.";
      const entries=c.signal?.entries||[];
      return "Over/Under entry digits with a red LEAST or green MOST bar are excluded before the existing entry qualification is applied. Extreme-digit safeguards also remain: Under excludes 0 and 1; Over excludes 8 and 9. Current signal: "+(c.signal?.value||"WAIT")+". Eligible entry candidates: "+(entries.length?entries.map(x=>x.digit+" ("+x.score+"/100, "+x.status+")").join("; "):"none currently qualified")+". A missing candidate is not replaced with a barred digit.";
    }
    if(/why|signal|setup|decision|status|blocked|avoid|wait|strong/.test(q)){
      if(engine!=="OVERUNDER")return "Current market: "+c.market+" ("+c.symbol+"). Active engine: "+engine+". Latest digit: "+(c.lastDigit===null?"not available":c.lastDigit)+". This local analyst has not changed the "+engine+" engine's signal rules.";
      const s=c.signal||{};
      return "Current setup: "+c.selectedSide+" "+c.selectedDigit+" on "+c.market+". Final signal: "+(s.value||"WAIT")+". Distribution gate: "+(s.distributionReady?(s.distributionPass?"PASS":"BLOCKED"):"WAIT — full 1,000-tick window required")+". "+(s.reason||"Collecting evidence.")+(s.probabilityConflict?" The complementary probability comparison is also blocking this setup.":"")+". Evidence score: "+(Number.isFinite(s.evidence)?Math.round(s.evidence*100)+"/100":"not available")+". This is statistical analysis, not a guarantee of the next tick.";
    }
    return "I can help with the current signal, digit distribution, entry digits, and privacy. Try: “Why is the signal blocked?”, “Explain distribution”, “Which entry digits are eligible?”, or “Is my data sent outside this page?”";
  }
  function open(){panel.classList.add("open");panel.setAttribute("aria-hidden","false");fab.setAttribute("aria-expanded","true");input.focus()}
  function shut(){panel.classList.remove("open");panel.setAttribute("aria-hidden","true");fab.setAttribute("aria-expanded","false");fab.focus()}
  fab.addEventListener("click",()=>panel.classList.contains("open")?shut():open());
  close.addEventListener("click",shut);
  panel.querySelectorAll("[data-maven-ai-question]").forEach(btn=>btn.addEventListener("click",()=>{const q=btn.getAttribute("data-maven-ai-question")||"";addMessage(q,"user");addMessage(explain(q),"assistant")}));
  form.addEventListener("submit",event=>{event.preventDefault();const q=input.value.trim();if(!q)return;addMessage(q,"user");addMessage(explain(q),"assistant");input.value="";input.focus()});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&panel.classList.contains("open"))shut()});
  addMessage("I’m Maven AI Analyst, a local rule-based assistant. I can explain the current Over/Under gate and eligible entry digits. I do not use an external AI service.","assistant");
})();
