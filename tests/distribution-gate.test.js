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

test('app.js remains syntactically valid', () => {
  // Node's parser check is run by the workflow with: node --check app.js
  assert.match(appSource, /function distributionGate/);
});

test('distribution failure forces Final Signal to AVOID in the existing evidence pipeline', () => {
  const evidenceStart = appSource.indexOf('function overUnderEvidence');
  assert.notEqual(evidenceStart, -1, 'overUnderEvidence must exist in app.js');
  const evidenceEnd = appSource.indexOf('\\nfunction ', evidenceStart + 10);
  const evidenceSource = appSource.slice(evidenceStart, evidenceEnd);
  const harness = `
    const ouStats = () => ({
      momentum: 0, trend: 0, weightedTransitionRate: .6, long: .5,
      recent: .5, short50: .5, mid250: .5, medium: .5,
      cluster: .5, streak: 2, transitions: 10, transitionRate: .6
    });
    const ouRate = () => .5;
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
  const evidenceEnd = appSource.indexOf('\\nfunction ', evidenceStart + 10);
  const evidenceSource = appSource.slice(evidenceStart, evidenceEnd);
  const harness = `
    const ouStats = () => ({
      momentum: 0, trend: 0, weightedTransitionRate: .6, long: .5,
      recent: .5, short50: .5, mid250: .5, medium: .5,
      cluster: .5, streak: 2, transitions: 10, transitionRate: .6
    });
    const ouRate = (d, digit, side) => digit === 7 && side === 'UNDER' ? .7 : .5;
    ${gateSource}
    ${evidenceSource}
    overUnderEvidence
  `;
  const runEvidence = vm.runInNewContext(harness);
  const result = runEvidence(overPassTicks, 2, 'OVER');
  assert.equal(result.distribution.pass, true);
  assert.equal(result.probabilityConflict, true);
  assert.equal(result.signal, 'AVOID');
});
