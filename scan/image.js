import { LIMITS, validateFile } from './engine.js';

export async function fileToCanvas(file) {
  if (!file || typeof file.size !== 'number' || file.size <= 0) return { ok: false, code: 'empty' };
  if (file.size > LIMITS.maxFileBytes) return { ok: false, code: 'too-large' };
  const type = file.type || '';
  if (type && !String(type).toLowerCase().startsWith('image/')) return { ok: false, code: 'not-image' };
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const check = validateFile({ size: file.size, type, bytes: header });
  if (!check.ok) return check;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, code: 'undecodable' };
  }
  try {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const scale = Math.min(1, LIMITS.maxEdge / Math.max(originalWidth, originalHeight));
    const workingWidth = Math.max(1, Math.round(originalWidth * scale));
    const workingHeight = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = workingWidth;
    canvas.height = workingHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, workingWidth, workingHeight);
    return { ok: true, canvas, originalWidth, originalHeight, workingWidth, workingHeight };
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

export function cropCanvas(src, frac) {
  const x = Math.max(0, Math.min(src.width - 1, Math.round(frac.left * src.width)));
  const y = Math.max(0, Math.min(src.height - 1, Math.round(frac.top * src.height)));
  const w = Math.max(1, Math.min(src.width - x, Math.round((frac.right - frac.left) * src.width)));
  const h = Math.max(1, Math.min(src.height - y, Math.round((frac.bottom - frac.top) * src.height)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
  return canvas;
}

export function grayFromCanvas(canvas, maxWidth = 400) {
  const scale = Math.min(1, maxWidth / canvas.width);
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const sample = document.createElement('canvas');
  sample.width = width;
  sample.height = height;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 + 0.5) | 0;
  }
  sample.width = 0;
  sample.height = 0;
  return { gray, width, height };
}

export function releaseCanvas(canvas) {
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
}
