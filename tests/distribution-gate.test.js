const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const gateStart = appSource.indexOf('function distributionGate');
assert.notEqual(gateStart, -1, 'distributionGate must exist in app.js');
const nextFunction = appSource.indexOf('\nfunction ', gateStart + 10);
const gateSource = appSource.slice(gateStart, nextFunction);
const distributionGate = vm.runInNewContext(gateSource + '\ndistributionGate');

function digitsFromCounts(counts) {
  return counts.flatMap((count, digit) => Array(count).fill(digit));
}

const overPassTicks = digitsFromCounts([100,100,100,110,90,100,100,100,100,100]);
const underPassTicks = digitsFromCounts([100,100,100,100,100,90,110,100,100,100]);
const boundaryTicks = digitsFromCounts([105,110,95,99,99,99,99,98,98,98]);

test('waits until exactly 1,000 ticks are available', () => {
  const result = distributionGate(Array(999).fill(2), 2, 'OVER');
  assert.equal(result.ready, false);
  assert.equal(result.pass, false);
  assert.equal(result.total, 999);
});

test('OVER checks the selected digit and every digit below it', () => {
  const result = distributionGate(overPassTicks, 2, 'OVER');
  assert.equal(result.ready, true);
  assert.equal(result.pass, true);
  assert.equal(Array.from(result.checks, x => x.digit).join(','), '0,1,2');
});

test('UNDER checks the selected digit and every digit above it', () => {
  const result = distributionGate(underPassTicks, 7, 'UNDER');
  assert.equal(result.ready, true);
  assert.equal(result.pass, true);
  assert.equal(Array.from(result.checks, x => x.digit).join(','), '7,8,9');
});

test('blocks a required digit at exactly 10.5%, even without a highlight', () => {
  const result = distributionGate(boundaryTicks, 0, 'OVER');
  const zero = result.failures.find(x => x.digit === 0);
  assert.equal(zero.percent, 10.5);
  assert.equal(zero.most, false);
  assert.equal(zero.least, false);
  assert.equal(result.pass, false);
});

test('blocks a green MOST digit when it is inside the required group', () => {
  const result = distributionGate(overPassTicks, 3, 'OVER');
  assert.equal(result.pass, false);
  assert.equal(result.failures.some(x => x.digit === 3 && x.most), true);
});

test('blocks a red LEAST digit when it is inside the required group', () => {
  const result = distributionGate(overPassTicks, 4, 'OVER');
  assert.equal(result.pass, false);
  assert.equal(result.failures.some(x => x.digit === 4 && x.least), true);
});

test('does not block because of a highlight outside the required group', () => {
  const result = distributionGate(overPassTicks, 2, 'OVER');
  assert.equal(result.pass, true);
  assert.equal(result.failures.length, 0);
});

test('uses the most recent 1,000 ticks when the input is longer', () => {
  const result = distributionGate([...Array(30).fill(9), ...overPassTicks], 2, 'OVER');
  assert.equal(result.ready, true);
  assert.equal(result.total, 1000);
  assert.equal(result.pass, true);
});

test('manual bot entry digits replace automatic digits and only require unbarred distribution digits', () => {
  assert.ok(appSource.includes('function overUnderEntry(d,selectedDigit,selectedSide,onlyCandidates=null)'));
  assert.ok(appSource.includes('function autoTradeEntrySelection()'));
  const selectionStart = appSource.indexOf('function autoTradeEntrySelection');
  const selectionEnd = appSource.indexOf('function renderParityControls', selectionStart);
  const selection = appSource.slice(selectionStart, selectionEnd);
  assert.ok(selection.includes('distributionBarFlags(state.digits)'));
  assert.ok(selection.includes('bars.most[digit]||bars.least[digit]'));
  assert.ok(!selection.includes('overUnderEntry'));
  assert.ok(appSource.includes('const candidates=autoTradeEntrySelection()'));
  const page = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(page.includes('id="autoTradeManualEntriesEnabled"'));
  assert.ok(page.includes('id="autoTradeManualDigit1"'));
  assert.ok(page.includes('id="autoTradeManualDigit2"'));
});

test('app.js remains syntactically valid', () => {
  // Node's parser check is run by the workflow with: node --check app.js
  assert.match(appSource, /function distributionGate/);
});

