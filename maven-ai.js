/* Maven FX AI — isolated shadow-analysis core.
 * No network access, API key, WebSocket, timers, DOM writes, or trade execution.
 * This module is intentionally NOT wired into the live app yet.
 */
(function (root) {
  "use strict";

  const VERSION = "0.1.0-shadow";
  const MAX_DISTRIBUTION_TICKS = 1000;
  const MIN_SETUP_PERCENT = 10.5;

  function validDigits(input) {
    return Array.isArray(input)
      ? input.filter(function (d) { return Number.isInteger(d) && d >= 0 && d <= 9; })
      : [];
  }

  // Mirrors renderDigitDistribution(): last 1,000 digits; tied maximum is
  // tagged MOST before the minimum/LEAST check, matching the current UI.
  function distributionSnapshot(input) {
    const digits = validDigits(input).slice(-MAX_DISTRIBUTION_TICKS);
    const counts = Array(10).fill(0);
    digits.forEach(function (digit) { counts[digit] += 1; });
    const total = digits.length;
    const percentages = counts.map(function (count) {
      return total ? count / total * 100 : 0;
    });
    const max = total ? Math.max.apply(null, counts) : 0;
    const min = total ? Math.min.apply(null, counts) : 0;
    const rows = counts.map(function (count, digit) {
      const isMost = total > 0 && count === max;
      const isLeast = total > 0 && count === min;
      const bar = isMost ? "green" : (isLeast ? "red" : null);
      return {
        digit: digit,
        count: count,
        percent: percentages[digit],
        percentText: percentages[digit].toFixed(1) + "%",
        bar: bar,
        tag: isMost ? "MOST" : (isLeast ? "LEAST" : "")
      };
    });
    return { total: total, windowSize: MAX_DISTRIBUTION_TICKS, rows: rows };
  }

  function setupGate(snapshot, side, selectedDigit) {
    const normalizedSide = String(side || "").toUpperCase();
    if (normalizedSide !== "OVER" && normalizedSide !== "UNDER") {
      return { eligible: false, reason: "Unknown Over/Under side.", checkedDigits: [], failures: [] };
    }
    if (!Number.isInteger(selectedDigit) || selectedDigit < 0 || selectedDigit > 9) {
      return { eligible: false, reason: "Selected digit must be between 0 and 9.", checkedDigits: [], failures: [] };
    }
    if (!snapshot || snapshot.total === 0) {
      return { eligible: false, reason: "Waiting for live digits before distribution analysis.", checkedDigits: [], failures: [] };
    }

    const checkedDigits = [];
    for (let d = 0; d <= 9; d += 1) {
      if ((normalizedSide === "OVER" && d <= selectedDigit) ||
          (normalizedSide === "UNDER" && d >= selectedDigit)) checkedDigits.push(d);
    }
    const failures = checkedDigits.map(function (digit) {
      const row = snapshot.rows[digit];
      const reasons = [];
      if (!(row.percent < MIN_SETUP_PERCENT)) reasons.push("distribution is not below 10.5%");
      if (row.bar) reasons.push(row.bar === "green" ? "green bar (MOST)" : "red bar (LEAST)");
      return { digit: digit, percent: row.percent, bar: row.bar, reasons: reasons };
    }).filter(function (item) { return item.reasons.length > 0; });

    return {
      eligible: failures.length === 0,
      side: normalizedSide,
      selectedDigit: selectedDigit,
      checkedDigits: checkedDigits,
      failures: failures,
      reason: failures.length
        ? "Blocked: every required digit must be below 10.5% and have neither a red nor a green bar."
        : "Distribution gate passed for this snapshot; other evidence and existing safety gates still apply."
    };
  }

  function filterEntryCandidates(snapshot, candidates) {
    const input = Array.isArray(candidates) ? candidates : [];
    const eligible = [];
    const excluded = [];
    input.forEach(function (candidate) {
      const digit = Number.isInteger(candidate) ? candidate : candidate && candidate.digit;
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
        excluded.push({ candidate: candidate, reason: "Invalid entry digit." });
        return;
      }
      const row = snapshot && snapshot.rows && snapshot.rows[digit];
      if (!row || !snapshot.total) {
        excluded.push({ digit: digit, reason: "No live distribution available." });
      } else if (row.bar) {
        excluded.push({
          digit: digit,
          bar: row.bar,
          percent: row.percent,
          reason: row.bar === "green" ? "Green-bar digits are never entry candidates." : "Red-bar digits are never entry candidates."
        });
      } else {
        eligible.push(candidate);
      }
    });
    return { eligible: eligible, excluded: excluded };
  }

  function basicEvidence(input) {
    const digits = validDigits(input).slice(-500);
    const total = digits.length;
    const counts = Array(10).fill(0);
    digits.forEach(function (digit) { counts[digit] += 1; });
    const parity = { even: 0, odd: 0 };
    digits.forEach(function (digit) { parity[digit % 2 ? "odd" : "even"] += 1; });
    let changes = 0;
    for (let i = 1; i < digits.length; i += 1) if (digits[i] !== digits[i - 1]) changes += 1;
    const transitions = Array.from({ length: 10 }, function () { return Array(10).fill(0); });
    for (let i = 1; i < digits.length; i += 1) transitions[digits[i - 1]][digits[i]] += 1;
    const last = digits.length ? digits[digits.length - 1] : null;
    let streak = 0;
    if (total) {
      for (let i = total - 1; i >= 0 && digits[i] === last; i -= 1) streak += 1;
    }
    return {
      sampleSize: total,
      digitCounts: counts,
      parityPercent: {
        even: total ? parity.even / total * 100 : null,
        odd: total ? parity.odd / total * 100 : null
      },
      transitionCount: Math.max(0, total - 1),
      distinctAdjacentChangePercent: total > 1 ? changes / (total - 1) * 100 : null,
      latestDigit: last,
      latestDigitStreak: streak,
      note: "Descriptive statistics only; past frequencies and transitions do not establish future outcomes."
    };
  }

  function assess(input) {
    const args = input || {};
    const digits = validDigits(args.digits);
    const distribution = distributionSnapshot(digits);
    const engine = String(args.engine || "overunder").toLowerCase();
    const evidence = basicEvidence(digits);
    let gate = null;
    if (engine === "overunder") gate = setupGate(distribution, args.side, args.selectedDigit);
    const ready = evidence.sampleSize >= 30 && (engine !== "overunder" || gate.eligible);
    const reasons = [];
    if (evidence.sampleSize < 30) reasons.push("At least 30 valid digits are needed for a preliminary assessment.");
    if (gate && !gate.eligible) reasons.push(gate.reason);
    if (gate && gate.eligible) reasons.push("Distribution eligibility passed; this is not by itself a trade signal.");
    if (engine !== "overunder") reasons.push("This engine is in descriptive shadow mode; no replacement signal is emitted.");
    return {
      version: VERSION,
      mode: "shadow",
      engine: engine,
      ready: ready,
      distribution: distribution,
      setupGate: gate,
      evidence: evidence,
      entryFilter: { eligible: [], excluded: [], note: "Pass candidate entry digits to filterEntryCandidates()." },
      explanation: reasons,
      signal: "SHADOW_ONLY",
      mayExecuteTrade: false
    };
  }

  root.MavenFXAI = Object.freeze({
    version: VERSION,
    mode: "shadow",
    distributionSnapshot: distributionSnapshot,
    setupGate: setupGate,
    filterEntryCandidates: filterEntryCandidates,
    basicEvidence: basicEvidence,
    assess: assess
  });
})(typeof window !== "undefined" ? window : globalThis);
