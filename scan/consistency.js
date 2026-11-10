/**
 * Border and text-band comparison against a reference image.
 * The only verdicts are "looks consistent" and "looks inconsistent".
 */

function sample(rgba, width, height, x0, y0, x1, y1) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const stepX = Math.max(1, Math.floor((x1 - x0) / 24));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 24));
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (Math.min(height - 1, y) * width + Math.min(width - 1, x)) * 4;
      r += rgba[i];
      g += rgba[i + 1];
      b += rgba[i + 2];
      n += 1;
    }
  }
  if (!n) return [0, 0, 0];
  return [r / n, g / n, b / n];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function phrase(distanceValue, part) {
  if (distanceValue < 35) return `The ${part} looks consistent with the reference.`;
  if (distanceValue > 70) return `The ${part} looks inconsistent with the reference.`;
  return `The ${part} is close to the reference. Photo lighting leaves it undecided.`;
}

export function compareReference(photo, reference) {
  if (!photo || !photo.rgba || !reference || !reference.rgba) {
    return { note: 'No reference image was available, so font, color, and border were not compared.' };
  }
  const borderPhoto = sample(photo.rgba, photo.width, photo.height, 0, 0, photo.width, Math.max(2, Math.round(photo.height * 0.04)));
  const borderRef = sample(reference.rgba, reference.width, reference.height, 0, 0, reference.width, Math.max(2, Math.round(reference.height * 0.04)));
  const textPhoto = sample(
    photo.rgba, photo.width, photo.height,
    Math.round(photo.width * 0.15), Math.round(photo.height * 0.78),
    Math.round(photo.width * 0.85), Math.round(photo.height * 0.92),
  );
  const textRef = sample(
    reference.rgba, reference.width, reference.height,
    Math.round(reference.width * 0.15), Math.round(reference.height * 0.78),
    Math.round(reference.width * 0.85), Math.round(reference.height * 0.92),
  );
  const border = phrase(distance(borderPhoto, borderRef), 'border color');
  const band = phrase(distance(textPhoto, textRef), 'text band');
  return {
    note: `${border} ${band} Font letter shapes were not compared. This is a photo comparison, not an authenticity result.`,
  };
}