test('distribution failure forces Final Signal to AVOID in the existing evidence pipeline', () => {
  const evidenceStart = appSource.indexOf('function overUnderEvidence');
  assert.notEqual(evidenceStart, -1, 'overUnderEvidence must exist in app.js');
  const evidenceEnd = appSource.indexOf('\nfunction ', evidenceStart + 10);
  const evidenceSource = appSource.slice(evidenceStart, evidenceEnd);
  const harness = `
    const ouStats = () => ({
      momentum: 0, trend: 0, weightedTransitionRate: .6, long: .5,
      recent: .5, short50: .5, mid250: .5, medium: .5,
      cluster: .5, streak: 2, transitions: 10, transitionRate: .6
    });
    const ouRate = () => .5;
    const mavenAIDecisionLayer = (engine,baseSignal,evidence,alignment,conflict,hardGate,sample) => ({signal:baseSignal,baseSignal,confidence:Number(evidence)||0,adjustedAlignment:alignment,adjustedEvidence:Number(evidence)||0,reason:"test harness"});
    ${gateSource}
    ${evidenceSource}
    overUnderEvidence
  `;
  const runEvidence = vm.runInNewContext(harness);
  const blocked = runEvidence(overPassTicks, 3, 'OVER');
  assert.equal(blocked.distribution.pass, false);
  assert.equal(blocked.signal, 'AVOID');
});

test('complementary probability conflict still blocks a distribution-passing setup', () => {
  const evidenceStart = appSource.indexOf('function overUnderEvidence');
  const evidenceEnd = appSource.indexOf('\nfunction ', evidenceStart + 10);
  const evidenceSource = appSource.slice(evidenceStart, evidenceEnd);
  const harness = `
    const ouStats = () => ({
      momentum: 0, trend: 0, weightedTransitionRate: .6, long: .5,
      recent: .5, short50: .5, mid250: .5, medium: .5,
      cluster: .5, streak: 2, transitions: 10, transitionRate: .6
    });
    const ouRate = (d, digit, side) => digit === 7 && side === 'UNDER' ? .7 : .5;
    const mavenAIDecisionLayer = (engine,baseSignal,evidence,alignment,conflict,hardGate,sample) => ({signal:baseSignal,baseSignal,confidence:Number(evidence)||0,adjustedAlignment:alignment,adjustedEvidence:Number(evidence)||0,reason:"test harness"});
    ${gateSource}
    ${evidenceSource}
    overUnderEvidence
  `;
  const runEvidence = vm.runInNewContext(harness);
  const result = runEvidence(overPassTicks, 2, 'OVER');
  assert.equal(result.distribution.pass, true);
  assert.equal(result.probabilityConflict, true);
  assert.equal(result.signal, 'WAIT');
});

test('distributionBarFlags matches the displayed MOST and LEAST bars', () => {
  const start = appSource.indexOf('function distributionBarFlags');
  assert.notEqual(start, -1, 'distributionBarFlags must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const run = vm.runInNewContext(source + '\ndistributionBarFlags');
  const flags = run([0,0,1,1,2,2,3,3,4,5]);
  assert.deepEqual(Array.from(flags.most, (v,i)=>v?i:null).filter(v=>v!==null), [0,1,2,3]);
  assert.deepEqual(Array.from(flags.least, (v,i)=>v?i:null).filter(v=>v!==null), [6,7,8,9]);
});

test('Over/Under entry loop explicitly rejects both highlighted distribution bars', () => {
  const entryStart = appSource.indexOf('function overUnderEntry');
  assert.notEqual(entryStart, -1);
  const entryEnd = appSource.indexOf('\nfunction ', entryStart + 10);
  const entrySource = appSource.slice(entryStart, entryEnd);
  assert.match(entrySource, /entryBars\.most\[candidate\]\|\|entryBars\.least\[candidate\]/);
});

test('local Maven AI module contains no network APIs or remote model calls', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'maven-ai.js'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//i);
  assert.match(source, /mavenAIGetContext/);
});

