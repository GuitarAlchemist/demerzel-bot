const { createCanvas } = require('canvas');
const vf = require('vexflow');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Suppress VexFlow's noisy-but-harmless Node.js warnings at module load time.
// "Element: No context for txtCanvas" fires hundreds of times because VexFlow
// tries to measure text via a browser canvas; we provide a measurement canvas
// below.  "couldn't load font bravura" is a native Cairo stderr message when
// Bravura/Academico are not installed — it is cosmetic only.
// ---------------------------------------------------------------------------
const _SUPPRESSED_WARNS = [
  'Element: No context for txtCanvas',
  "couldn't load font",
  'falling back to',
];
const _origWarn = console.warn.bind(console);
console.warn = (...args) => {
  const msg = args.join(' ');
  if (_SUPPRESSED_WARNS.some(s => msg.includes(s))) return;
  _origWarn(...args);
};
// Native stderr (Canvas/Cairo font fallback message)
const _origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  const s = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
  if (_SUPPRESSED_WARNS.some(w => s.includes(w))) return true;
  return _origStderrWrite(chunk, ...rest);
};

// ---------------------------------------------------------------------------
// Chord voicing lookup table — explicit, enharmonically correct, VexFlow-ready
// ---------------------------------------------------------------------------
const CHORD_VOICINGS = {
  // Major triads
  'C':    { keys: ['c/4', 'e/4', 'g/4'],           acc: [null, null, null] },
  'Db':   { keys: ['db/4', 'f/4', 'ab/4'],          acc: ['b',  null, 'b'] },
  'D':    { keys: ['d/4', 'f#/4', 'a/4'],           acc: [null, '#',  null] },
  'Eb':   { keys: ['eb/4', 'g/4', 'bb/4'],          acc: ['b',  null, 'b'] },
  'E':    { keys: ['e/4', 'g#/4', 'b/4'],           acc: [null, '#',  null] },
  'F':    { keys: ['f/4', 'a/4', 'c/5'],            acc: [null, null, null] },
  'Gb':   { keys: ['gb/4', 'bb/4', 'db/5'],         acc: ['b',  'b',  'b'] },
  'G':    { keys: ['g/4', 'b/4', 'd/5'],            acc: [null, null, null] },
  'Ab':   { keys: ['ab/4', 'c/5', 'eb/5'],          acc: ['b',  null, 'b'] },
  'A':    { keys: ['a/4', 'c#/5', 'e/5'],           acc: [null, '#',  null] },
  'Bb':   { keys: ['bb/4', 'd/5', 'f/5'],           acc: ['b',  null, null] },
  'B':    { keys: ['b/4', 'd#/5', 'f#/5'],          acc: [null, '#',  '#'] },

  // Minor triads
  'Cm':   { keys: ['c/4', 'eb/4', 'g/4'],           acc: [null, 'b',  null] },
  'Dm':   { keys: ['d/4', 'f/4', 'a/4'],            acc: [null, null, null] },
  'Ebm':  { keys: ['eb/4', 'gb/4', 'bb/4'],         acc: ['b',  'b',  'b'] },
  'Em':   { keys: ['e/4', 'g/4', 'b/4'],            acc: [null, null, null] },
  'Fm':   { keys: ['f/4', 'ab/4', 'c/5'],           acc: [null, 'b',  null] },
  'F#m':  { keys: ['f#/4', 'a/4', 'c#/5'],          acc: ['#',  null, '#'] },
  'Gm':   { keys: ['g/4', 'bb/4', 'd/5'],           acc: [null, 'b',  null] },
  'Abm':  { keys: ['ab/4', 'b/4', 'eb/5'],          acc: ['b',  null, 'b'] },
  'Am':   { keys: ['a/4', 'c/5', 'e/5'],            acc: [null, null, null] },
  'Bbm':  { keys: ['bb/4', 'db/5', 'f/5'],          acc: ['b',  'b',  null] },
  'Bm':   { keys: ['b/4', 'd/5', 'f#/5'],           acc: [null, null, '#'] },

  // Dominant 7ths
  'C7':   { keys: ['c/4', 'e/4', 'g/4', 'bb/4'],   acc: [null, null, null, 'b'] },
  'Db7':  { keys: ['db/4', 'f/4', 'ab/4', 'b/4'],  acc: ['b',  null, 'b',  null] },
  'D7':   { keys: ['d/4', 'f#/4', 'a/4', 'c/5'],   acc: [null, '#',  null, null] },
  'Eb7':  { keys: ['eb/4', 'g/4', 'bb/4', 'db/5'], acc: ['b',  null, 'b',  'b'] },
  'E7':   { keys: ['e/4', 'g#/4', 'b/4', 'd/5'],   acc: [null, '#',  null, null] },
  'F7':   { keys: ['f/4', 'a/4', 'c/5', 'eb/5'],   acc: [null, null, null, 'b'] },
  'F#7':  { keys: ['f#/4', 'a#/4', 'c#/5', 'e/5'], acc: ['#',  '#',  '#',  null] },
  'G7':   { keys: ['g/4', 'b/4', 'd/5', 'f/5'],    acc: [null, null, null, null] },
  'Ab7':  { keys: ['ab/4', 'c/5', 'eb/5', 'gb/5'], acc: ['b',  null, 'b',  'b'] },
  'A7':   { keys: ['a/4', 'c#/5', 'e/5', 'g/5'],   acc: [null, '#',  null, null] },
  'Bb7':  { keys: ['bb/4', 'd/5', 'f/5', 'ab/5'],  acc: ['b',  null, null, 'b'] },
  'B7':   { keys: ['b/4', 'd#/5', 'f#/5', 'a/5'],  acc: [null, '#',  '#',  null] },

  // Minor 7ths
  'Cm7':  { keys: ['c/4', 'eb/4', 'g/4', 'bb/4'],  acc: [null, 'b',  null, 'b'] },
  'Dm7':  { keys: ['d/4', 'f/4', 'a/4', 'c/5'],    acc: [null, null, null, null] },
  'Ebm7': { keys: ['eb/4', 'gb/4', 'bb/4', 'db/5'],acc: ['b',  'b',  'b',  'b'] },
  'Em7':  { keys: ['e/4', 'g/4', 'b/4', 'd/5'],    acc: [null, null, null, null] },
  'Fm7':  { keys: ['f/4', 'ab/4', 'c/5', 'eb/5'],  acc: [null, 'b',  null, 'b'] },
  'F#m7': { keys: ['f#/4', 'a/4', 'c#/5', 'e/5'],  acc: ['#',  null, '#',  null] },
  'Gm7':  { keys: ['g/4', 'bb/4', 'd/5', 'f/5'],   acc: [null, 'b',  null, null] },
  'Abm7': { keys: ['ab/4', 'b/4', 'eb/5', 'gb/5'], acc: ['b',  null, 'b',  'b'] },
  'Am7':  { keys: ['a/4', 'c/5', 'e/5', 'g/5'],    acc: [null, null, null, null] },
  'Bbm7': { keys: ['bb/4', 'db/5', 'f/5', 'ab/5'], acc: ['b',  'b',  null, 'b'] },
  'Bm7':  { keys: ['b/4', 'd/5', 'f#/5', 'a/5'],   acc: [null, null, '#',  null] },

  // Major 7ths
  'Cmaj7':  { keys: ['c/4', 'e/4', 'g/4', 'b/4'],    acc: [null, null, null, null] },
  'Dbmaj7': { keys: ['db/4', 'f/4', 'ab/4', 'c/5'],  acc: ['b',  null, 'b',  null] },
  'Dmaj7':  { keys: ['d/4', 'f#/4', 'a/4', 'c#/5'],  acc: [null, '#',  null, '#'] },
  'Ebmaj7': { keys: ['eb/4', 'g/4', 'bb/4', 'd/5'],  acc: ['b',  null, 'b',  null] },
  'Emaj7':  { keys: ['e/4', 'g#/4', 'b/4', 'd#/5'],  acc: [null, '#',  null, '#'] },
  'Fmaj7':  { keys: ['f/4', 'a/4', 'c/5', 'e/5'],    acc: [null, null, null, null] },
  'F#maj7': { keys: ['f#/4', 'a#/4', 'c#/5', 'e#/5'],acc: ['#',  '#',  '#',  '#'] },
  'Gmaj7':  { keys: ['g/4', 'b/4', 'd/5', 'f#/5'],   acc: [null, null, null, '#'] },
  'Abmaj7': { keys: ['ab/4', 'c/5', 'eb/5', 'g/5'],  acc: ['b',  null, 'b',  null] },
  'Amaj7':  { keys: ['a/4', 'c#/5', 'e/5', 'g#/5'],  acc: [null, '#',  null, '#'] },
  'Bbmaj7': { keys: ['bb/4', 'd/5', 'f/5', 'a/5'],   acc: ['b',  null, null, null] },
  'Bmaj7':  { keys: ['b/4', 'd#/5', 'f#/5', 'a#/5'], acc: [null, '#',  '#',  '#'] },
};

