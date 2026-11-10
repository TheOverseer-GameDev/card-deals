/**
 * The user places the border lines. The ratio is arithmetic on those lines.
 * It is not an automatic grade.
 */

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

export function clampGuides(g) {
  const width = g.width;
  const height = g.height;
  const outerLeft = clamp(g.outerLeft, 0, width - 4);
  const outerRight = clamp(g.outerRight, outerLeft + 3, width - 1);
  const innerLeft = clamp(g.innerLeft, outerLeft + 1, outerRight - 2);
  const innerRight = clamp(g.innerRight, innerLeft + 1, outerRight - 1);
  const outerTop = clamp(g.outerTop, 0, height - 4);
  const outerBottom = clamp(g.outerBottom, outerTop + 3, height - 1);
  const innerTop = clamp(g.innerTop, outerTop + 1, outerBottom - 2);
  const innerBottom = clamp(g.innerBottom, innerTop + 1, outerBottom - 1);
  return { outerLeft, innerLeft, innerRight, outerRight, outerTop, innerTop, innerBottom, outerBottom };
}

export function manualCentering({ width, height, outerLeft, innerLeft, outerRight, innerRight, outerTop, innerTop, outerBottom, innerBottom, back }) {
  const placed = clampGuides({
    width, height, outerLeft, innerLeft, outerRight, innerRight, outerTop, innerTop, outerBottom, innerBottom,
  });
  const left = placed.innerLeft - placed.outerLeft;
  const right = placed.outerRight - placed.innerRight;
  const top = placed.innerTop - placed.outerTop;
  const bottom = placed.outerBottom - placed.innerBottom;
  if (![width, height, left, right, top, bottom].every((n) => Number.isFinite(n))) return null;
  if (width < 2 || height < 2) return null;
  if (left <= 0 || right <= 0 || top <= 0 || bottom <= 0) return null;
  const leftPct = (100 * left) / (left + right);
  const rightPct = (100 * right) / (left + right);
  const topPct = (100 * top) / (top + bottom);
  const bottomPct = (100 * bottom) / (top + bottom);
  const worse = Math.max(leftPct, rightPct, topPct, bottomPct);
  const cutoff = back ? 75 : 55;
  return {
    leftPct,
    rightPct,
    topPct,
    bottomPct,
    withinCutoff: worse <= cutoff,
    cutoff,
    back: Boolean(back),
    label: 'measured by you',
  };
}

export function formatManual(result) {
  if (!result) return 'Measured by you: move the guides onto the border.';
  const side = result.back ? 'back' : 'front';
  const where = result.withinCutoff ? 'inside' : 'outside';
  return `Measured by you. Left/right ${result.leftPct.toFixed(1)}/${result.rightPct.toFixed(1)}. Top/bottom ${result.topPct.toFixed(1)}/${result.bottomPct.toFixed(1)}. ${where} the ${side} ${result.cutoff}/${100 - result.cutoff} cutoff. This is not a PSA grade.`;
}

const LABELS = {
  outerLeft: 'Outer left border',
  innerLeft: 'Inner left border',
  innerRight: 'Inner right border',
  outerRight: 'Outer right border',
  outerTop: 'Outer top border',
  innerTop: 'Inner top border',
  innerBottom: 'Inner bottom border',
  outerBottom: 'Outer bottom border',
};

function guide(host, axis, name, readLimits) {
  const hit = document.createElement('div');
  hit.className = `scan-guide scan-guide-${axis}`;
  hit.tabIndex = 0;
  hit.setAttribute('role', 'slider');
  hit.setAttribute('aria-label', LABELS[name]);
  hit.style.touchAction = 'none';
  const line = document.createElement('span');
  line.className = 'scan-guide-line';
  hit.append(line);
  host.append(hit);
  let value = 0;
  function place(px, span) {
    const limits = readLimits(name);
    value = clamp(px, limits.min, Math.min(limits.max, span - 1));
    const pct = span > 1 ? (value / (span - 1)) * 100 : 0;
    if (axis === 'x') hit.style.left = `${pct}%`;
    else hit.style.top = `${pct}%`;
    hit.setAttribute('aria-valuenow', String(Math.round(value)));
    hit.setAttribute('aria-valuemin', String(limits.min));
    hit.setAttribute('aria-valuemax', String(limits.max));
  }
  hit.addEventListener('pointerdown', (event) => {
    hit.setPointerCapture(event.pointerId);
    hit.focus();
    event.preventDefault();
  });
  hit.addEventListener('pointermove', (event) => {
    if (!hit.hasPointerCapture(event.pointerId)) return;
    const box = host.getBoundingClientRect();
    const span = Number(axis === 'x' ? host.dataset.w : host.dataset.h) || (axis === 'x' ? box.width : box.height);
    const local = axis === 'x' ? event.clientX - box.left : event.clientY - box.top;
    const view = axis === 'x' ? box.width : box.height;
    const px = view > 1 ? (local / view) * (span - 1) : 0;
    place(px, span);
    host.dispatchEvent(new Event('guide'));
  });
  hit.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 1;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (axis === 'x' && !horizontal) return;
    if (axis === 'y' && !vertical) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -step : step;
    const span = Number(axis === 'x' ? host.dataset.w : host.dataset.h) || 500;
    place(value + delta, span);
    host.dispatchEvent(new Event('guide'));
  });
  return {
    place,
    get value() { return value; },
  };
}

