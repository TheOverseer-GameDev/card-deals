/**
 * Throttled preview loop. The photo stays in this tab.
 * About 8 samples a second, on a short edge, so a mid-range phone can keep up.
 */
import { advanceHold, judgePreview } from './detect.js';

const SAMPLE_LONG = 192;
const GAP_MS = 125;

export function startLive(video, handlers) {
  let stop = false;
  let hold = { since: null, quad: null };
  let last = 0;
  const sample = document.createElement('canvas');
  const ctx = sample.getContext('2d', { willReadFrequently: true });

  function frame(now) {
    if (stop) return;
    requestAnimationFrame(frame);
    if (!video || video.readyState < 2 || video.videoWidth < 2 || now - last < GAP_MS) return;
    last = now;
    const scale = SAMPLE_LONG / Math.max(video.videoWidth, video.videoHeight);
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    if (sample.width !== w) sample.width = w;
    if (sample.height !== h) sample.height = h;
    try {
      ctx.drawImage(video, 0, 0, w, h);
    } catch {
      return;
    }
    let rgba;
    try {
      rgba = ctx.getImageData(0, 0, w, h).data;
    } catch {
      return;
    }
    const judgment = judgePreview(rgba, w, h);
    const quad = judgment.quad
      ? judgment.quad.map((p) => ({ x: p.x / scale, y: p.y / scale }))
      : null;
    hold = advanceHold(hold, { ready: judgment.ready, quad }, now);
    const view = { ...judgment, quad, progress: hold.progress, fire: hold.fire };
    if (handlers.onFrame) handlers.onFrame(view);
    if (hold.fire) {
      stop = true;
      if (handlers.onCapture) handlers.onCapture();
    }
  }

  requestAnimationFrame(frame);
  return function stopLive() {
    stop = true;
  };
}

export function mountRing(parent) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'scan-capture-ring';
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  arc.setAttribute('cx', '18');
  arc.setAttribute('cy', '18');
  arc.setAttribute('r', '16');
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', '#E10600');
  arc.setAttribute('stroke-width', '2');
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-dasharray', '100.53');
  arc.setAttribute('stroke-dashoffset', '100.53');
  arc.setAttribute('transform', 'rotate(-90 18 18)');
  svg.append(arc);
  parent.append(svg);
  return {
    set(progress) {
      const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
      arc.setAttribute('stroke-dashoffset', String(100.53 * (1 - clamped)));
    },
  };
}

export function mountEdge(finder) {
  const canvas = document.createElement('canvas');
  canvas.id = 'scan-live-edge';
  canvas.className = 'scan-live-edge';
  finder.append(canvas);
  return canvas;
}

export function coverPoint(videoW, videoH, viewW, viewH, x, y) {
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const ox = (viewW - videoW * scale) / 2;
  const oy = (viewH - videoH * scale) / 2;
  return { x: ox + x * scale, y: oy + y * scale };
}

export function drawLiveQuad(canvas, video, quad, code) {
  if (!canvas) return;
  const viewW = canvas.clientWidth || canvas.width;
  const viewH = canvas.clientHeight || canvas.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(viewW * dpr));
  const h = Math.max(1, Math.round(viewH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!quad || !video || !video.videoWidth || !viewW || !viewH) return;
  ctx.beginPath();
  quad.forEach((point, index) => {
    const p = coverPoint(video.videoWidth, video.videoHeight, w, h, point.x, point.y);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = code === 'lined-up' ? '#3ddc97' : '#ffb020';
  ctx.stroke();
}
