/**
 * Compare two or three angled photos. Nothing is uploaded.
 * A difference is a visual note, not proof of a scratch or a print line.
 */
const DW = 48;
const DH = 64;

function sample(rgba, width, height) {
  const out = new Float32Array(DW * DH);
  for (let y = 0; y < DH; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / DH));
    for (let x = 0; x < DW; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / DW));
      const i = (sy * width + sx) * 4;
      out[y * DW + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
  }
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i];
  const mean = sum / out.length;
  let varSum = 0;
  for (let i = 0; i < out.length; i++) varSum += (out[i] - mean) ** 2;
  const std = Math.sqrt(varSum / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / std;
  return out;
}

function lineRuns(mask) {
  let rows = 0;
  let cols = 0;
  for (let y = 0; y < DH; y++) {
    let run = 0;
    for (let x = 0; x < DW; x++) {
      if (mask[y * DW + x]) {
        run += 1;
        if (run === 8) rows += 1;
      } else run = 0;
    }
  }
  for (let x = 0; x < DW; x++) {
    let run = 0;
    for (let y = 0; y < DH; y++) {
      if (mask[y * DW + x]) {
        run += 1;
        if (run === 8) cols += 1;
      } else run = 0;
    }
  }
  return { rows, cols };
}

export function compareTilt(frames) {
  const usable = (frames || []).filter((frame) => frame && frame.rgba && frame.width > 8 && frame.height > 8).slice(0, 3);
  if (usable.length < 2) {
    return {
      status: 'need-more',
      note: 'Take 2 or 3 photos with the card tilted into the light. One flat photo misses scratches and print lines that only show at an angle.',
      findings: [],
    };
  }
  const grids = usable.map((frame) => sample(frame.rgba, frame.width, frame.height));
  const heat = new Float32Array(DW * DH);
  let pairs = 0;
  for (let a = 0; a < grids.length; a++) {
    for (let b = a + 1; b < grids.length; b++) {
      pairs += 1;
      for (let i = 0; i < heat.length; i++) heat[i] += Math.abs(grids[a][i] - grids[b][i]);
    }
  }
  let total = 0;
  for (let i = 0; i < heat.length; i++) {
    heat[i] /= pairs;
    total += heat[i];
  }
  const mean = total / heat.length;
  if (mean < 0.18) {
    return {
      status: 'too-similar',
      note: 'These photos look like the same angle. Tilt the card further so a new reflection can show a scratch or a print line.',
      findings: [],
    };
  }
  const mask = new Uint8Array(heat.length);
  let hot = 0;
  for (let i = 0; i < heat.length; i++) {
    if (heat[i] > Math.max(0.55, mean * 2.2)) {
      mask[i] = 1;
      hot += 1;
    }
  }
  if (hot < 8) {
    return {
      status: 'no-mark',
      note: 'The angles differ, but no thin mark stood out. That does not mean the surface is clean.',
      findings: [],
    };
  }
  const lines = lineRuns(mask);
  const findings = [];
  if (lines.rows + lines.cols >= 2) {
    findings.push({
      kind: 'print-line',
      text: 'Repeated thin lines showed up when the light moved. They may be print lines. A photo cannot prove that.',
    });
  } else {
    findings.push({
      kind: 'scratch',
      text: 'A thin mark showed up in one angle and not the other. It may be a scratch or a print line. A photo cannot tell them apart.',
    });
  }
  let minX = DW;
  let minY = DH;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < DH; y++) {
    for (let x = 0; x < DW; x++) {
      if (!mask[y * DW + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return {
    status: 'marked',
    note: 'Angled photos were compared on this device. Nothing here is a grade or a check that the card is genuine.',
    findings,
    box: {
      x: minX / DW,
      y: minY / DH,
      w: Math.max(1 / DW, (maxX - minX + 1) / DW),
      h: Math.max(1 / DH, (maxY - minY + 1) / DH),
    },
  };
}
