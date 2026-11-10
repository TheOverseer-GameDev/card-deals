/**
 * Edition and rarity marks.
 * Words are reported only when the on-device text read already contains them.
 * A bright cluster is not called a 1st Edition stamp.
 */

function luminance(rgba, i) {
  return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

function compactMark(rgba, width, height) {
  const x0 = Math.round(width * 0.04);
  const y0 = Math.round(height * 0.82);
  const x1 = Math.round(width * 0.28);
  const y1 = Math.round(height * 0.96);
  let bright = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total += 1;
      if (luminance(rgba, (y * width + x) * 4) > 210) bright += 1;
    }
  }
  if (!total) return false;
  const share = bright / total;
  return share > 0.04 && share < 0.45;
}

export function readMarks(rgba, width, height, text) {
  if (rgba && rgba.length < width * height * 4) {
    return { note: 'The photo is too small to check for stamps. No edition stamp or rarity word was read. A missing read is not a missing stamp.' };
  }
  const words = String(text || '');
  const notes = [];
  if (/1st\s*edition/i.test(words)) notes.push('The read text includes “1st Edition”.');
  if (/\b(secret|ultra|super|rare|common|uncommon|mythic)\b/i.test(words)) {
    notes.push('The read text includes a rarity word. The icon itself was not identified.');
  }
  if (rgba && width > 40 && height > 40 && compactMark(rgba, width, height)) {
    notes.push('A compact mark is visible in the lower-left stamp area. The words in that mark were not read from the pixels.');
  }
  if (!notes.length) {
    return { note: 'No edition stamp or rarity word was read. A missing read is not a missing stamp.' };
  }
  return { note: `${notes.join(' ')} A set symbol was not identified from the pixels.` };
}
