/* Maven FX AI — isolated shadow-analysis core.
 * No WebSocket, DOM, trading, storage, or network access.
 * This module only reads a caller-provided digit array and returns an assessment.
 * Distribution/bar classification intentionally mirrors renderDigitDistribution() in app.js.
 */
(function(root){
  "use strict";
  const VERSION = "0.1.0-shadow";
  const MAX_DISTRIBUTION_TICKS = 1000;
  const LIMIT_PERCENT = 10.5;

  function validDigit(value){
    return Number.isInteger(value) && value >= 0 && value <= 9;
  }

  function summarizeDistribution(input){
    const digits = Array.isArray(input) ? input.filter(validDigit).slice(-MAX_DISTRIBUTION_TICKS) : [];
    const total = digits.length;
    const counts = Array(10).fill(0);
    for (const digit of digits) counts[digit]++;
    const percentages = counts.map(count => total ? count / total * 100 : 0);
    const max = total ? Math.max(...counts) : 0;
    const min = total ? Math.min(...counts) : 0;

    // Match the current UI's MOST/LEAST precedence exactly:
    // when all counts are tied, MOST wins because it is checked first.
    const bars = counts.map(count => {
      const isMost = total > 0 && count === max;
      const isLeast = total > 0 && count === min;
      return isMost ? "green" : isLeast ? "red" : "none";
    });

    return {
      total,
      counts,
      percentages,
      displayedPercentages: percentages.map(p => Number(p.toFixed(1))),
      bars,
      windowSize: MAX_DISTRIBUTION_TICKS
    };
  }

  function getRequiredDigits(side, selectedDigit){
    if (!validDigit(selectedDigit) || (side !== "OVER" && side !== "UNDER")) return [];
    const result = [];
    if (side === "OVER") {
      for (let digit = 0; digit <= selectedDigit; digit++) result.push(digit);
    } else {
      for (let digit = selectedDigit; digit <= 9; digit++) result.push(digit);
    }
    return result;
  }

  function evaluateOverUnder(input){
    const digits = Array.isArray(input.digits) ? input.digits : [];
    const selectedDigit = Number(input.selectedDigit);
    const side = String(input.selectedSide || "").toUpperCase();
    const distribution = summarizeDistribution(digits);
    const requiredDigits = getRequiredDigits(side, selectedDigit);

    if (!requiredDigits.length) {
      return {
        version: VERSION,
        mode: "shadow",
        eligible: false,
        status: "WAIT",
        reason: "Choose a valid OVER/UNDER setup and digit from 0 to 9.",
        distribution,
        requiredDigits: [],
        failedDigits: [],
        entryCandidates: []
      };
    }

    const failedDigits = requiredDigits.filter(digit =>
      distribution.total === 0 ||
      !(distribution.percentages[digit] < LIMIT_PERCENT) ||
      distribution.bars[digit] !== "none"
    );

    const entryCandidates = Array.from({length: 10}, (_, digit) => digit)
      .filter(digit => distribution.bars[digit] === "none");

    const eligible = distribution.total > 0 && failedDigits.length === 0;
    const reasons = [];
    if (!distribution.total) reasons.push("No validated live digits are available.");
    for (const digit of failedDigits) {
      const pct = distribution.total ? distribution.percentages[digit].toFixed(2) + "%" : "unavailable";
      const bar = distribution.bars[digit];
      const details = [];
      if (!(distribution.percentages[digit] < LIMIT_PERCENT)) details.push("distribution is not below 10.5%");
      if (bar !== "none") details.push(bar + " bar excludes this digit");
      if (!distribution.total) details.push("no sample available");
      reasons.push("Digit " + digit + " (" + pct + "): " + details.join("; ") + ".");
    }
    if (distribution.total > 0 && distribution.total < 100) {
      reasons.push("Only " + distribution.total + " digits are available in the distribution window; treat this assessment as preliminary.");
    }

    return {
      version: VERSION,
      mode: "shadow",
      engine: "overunder",
      setup: side + " " + selectedDigit,
      eligible,
      status: eligible ? "DISTRIBUTION GATE PASSED" : "BLOCKED BY DISTRIBUTION RULES",
      reason: eligible
        ? "Every required digit is below 10.5% and has neither a red nor a green bar. This only clears the distribution gate; it is not a trade signal."
        : reasons.join(" "),
      distribution,
      requiredDigits,
      failedDigits,
      entryCandidates,
      entryRule: "Only digits with no red or green bar may be considered; existing entry checks must still pass.",
      disclaimer: "Statistical patterns describe observed history and do not guarantee future outcomes."
    };
  }

  function filterEntryCandidates(candidateDigits, distributionInput){
    const distribution = summarizeDistribution(distributionInput);
    return Array.from(new Set((Array.isArray(candidateDigits) ? candidateDigits : []).filter(validDigit)))
      .filter(digit => distribution.total > 0 && distribution.bars[digit] === "none")
      .sort((a,b) => a-b);
  }

  const api = Object.freeze({
    version: VERSION,
    summarizeDistribution,
    evaluateOverUnder,
    filterEntryCandidates
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MavenFXAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
