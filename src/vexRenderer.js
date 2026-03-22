const { createCanvas } = require('canvas');
const { Renderer, Stave, StaveNote, Voice, Formatter, Accidental } = require('vexflow');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Render VexTab notation to a PNG file.
 * Returns the absolute path to the rendered image.
 */
function renderNotation(options = {}) {
  const {
    notes = [],        // Array of { keys: ['c/4'], duration: 'q', accidentals?: ['#'] }
    title = '',
    timeSignature = '4/4',
    clef = 'treble',
    keySignature = 'C',
    width = 800,
    height = 200,
  } = options;

  // Create canvas
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  // Dark background for Discord
  context.fillStyle = '#161b22';
  context.fillRect(0, 0, width, height);

  // VexFlow renderer
  const renderer = new Renderer(canvas, Renderer.Backends.CANVAS);
  renderer.resize(width, height);
  const ctx = renderer.getContext();

  // Title
  if (title) {
    ctx.setFont('Arial', 14, 'bold');
    ctx.fillStyle = '#c9d1d9';
    ctx.fillText(title, 10, 20);
  }

  const staveY = title ? 35 : 10;
  const stave = new Stave(10, staveY, width - 30);
  stave.addClef(clef);
  stave.addKeySignature(keySignature);
  stave.addTimeSignature(timeSignature);

  // Style for dark mode
  stave.setStyle({ strokeStyle: '#c9d1d9', fillStyle: '#c9d1d9' });
  stave.setContext(ctx).draw();

  if (notes.length > 0) {
    const staveNotes = notes.map(n => {
      const note = new StaveNote({
        keys: n.keys,
        duration: n.duration || 'q',
      });
      note.setStyle({ strokeStyle: '#58a6ff', fillStyle: '#58a6ff' });

      // Add accidentals
      if (n.accidentals) {
        n.accidentals.forEach((acc, i) => {
          if (acc) note.addModifier(new Accidental(acc), i);
        });
      }
      return note;
    });

    const voice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false);
    voice.addTickables(staveNotes);

    new Formatter().joinVoices([voice]).format([voice], width - 80);
    voice.draw(ctx, stave);
  }

  // Save to temp file
  const tmpFile = path.join(os.tmpdir(), `vex-${Date.now()}.png`);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(tmpFile, buffer);

  return tmpFile;
}

/**
 * Render a scale on a fretboard diagram as PNG.
 */
function renderFretboard(options = {}) {
  const {
    title = 'Fretboard',
    notes = {},  // { string: [{ fret, label, color }] }
    startFret = 0,
    endFret = 12,
    width = 800,
    height = 200,
  } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, width, height);

  // Title
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

  // String labels
  ctx.font = '12px monospace';
  ctx.fillStyle = '#8b949e';
  for (let s = 0; s < numStrings; s++) {
    ctx.fillText(stringNames[s], 8, topMargin + s * stringSpacing + 4);
  }

  // Fret lines
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  for (let f = 0; f <= fretCount; f++) {
    const x = leftMargin + f * fretSpacing;
    ctx.beginPath();
    ctx.moveTo(x, topMargin - 8);
    ctx.lineTo(x, topMargin + (numStrings - 1) * stringSpacing + 8);
    ctx.stroke();

    // Fret numbers
    if ((f + startFret) % 2 === 0 || f === 0) {
      ctx.fillStyle = '#8b949e';
      ctx.font = '10px Arial';
      ctx.fillText(String(f + startFret), x - 3, topMargin + numStrings * stringSpacing + 12);
    }
  }

  // Strings
  ctx.strokeStyle = '#484f58';
  for (let s = 0; s < numStrings; s++) {
    const y = topMargin + s * stringSpacing;
    ctx.lineWidth = s < 3 ? 1 : 1.5; // Bass strings thicker
    ctx.beginPath();
    ctx.moveTo(leftMargin, y);
    ctx.lineTo(leftMargin + fretCount * fretSpacing, y);
    ctx.stroke();
  }

  // Dot markers (frets 3, 5, 7, 9, 12)
  const dotFrets = [3, 5, 7, 9, 12, 15];
  ctx.fillStyle = '#21262d';
  for (const df of dotFrets) {
    if (df >= startFret && df <= endFret) {
      const x = leftMargin + (df - startFret - 0.5) * fretSpacing;
      const y = topMargin + 2.5 * stringSpacing;
      if (df === 12) {
        // Double dot
        ctx.beginPath(); ctx.arc(x, topMargin + 1.5 * stringSpacing, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x, topMargin + 3.5 * stringSpacing, 4, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Notes
  for (const [stringNum, noteList] of Object.entries(notes)) {
    const s = parseInt(stringNum) - 1; // 1-indexed to 0-indexed
    const y = topMargin + s * stringSpacing;

    for (const note of noteList) {
      const x = leftMargin + (note.fret - startFret - 0.5) * fretSpacing;
      const color = note.color || '#58a6ff';
      const radius = 9;

      // Circle
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = '#0d1117';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(note.label || '', x, y);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  // Save
  const tmpFile = path.join(os.tmpdir(), `fretboard-${Date.now()}.png`);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(tmpFile, buffer);

  return tmpFile;
}

/**
 * Parse Claude's response for VexTab notation blocks and render them.
 * Returns array of file paths to rendered images.
 */
function extractAndRender(text) {
  const images = [];

  // Look for fretboard diagram requests in tool calls
  // For now, render A minor pentatonic as a demo
  // Future: parse the actual scale/chord from the tool response

  return images;
}

module.exports = { renderNotation, renderFretboard, extractAndRender };
