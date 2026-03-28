/**
 * Visual Critic Module — render → screenshot → score → fix → re-render
 *
 * Closes the perception loop for AI-generated UIs. Integrates with:
 * - Chrome DevTools MCP for console error detection
 * - Windows MCP for viewport screenshots
 * - Demerzel visual-critic-policy.yaml scoring dimensions
 *
 * This module is consumed by the bot for Discord-triggered visual reviews
 * and by the demerzel-render-critic skill for autonomous loops.
 */

// Scoring dimensions from visual-critic-policy.yaml
const SCORING_DIMENSIONS = [
  { name: 'layout_fidelity', weight: 0.35, passThreshold: 0.7 },
  { name: 'color_contrast', weight: 0.25, passThreshold: 0.7 },
  { name: 'responsiveness', weight: 0.20, passThreshold: 0.7 },
  { name: 'component_completeness', weight: 0.20, passThreshold: 0.7 },
];

// Quality thresholds from policy
const THRESHOLDS = {
  shipReady: 0.9,
  acceptable: 0.7,
  needsWork: 0.5,
  broken: 0.3,
};

const MAX_FIX_ITERATIONS = 5;
const CONSECUTIVE_SHIP_REQUIRED = 2;

/**
 * Error classification from policy — determines confidence and action.
 */
const ERROR_CLASSES = {
  syntax: {
    patterns: [/SyntaxError/i, /Unexpected token/i, /JSX parse error/i],
    confidence: 0.95,
    action: 'auto-fix',
  },
  runtime: {
    patterns: [/TypeError/i, /ReferenceError/i, /Cannot read propert/i],
    confidence: 0.80,
    action: 'classify-fix',
  },
  render: {
    patterns: [/Minified React error/i, /Error boundary/i, /blank page/i, /hydration/i],
    confidence: 0.70,
    action: 'check-lifecycle',
  },
  layout: {
    patterns: [/CSS module/i, /Unknown CSS/i, /Failed to resolve/i],
    confidence: 0.75,
    action: 'fix-stylesheet',
  },
};

/**
 * Classify a console error into one of the error categories.
 * @param {string} message - Console error message
 * @returns {{ type: string, confidence: number, action: string }}
 */
function classifyError(message) {
  for (const [type, spec] of Object.entries(ERROR_CLASSES)) {
    for (const pattern of spec.patterns) {
      if (pattern.test(message)) {
        return { type, confidence: spec.confidence, action: spec.action };
      }
    }
  }
  return { type: 'unknown', confidence: 0.5, action: 'escalate' };
}

/**
 * Parse console errors from Chrome DevTools MCP output.
 * @param {Array<{level: string, text: string, url?: string, line?: number}>} consoleEntries
 * @returns {Array<{level: string, text: string, classification: object}>}
 */
function parseConsoleErrors(consoleEntries) {
  return consoleEntries
    .filter((e) => e.level === 'error' || e.level === 'warning')
    .map((e) => ({
      level: e.level,
      text: e.text,
      url: e.url || null,
      line: e.line || null,
      classification: classifyError(e.text),
    }));
}

/**
 * Score a dimension based on analysis results.
 * Each dimension score is 0.0 - 1.0.
 * @param {string} dimensionName
 * @param {object} analysisData - Data from visual analysis
 * @returns {number}
 */
function scoreDimension(dimensionName, analysisData) {
  const data = analysisData[dimensionName];
  if (!data) return 0.0;

  // If the analysis provides a direct score, use it
  if (typeof data.score === 'number') {
    return Math.max(0, Math.min(1, data.score));
  }

  // If it provides pass/fail checks, compute from those
  if (Array.isArray(data.checks)) {
    const passed = data.checks.filter((c) => c.passed).length;
    return data.checks.length > 0 ? passed / data.checks.length : 0.0;
  }

  return 0.0;
}

/**
 * Compute the weighted visual quality score.
 * @param {object} analysisData - Per-dimension analysis results
 * @returns {{ total: number, dimensions: Array<{name: string, score: number, weight: number, weighted: number, pass: boolean}>, verdict: string }}
 */
function computeScore(analysisData) {
  const dimensions = SCORING_DIMENSIONS.map((dim) => {
    const score = scoreDimension(dim.name, analysisData);
    const weighted = score * dim.weight;
    return {
      name: dim.name,
      score: Math.round(score * 100) / 100,
      weight: dim.weight,
      weighted: Math.round(weighted * 100) / 100,
      pass: score >= dim.passThreshold,
    };
  });

  const total = Math.round(dimensions.reduce((sum, d) => sum + d.weighted, 0) * 100) / 100;

  let verdict;
  if (total >= THRESHOLDS.shipReady) verdict = 'ship-ready';
  else if (total >= THRESHOLDS.acceptable) verdict = 'acceptable';
  else if (total >= THRESHOLDS.needsWork) verdict = 'needs-work';
  else verdict = 'broken';

  return { total, dimensions, verdict };
}

/**
 * Format a score report for Discord embed display.
 * @param {{ total: number, dimensions: Array, verdict: string }} scoreResult
 * @param {number} iteration - Current iteration number
 * @returns {string}
 */
