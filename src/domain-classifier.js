// src/domain-classifier.js
// Embedding-based domain routing. Replaces hardcoded keyword lists with
// cosine similarity against pre-computed anchor centroids.
//
// Adding a new domain = append 3-5 example sentences to DOMAINS below.
// No code changes, no regex tuning, no keyword maintenance.
//
// Cost per classification: one ~50ms embedding call + a few cosine ops.
// Anchors are embedded once at module load and cached forever.

const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text:latest';

// ---------------------------------------------------------------------------
// Domain definitions — anchor sentences + routing decision
// ---------------------------------------------------------------------------

const DOMAINS = {
  governance: {
    route: 'cloud',
    reason: 'constitutional reasoning needs Claude + full governance context',
    anchors: [
      'What is Article 3 of the Demerzel Constitution?',
      'Explain the Zeroth Law of Robotics',
      'How does hexavalent logic assign truth values?',
      'What does the Asimov mandate say about Daneel?',
      'Is this policy superseded by a newer amendment?',
      'What is an ERGOL binding versus a LOLLI reference?',
    ],
  },
  music: {
    route: 'cloud',
    reason: 'GA persona has fretboard_diagram tool for verified music answers',
    anchors: [
      'How do I play a C major chord on guitar?',
      'What notes are in the pentatonic scale?',
      'Show me the A minor fretboard shape',
      'Explain the circle of fifths',
      'What is a barre chord?',
      'How do I tune a guitar to drop D?',
    ],
  },
  general: {
    route: 'local',
    reason: 'casual chat, acks, short explanations handled by local tiers',
    anchors: [
      'ok thanks',
      'what is governance in one sentence',
      'explain this briefly',
      'tell me more',
      'what does that mean',
      'summarize the status',
    ],
  },
};

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

async function embed(text, signal) {
  const res = await fetch(`${OLLAMA_ENDPOINT}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    signal,
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.embeddings?.[0] ?? data.embedding;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// Centroid cache — each domain's centroid is the mean of its anchor vectors
// ---------------------------------------------------------------------------

let centroidCache = null;

async function buildCentroids() {
  const centroids = {};
  for (const [name, cfg] of Object.entries(DOMAINS)) {
    const vecs = await Promise.all(cfg.anchors.map(a => embed(a)));
    const dim = vecs[0].length;
    const mean = new Array(dim).fill(0);
    for (const v of vecs) for (let i = 0; i < dim; i++) mean[i] += v[i] / vecs.length;
    centroids[name] = { vec: mean, route: cfg.route, reason: cfg.reason };
  }
  return centroids;
}

async function ensureCentroids() {
  if (centroidCache) return centroidCache;
  centroidCache = await buildCentroids();
  return centroidCache;
}

// ---------------------------------------------------------------------------
// Public API: classify a user message into a domain + route
// ---------------------------------------------------------------------------

/**
 * Classify the user's message by cosine similarity to each domain centroid.
 * Returns { domain, route, confidence, reason } where confidence is the
 * similarity to the winning domain minus runner-up (margin of victory).
 *
 * If no domain scores above MIN_CONFIDENCE, returns 'general' with reason
 * 'below threshold — defaulted to general'.
 */
async function classifyDomain(userMessage, opts = {}) {
  const { minConfidence = 0.35, signal } = opts;
  const cents = await ensureCentroids();
  const qvec = await embed(userMessage, signal);

  const scored = Object.entries(cents)
    .map(([name, c]) => ({ name, score: cosine(qvec, c.vec), route: c.route, reason: c.reason }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUp = scored[1];
  const margin = top.score - runnerUp.score;

  if (top.score < minConfidence) {
    return { domain: 'general', route: 'local', confidence: top.score, reason: 'below threshold — defaulted to general', scored };
  }

  return { domain: top.name, route: top.route, confidence: top.score, margin, reason: top.reason, scored };
}

/**
 * Pre-warm the centroid cache at startup so first classification is fast.
 */
async function warmup() {
  try {
    await ensureCentroids();
    return true;
  } catch (e) {
    console.warn('[domain-classifier] warmup failed:', e.message);
    return false;
  }
}

module.exports = { classifyDomain, warmup, DOMAINS };
