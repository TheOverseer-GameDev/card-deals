/**
 * The user places the border lines. The ratio is arithmetic on those lines.
 * It is not an automatic grade.
 */

export function manualCentering({ width, height, outerLeft, innerLeft, outerRight, innerRight, outerTop, innerTop, outerBottom, innerBottom, back }) {
  const left = Number(innerLeft) - Number(outerLeft);
  const right = Number(outerRight) - Number(innerRight);
  const top = Number(innerTop) - Number(outerTop);
  const bottom = Number(outerBottom) - Number(innerBottom);
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

function guide(host, axis, start) {
  const hit = document.createElement('div');
  hit.className = `scan-guide scan-guide-${axis}`;
  hit.style.touchAction = 'none';
  const line = document.createElement('span');
  line.className = 'scan-guide-line';
  hit.append(line);
  host.append(hit);
  let value = start;
  function place(px, span) {
    value = Math.max(0, Math.min(span - 1, px));
    const pct = span > 1 ? (value / (span - 1)) * 100 : 0;
    if (axis === 'x') hit.style.left = `${pct}%`;
    else hit.style.top = `${pct}%`;
  }
  hit.addEventListener('pointerdown', (event) => {
    hit.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  hit.addEventListener('pointermove', (event) => {
    if (!hit.hasPointerCapture(event.pointerId)) return;
    const box = host.getBoundingClientRect();
    if (axis === 'x') place(event.clientX - box.left, box.width);
    else place(event.clientY - box.top, box.height);
    host.dispatchEvent(new Event('guide'));
  });
  return {
    place,
    get value() { return value; },
  };
}

export function mountGuides(host) {
  host.classList.add('scan-guides');
  const outerL = guide(host, 'x', 0);
  const innerL = guide(host, 'x', 0);
  const innerR = guide(host, 'x', 0);
  const outerR = guide(host, 'x', 0);
  const outerT = guide(host, 'y', 0);
  const innerT = guide(host, 'y', 0);
  const innerB = guide(host, 'y', 0);
  const outerB = guide(host, 'y', 0);
  let width = 500;
  let height = 700;
  let back = false;
  const note = document.createElement('p');
  note.className = 'note scan-manual-note';
  note.textContent = 'Measured by you: move the guides onto the border.';
  function redraw() {
    const result = manualCentering({
      width,
      height,
      outerLeft: outerL.value,
      innerLeft: innerL.value,
      outerRight: outerR.value,
      innerRight: innerR.value,
      outerTop: outerT.value,
      innerTop: innerT.value,
      outerBottom: outerB.value,
      innerBottom: innerB.value,
      back,
    });
    note.textContent = formatManual(result);
  }
  host.addEventListener('guide', redraw);
  function setImage(nextWidth, nextHeight, estimate) {
    width = nextWidth;
    height = nextHeight;
    const left = estimate && estimate.left > 1 ? estimate.left : nextWidth * 0.08;
    const right = estimate && estimate.right > 1 ? estimate.right : nextWidth * 0.08;
    const top = estimate && estimate.top > 1 ? estimate.top : nextHeight * 0.08;
    const bottom = estimate && estimate.bottom > 1 ? estimate.bottom : nextHeight * 0.08;
    outerL.place(0, nextWidth);
    innerL.place(left, nextWidth);
    innerR.place(nextWidth - 1 - right, nextWidth);
    outerR.place(nextWidth - 1, nextWidth);
    outerT.place(0, nextHeight);
    innerT.place(top, nextHeight);
    innerB.place(nextHeight - 1 - bottom, nextHeight);
    outerB.place(nextHeight - 1, nextHeight);
    redraw();
  }
  return {
    note,
    setBack(value) { back = Boolean(value); redraw(); },
    setImage,
  };
}
