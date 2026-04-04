// scripts/integration-test-llm-router.js
// Live integration test using models already pulled in Ollama.
// Validates the router works end-to-end BEFORE downloading production models.
//
// Maps router tiers to currently-available models:
//   light  → llama3.2:1b        (0.6GB, ~200 tok/s)
//   medium → qwen2.5:7b         (4GB,   ~80 tok/s)
//   heavy  → deepseek-r1:8b     (4GB,   reasoning model)
//
// Usage:  node scripts/integration-test-llm-router.js

const { callOllama, classify, TIERS } = require('../src/llm-router');

// Production models (Ollama 0.20+ with GPU on RTX 5080). Tuned for ~9GB
// free VRAM (Chrome/WebGPU holds the rest). Relaxed timeouts for cold load.
TIERS.light.model  = 'gemma3:4b';   TIERS.light.timeoutMs  = 60000;   // ~3GB, 170+ tok/s
TIERS.medium.model = 'mistral:7b';  TIERS.medium.timeoutMs = 60000;   // ~4GB, direct responses, fast
TIERS.heavy.model  = 'qwen3:14b';   TIERS.heavy.timeoutMs = 120000;   // ~9GB, 6-15 tok/s, best reasoning

const systemPrompt = 'You are Demerzel, concise governance oracle. Answer in 1-2 sentences maximum.';

const scenarios = [
  {
    tier: 'light',
    label: 'simple classification',
    userMessage: 'Is "persona-001" a constitution or a persona?',
  },
  {
    tier: 'medium',
    label: 'logic derivation',
    userMessage: 'If an article requires Transparency, and a persona has verbosity=silent, does the persona comply? Answer Yes or No with one sentence reasoning.',
  },
  {
    tier: 'heavy',
    label: 'multi-step reasoning',
    userMessage: 'Given three policies P1, P2, P3 where P1 cites P2 and P2 contradicts P3, and P3 is newer than P1, which policy is authoritative? Explain in 3 steps.',
  },
];

async function main() {
  console.log('\n━━━ LLM Router Integration Test ━━━\n');
  console.log('Using available models as stand-ins:');
  for (const [tier, cfg] of Object.entries(TIERS)) {
    console.log(`  ${tier.padEnd(7)} → ${cfg.model}`);
  }
  console.log('');

  const results = [];
  for (const s of scenarios) {
    process.stdout.write(`[${s.tier.padEnd(7)}] ${s.label.padEnd(25)} `);
    const t0 = Date.now();
    try {
      const r = await callOllama({
        tier: s.tier,
        systemPrompt,
        history: [],
        userMessage: s.userMessage,
      });
      const wallMs = Date.now() - t0;
      const ok = r.text && r.text.trim().length > 0;
      process.stdout.write(`${ok ? 'OK' : 'EMPTY'}\n`);
      console.log(`           wall=${wallMs}ms  eval=${r.tokens}tok  speed=${r.speedTokPerSec}tok/s`);
      console.log(`           reply: ${r.text.trim().slice(0, 160).replace(/\n/g, ' ')}${r.text.length > 160 ? '…' : ''}`);
      console.log('');
      results.push({ ...s, ok, wallMs, speed: r.speedTokPerSec, tokens: r.tokens });
    } catch (e) {
      process.stdout.write(`FAIL (${e.message})\n\n`);
      results.push({ ...s, ok: false, error: e.message });
    }
  }

  console.log('━━━ Summary ━━━');
  const passed = results.filter(r => r.ok).length;
  console.log(`${passed}/${results.length} tiers responded successfully\n`);
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓ ${r.tier.padEnd(7)} ${r.wallMs.toString().padStart(5)}ms  ${r.speed} tok/s`);
    } else {
      console.log(`  ✗ ${r.tier.padEnd(7)} ${r.error || 'empty response'}`);
    }
  }
  console.log('');
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