test('one qualified Over/Under entry candidate is visibly marked incomplete without changing Final Signal logic', () => {
  const start = appSource.indexOf('function entryHtml');
  assert.notEqual(start, -1, 'entryHtml must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  assert.match(source, /e\.status==="1 VALID CANDIDATE"&&e\.entries\.length===1/);
  assert.match(source, /SECOND DIGIT NOT QUALIFIED/);
  assert.match(source, /entry-pending/);
  // Entry candidates are displayed separately; this UI clarification does not gate the Final Signal.
  const evidenceStart = appSource.indexOf('function overUnderEvidence');
  const evidenceEnd = appSource.indexOf('\nfunction ', evidenceStart + 10);
  const evidenceSource = appSource.slice(evidenceStart, evidenceEnd);
  assert.doesNotMatch(evidenceSource, /overUnderEntry/);
});

test('Over/Under reaction depth preserves valid one-tick evidence when longer horizons are unavailable', () => {
  const start = appSource.indexOf('function ouReactionDepth');
  assert.notEqual(start, -1, 'ouReactionDepth must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const run = vm.runInNewContext(source + '\nouReactionDepth');
  const result = run([5, 6], 5, 4, 'OVER');
  assert.equal(result.n1, 1);
  assert.equal(result.r1, 1);
  assert.equal(result.n2, 0);
  assert.equal(result.n3, 0);
});

test('Over/Under reaction depth preserves two-tick continuation without requiring three ticks', () => {
  const start = appSource.indexOf('function ouReactionDepth');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const run = vm.runInNewContext(source + '\nouReactionDepth');
  const result = run([5, 6, 7], 5, 4, 'OVER');
  assert.equal(result.n1, 1);
  assert.equal(result.r1, 1);
  assert.equal(result.n2, 1);
  assert.equal(result.r2, 1);
  assert.equal(result.n3, 0);
});

test('complementary Over/Under digit mapping is symmetric for all five pairs', () => {
  const start = appSource.indexOf('function overUnderEvidence');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const evidenceSource = appSource.slice(start, end);
  const harness = `
    const ouStats = () => ({
      momentum: 0, trend: 0, weightedTransitionRate: .6, long: .5,
      recent: .5, short50: .5, mid250: .5, medium: .5,
      cluster: .5, streak: 2, transitions: 10, transitionRate: .6
    });
    const ouRate = () => .5;
    const mavenAIDecisionLayer = (engine,baseSignal,evidence,alignment,conflict,hardGate,sample) => ({signal:baseSignal,baseSignal,confidence:Number(evidence)||0,adjustedAlignment:alignment,adjustedEvidence:Number(evidence)||0,reason:"test harness"});
    ${gateSource}
    ${evidenceSource}
    overUnderEvidence
  `;
  const runEvidence = vm.runInNewContext(harness);
  for (let digit = 0; digit <= 4; digit++) {
    const over = runEvidence(overPassTicks, digit, 'OVER');
    const under = runEvidence(underPassTicks, 9 - digit, 'UNDER');
    assert.equal(over.oppositeDigit, 9 - digit, 'OVER ' + digit + ' should pair with UNDER ' + (9 - digit));
    assert.equal(under.oppositeDigit, digit, 'UNDER ' + (9 - digit) + ' should pair with OVER ' + digit);
  }
});

test('spike-risk protection blocks entry eligibility without overwriting the directional Final Signal', () => {
  const start = appSource.indexOf('function applySpikeRiskProtection');
  assert.notEqual(start, -1, 'applySpikeRiskProtection must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  assert.match(source, /Spike risk blocks entry eligibility only/);
  assert.match(source, /NO ENTRY — SPIKE RISK/);
  assert.match(source, /Final Signal remains the engine analysis/);
  assert.doesNotMatch(source, /signal\.textContent\s*=\s*["']ENTRY BLOCKED/);
  assert.doesNotMatch(source, /reason\.textContent\s*=/);
});

test('spike-risk refresh uses a removable note marker to avoid stacking warnings', () => {
  const start = appSource.indexOf('function applySpikeRiskProtection');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  assert.match(source, /querySelectorAll\("\.spike-risk-note"\)\.forEach\(node=>node\.remove\(\)\)/);
  assert.match(source, /className="block spike-risk-note"/);
  assert.match(source, /className="spike-risk-note"/);
});


test('Wilson intervals expose uncertainty and remain bounded for live hit rates', () => {
  const start = appSource.indexOf('function wilsonInterval');
  assert.notEqual(start, -1);
  const end = appSource.indexOf('\nfunction ', start + 10);
  const wilsonInterval = vm.runInNewContext(appSource.slice(start, end) + '\nwilsonInterval');
  const small = wilsonInterval(5, 10);
  assert.ok(small.low > 0.2 && small.low < 0.3);
  assert.ok(small.high > 0.7 && small.high < 0.8);
  assert.ok(small.low < 0.5 && small.high > 0.5);
  assert.equal(wilsonInterval(0, 0), null);
  assert.equal(wilsonInterval(11, 10), null);
  const perfect = wilsonInterval(10, 10);
  assert.ok(perfect.low < 1 && perfect.high <= 1);
});

test('Over/Under validation scores only a candidate triggered immediately after its analysis snapshot', () => {
  const start = appSource.indexOf('function recordOUValidationTrigger');
  assert.notEqual(start, -1);
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const makeHarness = tickCount => `
    const state = {
      engine: 'overunder', symbol: 'R_100', selectedDigit: 2, selectedSide: 'OVER',
      ticks: Array(100).fill({ quote: 100 }), liveTickSequence: 100, validationDirty: false,
      ouEntrySnapshot: { key: 'R_100|2|OVER', tickCount: ${tickCount}, active: true, digits: [4], validationDigits: [4], confidence: .8 },
      ouValidation: { pending: [], lastTrigger: '' }, ouValidationBook: {}
    };
    const resetOUValidationIfNeeded = () => {};
    const ouValidationKey = () => 'R_100|2|OVER';
    const ouValidationRecordKey = () => 'R_100|2|OVER|4';
    ${source}
    ({run:recordOUValidationTrigger,state})
  `;
  const fresh = vm.runInNewContext(makeHarness(99)); fresh.run(4);
  const stale = vm.runInNewContext(makeHarness(98)); stale.run(4);
  assert.equal(fresh.state.ouValidation.pending.length, 1);
  assert.equal(stale.state.ouValidation.pending.length, 0);
});

test('signal validation uses the monotonic live sequence after the tick buffer is full', () => {
  const start = appSource.indexOf('function processSignalValidationTick');
  assert.notEqual(start, -1);
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const makeHarness = snapshotTick => `
    const state = {
      symbol: 'R_100', liveTickSequence: 5001,
      ticks: Array(2000).fill({quote: 100}), selectedDigit: 2, selectedSide: 'OVER',
      signalValidation: {
        snapshot: {active: true, market: 'R_100', engine: 'overunder', target: 'OVER 2', side: 'OVER', selectedDigit: 2, tickCount: ${snapshotTick}, confidence: .8},
        book: {}
      }, validationDirty: false
    };
    const signalValidationKey = (engine,target,market) => market+'|'+engine+'|'+target;
    ${source}
    ({run:processSignalValidationTick,state})
  `;
  const fresh = vm.runInNewContext(makeHarness(5000));
  fresh.run(4, 101, 100);
  const rec = fresh.state.signalValidation.book['R_100|overunder|OVER 2'];
  assert.equal(rec.n, 1);
  assert.equal(rec.hits, 1);
  const stale = vm.runInNewContext(makeHarness(4999));
  stale.run(4, 101, 100);
  assert.equal(Object.keys(stale.state.signalValidation.book).length, 0);
});

test('validation snapshots are discarded when the active engine changes before the next tick', () => {
  const signalStart = appSource.indexOf('function processSignalValidationTick');
  const signalEnd = appSource.indexOf('\nfunction ', signalStart + 10);
  const signalSource = appSource.slice(signalStart, signalEnd);
  const signalHarness = `
    const state = {
      symbol: 'R_100', engine: 'risefall', liveTickSequence: 101,
      signalValidation: {snapshot: {active: true, market: 'R_100', engine: 'evenodd', target: 'EVEN', tickCount: 100, confidence: .8}, book: {}},
      validationDirty: false
    };
    const signalValidationKey = (engine,target,market) => market+'|'+engine+'|'+target;
    ${signalSource}
    ({run:processSignalValidationTick,state})
  `;
  const signal = vm.runInNewContext(signalHarness);
  signal.run(2, 101, 100);
  assert.equal(Object.keys(signal.state.signalValidation.book).length, 0);
  assert.equal(signal.state.signalValidation.snapshot, null);

  const otherStart = appSource.indexOf('function processOtherValidationTick');
  const otherEnd = appSource.indexOf('\nfunction ', otherStart + 10);
  const otherSource = appSource.slice(otherStart, otherEnd);
  const otherHarness = `
    const state = {
      symbol: 'R_100', engine: 'risefall', liveTickSequence: 101,
      otherValidation: {snapshot: {active: true, market: 'R_100', engine: 'evenodd', target: 'EVEN', tickCount: 100, confidence: .8}, pending: [], book: {}},
      validationDirty: false
    };
    const otherValidationKey = (engine,target,market) => market+'|'+engine+'|'+target;
    const scoreOtherValidationPending = () => { throw new Error('no pending forecast should be scored'); };
    ${otherSource}
    ({run:processOtherValidationTick,state})
  `;
  const other = vm.runInNewContext(otherHarness);
  other.run(2, 101, 100);
  assert.equal(Object.keys(other.state.otherValidation.book).length, 0);
  assert.equal(other.state.otherValidation.snapshot, null);
});

test('bot entry validation refuses an incomplete or duplicated entry pair', () => {
  const start = appSource.indexOf('function autoTradeReadyToEnter');
  assert.notEqual(start, -1, 'autoTradeReadyToEnter must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const harness = `
    const autoTrade = { enabled: true, authorized: true };
    const state = {
      connected: true, lastTickAt: Date.now(), engine: 'overunder',
      digits: Array(100).fill(2), symbol: 'R_100',
      ouSignalSnapshot: { tickCount: 100, key: 'R_100|2|OVER', active: true, signal: 'STRONG SIGNAL' },
      ouEntrySnapshot: { key: 'R_100|2|OVER', active: true, digits: [3] }
    };
    const ouValidationKey = () => 'R_100|2|OVER';
    const autoTradeEntrySelection = () => state.ouEntrySnapshot?.active ? state.ouEntrySnapshot.digits : [];
    const $ = () => ({ checked: false });
    const spikeRiskAssessment = () => ({ level: 'LOW', title: 'LOW SPIKE RISK' });
    ${source}
    autoTradeReadyToEnter
  `;
  const ready = vm.runInNewContext(harness);
  assert.equal(ready(3).ok, false);
  assert.match(ready(3).reason, /exactly two distinct validated entry digits/);

  const distinctPairHarness = harness.replace('digits: [3]', 'digits: [3, 4]');
  const readyWithPair = vm.runInNewContext(distinctPairHarness);
  assert.equal(readyWithPair(3).ok, true);
  assert.equal(readyWithPair(4).ok, true);

  const duplicatePairHarness = harness.replace('digits: [3]', 'digits: [3, 3]');
  const readyWithDuplicates = vm.runInNewContext(duplicatePairHarness);
  assert.equal(readyWithDuplicates(3).ok, false);
});


test('Even/Odd waits for at least 100 observed digits before issuing a signal', () => {
  const start = appSource.indexOf('function parityStats');
  assert.notEqual(start, -1, 'parityStats must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const run = vm.runInNewContext(source + '\nparityStats', {mavenAIDecisionLayer:(engine,baseSignal,evidence,alignment,conflict,hardGate,sample)=>({signal:baseSignal,baseSignal,confidence:Number(evidence)||0,adjustedAlignment:alignment,adjustedEvidence:Number(evidence)||0,reason:'test harness'})});
  const result = run(Array(99).fill(2), 'EVEN');
  assert.equal(result.signal, 'WAIT');
});

test('Even/Odd entry requires a current live trigger and does not rely on a historical pattern alone', () => {
  const start = appSource.indexOf('function selectParityEntry');
  assert.notEqual(start, -1, 'selectParityEntry must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const harness = `
    const parityPatternStats = () => ({
      type: 'PATTERN', status: 'STRONG ENTRY', main: 'E → EVEN',
      confidence: '80%', score: 8, reason: 'test', evidence: 'test'
    });
    const parityReactionEntry = () => null;
    ${source}
    selectParityEntry
  `;
  const run = vm.runInNewContext(harness);
  assert.equal(run([1, 3, 5, 7, 9, 1, 3, 5, 7, 9], 'EVEN'), null,
    'a historical candidate must not pass without a current matching trigger and follow-through');
  const confirmed = run([1, 3, 5, 7, 9, 2, 4], 'EVEN');
  assert.ok(confirmed, 'a matching live trigger with one-tick follow-through may qualify');
  assert.match(confirmed.evidence, /live trigger matched/);
});

test('Even/Odd renderer only activates entry validation for SIGNAL or STRONG SIGNAL', () => {
  const start = appSource.indexOf('function renderEvenOdd');
  assert.notEqual(start, -1);
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  assert.ok(source.includes('e.signal==="SIGNAL"||e.signal==="STRONG SIGNAL"'));
  assert.match(source, /entryActive\?selectParityEntry/);
});

test('Rise/Fall waits for its minimum 30 price observations before analysis', () => {
  const start = appSource.indexOf('function riseFallAnalysis');
  assert.notEqual(start, -1, 'riseFallAnalysis must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const run = vm.runInNewContext(source + '\nriseFallAnalysis', {
    state: { selectedRiseFall: 'RISE' },
    mavenAIDecisionLayer: (engine,baseSignal,evidence,alignment,conflict,hardGate,sample) => ({signal:baseSignal,baseSignal,confidence:Number(evidence)||0,reason:'test harness'})
  });
  const result = run(Array.from({ length: 29 }, (_, i) => i + 100));
  assert.equal(result, null);
});

test('Rise/Fall entry rejects inactive signals and requires current pattern follow-through', () => {
  const start = appSource.indexOf('function riseFallEntry');
  assert.notEqual(start, -1, 'riseFallEntry must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const run = vm.runInNewContext(source + '\nriseFallEntry');
  assert.equal(run(Array(100).fill(100), { signal: 'WAIT', selected: 'RISE' }), null);
  assert.equal(run(Array.from({ length: 100 }, (_, i) => i), { signal: 'SIGNAL', selected: 'RISE' }), null,
    'a trend alone must not count as an entry without a qualified historical trigger');
});

test('Rise/Fall renderer only activates entry validation for SIGNAL or STRONG SIGNAL', () => {
  const start = appSource.indexOf('function renderRiseFall(root');
  assert.notEqual(start, -1);
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  assert.match(source, /const rawEntry=riseFallEntry\(prices,a\)/);
  assert.ok(source.includes('setOtherValidationForecast("risefall",state.selectedRiseFall,a.signal,!!entry,state.liveTickSequence'));
  const validationStart = appSource.indexOf('function setOtherValidationForecast');
  const validationEnd = appSource.indexOf('\nfunction ', validationStart + 10);
  assert.match(appSource.slice(validationStart, validationEnd), /const active=\(signal==="SIGNAL"\|\|signal==="STRONG SIGNAL"\)&&hasEntry/);
});

test('shared spike-risk protection blocks entry display without replacing any engine Final Signal', () => {
  const start = appSource.indexOf('function applySpikeRiskProtection');
  assert.notEqual(start, -1);
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  assert.match(source, /NO ENTRY — SPIKE RISK/);
  assert.match(source, /Final Signal remains the engine analysis/);
  assert.doesNotMatch(source, /signal\.textContent\s*=/);
});


test('Deep Scanner re-evaluates candidates when live scanner ticks arrive', () => {
  const start = appSource.indexOf('function receiveScannerTick');
  assert.notEqual(start, -1, 'receiveScannerTick must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  assert.match(source, /r\.lastTickAt=Date\.now\(\)/);
  assert.match(source, /deepScannerEvaluate\(false\)/,
    'live scanner ticks must trigger the throttled candidate evaluation');
  assert.ok(source.indexOf('r.lastTickAt=Date.now()') < source.indexOf('deepScannerEvaluate(false)'));
});

test('Deep Scanner can assess a market from a fresh Deriv history while live subscription warms up', () => {
  const start = appSource.indexOf('function scannerRisk');
  assert.notEqual(start, -1, 'scannerRisk must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  const run = vm.runInNewContext(source + '\nscannerRisk', { state: { connected: true }, Date });
  const now = Math.floor(Date.now() / 1000);
  const record = {
    lastTickAt: 0,
    ticks: Array.from({ length: 120 }, (_, i) => ({ quote: 100 + i, epoch: now - (119 - i) }))
  };
  assert.equal(run(record).level, 'LOW',
    'fresh historical Deriv ticks should be eligible for risk assessment before a live subscription tick arrives');
  record.ticks[record.ticks.length - 1].epoch = now - 180;
  assert.equal(run(record).level, 'UNKNOWN',
    'stale Deriv history must not be treated as fresh');
});

test('Deep Scanner requests the full 1,000-tick window required by the distribution gate', () => {
  const scannerStart = appSource.indexOf('function syncDeepScannerSubscriptions');
  const scannerEnd = appSource.indexOf('\nfunction receiveScannerTick', scannerStart);
  assert.notEqual(scannerStart, -1, 'syncDeepScannerSubscriptions must exist');
  const subscriptionSource = appSource.slice(scannerStart, scannerEnd);
  assert.match(subscriptionSource, /ticks_history:m\.symbol,end:"latest",count:1000/);

  const scanStart = appSource.indexOf('function startDeepScan');
  const scanEnd = appSource.indexOf('\nfunction loadStrongestScannerMarket', scanStart);
  assert.notEqual(scanStart, -1, 'startDeepScan must exist');
  const scanSource = appSource.slice(scanStart, scanEnd);
  assert.match(scanSource, /ticks_history:m\.symbol,end:"latest",count:1000/);
});

test('Deep Scanner reports aggregate rejection reasons without exposing individual markets', () => {
  const start = appSource.indexOf('function deepScannerEvaluate(force=false)');
  const end = appSource.indexOf('\nfunction startDeepScan', start);
  assert.notEqual(start, -1);
  const evaluator = appSource.slice(start, end);
  assert.match(evaluator, /r\.digits\.length<1000/);
  assert.match(evaluator, /counts\.distribution\+\+/);
  assert.match(evaluator, /counts\.probability\+\+/);
  assert.match(evaluator, /counts\.signal\+\+/);
  assert.match(evaluator, /counts\.entry\+\+/);
  assert.match(evaluator, /ds\.lastScanDiagnostics=\{\.\.\.counts,total:state\.markets\.length,qualified:rows\.length/);

  const renderStart = appSource.indexOf('function renderDeepScanner(rows=null)');
  const renderEnd = appSource.indexOf('\nfunction ouValidationKey', renderStart);
  const renderer = appSource.slice(renderStart, renderEnd);
  assert.match(renderer, /awaiting 1,000 ticks/);
  assert.match(renderer, /blocked by distribution rules/);
  assert.match(renderer, /blocked by complementary probability/);
  assert.match(renderer, /had no qualified entry digit/);
  assert.match(renderer, /results\.hidden=true/);
});


test('primary Deriv feed sends heartbeat pings and detects a stale connection', () => {
  assert.match(appSource, /state\.lastPongAt=Date\.now\(\)/);
  assert.match(appSource, /request\(\{ping:1,req_id:nextReq\(\)\}\)/);
  assert.match(appSource, /Date\.now\(\)-state\.lastPongAt>45000/);
  assert.match(appSource, /Deriv heartbeat timed out/);
});

test('market changes forget the previous primary tick subscription', () => {
  const start = appSource.indexOf('function startMarket(force=false)');
  const end = appSource.indexOf('\nfunction loadHistory', start + 10);
  const source = appSource.slice(start, end);
  assert.match(source, /state\.primarySubscriptionId&&state\.socket\?\.readyState===WebSocket\.OPEN/);
  assert.match(source, /request\(\{forget:state\.primarySubscriptionId/);
  assert.match(source, /state\.primaryHistoryRequests\[historyReq\]=state\.symbol/);
});

test('delayed history responses from a previously selected market are ignored', () => {
  assert.match(appSource, /requestedSymbol!==state\.symbol\)return; \/\/ Ignore delayed history for a market that is no longer selected\./);
});

test('Deriv subscription metadata is read from the top-level tick response', () => {
  assert.match(appSource, /const raw=d\.tick,sub=d\.subscription\|\|raw\?\.subscription,req=d\.req_id/);
  assert.match(appSource, /state\.primarySubscriptionId=sub\.id/);
});


test('recovery OFF keeps running through two runs after a loss and waits for a fresh entry afterward', () => {
  const start = appSource.indexOf('function autoTradeHandleMessage');
  const end = appSource.indexOf('async function autoTradeConnect', start);
  const source = appSource.slice(start, end);
  const lossBranchStart = source.indexOf('if(!autoTrade.recoveryEnabled)');
  assert.notEqual(lossBranchStart, -1, 'recovery-OFF loss handling must exist');
  const lossBranchEnd = source.indexOf('if(wasRecovery<2)', lossBranchStart);
  assert.notEqual(lossBranchEnd, -1, 'recovery-ON path must follow the recovery-OFF branch');
  const lossBranch = source.slice(lossBranchStart, lossBranchEnd);
  assert.match(lossBranch, /autoTrade\.recoveryPhase=0;autoTrade\.nextStake=autoTrade\.stake;runFinished=true/);
  assert.doesNotMatch(lossBranch, /autoTradePause\(/);
  assert.match(source, /RUN 1 COMPLETE · starting RUN 2/);
  assert.match(source, /RUN 2 COMPLETE · two-run entry finished\. Cooling down for 5 seconds; then waiting for a fresh live entry-digit hit/);
  assert.match(source, /autoTrade\.sessionProfit>=autoTrade\.takeProfit/);
  assert.match(source, /autoTrade\.sessionProfit<=-autoTrade\.stopLoss/);
});

test('recovery-OFF UI explains two-run entry cycles and fresh-entry waiting', () => {
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /With recovery OFF, a loss ends that attempt at base stake/);
  assert.match(html, /One valid manual digit is enough to trigger the normal two-run entry cycle/);
  assert.match(html, /current entry still completes its two-run cycle; after run 2 the bot waits for a fresh entry/);
  assert.match(html, /Only session take-profit or stop-loss pauses the bot/);
});


test('recovery side selectors default to existing logic and allow independent Over/Under overrides', () => {
  assert.match(appSource, /recoverySide1:"DEFAULT",recoverySide2:"DEFAULT"/);
  assert.match(appSource, /autoTrade\.recoverySide1=recoverySide1;autoTrade\.recoverySide2=recoverySide2/);
  assert.match(appSource, /autoTrade\.recoverySide1==="DEFAULT"\?autoTrade\.runSide:autoTrade\.recoverySide1/);
  assert.match(appSource, /autoTrade\.recoverySide2==="DEFAULT"\?\(autoTrade\.runSide==="OVER"\?"UNDER":"OVER"\):autoTrade\.recoverySide2/);
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="autoTradeRecoverySide1"/);
  assert.match(html, /id="autoTradeRecoverySide2"/);
  assert.equal((html.match(/<option value="OVER">Over<\/option>/g) || []).length, 2);
  assert.equal((html.match(/<option value="UNDER">Under<\/option>/g) || []).length, 2);
  assert.match(html, /Defaults preserve the existing logic/);
});


test('manual entry digits bypass Entry Engine filters but must have neither red nor green distribution bars', () => {
  const start = appSource.indexOf('function autoTradeEntrySelection');
  const end = appSource.indexOf('function renderParityControls', start);
  assert.notEqual(start, -1);
  const source = appSource.slice(start, end);
  assert.ok(source.includes('distributionBarFlags(state.digits)'));
  assert.ok(source.includes('bars.most[digit]||bars.least[digit]'));
  assert.doesNotMatch(source, /overUnderEntry/);
  assert.ok(appSource.includes('neither manual digit currently passes the red/green distribution-bar rule'));
  assert.ok(appSource.includes('digit is not an eligible manual entry digit'));
  assert.ok(appSource.includes('automaticEntryIsCurrent=manualEntriesEnabled||'));
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('Use my manual entry digits instead of the Entry Engine digits'));
  assert.ok(html.includes('Each manual digit must avoid a red (least frequent) or green (most frequent) distribution bar. If one has a red/green bar, the bot uses the other eligible manual digit on its own. One valid manual digit is enough to trigger the normal two-run entry cycle.'));
  assert.ok(html.includes('Final Signal, probability comparison, live-data and spike-risk checks still apply'));
});

test('manual entry mode does not depend on the automatic Entry Engine snapshot and reports red/green-bar blocks', () => {
  const start = appSource.indexOf('function autoTradeEntrySelection');
  const end = appSource.indexOf('function renderParityControls', start);
  const selectionSource = appSource.slice(start, end);
  assert.match(selectionSource, /Manual digits bypass every Entry Engine candidate filter/);
  assert.match(selectionSource, /distributionBarFlags\(state\.digits\)/);
  assert.match(selectionSource, /autoTrade\.lastManualBlockReason/);
  assert.match(selectionSource, /const valid=\[first,second\]\.filter\(digit=>!bars\.most\[digit\]&&!bars\.least\[digit\]\)/);
  assert.match(selectionSource, /Using the remaining eligible manual digit/);

  const readyStart = appSource.indexOf('function autoTradeReadyToEnter');
  const readyEnd = appSource.indexOf('\nfunction ', readyStart + 10);
  const readySource = appSource.slice(readyStart, readyEnd);
  assert.match(readySource, /const automaticEntryIsCurrent=manualEntriesEnabled\|\|/);
  assert.match(readySource, /if\(!signalIsCurrent\|\|!automaticEntryIsCurrent\)/);
  assert.match(readySource, /Manual digits use the same live Final Signal and risk gates/);

  const tickStart = appSource.indexOf('function processAutoTradeTick');
  const tickEnd = appSource.indexOf('\nfunction autoTradePlaceNext', tickStart);
  const tickSource = appSource.slice(tickStart, tickEnd);
  assert.match(tickSource, /Manual entry waiting/);
  assert.match(tickSource, /lastManualLoggedReason!==reason/);
});

test('recovery OFF keeps the two-run entry cycle after a loss and waits for a fresh trigger after run 2', () => {
  const start = appSource.indexOf('function autoTradeHandleMessage');
  const end = appSource.indexOf('async function autoTradeConnect', start);
  const source = appSource.slice(start, end);
  const lossStart = source.indexOf('if(!autoTrade.recoveryEnabled)');
  assert.notEqual(lossStart, -1);
  const lossEnd = source.indexOf('if(wasRecovery<2)', lossStart);
  assert.notEqual(lossEnd, -1);
  const lossBranch = source.slice(lossStart, lossEnd);
  assert.match(lossBranch, /autoTrade\.recoveryPhase=0;autoTrade\.nextStake=autoTrade\.stake;runFinished=true/);
  assert.doesNotMatch(lossBranch, /autoTradePause\(/);
  assert.match(source, /if\(runFinished\)[\s\S]*?RUN 1 COMPLETE[\s\S]*?RUN 2 COMPLETE/);
  assert.match(source, /autoTrade\.sessionProfit>=autoTrade\.takeProfit/);
  assert.match(source, /autoTrade\.sessionProfit<=-autoTrade\.stopLoss/);
});

test('bot session P/L is colored green for profit and red for loss', () => {
  const start = appSource.indexOf('function autoTradeRenderPnL()');
  assert.notEqual(start, -1, 'autoTradeRenderPnL must exist');
  const end = appSource.indexOf('\nfunction ', start + 10);
  const source = appSource.slice(start, end);
  assert.match(source, /pnl>0/);
  assert.match(source, /pnl<0/);
  assert.match(source, /pnl-positive/);
  assert.match(source, /pnl-negative/);
  assert.match(source, /pnl-neutral/);
  const styles = fs.readFileSync(require('node:path').join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(styles, /#autoTradePnL\.pnl-positive\{color:#16a34a/);
  assert.match(styles, /#autoTradePnL\.pnl-negative\{color:#ef4444/);
});