function formatScoreReport(scoreResult, iteration = 1) {
  const verdictEmoji = {
    'ship-ready': '🟢',
    'acceptable': '🟡',
    'needs-work': '🟠',
    'broken': '🔴',
  };

  const emoji = verdictEmoji[scoreResult.verdict] || '⚪';
  let report = `**Visual Quality Score: ${scoreResult.total}** ${emoji} ${scoreResult.verdict}\n`;
  report += `Iteration: ${iteration}/${MAX_FIX_ITERATIONS}\n\n`;
  report += '| Dimension | Score | Weight | Pass |\n';
  report += '|-----------|-------|--------|------|\n';

  for (const dim of scoreResult.dimensions) {
    const passIcon = dim.pass ? '✓' : '✗';
    report += `| ${dim.name} | ${dim.score} | ${dim.weight} | ${passIcon} |\n`;
  }

  return report;
}

/**
 * Format an error report for Discord.
 * @param {Array} classifiedErrors
 * @returns {string}
 */
function formatErrorReport(classifiedErrors) {
  if (classifiedErrors.length === 0) {
    return '**Console:** Clean — no errors or warnings detected.\n';
  }

  let report = `**Console Errors: ${classifiedErrors.length}**\n`;
  for (const err of classifiedErrors.slice(0, 10)) {
    const icon = err.level === 'error' ? '🔴' : '🟡';
    report += `${icon} \`${err.classification.type}\` (${err.classification.confidence}) — ${err.text.slice(0, 120)}\n`;
    report += `  → Action: ${err.classification.action}\n`;
  }
  if (classifiedErrors.length > 10) {
    report += `... and ${classifiedErrors.length - 10} more\n`;
  }
  return report;
}

/**
 * Create a visual critic cycle state tracker.
 * Manages the render → screenshot → score → fix → re-render loop.
 * @param {string} componentPath - Path to the component being reviewed
 * @returns {object} Cycle state manager
 */
function createCycleState(componentPath) {
  return {
    componentPath,
    startedAt: new Date().toISOString(),
    iterations: [],
    consecutiveShipScores: 0,
    status: 'pending', // pending | running | ship-ready | acceptable | escalated | max-iterations

    /**
     * Record an iteration result.
     * @param {{ errors: Array, score: object, fixes: Array }} result
     * @returns {{ shouldContinue: boolean, reason: string }}
     */
    recordIteration(result) {
      this.iterations.push({
        number: this.iterations.length + 1,
        timestamp: new Date().toISOString(),
        errorCount: result.errors.length,
        score: result.score,
        fixesApplied: result.fixes || [],
      });

      this.status = 'running';

      // Check consecutive ship-ready scores
      if (result.score.verdict === 'ship-ready') {
        this.consecutiveShipScores++;
      } else {
        this.consecutiveShipScores = 0;
      }

      // Ship if we hit consecutive threshold
      if (this.consecutiveShipScores >= CONSECUTIVE_SHIP_REQUIRED) {
        this.status = 'ship-ready';
        return { shouldContinue: false, reason: `Ship-ready after ${CONSECUTIVE_SHIP_REQUIRED} consecutive high scores` };
      }

      // Max iterations reached — escalate per Article 6
      if (this.iterations.length >= MAX_FIX_ITERATIONS) {
        this.status = 'max-iterations';
        return { shouldContinue: false, reason: `Max iterations (${MAX_FIX_ITERATIONS}) reached — escalate to human (Article 6)` };
      }

      // Acceptable score with no errors — can stop
      if (result.score.verdict === 'acceptable' && result.errors.length === 0) {
        this.status = 'acceptable';
        return { shouldContinue: false, reason: 'Acceptable quality with clean console' };
      }

      // Broken — escalate immediately if score is critically low
      if (result.score.total < THRESHOLDS.broken) {
        this.status = 'escalated';
        return { shouldContinue: false, reason: `Score below ${THRESHOLDS.broken} — escalate to human` };
      }

      return { shouldContinue: true, reason: 'Continuing improvement cycle' };
    },

    /**
     * Get a summary of the cycle for audit trail (Article 7).
     */
    getSummary() {
      return {
        componentPath: this.componentPath,
        startedAt: this.startedAt,
        completedAt: new Date().toISOString(),
        status: this.status,
        totalIterations: this.iterations.length,
        finalScore: this.iterations.length > 0
          ? this.iterations[this.iterations.length - 1].score.total
          : null,
        scoreProgression: this.iterations.map((i) => i.score.total),
      };
    },
  };
}

module.exports = {
  // Scoring
  SCORING_DIMENSIONS,
  THRESHOLDS,
  MAX_FIX_ITERATIONS,
  CONSECUTIVE_SHIP_REQUIRED,
  computeScore,
  scoreDimension,

  // Error handling
  ERROR_CLASSES,
  classifyError,
  parseConsoleErrors,

  // Formatting
  formatScoreReport,
  formatErrorReport,

  // Cycle management
  createCycleState,
};
