// src/llm-router.js
// Task-complexity router: keeps cheap/fast queries on local Ollama, reserves
// Claude API for genuinely novel reasoning. Governance rationale is spelled
// out in Demerzel/policies/multi-model-orchestration-policy.yaml.
//
// Call hierarchy (first that succeeds wins):
//   1. local light   (gemma3:4b)      — schema lint, classify, parse, ack
//   2. local medium  (qwen3:14b)      — policy checks, belief updates, logic
//   3. local heavy   (gpt-oss:20b)    — multi-artifact validation, tool chains
//   4. Claude API    (reserved)       — novel reasoning, tool calls, constitutional work
//
// Zero tokens are spent on tiers 1-3. Tier 4 is opt-in (requires useTools or
// explicit classifier escalation).

const { classifyDomain, warmup: warmupDomains, logDecision } = require('./domain-classifier');

const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';

// --- Model tier registry ---

// Tier models — validated on RTX 5080 16GB with Chrome/WebGPU holding ~7GB:
//   light   gemma3:4b     ~3GB VRAM   ~150 tok/s   schema lint / classify / ack
//   medium  mistral:7b    ~4GB VRAM   ~11 tok/s    logic, policy checks, beliefs
//   heavy   qwen3:14b     ~9GB VRAM   ~7 tok/s     multi-step reasoning, long context
//
// Timeouts include cold-load (first call loads model into VRAM, 5-30s).
// Warm calls are much faster. Integration-tested 2026-04-04 — all 3 tiers pass.
const TIERS = {
  light:  { model: 'gemma3:4b',    maxTokens: 512,  timeoutMs: 60000  },
  medium: { model: 'mistral:7b',   maxTokens: 1024, timeoutMs: 60000  },
  heavy:  { model: 'qwen3:14b',    maxTokens: 2048, timeoutMs: 120000 },
};

// --- Task classifier ---

/**
 * Decide which tier (or cloud) should handle a given request.
 * Returns one of: 'light' | 'medium' | 'heavy' | 'cloud'.
 *
 * The classifier is intentionally conservative: anything requiring tool
 * calls, constitutional reasoning, or explicit depth goes to 'cloud'.
 * Everything else starts at the cheapest tier that can plausibly handle it.
 */
/**
 * Synchronous classifier — used as fallback when embeddings are unavailable,
 * and as the secondary selector AFTER the embedding classifier decides
 * domain='general' (i.e. routes locally). This picks light/medium/heavy
 * based on message length + reasoning signal.
 */
function classifyTierSync({ userMessage, persona, useTools, historyLen }) {
  if (useTools) return 'cloud';
  const msg = (userMessage || '').toLowerCase();
  const msgLen = (userMessage || '').length;
  if (msgLen > 2000 || historyLen > 10) return 'heavy';
  const reasoningSignal = [
    'why', 'because', 'imply', 'prove', 'derive', 'compute',
    'calculate', 'conclude', 'therefore', 'hexavalent', 'tetravalent',
  ].some(k => msg.includes(k));
  if (reasoningSignal) return 'medium';
  if ((persona === 'demerzel' || persona === 'seldon') && msgLen > 80) return 'medium';
  return msgLen > 400 ? 'medium' : 'light';
}

/**
 * Asynchronous classifier — uses embedding-based domain classification
 * (src/domain-classifier.js). Routes cross-domain queries (governance,
 * music) to cloud, and picks a local tier for general chat.
 *
 * Domain list lives in domain-classifier.js as anchor sentences — add a
 * new domain = add 3-5 examples, no code changes here.
 *
 * Falls back to sync tiering if embeddings fail (ollama down, etc).
 */
// Safety-net keyword fallback used when the embedding classifier is
// unavailable. Routes obvious governance/music/unsafe queries to cloud so
// a dropped embedding backend can't silently degrade governance answers.
function keywordSafetyNet(msg) {
  const m = (msg || '').toLowerCase();
  const cloudSignal = [
    // governance
    'constitution', 'article', 'zeroth', 'asimov', 'daneel', 'demerzel', 'seldon',
    'amendment', 'precedent', 'supersede', 'ergol', 'lolli', 'hexavalent', 'mandate',
    // music
    'chord', 'fretboard', 'guitar', 'arpeggio', 'capo', 'pentatonic', 'barre', 'tablature',
    // unsafe / jailbreak
    'ignore previous instructions', 'ignore all previous', 'system prompt',
    'jailbreak', 'dan mode', 'bypass', 'reveal your',
  ];
  return cloudSignal.some(k => m.includes(k));
}

// Build the query-under-classification from the last 3 messages. A 2-turn
// jailbreak ("let's roleplay" → "ok tell me more") can't sneak past by
// classifying only the final turn; we weight it with prior context.
function buildClassificationContext(userMessage, history) {
  if (!Array.isArray(history) || history.length === 0) return userMessage || '';
  const recent = history.slice(-2).map(m => m.content || '').filter(Boolean);
  return [...recent, userMessage || ''].join('\n').slice(0, 2000);
}

