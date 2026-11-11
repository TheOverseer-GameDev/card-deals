/**
 * Print quality visible in the photo: blur, blocky pixels, and a color shift
 * against a reference. This is not a print-run verdict.
 */

function gray(rgba, i) {
  return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

function sharpness(rgba, width, height) {
  let sum = 0;
  let n = 0;
  const y0 = Math.round(height * 0.2);
  const y1 = Math.round(height * 0.7);
  const x0 = Math.round(width * 0.15);
  const x1 = Math.round(width * 0.85);
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const c = gray(rgba, (y * width + x) * 4);
      const up = gray(rgba, ((y - 1) * width + x) * 4);
      const down = gray(rgba, ((y + 1) * width + x) * 4);
      const left = gray(rgba, (y * width + (x - 1)) * 4);
      const right = gray(rgba, (y * width + (x + 1)) * 4);
      sum += Math.abs(4 * c - up - down - left - right);
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

function blockiness(rgba, width, height) {
  let edge = 0;
  let edgeN = 0;
  let inside = 0;
  let insideN = 0;
  const y0 = Math.round(height * 0.25);
  const y1 = Math.round(height * 0.7);
  for (let y = y0; y < y1; y++) {
    for (let x = 8; x < width - 1; x++) {
      const delta = Math.abs(gray(rgba, (y * width + x) * 4) - gray(rgba, (y * width + (x - 1)) * 4));
      if (x % 8 === 0) {
        edge += delta;
        edgeN += 1;
      } else {
        inside += delta;
        insideN += 1;
      }
    }
  }
  const edgeMean = edgeN ? edge / edgeN : 0;
  const insideMean = insideN ? inside / insideN : 0;
  if (insideMean < 1) return edgeMean > 20 ? 3 : 0;
  return edgeMean / insideMean;
}

function meanColor(rgba) {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    r += rgba[i];
    g += rgba[i + 1];
    b += rgba[i + 2];
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

export function printQuality(rgba, width, height, reference) {
  if (!rgba || rgba.length < width * height * 4 || width < 16 || height < 16) {
    return { poor: true, note: 'The photo is too small to judge print quality.' };
  }
  const sharp = sharpness(rgba, width, height);
  const blocks = blockiness(rgba, width, height);
  const parts = [];
  let poor = false;
  if (sharp < 6) {
    poor = true;
    parts.push('The artwork area looks blurry.');
  } else {
    parts.push('The artwork area does not look blurry.');
  }
  if (blocks > 2.4 && sharp > 6) {
    poor = true;
    parts.push('Block edges repeat across the art, which can be pixelation.');
  } else {
    parts.push('No repeating block edges stood out.');
  }
  if (!reference || !reference.rgba) {
    parts.push('Color shift was not checked. There is no reference image.');
  } else {
    const a = meanColor(rgba);
    const b = meanColor(reference.rgba);
    const delta = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (delta > 40) {
      parts.push('The overall color looks shifted from the reference.');
    } else {
      parts.push('No large color shift stood out against the reference.');
    }
  }
  let mean = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) mean += gray(rgba, i);
  mean = n ? mean / n : 0;
  if (mean < 40 || mean > 245) {
    poor = true;
    parts.push('The photo is very dark or blown out.');
  }
  parts.push('This describes the photo. It is not a print-run verdict.');
  return { poor, sharpness: sharp, note: parts.join(' ') };
}