// Enharmonic normalizations
const ENHARMONICS = {
  'C#': 'Db', 'C#m': 'Dbm', 'C#7': 'Db7', 'C#m7': 'Dbm7', 'C#maj7': 'Dbmaj7',
  'D#': 'Eb', 'D#m': 'Ebm', 'D#7': 'Eb7', 'D#m7': 'Ebm7', 'D#maj7': 'Ebmaj7',
  'G#': 'Ab', 'G#m': 'Abm', 'G#7': 'Ab7', 'G#m7': 'Abm7', 'G#maj7': 'Abmaj7',
  'A#': 'Bb', 'A#m': 'Bbm', 'A#7': 'Bb7', 'A#m7': 'Bbm7', 'A#maj7': 'Bbmaj7',
};

/**
 * Normalize a chord name and look up its VexFlow voicing.
 */
function chordToNotes(name) {
  // Normalize spelling: min7→m7, min→m, Maj→maj, MIN→m, etc.
  let n = name.trim()
    .replace(/min7/ig, 'm7')
    .replace(/min/ig, 'm')
    .replace(/Maj7/g, 'maj7')
    .replace(/MAJ7/g, 'maj7');

  // Apply enharmonic substitution
  const normalized = ENHARMONICS[n] || n;

  const voicing = CHORD_VOICINGS[normalized];
  if (voicing) {
    return { keys: [...voicing.keys], accidentals: [...voicing.acc] };
  }

  // Fallback: look for the bare root without quality
  const root = normalized.replace(/m7|maj7|7|m$/, '');
  const fallback = CHORD_VOICINGS[root];
  if (fallback) {
    return { keys: [...fallback.keys], accidentals: [...fallback.acc] };
  }

  // Last resort: C major
  console.warn(`[vexRenderer] Unknown chord "${name}" (normalized: "${normalized}"), using C major`);
  return { keys: ['c/4', 'e/4', 'g/4'], accidentals: [null, null, null] };
}

