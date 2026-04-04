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

const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';

// --- Model tier registry ---

const TIERS = {
  light:  { model: 'gemma3:4b',    maxTokens: 512,  timeoutMs: 4000  },
  medium: { model: 'qwen3:14b',    maxTokens: 1024, timeoutMs: 8000  },
  heavy:  { model: 'gpt-oss:20b',  maxTokens: 2048, timeoutMs: 15000 },
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
function classify({ userMessage, persona, useTools, historyLen }) {
  // 1. Tools → Claude. Local tool calling via Ollama is possible but
  //    the schemas are Anthropic-specific — not converting them here.
  if (useTools) return 'cloud';

  // 2. Constitutional / governance reasoning keywords → Claude.
  //    These touch Asimov laws, article interpretation, amendments — a wrong
  //    answer here has governance cost. Err toward the smart model.
  const msg = (userMessage || '').toLowerCase();
  const constitutionalSignal = [
    'article', 'zeroth', 'constitution', 'amendment', 'precedent',
    'supersede', 'override', 'contradiction', 'escalate', 'asimov',
  ].some(k => msg.includes(k));
  if (constitutionalSignal) return 'cloud';

  // 3. Long context or deep history → heavy local (still free).
  //    Under ~500 tokens total the light model is plenty.
  const msgLen = (userMessage || '').length;
  const longContext = msgLen > 2000 || historyLen > 10;
  if (longContext) return 'heavy';

  // 4. Logic/math keywords → medium (reasoning model).
  const reasoningSignal = [
    'why', 'because', 'imply', 'prove', 'derive', 'compute',
    'calculate', 'conclude', 'therefore', 'hexavalent', 'tetravalent',
  ].some(k => msg.includes(k));
  if (reasoningSignal) return 'medium';

  // 5. Persona depth: demerzel/seldon lean more reasoning-heavy than
  //    the ga music chatbot persona.
  if (persona === 'demerzel' || persona === 'seldon') return 'medium';

  // 6. Default: fast path.
  return msgLen > 400 ? 'medium' : 'light';
}

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
  const tier = classify(ctx);
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

module.exports = { tryLocal, classify, callOllama, TIERS, isTierAvailable };