export function mountGuides(host) {
  host.classList.add('scan-guides');
  let width = 500;
  let height = 700;
  let back = false;
  let onChange = null;
  const guides = {};
  function limits(name) {
    const oL = guides.outerLeft ? guides.outerLeft.value : 0;
    const iL = guides.innerLeft ? guides.innerLeft.value : 1;
    const iR = guides.innerRight ? guides.innerRight.value : width - 2;
    const oR = guides.outerRight ? guides.outerRight.value : width - 1;
    const oT = guides.outerTop ? guides.outerTop.value : 0;
    const iT = guides.innerTop ? guides.innerTop.value : 1;
    const iB = guides.innerBottom ? guides.innerBottom.value : height - 2;
    const oB = guides.outerBottom ? guides.outerBottom.value : height - 1;
    if (name === 'outerLeft') return { min: 0, max: iL - 1 };
    if (name === 'innerLeft') return { min: oL + 1, max: iR - 1 };
    if (name === 'innerRight') return { min: iL + 1, max: oR - 1 };
    if (name === 'outerRight') return { min: iR + 1, max: width - 1 };
    if (name === 'outerTop') return { min: 0, max: iT - 1 };
    if (name === 'innerTop') return { min: oT + 1, max: iB - 1 };
    if (name === 'innerBottom') return { min: iT + 1, max: oB - 1 };
    return { min: iB + 1, max: height - 1 };
  }
  for (const [name, axis] of [
    ['outerLeft', 'x'], ['innerLeft', 'x'], ['innerRight', 'x'], ['outerRight', 'x'],
    ['outerTop', 'y'], ['innerTop', 'y'], ['innerBottom', 'y'], ['outerBottom', 'y'],
  ]) {
    guides[name] = guide(host, axis, name, limits);
  }
  const note = document.createElement('p');
  note.className = 'note scan-manual-note';
  note.textContent = 'Measured by you: move the guides onto the border.';
  function values() {
    return clampGuides({
      width,
      height,
      outerLeft: guides.outerLeft.value,
      innerLeft: guides.innerLeft.value,
      innerRight: guides.innerRight.value,
      outerRight: guides.outerRight.value,
      outerTop: guides.outerTop.value,
      innerTop: guides.innerTop.value,
      innerBottom: guides.innerBottom.value,
      outerBottom: guides.outerBottom.value,
    });
  }
  function publish() {
    const placed = values();
    const result = manualCentering({ width, height, ...placed, back });
    note.textContent = formatManual(result);
    return result;
  }
  function redraw() {
    publish();
  }
  host.addEventListener('guide', () => {
    const result = publish();
    if (onChange) onChange(result);
  });
  function setImage(nextWidth, nextHeight, estimate) {
    width = nextWidth;
    height = nextHeight;
    host.dataset.w = String(nextWidth);
    host.dataset.h = String(nextHeight);
    const left = estimate && estimate.left > 1 ? estimate.left : nextWidth * 0.08;
    const right = estimate && estimate.right > 1 ? estimate.right : nextWidth * 0.08;
    const top = estimate && estimate.top > 1 ? estimate.top : nextHeight * 0.08;
    const bottom = estimate && estimate.bottom > 1 ? estimate.bottom : nextHeight * 0.08;
    const placed = clampGuides({
      width: nextWidth,
      height: nextHeight,
      outerLeft: 0,
      innerLeft: left,
      innerRight: nextWidth - 1 - right,
      outerRight: nextWidth - 1,
      outerTop: 0,
      innerTop: top,
      innerBottom: nextHeight - 1 - bottom,
      outerBottom: nextHeight - 1,
    });
    guides.outerLeft.place(placed.outerLeft, nextWidth);
    guides.innerLeft.place(placed.innerLeft, nextWidth);
    guides.innerRight.place(placed.innerRight, nextWidth);
    guides.outerRight.place(placed.outerRight, nextWidth);
    guides.outerTop.place(placed.outerTop, nextHeight);
    guides.innerTop.place(placed.innerTop, nextHeight);
    guides.innerBottom.place(placed.innerBottom, nextHeight);
    guides.outerBottom.place(placed.outerBottom, nextHeight);
    redraw();
  }
  return {
    note,
    setBack(value) { back = Boolean(value); redraw(); },
    setImage,
    set onChange(fn) { onChange = fn; },
  };
}