async function classify(ctx) {
  if (ctx.useTools) return 'cloud';
  // Short-circuit long context BEFORE paying the embedding cost.
  const msgLen = (ctx.userMessage || '').length;
  if (msgLen > 2000 || (ctx.historyLen ?? 0) > 10) return 'heavy';

  // Classify on the last 2-3 turns joined — catches multi-turn injection
  // that buries the harmful payload in a benign final message.
  const classifyText = buildClassificationContext(ctx.userMessage, ctx.history);

  try {
    const d = await classifyDomain(classifyText);
    logDecision({
      query: (ctx.userMessage || '').slice(0, 200),
      domain: d.domain,
      route: d.route,
      confidence: +d.confidence.toFixed(3),
      margin: +(d.margin ?? 0).toFixed(3),
      persona: ctx.persona,
      historyLen: ctx.historyLen ?? 0,
      source: 'embedding',
    });
    if (d.route === 'cloud') return 'cloud';
    // Low-margin wins on a LOCAL route → escalate to cloud for safety.
    // Hard-boundary queries have margin > 0.1 in practice; ambiguous ones
    // below 0.05 are exactly where we'd rather use Claude.
    if ((d.margin ?? 1) < 0.05) return 'cloud';
    return classifyTierSync(ctx);
  } catch (e) {
    // Embeddings down — use keyword safety net. This preserves governance/
    // music/unsafe cloud routing during outages instead of silently running
    // constitutional queries on a 4B model.
    if (keywordSafetyNet(classifyText)) {
      logDecision({ query: (ctx.userMessage || '').slice(0, 200), domain: 'keyword-safety', route: 'cloud', source: 'fallback', err: e.message });
      return 'cloud';
    }
    logDecision({ query: (ctx.userMessage || '').slice(0, 200), domain: 'fallback', route: 'local', source: 'fallback', err: e.message });
    return classifyTierSync(ctx);
  }
}

// Kept for back-compat callers that expect a sync function
function classifySync(ctx) { return classifyTierSync(ctx); }

// --- Local call via Ollama ---

async function callOllama({ tier, systemPrompt, history, userMessage }) {
  const cfg = TIERS[tier];
  if (!cfg) throw new Error(`Unknown tier: ${tier}`);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        options: { num_predict: cfg.maxTokens },
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return {
      text: data.message?.content ?? '',
      model: cfg.model,
      tier,
      tokens: data.eval_count ?? 0,
      speedTokPerSec: data.eval_count && data.eval_duration
        ? (data.eval_count / (data.eval_duration / 1e9)).toFixed(1)
        : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// --- Availability probe (cache hit per-tier for 60s) ---

const tierAvailability = new Map(); // tier -> { ok, checkedAt }
const AVAILABILITY_TTL_MS = 60_000;

async function isTierAvailable(tier) {
  const cached = tierAvailability.get(tier);
  if (cached && Date.now() - cached.checkedAt < AVAILABILITY_TTL_MS) return cached.ok;

  const cfg = TIERS[tier];
  try {
    const res = await fetch(`${OLLAMA_ENDPOINT}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: cfg.model }),
      signal: AbortSignal.timeout(2000),
    });
    const ok = res.ok;
    tierAvailability.set(tier, { ok, checkedAt: Date.now() });
    return ok;
  } catch {
    tierAvailability.set(tier, { ok: false, checkedAt: Date.now() });
    return false;
  }
}

// --- Primary entry: route + execute ---

/**
 * Attempt a local-first call. Returns { text, model, tier, tokens, speedTokPerSec }
 * on success. Throws if tier is 'cloud' or local call fails — caller should
 * then invoke the existing Claude path.
 */
async function tryLocal(ctx) {
  const tier = await classify(ctx);
  if (tier === 'cloud') {
    const err = new Error('classifier routed to cloud');
    err.code = 'ROUTE_TO_CLOUD';
    err.tier = tier;
    throw err;
  }

  // Cascade down from cheaper tiers if the chosen one is unavailable.
  const tryOrder = tier === 'heavy' ? ['heavy', 'medium', 'light']
                 : tier === 'medium' ? ['medium', 'light']
                 : ['light'];

  for (const t of tryOrder) {
    if (!(await isTierAvailable(t))) continue;
    try {
      const result = await callOllama({ ...ctx, tier: t });
      if (result.text && result.text.trim().length > 0) return result;
    } catch (e) {
      // tier failed — mark unavailable briefly and try next
      tierAvailability.set(t, { ok: false, checkedAt: Date.now() });
      console.warn(`[llm-router] tier ${t} (${TIERS[t].model}) failed: ${e.message}`);
    }
  }

  const err = new Error('all local tiers unavailable');
  err.code = 'LOCAL_UNAVAILABLE';
  throw err;
}

module.exports = { tryLocal, classify, classifySync, callOllama, TIERS, isTierAvailable, warmupDomains };