/**
 * Render a chord progression as a staff notation PNG.
 *
 * @param {string[]} chords  - array of chord names like ["Cm7", "Fm7", "Bb7", "Ebmaj7"]
 * @param {object}   options - { title, width, height, chordsPerLine }
 * @returns {string} absolute path to the temp PNG file
 */
function renderChordProgression(chords, options = {}) {
  const {
    title = '',
    width = 900,
    height = 240,
    chordsPerLine = 4,
  } = options;

  const canvas = createCanvas(width, height);

  // VexFlow 5 + node-canvas: canvas.style is undefined, patch it so resize() works
  if (!canvas.style) {
    canvas.style = {};
  }

  // Provide a measurement canvas so VexFlow's Element.getTextMetrics() works
  // without spamming "No context for txtCanvas" warnings.
  if (!vf.Element.txtCanvas) {
    const measureCanvas = createCanvas(300, 150);
    vf.Element.setTextMeasurementCanvas(measureCanvas);
  }

  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, width, height);

  // Title
  if (title) {
    ctx.font = 'bold 15px Arial';
    ctx.fillStyle = '#c9d1d9';
    ctx.fillText(title, 15, 24);
  }

  const staveY = title ? 38 : 15;
  const staveWidth = width - 40;

  // VexFlow renderer
  const renderer = new vf.Renderer(canvas, vf.Renderer.Backends.CANVAS);
  renderer.resize(width, height);
  const vfCtx = renderer.getContext();

  // Draw stave
  const stave = new vf.Stave(15, staveY, staveWidth);
  stave.addClef('treble');
  stave.setContext(vfCtx).draw();

  // Build StaveNotes (max chordsPerLine per stave)
  const slice = chords.slice(0, chordsPerLine);
  const staveNotes = slice.map(chordName => {
    const noteData = chordToNotes(chordName);

    const note = new vf.StaveNote({
      keys: noteData.keys,
      duration: 'w',
      auto_stem: false,
    });

    // Accidentals
    noteData.accidentals.forEach((acc, i) => {
      if (acc) note.addModifier(new vf.Accidental(acc), i);
    });

    // Chord symbol above staff
    try {
      const sym = new vf.ChordSymbol();
      sym.addText(chordName);
      sym.setHorizontal('center');
      note.addModifier(sym);
    } catch (e) {
      // ChordSymbol may fail on some VexFlow builds — non-fatal
    }

    return note;
  });

  if (staveNotes.length > 0) {
    const voice = new vf.Voice({
      num_beats: staveNotes.length * 4,
      beat_value: 4,
    }).setStrict(false);
    voice.addTickables(staveNotes);

    new vf.Formatter()
      .joinVoices([voice])
      .format([voice], staveWidth - 80);

    voice.draw(vfCtx, stave);
  }

  // Write PNG
  const tmpFile = path.join(os.tmpdir(), `chord-prog-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, canvas.toBuffer('image/png'));
  return tmpFile;
}

/**
 * Render a fretboard diagram as PNG.
 */
function renderFretboard(options = {}) {
  const {
    title = 'Fretboard',
    notes = {},
    startFret = 0,
    endFret = 12,
    width = 800,
    height = 200,
  } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, width, height);

  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = '#c9d1d9';
  ctx.fillText(title, 10, 20);

  const stringNames = ['E', 'B', 'G', 'D', 'A', 'E'];
  const numStrings = 6;
  const topMargin = 35;
  const leftMargin = 30;
  const stringSpacing = 24;
  const fretCount = endFret - startFret;
  const fretSpacing = (width - leftMargin - 20) / fretCount;

  ctx.font = '12px monospace';
  ctx.fillStyle = '#8b949e';
  for (let s = 0; s < numStrings; s++) {
    ctx.fillText(stringNames[s], 8, topMargin + s * stringSpacing + 4);
  }

  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  for (let f = 0; f <= fretCount; f++) {
    const x = leftMargin + f * fretSpacing;
    ctx.beginPath();
    ctx.moveTo(x, topMargin - 8);
    ctx.lineTo(x, topMargin + (numStrings - 1) * stringSpacing + 8);
    ctx.stroke();
    if ((f + startFret) % 2 === 0 || f === 0) {
      ctx.fillStyle = '#8b949e';
      ctx.font = '10px Arial';
      ctx.fillText(String(f + startFret), x - 3, topMargin + numStrings * stringSpacing + 12);
    }
  }

  ctx.strokeStyle = '#484f58';
  for (let s = 0; s < numStrings; s++) {
    const y = topMargin + s * stringSpacing;
    ctx.lineWidth = s < 3 ? 1 : 1.5;
    ctx.beginPath();
    ctx.moveTo(leftMargin, y);
    ctx.lineTo(leftMargin + fretCount * fretSpacing, y);
    ctx.stroke();
  }

  const dotFrets = [3, 5, 7, 9, 12, 15];
  ctx.fillStyle = '#21262d';
  for (const df of dotFrets) {
    if (df >= startFret && df <= endFret) {
      const x = leftMargin + (df - startFret - 0.5) * fretSpacing;
      if (df === 12) {
        ctx.beginPath(); ctx.arc(x, topMargin + 1.5 * stringSpacing, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x, topMargin + 3.5 * stringSpacing, 4, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(x, topMargin + 2.5 * stringSpacing, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  for (const [stringNum, noteList] of Object.entries(notes)) {
    const s = parseInt(stringNum) - 1;
    const y = topMargin + s * stringSpacing;
    for (const note of noteList) {
      const x = leftMargin + (note.fret - startFret - 0.5) * fretSpacing;
      ctx.fillStyle = note.color || '#58a6ff';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0d1117';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(note.label || '', x, y);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  const tmpFile = path.join(os.tmpdir(), `fretboard-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, canvas.toBuffer('image/png'));
  return tmpFile;
}

/**
 * Extract chord names from text and render if found.
 * Only triggers when text contains a clear chord PROGRESSION pattern
 * (chords separated by - | → or listed in sequence).
 * Returns file path or null.
 */
function tryRenderFromText(text) {
  // Only match real chord patterns (not single-letter words like "A" or "B")
  // Must have chord quality suffix or be part of a progression sequence with separators
  const progressionPattern = /\b([A-G][#b]?(?:maj7|min7|m7|maj|min|7|dim7|aug|sus[24]|add9|m(?!a)))\b/g;
  const matches = [...text.matchAll(progressionPattern)].map(m => m[1]);

  // Need at least 3 properly-qualified chords
  if (matches.length >= 3) {
    const chords = matches.slice(0, 8);
    try {
      return renderChordProgression(chords, { title: 'Chord Progression' });
    } catch (e) {
      console.error('[vexRenderer] Chord render error:', e.message);
      return null;
    }
  }
  return null;
}

module.exports = { renderChordProgression, renderFretboard, tryRenderFromText, chordToNotes };
