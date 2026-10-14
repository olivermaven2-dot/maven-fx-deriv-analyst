/* Maven FX AI — shadow-mode analysis core.
 * Deliberately standalone: this file does not connect to Deriv, mutate app state,
 * render UI, alter existing signals, or trigger Auto Trade.
 * Include in a future integration only after independent validation.
 */
(function (root) {
  "use strict";

  const WINDOW_SIZE = 1000;
  const DISTRIBUTION_LIMIT_PERCENT = 10.5;

  function validDigit(value) {
    return Number.isInteger(value) && value >= 0 && value <= 9;
  }

  function buildDistribution(digits) {
    const source = Array.isArray(digits) ? digits : [];
    const windowDigits = source.slice(-WINDOW_SIZE).filter(validDigit);
    const total = windowDigits.length;
    const counts = Array(10).fill(0);

    for (const digit of windowDigits) counts[digit] += 1;

    const percentages = counts.map(count => total ? count / total * 100 : 0);
    const maxCount = total ? Math.max.apply(null, counts) : 0;
    const minCount = total ? Math.min.apply(null, counts) : 0;

    const rows = counts.map((count, digit) => {
      const isGreen = total > 0 && count === maxCount;
      // Match the live UI precedence: green/MOST wins when every digit is tied.
      const isRed = total > 0 && count === minCount && !isGreen;
      return {
        digit,
        count,
        percent: percentages[digit],
        percentLabel: percentages[digit].toFixed(1) + "%",
        greenBar: isGreen,
        redBar: isRed,
        bar: isGreen && isRed ? "BOTH" : isGreen ? "GREEN" : isRed ? "RED" : "NONE",
        hasColoredBar: isGreen || isRed
      };
    });

    return { total, windowSize: WINDOW_SIZE, rows };
  }

  function evaluateSetup(digits, selectedDigit, side) {
    const distribution = buildDistribution(digits);
    const normalizedSide = String(side || "").toUpperCase();
    const validSide = normalizedSide === "OVER" || normalizedSide === "UNDER";
    const validSelection = validDigit(selectedDigit);
    const requiredDigits = validSide && validSelection
      ? distribution.rows
          .filter(row => normalizedSide === "OVER"
            ? row.digit <= selectedDigit
            : row.digit >= selectedDigit)
          .map(row => row.digit)
      : [];
    const requiredRows = requiredDigits.map(digit => distribution.rows[digit]);
    const failures = [];

    if (!validSide) failures.push("Choose OVER or UNDER.");
    if (!validSelection) failures.push("Selected digit must be an integer from 0 to 9.");
    if (distribution.total < 30) {
      failures.push("At least 30 valid live digits are required for a preliminary assessment.");
    }

    for (const row of requiredRows) {
      if (!(row.percent < DISTRIBUTION_LIMIT_PERCENT)) {
        failures.push("Digit " + row.digit + " is " + row.percentLabel +
          "; it must be strictly below " + DISTRIBUTION_LIMIT_PERCENT + "%.");
      }
      if (row.greenBar) failures.push("Digit " + row.digit + " has a green (MOST) bar.");
      if (row.redBar) failures.push("Digit " + row.digit + " has a red (LEAST) bar.");
    }

    const eligible = validSide && validSelection && distribution.total >= 30 &&
      failures.length === 0;

    return {
      mode: "shadow",
      side: normalizedSide,
      selectedDigit,
      eligible,
      status: eligible ? "DISTRIBUTION GATE PASSED" : "BLOCKED",
      sampleSize: distribution.total,
      thresholdPercent: DISTRIBUTION_LIMIT_PERCENT,
      requiredDigits,
      checked: requiredRows.map(row => ({
        digit: row.digit,
        count: row.count,
        percent: row.percent,
        percentLabel: row.percentLabel,
        greenBar: row.greenBar,
        redBar: row.redBar,
        bar: row.bar,
        passed: row.percent < DISTRIBUTION_LIMIT_PERCENT &&
          !row.greenBar && !row.redBar
      })),
      reasons: failures,
      explanation: eligible
        ? normalizedSide + " " + selectedDigit +
          " passes the distribution gate on " + distribution.total +
          " recent valid digits. Other signal evidence still needs to be evaluated."
        : failures.length
          ? "Do not qualify " + (validSide && validSelection ? normalizedSide + " " + selectedDigit : "this setup") +
            ": " + failures.join(" ")
          : "The distribution gate has not passed."
    };
  }

  function filterEntryDigits(digits, candidateDigits) {
    const distribution = buildDistribution(digits);
    const candidates = Array.isArray(candidateDigits) ? candidateDigits : [];
    const accepted = [];
    const rejected = [];

    for (const digit of candidates) {
      if (!validDigit(digit)) {
        rejected.push({ digit, reason: "Invalid digit." });
        continue;
      }
      const row = distribution.rows[digit];
      if (row.hasColoredBar) {
        rejected.push({
          digit,
          reason: row.bar === "BOTH"
            ? "Digit has both green and red bar classifications."
            : row.greenBar ? "Green (MOST) bar digits cannot be entry digits."
              : "Red (LEAST) bar digits cannot be entry digits.",
          percent: row.percent,
          bar: row.bar
        });
      } else {
        accepted.push(digit);
      }
    }

    return {
      mode: "shadow",
      sampleSize: distribution.total,
      accepted,
      rejected
    };
  }

  function analyze(input) {
    const args = input || {};
    const distribution = buildDistribution(args.digits);
    const setup = evaluateSetup(args.digits, args.selectedDigit, args.side);
    const entryFilter = filterEntryDigits(args.digits, args.entryCandidates);
    return {
      mode: "shadow",
      distribution,
      setup,
      entryFilter,
      generatedAt: Date.now(),
      note: "Statistical shadow analysis only. This module does not predict certainty, change production signals, or execute trades."
    };
  }

  root.MavenFXAI = Object.freeze({
    version: "0.1.0-shadow",
    windowSize: WINDOW_SIZE,
    distributionLimitPercent: DISTRIBUTION_LIMIT_PERCENT,
    buildDistribution,
    evaluateSetup,
    filterEntryDigits,
    analyze
  });

  // Render only into the dedicated shadow panel; never call production renderers.
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    let lastPanelUpdate = 0;
    window.addEventListener("mavenfx:shadow-tick", function (event) {
      const now = Date.now();
      if (now - lastPanelUpdate < 1800) return;
      lastPanelUpdate = now;
      const detail = event && event.detail;
      if (!detail || !Array.isArray(detail.digits)) return;
      const status = document.getElementById("mavenAiStatus");
      const reason = document.getElementById("mavenAiReason");
      const gateDetails = document.getElementById("mavenAiGateDetails");
      const entries = document.getElementById("mavenAiEntries");
      const mode = document.getElementById("mavenAiMode");
      if (!status || !reason || !gateDetails || !entries) return;
      const candidates = Array.from({length: 10}, (_, digit) => digit);
      const result = analyze({
        digits: detail.digits,
        selectedDigit: detail.selectedDigit,
        side: detail.side,
        entryCandidates: candidates
      });
      const setup = result.setup;
      if (detail.engine !== "overunder") {
        status.textContent = "SHADOW MODE · " + String(detail.engine || "engine").toUpperCase();
        reason.textContent = "Distribution and entry-bar audit are running independently. Over/Under's 10.5% setup gate applies only to Over/Under.";
        gateDetails.textContent = "Switch to Over/Under to assess the selected threshold.";
      } else {
        status.textContent = setup.eligible ? "DISTRIBUTION GATE PASSED" : setup.status;
        reason.textContent = setup.explanation;
        gateDetails.textContent = setup.requiredDigits.length
          ? setup.checked.map(row => "Digit " + row.digit + ": " + row.percentLabel + " · " + row.bar + (row.passed ? " · PASS" : " · BLOCK")).join(" | ")
          : "Collect at least 30 valid digits and select a valid Over/Under setup.";
      }
      if (mode) mode.textContent = result.distribution.total + " TICKS";
      entries.textContent = result.entryFilter.accepted.length
        ? result.entryFilter.accepted.join(", ")
        : "No digits currently pass the bar exclusion.";
      if (result.entryFilter.rejected.length) {
        entries.textContent += " · Excluded: " + result.entryFilter.rejected.map(x => x.digit + " (" + x.bar + ")").join(", ");
      }
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
