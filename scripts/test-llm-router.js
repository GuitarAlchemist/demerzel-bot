// scripts/test-llm-router.js
// Quick bench: runs each tier against sample prompts + prints classify decisions.
// Usage:  node scripts/test-llm-router.js

const { tryLocal, classify, TIERS, isTierAvailable } = require('../src/llm-router');

const cases = [
  { label: 'simple ack',         userMessage: 'ok thanks',                                persona: 'ga',       useTools: false, historyLen: 0, expect: 'light' },
  { label: 'parse classify',     userMessage: 'what kind of node is persona-001?',        persona: 'demerzel', useTools: false, historyLen: 0, expect: 'light' },
  { label: 'logic derivation',   userMessage: 'why does this clause imply the test?',     persona: 'demerzel', useTools: false, historyLen: 2, expect: 'medium' },
  { label: 'long history',       userMessage: 'continue the analysis',                    persona: 'demerzel', useTools: false, historyLen: 15, expect: 'heavy' },
  { label: 'constitutional',     userMessage: 'is article 3 overridden by the amendment?', persona: 'demerzel', useTools: false, historyLen: 0, expect: 'cloud' },
  { label: 'tool required',      userMessage: 'show me C major on fretboard',             persona: 'ga',       useTools: true,  historyLen: 0, expect: 'cloud' },
  { label: 'big message',        userMessage: 'x'.repeat(2500),                           persona: 'ga',       useTools: false, historyLen: 0, expect: 'heavy' },
];

async function main() {
  console.log('\n=== classifier cases ===\n');
  let passed = 0;
  for (const c of cases) {
    const got = classify(c);
    const ok = got === c.expect;
    if (ok) passed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label.padEnd(20)} → ${got} (expected ${c.expect})`);
  }
  console.log(`\nclassifier: ${passed}/${cases.length} passed\n`);

  console.log('=== tier availability ===\n');
  for (const tier of Object.keys(TIERS)) {
    const ok = await isTierAvailable(tier);
    console.log(`${ok ? '✓' : '✗'} ${tier.padEnd(7)} ${TIERS[tier].model}`);
  }

  console.log('\n=== live call (light tier) ===\n');
  try {
    const r = await tryLocal({
      userMessage: 'in one sentence, what is governance?',
      persona: 'demerzel',
      useTools: false,
      historyLen: 0,
      systemPrompt: 'You are Demerzel, a concise governance oracle. Answer in one sentence.',
      history: [],
    });
    console.log(`model:   ${r.model}`);
    console.log(`tier:    ${r.tier}`);
    console.log(`tokens:  ${r.tokens}`);
    console.log(`speed:   ${r.speedTokPerSec} tok/s`);
    console.log(`reply:   ${r.text.trim()}`);
  } catch (e) {
    console.log(`live call failed: ${e.code || e.message}`);
    console.log('(this is expected if Ollama models not installed yet — run `ollama pull gemma3:4b`)');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
