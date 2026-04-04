// scripts/promote-anchors.js
// Reads logs/routing-decisions.jsonl and surfaces queries that are strong
// candidates to become new anchors. Never modifies domain-classifier.js
// directly — outputs a proposal for human review.
//
// Promotion criteria (conservative):
//   - margin >= 0.15 (clear win, not a coin-flip)
//   - confidence >= 0.65 (classifier strongly agrees)
//   - not already in the anchor set (fuzzy match)
//   - query length 15-120 chars (neither too terse nor too verbose)
//
// Usage:
//   node scripts/promote-anchors.js                 # proposals
//   node scripts/promote-anchors.js --top 5         # top N per domain
//   node scripts/promote-anchors.js --stats         # drift stats only
//
// Run weekly. Review proposals, append good ones to DOMAINS in
// src/domain-classifier.js, delete bad ones.

const fs = require('fs');
const path = require('path');
const { DOMAINS } = require('../src/domain-classifier');

const LOG_PATH = process.env.DOMAIN_LOG_PATH || path.join(__dirname, '..', 'logs', 'routing-decisions.jsonl');
const args = process.argv.slice(2);
const TOP_N = parseInt(args[args.indexOf('--top') + 1] || '3', 10);
const STATS_ONLY = args.includes('--stats');

function readDecisions() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs.readFileSync(LOG_PATH, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function lower(s) { return (s || '').toLowerCase().trim(); }

// Fuzzy dedupe: would this query essentially duplicate an existing anchor?
function isDuplicate(query, anchors) {
  const q = lower(query);
  for (const a of anchors) {
    const low = lower(a);
    // If 60%+ of the anchor's words appear in the query, treat as dup.
    const words = low.split(/\s+/).filter(w => w.length > 3);
    if (words.length === 0) continue;
    const hits = words.filter(w => q.includes(w)).length;
    if (hits / words.length >= 0.6) return true;
  }
  return false;
}

function main() {
  const decisions = readDecisions();
  if (decisions.length === 0) {
    console.log(`No decisions in ${LOG_PATH} yet. Use the bot first, then re-run.`);
    return;
  }

  // Stats: distribution, drift signals
  const byDomain = {};
  const byRoute = {};
  const marginBuckets = { 'low (<0.05)': 0, 'med (0.05-0.15)': 0, 'high (>=0.15)': 0 };
  for (const d of decisions) {
    byDomain[d.domain] = (byDomain[d.domain] || 0) + 1;
    byRoute[d.route] = (byRoute[d.route] || 0) + 1;
    const m = d.margin ?? 0;
    if (m < 0.05) marginBuckets['low (<0.05)']++;
    else if (m < 0.15) marginBuckets['med (0.05-0.15)']++;
    else marginBuckets['high (>=0.15)']++;
  }

  console.log(`\n━━━ Routing decisions (${decisions.length} total) ━━━`);
  console.log('\nBy domain:'); for (const [k, v] of Object.entries(byDomain)) console.log(`  ${k.padEnd(12)} ${v}`);
  console.log('\nBy route:');  for (const [k, v] of Object.entries(byRoute))  console.log(`  ${k.padEnd(12)} ${v}`);
  console.log('\nMargin distribution:'); for (const [k, v] of Object.entries(marginBuckets)) console.log(`  ${k.padEnd(20)} ${v}`);

  const lowMarginPct = marginBuckets['low (<0.05)'] / decisions.length;
  if (lowMarginPct > 0.15) {
    console.log(`\n⚠ ${(lowMarginPct * 100).toFixed(0)}% of queries had margin < 0.05 — classifier is uncertain, anchors may need attention.`);
  }

  if (STATS_ONLY) return;

  // Anchor-promotion candidates, per domain
  console.log(`\n━━━ Promotion candidates (top ${TOP_N} per domain) ━━━\n`);

  const candidatesByDomain = {};
  for (const d of decisions) {
    if (d.source !== 'embedding') continue;              // skip fallback-sourced decisions
    if ((d.margin ?? 0) < 0.15) continue;                // not confident enough
    if ((d.confidence ?? 0) < 0.65) continue;            // weak signal
    const q = (d.query || '').trim();
    if (q.length < 15 || q.length > 120) continue;       // too short/long to be a clean anchor
    if (!DOMAINS[d.domain]) continue;                    // unknown domain
    if (isDuplicate(q, DOMAINS[d.domain].anchors)) continue;

    (candidatesByDomain[d.domain] ||= []).push({ q, margin: d.margin, confidence: d.confidence });
  }

  let totalProposed = 0;
  for (const [domain, items] of Object.entries(candidatesByDomain)) {
    items.sort((a, b) => b.margin - a.margin);
    const top = items.slice(0, TOP_N);
    if (top.length === 0) continue;
    totalProposed += top.length;
    console.log(`[${domain}] — ${items.length} candidates, top ${top.length}:`);
    for (const c of top) {
      console.log(`  conf=${c.confidence.toFixed(3)} margin=${c.margin.toFixed(3)}  "${c.q}"`);
    }
    console.log('');
  }

  if (totalProposed === 0) {
    console.log('(no candidates — all recent queries either had low margin, low confidence, or duplicate existing anchors)\n');
  } else {
    console.log(`${totalProposed} anchor candidates proposed. Review each and append good ones to DOMAINS in src/domain-classifier.js.\n`);
  }
}

main();
