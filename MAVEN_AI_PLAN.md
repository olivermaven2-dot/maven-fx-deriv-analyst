# Maven FX AI shadow core

This branch contains an isolated, free-to-run statistical analysis module. It does not connect to Deriv, open sockets, change the existing engines, or execute trades.

## Current scope
- Uses a caller-supplied digit history, limited to the latest 1,000 valid digits.
- Mirrors the current digit-distribution UI's frequency and MOST/LEAST bar precedence.
- Implements the requested Over/Under distribution gate: every digit in the required range must be strictly below 10.5% and have no red/green bar.
- Excludes red/green-bar digits from eligible entry candidates.
- Returns a structured, explainable result and does not claim that clearing the gate predicts the next tick.

## Safety status
The module is not yet connected to the live page and is not deployed to GitHub Pages. This is intentional: it is being developed on the `maven-ai-shadow` branch so the working `gh-pages` app remains untouched.

## Tests
Run with Node.js 18 or later:
```sh
node --test tests/maven-ai.test.js
```

The tests cover both Over/Under ranges, bar exclusion, missing data, invalid setups, digit zero, and the 1,000-tick cap.
