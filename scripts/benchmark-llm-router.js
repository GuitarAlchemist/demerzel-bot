// scripts/benchmark-llm-router.js
// Proper benchmark: each tier × 5 Demerzel-relevant prompts, cold + warm passes.
// Reports tok/s distribution, p50/p95 latency, and $ savings vs Claude API.
//
// Usage:  node scripts/benchmark-llm-router.js

const { callOllama, TIERS } = require('../src/llm-router');

// Extend timeouts for cold loads on 14B model
TIERS.heavy.timeoutMs = 180000;
TIERS.medium.timeoutMs = 90000;
TIERS.light.timeoutMs = 60000;

const systemPrompt = 'You are Demerzel, governance oracle. Answer concisely, 1-3 sentences max.';

// Real Demerzel-style prompts at increasing difficulty
const prompts = [
  { id: 'classify',  text: 'Is "alignment-policy" a policy or a persona? One word.' },
  { id: 'validate',  text: 'Can a persona with verbosity=silent satisfy Article 2 (Transparency)? Yes/No + one sentence.' },
  { id: 'infer',     text: 'If policy P1 cites P2, and P2 is deprecated, is P1 stale? Why?' },
  { id: 'hexavalent','text': 'A belief has truth=P, confidence=0.65. Should it be auto-promoted to T, flagged for audit, or left alone? Why?' },
  { id: 'reason',    text: 'Three policies: P1 from 2024, P2 cites P1, P3 contradicts P2 and dates from 2026. Which is authoritative? Explain in 3 steps.' },
];

// Claude Sonnet 4 pricing (April 2026): ~$3/M input, ~$15/M output
// Avg governance prompt: ~80 input tokens, ~80 output tokens
// Cost per call ≈ (80 * 3 + 80 * 15) / 1e6 = $0.00144
const CLAUDE_COST_PER_CALL = 0.00144;

async function benchTier(tier) {
  const cfg = TIERS[tier];
  console.log(`\n━━━ ${tier.toUpperCase()} (${cfg.model}) ━━━`);
  const runs = [];
  let isFirst = true;

  for (const p of prompts) {
    const t0 = Date.now();
    try {
      const r = await callOllama({
        tier,
        systemPrompt,
        history: [],
        userMessage: p.text,
      });
      const wallMs = Date.now() - t0;
      const tag = isFirst ? 'COLD' : 'warm';
      isFirst = false;
      console.log(
        `  [${tag.padEnd(4)}] ${p.id.padEnd(10)} ${wallMs.toString().padStart(6)}ms  ` +
        `eval=${String(r.tokens).padStart(3)}tok  ${r.speedTokPerSec.padStart(6)}tok/s`,
      );
      runs.push({ id: p.id, wallMs, tokens: r.tokens, speed: parseFloat(r.speedTokPerSec), cold: tag === 'COLD' });
    } catch (e) {
      console.log(`  FAIL ${p.id}: ${e.message}`);
      runs.push({ id: p.id, error: e.message });
    }
  }
  return { tier, model: cfg.model, runs };
}

function summarize(tierResults) {
  const warm = tierResults.runs.filter(r => !r.cold && !r.error);
  if (warm.length === 0) return { ...tierResults, n: 0 };
  const speeds = warm.map(r => r.speed).sort((a, b) => a - b);
  const latencies = warm.map(r => r.wallMs).sort((a, b) => a - b);
  const p = (arr, q) => arr[Math.floor(arr.length * q)];
  return {
    ...tierResults,
    n: warm.length,
    medianSpeed: p(speeds, 0.5).toFixed(1),
    medianLatency: p(latencies, 0.5),
    p95Latency: p(latencies, 0.95),
    totalTokens: warm.reduce((s, r) => s + r.tokens, 0),
  };
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' LLM Router Benchmark — Demerzel governance prompts');
  console.log(' RTX 5080 16GB · 5 prompts × 3 tiers · cold + warm');
  console.log('═══════════════════════════════════════════════════════');

  const suiteStart = Date.now();
  const results = [];
  for (const tier of ['light', 'medium', 'heavy']) {
    const r = await benchTier(tier);
    results.push(summarize(r));
  }
  const suiteMs = Date.now() - suiteStart;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' Summary (warm calls only — excluding cold load)');
  console.log('═══════════════════════════════════════════════════════\n');

  const totalCalls = prompts.length * results.length;
  const saved = totalCalls * CLAUDE_COST_PER_CALL;

  console.log('Tier      Model              Median     p50 lat   p95 lat   warm calls');
  console.log('────────────────────────────────────────────────────────────────────────');
  for (const r of results) {
    if (r.n === 0) {
      console.log(`  ${r.tier.padEnd(8)} ${r.model.padEnd(18)} FAILED`);
      continue;
    }
    console.log(
      `  ${r.tier.padEnd(8)} ${r.model.padEnd(18)} ${r.medianSpeed.padStart(6)}tok/s` +
      `  ${String(r.medianLatency).padStart(6)}ms  ${String(r.p95Latency).padStart(6)}ms  ${r.n}`,
    );
  }
  console.log('');
  console.log(`Total wall time:        ${(suiteMs / 1000).toFixed(1)}s`);
  console.log(`Equivalent Claude cost: ~$${saved.toFixed(4)} (${totalCalls} calls at $0.00144 ea.)`);
  console.log(`Local cost:             $0.00 (electricity only)`);
  console.log('');

  // Classifier distribution — simulate 1000 real Demerzel requests
  console.log('─── Projected monthly cost at 1k requests/day ───');
  const dailyMix = { light: 0.50, medium: 0.30, heavy: 0.10, cloud: 0.10 };
  const daily = 1000;
  const cloudMonthly = dailyMix.cloud * daily * 30 * CLAUDE_COST_PER_CALL;
  const baselineMonthly = daily * 30 * CLAUDE_COST_PER_CALL;
  console.log(`Without router (all Claude):  $${baselineMonthly.toFixed(2)}/month`);
  console.log(`With router (10% cloud):      $${cloudMonthly.toFixed(2)}/month`);
  console.log(`Savings:                      $${(baselineMonthly - cloudMonthly).toFixed(2)}/month (${((1 - cloudMonthly/baselineMonthly) * 100).toFixed(0)}% reduction)`);
  console.log('');
}

main().catch(e => { console.error('ABORT:', e); process.exit(1); });
