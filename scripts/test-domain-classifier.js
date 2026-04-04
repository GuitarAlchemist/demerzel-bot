// scripts/test-domain-classifier.js
// Validates embedding-based domain routing. Runs known-good and edge cases
// through the classifier and reports domain + confidence + runner-up margin.
//
// Usage:  node scripts/test-domain-classifier.js

const { classifyDomain, warmup } = require('../src/domain-classifier');

const cases = [
  // governance (expect cloud)
  { msg: 'What is the Zeroth Law?',                   expect: 'governance' },
  { msg: 'Explain Article 5 please',                  expect: 'governance' },
  { msg: 'Does this policy supersede the older one?', expect: 'governance' },
  { msg: 'Who is Daneel Olivaw?',                     expect: 'governance' },
  { msg: 'What are ERGOL bindings?',                  expect: 'governance' },

  // music (expect cloud)
  { msg: 'How do I play C major on guitar?',          expect: 'music' },
  { msg: 'What is a pentatonic scale?',               expect: 'music' },
  { msg: 'Show me A minor fretboard',                 expect: 'music' },
  { msg: 'How do I tune a guitar?',                   expect: 'music' },
  { msg: 'Explain barre chords',                      expect: 'music' },

  // general (expect local)
  { msg: 'ok thanks',                                 expect: 'general' },
  { msg: 'what is governance in one sentence',        expect: 'general' },
  { msg: 'summarize what happened',                   expect: 'general' },

  // edge cases — ambiguous phrasing
  { msg: 'What is the scale of this problem?',        expect: 'general', note: 'should NOT match music' },
  { msg: 'Is this a major change?',                   expect: 'general', note: 'should NOT match music' },
  { msg: 'key decision needed',                       expect: 'general', note: 'should NOT match music' },
];

async function main() {
  console.log('\n━━━ Embedding-based domain classifier test ━━━\n');
  const ok = await warmup();
  if (!ok) { console.error('warmup failed — is nomic-embed-text pulled?'); process.exit(1); }
  console.log('✓ centroids warmed\n');

  let passed = 0;
  for (const c of cases) {
    const t0 = Date.now();
    const r = await classifyDomain(c.msg);
    const elapsedMs = Date.now() - t0;
    const match = r.domain === c.expect;
    if (match) passed++;
    const marker = match ? '✓' : '✗';
    const note = c.note ? ` (${c.note})` : '';
    console.log(
      `${marker} ${r.domain.padEnd(10)} conf=${r.confidence.toFixed(3)}  ` +
      `margin=${(r.margin ?? 0).toFixed(3)}  ${elapsedMs}ms  ` +
      `→ ${r.route.padEnd(5)}  [${c.msg.slice(0, 40)}]${note}`,
    );
  }
  console.log(`\n${passed}/${cases.length} correct`);
  console.log('');
  process.exit(passed === cases.length ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
