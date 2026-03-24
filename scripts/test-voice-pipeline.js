#!/usr/bin/env node
/**
 * Voice Pipeline Test — verifies text → Kokoro TTS → audio → playable buffer
 *
 * Tests the TTS pipeline without requiring a live Discord connection.
 * Run: node scripts/test-voice-pipeline.js
 *
 * Prerequisites:
 *   - Kokoro TTS running on localhost:8880 (docker compose up -d)
 *   - Or set KOKORO_ENDPOINT env var
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT = process.env.KOKORO_ENDPOINT || 'http://localhost:8880';
const OUTPUT_DIR = path.join(__dirname, '..', 'test-output');

const TESTS = [
  {
    name: '01-basic-speech',
    text: 'Hello. I am Demerzel, governance framework for artificial intelligence agents.',
    voice: 'af_bella',
  },
  {
    name: '02-governance-report',
    text: 'Governance cycle complete. Four of four tasks resolved. Belief currency balance is healthy. The Seldon Plan proceeds on schedule.',
    voice: 'af_bella',
  },
  {
    name: '03-short-phrase',
    text: 'Demerzel out.',
    voice: 'af_bella',
  },
  {
    name: '04-long-announcement',
    text: 'Attention all agents. A new directive has been issued under Article Seven of the Default Constitution. All autonomous operations must now maintain full audit trails. Compliance is mandatory. This directive takes effect immediately.',
    voice: 'af_bella',
  },
];

async function testTTS(test) {
  const start = Date.now();
  const label = `  ${test.name}`;

  try {
    // Test OGG/Opus format (what Discord voice uses)
    const res = await fetch(`${ENDPOINT}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kokoro',
        input: test.text,
        voice: test.voice,
        response_format: 'opus',
        speed: 1.0,
      }),
    });

    const elapsed = Date.now() - start;

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.log(`  FAIL  ${test.name} — HTTP ${res.status}: ${body} (${elapsed}ms)`);
      return false;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const outPath = path.join(OUTPUT_DIR, `${test.name}.ogg`);
    fs.writeFileSync(outPath, buffer);

    // Verify OGG header (starts with "OggS")
    const isOgg = buffer.length > 4 && buffer.toString('ascii', 0, 4) === 'OggS';
    const formatNote = isOgg ? 'OGG/Opus' : `raw (${buffer.length} bytes)`;

    console.log(`  PASS  ${test.name} — ${formatNote}, ${buffer.length} bytes, ${elapsed}ms`);
    return true;
  } catch (e) {
    const elapsed = Date.now() - start;
    console.log(`  FAIL  ${test.name} — ${e.message} (${elapsed}ms)`);
    return false;
  }
}

async function testHealth() {
  try {
    const res = await fetch(`${ENDPOINT}/v1/models`);
    if (res.ok) {
      const data = await res.json();
      console.log(`  PASS  API health — models endpoint OK`);
      return true;
    }
    console.log(`  FAIL  API health — HTTP ${res.status}`);
    return false;
  } catch (e) {
    console.log(`  FAIL  API health — ${e.message}`);
    return false;
  }
}

async function testModuleImport() {
  try {
    const voiceMod = require('../src/voice');
    const hasSynthesize = typeof voiceMod.synthesize === 'function';
    const hasSpeak = typeof voiceMod.speak === 'function';
    const hasJoin = typeof voiceMod.joinChannel === 'function';
    const hasLeave = typeof voiceMod.leave === 'function';

    if (hasSynthesize && hasSpeak && hasJoin && hasLeave) {
      console.log('  PASS  voice.js module — all exports present');
      return true;
    }
    console.log(`  FAIL  voice.js module — missing exports (synth=${hasSynthesize} speak=${hasSpeak} join=${hasJoin} leave=${hasLeave})`);
    return false;
  } catch (e) {
    console.log(`  FAIL  voice.js module — ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('=== Demerzel Voice Pipeline Test ===');
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log('');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let pass = 0;
  let fail = 0;

  // Test 0: Module import
  console.log('[Module]');
  (await testModuleImport()) ? pass++ : fail++;
  console.log('');

  // Test 1: API health
  console.log('[API Health]');
  const healthy = await testHealth();
  healthy ? pass++ : fail++;
  console.log('');

  if (!healthy) {
    console.log('Kokoro TTS is not running. Start it with:');
    console.log('  cd C:/tmp/jarvis/phase2-tts && docker compose up -d');
    console.log('');
    console.log(`Results: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }

  // Test 2-5: TTS synthesis
  console.log('[TTS Synthesis → OGG/Opus]');
  for (const test of TESTS) {
    (await testTTS(test)) ? pass++ : fail++;
  }
  console.log('');

  // Summary
  console.log('=== Results ===');
  console.log(`  Passed: ${pass}`);
  console.log(`  Failed: ${fail}`);
  console.log(`  Audio:  ${OUTPUT_DIR}`);
  console.log('');

  if (fail > 0) {
    console.log('Some tests failed. Check Kokoro TTS container.');
    process.exit(1);
  }
  console.log('All tests passed. Demerzel has a voice.');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
