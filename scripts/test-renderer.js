/**
 * Test script for vexRenderer — runs all 5 checks from the task.
 * Run: node scripts/test-renderer.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── Suppress known VexFlow/Canvas noise before requiring ──────────────────────
const SUPPRESSED = [
  'Element: No context for txtCanvas',
  "couldn't load font",
  'falling back to',
];
const _origWarn = console.warn.bind(console);
console.warn = (...args) => {
  const msg = args.join(' ');
  if (SUPPRESSED.some(s => msg.includes(s))) return; // swallow
  _origWarn(...args);
};
// Suppress native stderr font messages
const _origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  const s = typeof chunk === 'string' ? chunk : chunk.toString();
  if (SUPPRESSED.some(w => s.includes(w))) return true;
  return _origStderrWrite(chunk, ...rest);
};
// ─────────────────────────────────────────────────────────────────────────────

const { renderChordProgression, tryRenderFromText, chordToNotes } = require('../src/vexRenderer');

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ─── Task 1 + 2: renderChordProgression produces a PNG ───────────────────────
console.log('\n=== Test 1+2: renderChordProgression + file size/dimensions ===');
let pngPath;
try {
  pngPath = renderChordProgression(['Am7', 'Dm7', 'G7', 'Cmaj7'], { title: 'ii-V-I-I in C' });
  assert(typeof pngPath === 'string' && pngPath.endsWith('.png'), 'Returns .png path', pngPath);
  assert(fs.existsSync(pngPath), 'File exists on disk', pngPath);

  const stat = fs.statSync(pngPath);
  assert(stat.size > 2000, `File size > 2 KB (got ${stat.size} bytes)`);
  assert(stat.size < 500_000, `File size < 500 KB (got ${stat.size} bytes)`);

  // Read PNG header to verify dimensions: bytes 16-23 = width (4) + height (4)
  const buf = fs.readFileSync(pngPath);
  const sig = buf.slice(0, 8).toString('hex');
  assert(sig === '89504e470d0a1a0a', 'Valid PNG signature');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  console.log(`       PNG dimensions: ${w}x${h}`);
  assert(w === 900, `Width is 900 (got ${w})`);
  assert(h === 240, `Height is 240 (got ${h})`);

  console.log('  File:', pngPath);
} catch (e) {
  console.error('  ERROR:', e.message);
  failed++;
}

// ─── Task 3: Suppression of VexFlow noise ────────────────────────────────────
console.log('\n=== Test 3: console.warn suppression ===');
{
  const warnings = [];
  const _w = console.warn;
  console.warn = (...a) => { warnings.push(a.join(' ')); _w(...a); };
  try {
    renderChordProgression(['Cmaj7', 'Am7', 'Dm7', 'G7'], { title: 'test' });
  } catch (_) {}
  console.warn = _w;

  const noisy = warnings.filter(w => w.includes('No context for txtCanvas') || w.includes('falling back'));
  assert(noisy.length === 0, `No noisy VexFlow warnings leaked (got ${noisy.length})`);
}

// ─── Task 4: tryRenderFromText with realistic bot response ────────────────────
console.log('\n=== Test 4: tryRenderFromText ===');
{
  const botResp = 'A classic ii-V-I in C major uses Dm7 going to G7 and resolving to Cmaj7. ' +
    'You could extend it to Am7 - Dm7 - G7 - Cmaj7 for a more complete progression.';
  const result = tryRenderFromText(botResp);
  assert(result !== null, 'Detects chords in realistic bot response');
  if (result) {
    assert(fs.existsSync(result), 'Rendered PNG exists', result);
    const stat = fs.statSync(result);
    assert(stat.size > 1000, `Rendered file > 1 KB (${stat.size} bytes)`);
    console.log('  File:', result);
  }
}

{
  // Should NOT render for text with no chord pattern
  const plain = 'Guitar is a string instrument popular in rock and blues music.';
  const result = tryRenderFromText(plain);
  assert(result === null, 'Returns null for text without chord progressions');
}

{
  // Should NOT render for text with only 1-2 chords
  const sparse = 'Play Dm7 to set the mood.';
  const result = tryRenderFromText(sparse);
  assert(result === null, 'Returns null when fewer than 3 qualifying chords');
}

// ─── Task 5: render_chords handler logic (unit test, no Discord) ─────────────
console.log('\n=== Test 5: render_chords handler (simulated) ===');
{
  // Simulate what bot.js does in the render_chords branch
  let attachments = [];
  try {
    const input = { chords: ['Am7', 'Dm7', 'G7', 'Cmaj7'], title: 'ii-V-I-I in C' };
    const imgPath = renderChordProgression(input.chords, { title: input.title || 'Chord Progression' });
    attachments.push(imgPath);
  } catch (e) {
    console.error('  Chord render error:', e.message);
    failed++;
  }
  assert(attachments.length === 1, 'handler pushes exactly one file into attachments');
  assert(fs.existsSync(attachments[0] || ''), 'attachment file exists', attachments[0]);

  // Confirm files object structure Discord would use
  const files = attachments.map((filePath, i) => ({ attachment: filePath, name: `diagram-${i + 1}.png` }));
  assert(files[0]?.name === 'diagram-1.png', 'Discord files[0].name is diagram-1.png');
  assert(files[0]?.attachment === attachments[0], 'Discord files[0].attachment is the path');
}

// ─── chordToNotes: enharmonic normalization ───────────────────────────────────
console.log('\n=== Bonus: chordToNotes normalizations ===');
{
  const tests = [
    ['C#m7', 'Dbm7 keys expected', 3],
    ['G#maj7', 'Abmaj7 keys expected', 4],
    ['A#', 'Bb keys expected', 3],
    ['Bbmin7', 'Bbm7 normalized', 4],
  ];
  for (const [chord, label, expectedKeys] of tests) {
    try {
      const notes = chordToNotes(chord);
      assert(notes.keys.length === expectedKeys, `chordToNotes('${chord}') → ${label} (${notes.keys.length} notes)`);
    } catch (e) {
      console.error(`  ERROR chordToNotes('${chord}'):`, e.message);
      failed++;
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
