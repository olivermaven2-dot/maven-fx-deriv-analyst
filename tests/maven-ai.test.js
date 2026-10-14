const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'maven-ai.js'), 'utf8');
test('local analyst avoids network APIs and remote model calls', () => {
  assert.doesNotMatch(source, /\\bfetch\\s*\\(|XMLHttpRequest|WebSocket|https?:\\/\\//i);
  assert.match(source, /mavenAIGetContext/);
  assert.match(source, /distributionPass/);
});
test('local analyst has deterministic local question handling and privacy explanation', () => {
  assert.match(source, /function explain\\(question\\)/);
  assert.match(source, /no external requests/i);
  assert.match(source, /distribution gate/i);
});
