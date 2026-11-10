/**
 * Compare captured artwork with an official image already on this device.
 * The photo is not uploaded. A match is not proof the card is genuine.
 */
const DW = 24;
const DH = 34;

function grayGrid(rgba, width, height, crop) {
  const out = new Float32Array(DW * DH);
  const x0 = crop ? Math.floor(width * 0.22) : 0;
  const y0 = crop ? Math.floor(height * 0.22) : 0;
  const x1 = crop ? Math.ceil(width * 0.78) : width;
  const y1 = crop ? Math.ceil(height * 0.78) : height;
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);
  for (let y = 0; y < DH; y++) {
    const sy = Math.min(height - 1, y0 + Math.floor((y + 0.5) * ch / DH));
    for (let x = 0; x < DW; x++) {
      const sx = Math.min(width - 1, x0 + Math.floor((x + 0.5) * cw / DW));
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

export function artworkCorrelation(cardRgba, cardW, cardH, officialRgba, officialW, officialH) {
  if (!cardRgba || !officialRgba || cardW < 8 || officialW < 8) return null;
  const a = grayGrid(cardRgba, cardW, cardH, true);
  const b = grayGrid(officialRgba, officialW, officialH, false);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  const den = Math.sqrt(aa * bb) || 1;
  return dot / den;
}

export function matchArtwork(cardRgba, cardW, cardH, officialRgba, officialW, officialH) {
  if (!officialRgba) {
    return {
      state: 'unavailable',
      correlation: null,
      note: 'Official image unavailable, so the artwork was not compared.',
    };
  }
  const correlation = artworkCorrelation(cardRgba, cardW, cardH, officialRgba, officialW, officialH);
  if (correlation == null) {
    return { state: 'unavailable', correlation: null, note: 'The artwork could not be compared from these images.' };
  }
  const rounded = Math.round(correlation * 100) / 100;
  if (correlation >= 0.72) {
    return {
      state: 'similar',
      correlation: rounded,
      note: `The photo's artwork looks like this official image (${rounded}). That is not proof of the exact print or that the card is genuine.`,
    };
  }
  if (correlation >= 0.4) {
    return {
      state: 'uncertain',
      correlation: rounded,
      note: `The artwork is only partly like this official image (${rounded}). The print is not confirmed.`,
    };
  }
  return {
    state: 'different',
    correlation: rounded,
    note: `The artwork does not look like this official image (${rounded}). It may be a different card, a bad crop, or a poor photo.`,
  };
}
