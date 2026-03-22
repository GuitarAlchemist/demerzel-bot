const { createCanvas } = require('canvas');
const vf = require('vexflow');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Render a chord progression as staff notation PNG.
 * Input: array of chord names like ["Cm7", "Fm7", "Bb7", "Ebmaj7"]
 */
function renderChordProgression(chords, options = {}) {
  const {
    title = '',
    width = 800,
    height = 220,
    chordsPerLine = 4,
  } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, width, height);

  // Title
  if (title) {
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = '#c9d1d9';
    ctx.fillText(title, 15, 25);
  }

  const staveY = title ? 40 : 15;
  const staveWidth = width - 30;

  // Use VexFlow renderer
  const renderer = new vf.Renderer(canvas, vf.Renderer.Backends.CANVAS);
  renderer.resize(width, height);
  const context = renderer.getContext();

  // Draw stave
  const stave = new vf.Stave(10, staveY, staveWidth);
  stave.addClef('treble');
  stave.setStyle({ strokeStyle: '#8b949e', fillStyle: '#8b949e' });
  stave.setContext(context).draw();

  // Map chord names to simple note representations
  const chordNotes = chords.slice(0, chordsPerLine).map(chordName => {
    const noteData = chordToNotes(chordName);
    const note = new vf.StaveNote({
      keys: noteData.keys,
      duration: 'w', // whole note per chord
    });
    note.setStyle({ strokeStyle: '#58a6ff', fillStyle: '#58a6ff' });

    // Add accidentals
    noteData.accidentals.forEach((acc, i) => {
      if (acc) note.addModifier(new vf.Accidental(acc), i);
    });

    // Add chord symbol above
    const symbol = new vf.ChordSymbol();
    symbol.addText(chordName);
    symbol.setHorizontal('left');
    note.addModifier(symbol);

    return note;
  });

  if (chordNotes.length > 0) {
    const voice = new vf.Voice({
      num_beats: chordNotes.length * 4,
      beat_value: 4,
    }).setStrict(false);
    voice.addTickables(chordNotes);

    new vf.Formatter().joinVoices([voice]).format([voice], staveWidth - 60);
    voice.draw(context, stave);
  }

  // Save
  const tmpFile = path.join(os.tmpdir(), `chord-prog-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, canvas.toBuffer('image/png'));
  return tmpFile;
}

/**
 * Map a chord name to VexFlow note keys.
 * Simplified mapping — covers common chords.
 */
function chordToNotes(name) {
  const n = name.replace(/maj|min|dim|aug|sus|add/gi, '').trim();
  const root = n[0].toUpperCase();
  const hasFlat = n.includes('b') && n.indexOf('b') === 1;
  const hasSharp = n.includes('#') && n.indexOf('#') === 1;
  const isMinor = /m(?!aj)/i.test(name) && !name.toLowerCase().startsWith('maj');

  // Base note mapping (root position, close voicing)
  const noteMap = {
    'C': { keys: ['c/4', 'e/4', 'g/4'], acc: [null, null, null] },
    'D': { keys: ['d/4', 'f#/4', 'a/4'], acc: [null, '#', null] },
    'E': { keys: ['e/4', 'g#/4', 'b/4'], acc: [null, '#', null] },
    'F': { keys: ['f/4', 'a/4', 'c/5'], acc: [null, null, null] },
    'G': { keys: ['g/4', 'b/4', 'd/5'], acc: [null, null, null] },
    'A': { keys: ['a/4', 'c#/5', 'e/5'], acc: [null, '#', null] },
    'B': { keys: ['b/4', 'd#/5', 'f#/5'], acc: [null, '#', '#'] },
  };

  let base = noteMap[root] || noteMap['C'];
  let keys = [...base.keys];
  let accidentals = [...base.acc];

  // Minor: flatten the 3rd
  if (isMinor) {
    if (keys[1].includes('#')) {
      keys[1] = keys[1].replace('#', '');
      accidentals[1] = null;
    } else {
      keys[1] = keys[1].replace(/([a-g])/, '$1b');
      accidentals[1] = 'b';
    }
  }

  // 7th chords: add a 4th note
  if (name.includes('7') || name.includes('maj7')) {
    const isMaj7 = name.toLowerCase().includes('maj7');
    // Add 7th (simplified)
    const rootIdx = 'cdefgab'.indexOf(root.toLowerCase());
    const seventh = 'cdefgab'[(rootIdx + 6) % 7]; // b7
    const octave = seventh < root.toLowerCase() ? '/5' : '/4';
    if (isMaj7) {
      keys.push(seventh + octave);
      accidentals.push(null);
    } else {
      keys.push(seventh + 'b' + octave);
      accidentals.push('b');
    }
  }

  return { keys, accidentals };
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
 * Returns file path or null.
 */
function tryRenderFromText(text) {
  // Look for chord progressions in the response
  // Pattern: chord names separated by | - → or spaces
  const chordPattern = /\b([A-G][#b]?(?:maj7|min7|m7|7|dim7|aug|sus[24]|add9|m|M)?)\b/g;
  const matches = [...text.matchAll(chordPattern)].map(m => m[1]);

  // Need at least 3 chord-like matches in sequence
  if (matches.length >= 3) {
    // Take first 8 unique-ish chords
    const chords = matches.slice(0, 8);
    try {
      return renderChordProgression(chords, { title: 'Chord Progression' });
    } catch (e) {
      console.error('Chord render error:', e.message);
      return null;
    }
  }
  return null;
}

module.exports = { renderChordProgression, renderFretboard, tryRenderFromText };
