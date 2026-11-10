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
  // A one-pixel gap is the collapsed default, not a border the user placed.
  if (left < 3 || right < 3 || top < 3 || bottom < 3) return null;
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
  function paint(span) {
    const limits = readLimits(name);
    const pct = span > 1 ? (value / (span - 1)) * 100 : 0;
    if (axis === 'x') hit.style.left = `${pct}%`;
    else hit.style.top = `${pct}%`;
    hit.setAttribute('aria-valuenow', String(Math.round(value)));
    hit.setAttribute('aria-valuemin', String(limits.min));
    hit.setAttribute('aria-valuemax', String(limits.max));
  }
  // The initial lines are already ordered. Clamping each one against the
  // others while those are still 0 collapses every line onto the left edge.
  function assign(px, span) {
    value = clamp(px, 0, Math.max(0, span - 1));
    paint(span);
  }
  function place(px, span) {
    const limits = readLimits(name);
    value = clamp(px, limits.min, Math.min(limits.max, span - 1));
    paint(span);
  }
  hit.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    event.preventDefault();
    hit.setPointerCapture(event.pointerId);
    hit.focus();
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
    assign,
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
  const prompt = 'Measured by you: move the guides onto the border.';
  function measured() {
    const placed = values();
    return manualCentering({ width, height, ...placed, back });
  }
  host.addEventListener('guide', () => {
    const result = measured();
    note.textContent = formatManual(result);
    if (onChange) onChange(result);
  });
  function setImage(nextWidth, nextHeight, estimate) {
    width = nextWidth;
    height = nextHeight;
    host.dataset.w = String(nextWidth);
    host.dataset.h = String(nextHeight);
    // The 44 px hit target hangs 22 px off a line. Keep the outer lines
    // inside the photo so that target is not under the top bar or off the stage.
    const edge = Math.min(22, Math.floor(nextWidth / 6), Math.floor(nextHeight / 6));
    const left = Math.max(8, estimate && estimate.left > 1 ? estimate.left : Math.round(nextWidth * 0.08));
    const right = Math.max(8, estimate && estimate.right > 1 ? estimate.right : Math.round(nextWidth * 0.08));
    const top = Math.max(8, estimate && estimate.top > 1 ? estimate.top : Math.round(nextHeight * 0.08));
    const bottom = Math.max(8, estimate && estimate.bottom > 1 ? estimate.bottom : Math.round(nextHeight * 0.08));
    const placed = clampGuides({
      width: nextWidth,
      height: nextHeight,
      outerLeft: edge,
      innerLeft: edge + left,
      innerRight: nextWidth - 1 - edge - right,
      outerRight: nextWidth - 1 - edge,
      outerTop: edge,
      innerTop: edge + top,
      innerBottom: nextHeight - 1 - edge - bottom,
      outerBottom: nextHeight - 1 - edge,
    });
    guides.outerLeft.assign(placed.outerLeft, nextWidth);
    guides.innerLeft.assign(placed.innerLeft, nextWidth);
    guides.innerRight.assign(placed.innerRight, nextWidth);
    guides.outerRight.assign(placed.outerRight, nextWidth);
    guides.outerTop.assign(placed.outerTop, nextHeight);
    guides.innerTop.assign(placed.innerTop, nextHeight);
    guides.innerBottom.assign(placed.innerBottom, nextHeight);
    guides.outerBottom.assign(placed.outerBottom, nextHeight);
    note.textContent = prompt;
  }
  return {
    note,
    setBack(value) { back = Boolean(value); },
    setImage,
    set onChange(fn) { onChange = fn; },
  };
}
