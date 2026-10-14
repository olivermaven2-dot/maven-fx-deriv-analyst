"use strict";
const assert = require("node:assert/strict");
require("../maven-ai.js");
const ai = globalThis.MavenFXAI;
assert.ok(ai, "AI module should expose MavenFXAI");
assert.equal(ai.mode, "shadow");

// Construct deterministic snapshots to exercise strict threshold and bar rules.
function snapshot(percentages, bars) {
  return {
    total: 1000,
    rows: percentages.map((percent, digit) => ({
      digit: digit,
      percent: percent,
      percentText: percent.toFixed(1) + "%",
      bar: bars[digit] || null,
      tag: bars[digit] === "green" ? "MOST" : (bars[digit] === "red" ? "LEAST" : "")
    }))
  };
}
const allSafe = snapshot(Array(10).fill(8.4), {});
assert.equal(ai.setupGate(allSafe, "OVER", 4).eligible, true);
assert.deepEqual(ai.setupGate(allSafe, "OVER", 4).checkedDigits, [0, 1, 2, 3, 4]);
assert.deepEqual(ai.setupGate(allSafe, "UNDER", 4).checkedDigits, [4, 5, 6, 7, 8, 9]);

const thresholdFail = snapshot([8, 8, 8, 8, 10.5, 8, 8, 8, 8, 8], {});
assert.equal(ai.setupGate(thresholdFail, "OVER", 4).eligible, false, "10.5% must fail strict less-than rule");
assert.equal(ai.setupGate(thresholdFail, "UNDER", 4).eligible, false, "selected digit at 10.5% must fail");

const greenFail = snapshot(Array(10).fill(8), { 2: "green" });
assert.equal(ai.setupGate(greenFail, "OVER", 4).eligible, false, "green bar in required group must block setup");
const redFail = snapshot(Array(10).fill(8), { 8: "red" });
assert.equal(ai.setupGate(redFail, "UNDER", 4).eligible, false, "red bar in required group must block setup");

const entrySnapshot = snapshot(Array(10).fill(8), { 1: "green", 7: "red" });
const filtered = ai.filterEntryCandidates(entrySnapshot, [0, 1, 2, 7, 9]);
assert.deepEqual(filtered.eligible, [0, 2, 9]);
assert.deepEqual(filtered.excluded.map(function (item) { return item.digit; }), [1, 7]);

const empty = ai.assess({ digits: [], engine: "overunder", side: "OVER", selectedDigit: 3 });
assert.equal(empty.signal, "SHADOW_ONLY");
assert.equal(empty.mayExecuteTrade, false);
assert.equal(empty.ready, false);
console.log("Maven FX AI shadow tests passed.");
