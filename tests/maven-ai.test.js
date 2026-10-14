"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const AI = require("../maven-ai.js");

test("OVER gate checks selected digit and every digit below it", () => {
  const digits = [];
  // Each digit occurs 10 times in 100 samples, giving 10% each.
  for (let d = 0; d < 10; d++) for (let i = 0; i < 10; i++) digits.push(d);
  const result = AI.evaluateOverUnder({ digits, selectedDigit: 5, selectedSide: "OVER" });
  assert.deepEqual(result.requiredDigits, [0,1,2,3,4,5]);
  // All frequencies tie; current UI classifies tied digits as MOST/green.
  assert.equal(result.eligible, false);
  assert.equal(result.failedDigits.length, 6);
});

test("UNDER gate checks selected digit and every digit above it", () => {
  const digits = [];
  for (let d = 0; d < 10; d++) for (let i = 0; i < 10; i++) digits.push(d);
  const result = AI.evaluateOverUnder({ digits, selectedDigit: 5, selectedSide: "UNDER" });
  assert.deepEqual(result.requiredDigits, [5,6,7,8,9]);
  assert.equal(result.eligible, false);
});

test("red/green bar candidates are excluded from entry digits", () => {
  const digits = [];
  for (let d = 0; d < 10; d++) for (let i = 0; i < d + 1; i++) digits.push(d);
  const dist = AI.summarizeDistribution(digits);
  const filtered = AI.filterEntryCandidates([0,1,2,3,4,5,6,7,8,9], digits);
  for (const digit of filtered) assert.equal(dist.bars[digit], "none");
  assert.ok(filtered.every(digit => digit >= 0 && digit <= 9));
});

test("missing data and invalid setup fail closed", () => {
  const empty = AI.evaluateOverUnder({digits: [], selectedDigit: 3, selectedSide: "OVER"});
  assert.equal(empty.eligible, false);
  const invalid = AI.evaluateOverUnder({digits: [1,2,3], selectedDigit: 12, selectedSide: "OVER"});
  assert.equal(invalid.eligible, false);
});

test("digit zero is retained and distribution uses at most 1000 ticks", () => {
  const digits = [0,1,2,3,4,5,6,7,8,9,0];
  const dist = AI.summarizeDistribution(digits);
  assert.equal(dist.total, 11);
  assert.equal(dist.counts[0], 2);
  assert.equal(AI.summarizeDistribution(Array(1200).fill(0)).total, 1000);
});
