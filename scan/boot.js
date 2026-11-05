import {
  assessPhoto,
  captureSize,
  catalogFromSite,
  clampCrop,
  fileMessage,
  formatUsd,
  identityFields,
  LIMITS,
  matchText,
  safeHttpUrl,
  searchCatalog,
  suggestCrop,
} from './engine.js';
import { cropCanvas, fileToCanvas, grayFromCanvas, releaseCanvas } from './image.js';
import { createLookup } from './lookup.js';

if (!globalThis.__cardScan) {
  globalThis.__cardScan = true;
  boot();
}

function boot() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'scan/scan.css';
  document.head.appendChild(link);

  const main = document.querySelector('main');
  const nav = document.querySelector('nav');
  if (!main || !nav) return;

  const section = document.createElement('section');
  section.id = 'v-scan';
  section.className = 'view';
  main.appendChild(section);

  const navButton = document.createElement('button');
  navButton.type = 'button';
  navButton.dataset.v = 'scan';
  const icon = document.createElement('span');
  icon.textContent = '📷';
  navButton.append(icon, document.createTextNode('Scan'));
  nav.appendChild(navButton);

  const rows = catalogFromSite(globalThis.D);
  const lookup = createLookup();
  const slots = {
    front: { canvas: null, originalWidth: 0, originalHeight: 0, token: 0 },
    back: { canvas: null, originalWidth: 0, originalHeight: 0, token: 0 },
  };
  let readerPromise = null;
  let idleTimer = 0;
  let abort = null;
  let confirmedKey = null;
  let suggestBox = null;
  let drag = null;

  const ui = build(section, rows.length === 0);
  wire(ui);

  document.addEventListener('click', (ev) => {
    const button = ev.target.closest && ev.target.closest('nav button');
    if (!button) return;
    const on = button.dataset.v === 'scan';
    section.classList.toggle('on', on);
    if (on) window.clearTimeout(idleTimer);
    else idleTimer = window.setTimeout(() => dropReader(), 60000);
  });

  function dropReader() {
    readerPromise?.then((reader) => reader.terminate()).catch(() => {});
    readerPromise = null;
  }

  function wire() {
    ui.frontFile.addEventListener('change', () => {
      const file = ui.frontFile.files && ui.frontFile.files[0];
      if (file) loadFile('front', file);
    });
    ui.backFile.addEventListener('change', () => {
      const file = ui.backFile.files && ui.backFile.files[0];
      if (file) loadFile('back', file);
    });
    ui.frontCam.addEventListener('click', () => openCamera('front'));
    ui.backCam.addEventListener('click', () => openCamera('back'));
    ui.camUse.addEventListener('click', () => useFrame());
    ui.camStop.addEventListener('click', () => stopCamera());
    ui.zoom.addEventListener('input', applyView);
    ui.panX.addEventListener('input', applyView);
    ui.panY.addEventListener('input', applyView);
    for (const slider of [ui.cropL, ui.cropT, ui.cropR, ui.cropB]) slider.addEventListener('input', () => {
      applyCropRect();
    });
    ui.qualityBtn.addEventListener('click', () => runQuality('front'));
    ui.backQualityBtn.addEventListener('click', () => runQuality('back'));
    ui.suggestBtn.addEventListener('click', () => {
      if (!suggestBox) return;
      ui.cropL.value = String(Math.round(suggestBox.left * 100));
      ui.cropT.value = String(Math.round(suggestBox.top * 100));
      ui.cropR.value = String(Math.round(suggestBox.right * 100));
      ui.cropB.value = String(Math.round(suggestBox.bottom * 100));
      applyCropRect();
      runQuality('front');
    });
    ui.readBtn.addEventListener('click', () => readFront());
    ui.cancelBtn.addEventListener('click', () => abort?.abort());
    ui.rematch.addEventListener('click', () => renderMatch(matchText(rows, ui.text.value)));
    ui.search.addEventListener('input', () => renderSearch(ui.search.value));
    ui.results.addEventListener('click', (ev) => {
      const button = ev.target.closest('button[data-key]');
      if (!button) return;
      const row = rows.find((item) => item.key === button.dataset.key);
      if (row) confirmRow(row);
    });
    ui.clearBtn.addEventListener('click', () => {
      confirmedKey = null;
      ui.identity.replaceChildren();
      ui.prices.replaceChildren(text('Confirm a catalog row to see stored prices.'));
    });
    const viewport = ui.viewport;
    viewport.addEventListener('pointerdown', (ev) => {
      drag = { x: ev.clientX, y: ev.clientY, px: Number(ui.panX.value), py: Number(ui.panY.value) };
      viewport.setPointerCapture(ev.pointerId);
    });
    viewport.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      ui.panX.value = String(drag.px + (ev.clientX - drag.x));
      ui.panY.value = String(drag.py + (ev.clientY - drag.y));
      applyView();
    });
    viewport.addEventListener('pointerup', () => { drag = null; });
    viewport.addEventListener('pointercancel', () => { drag = null; });
    applyCropRect();
    applyView();
  }

  async function loadFile(slot, file) {
    const state = slots[slot];
    const my = ++state.token;
    const note = slot === 'front' ? ui.frontNote : ui.backNote;
    const decoded = await fileToCanvas(file);
    if (my !== state.token) {
      if (decoded.canvas) releaseCanvas(decoded.canvas);
      return;
    }
    if (!decoded.ok) {
      note.textContent = fileMessage(decoded.code);
      return;
    }
    if (state.canvas) releaseCanvas(state.canvas);
    state.canvas = decoded.canvas;
    state.originalWidth = decoded.originalWidth;
    state.originalHeight = decoded.originalHeight;
    note.textContent = `Working copy ${decoded.workingWidth}×${decoded.workingHeight} from ${decoded.originalWidth}×${decoded.originalHeight}. Longest side is capped at ${LIMITS.maxEdge} px.`;
    if (slot === 'front') {
      ui.stage.replaceChildren();
      ui.stage.append(decoded.canvas, ui.rect);
      ui.readBtn.disabled = false;
      ui.viewport.hidden = false;
      runQuality('front');
      offerCrop();
    } else {
      ui.backStage.replaceChildren(decoded.canvas);
      ui.backView.hidden = false;
    }
  }

  function cropFractions() {
    return clampCrop(ui.cropL.value / 100, ui.cropT.value / 100, ui.cropR.value / 100, ui.cropB.value / 100);
  }

  function applyCropRect() {
    const crop = cropFractions();
    ui.rect.style.left = `${crop.left * 100}%`;
    ui.rect.style.top = `${crop.top * 100}%`;
    ui.rect.style.width = `${(crop.right - crop.left) * 100}%`;
    ui.rect.style.height = `${(crop.bottom - crop.top) * 100}%`;
  }

  function applyView() {
    ui.stage.style.transform = `translate(${Number(ui.panX.value) || 0}px, ${Number(ui.panY.value) || 0}px) scale(${Number(ui.zoom.value) || 1})`;
  }

  function frontSample() {
    if (!slots.front.canvas) return null;
    const cropped = cropCanvas(slots.front.canvas, cropFractions());
    const sample = grayFromCanvas(cropped, 400);
    releaseCanvas(cropped);
    sample.originalWidth = slots.front.originalWidth;
    sample.originalHeight = slots.front.originalHeight;
    return sample;
  }

  function runQuality(slot) {
    const state = slots[slot];
    const host = slot === 'front' ? ui.frontQuality : ui.backQuality;
    if (!state.canvas) {
      host.textContent = 'Add a photo first.';
      return;
    }
    let sample;
    if (slot === 'front') sample = frontSample();
    else {
      sample = grayFromCanvas(state.canvas, 400);
      sample.originalWidth = state.originalWidth;
      sample.originalHeight = state.originalHeight;
    }
    const report = assessPhoto({
      gray: sample.gray,
      width: sample.width,
      height: sample.height,
      originalWidth: sample.originalWidth,
      originalHeight: sample.originalHeight,
    });
    renderQuality(host, report);
    if (slot === 'front') ui.centering.textContent = centeringLine(report.centering);
  }

  function offerCrop() {
    const sample = grayFromCanvas(slots.front.canvas, 400);
    const found = suggestCrop(sample.gray, sample.width, sample.height);
    if (found.state === 'suggested') {
      suggestBox = found;
      ui.suggestBtn.hidden = false;
      ui.suggestNote.textContent = 'A tighter crop is available because the background looks flat and the subject has a card shape. Check it before reading text.';
    } else {
      suggestBox = null;
      ui.suggestBtn.hidden = true;
      ui.suggestNote.textContent = 'No tighter crop was detected. Set the crop yourself.';
    }
  }

  async function openCamera(slot) {
    stopCamera();
    ui.camSlot = slot;
    ui.camMsg.textContent = '';
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      ui.camMsg.textContent = 'This browser has no camera API. You can still upload a photo.';
      return;
    }
    try {
      ui.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
    } catch (err) {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        ui.camMsg.textContent = 'Camera permission was denied. You can still upload a photo.';
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'AbortError') {
        ui.camMsg.textContent = 'No usable camera was found. You can still upload a photo.';
      } else {
        ui.camMsg.textContent = 'The camera could not be opened. You can still upload a photo.';
      }
      return;
    }
    ui.video.srcObject = ui.stream;
    ui.video.playsInline = true;
    ui.video.muted = true;
    try { await ui.video.play(); } catch { /* The frame button still works after the video is ready. */ }
    ui.camBox.hidden = false;
  }

  function stopCamera() {
    if (ui.stream) {
      for (const track of ui.stream.getTracks()) track.stop();
      ui.stream = null;
    }
    ui.video.srcObject = null;
    ui.camBox.hidden = true;
  }

  async function useFrame() {
    const box = captureSize(ui.video.videoWidth, ui.video.videoHeight);
    if (!box) {
      ui.camMsg.textContent = 'The camera has no frame yet.';
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = box.width;
    canvas.height = box.height;
    canvas.getContext('2d').drawImage(ui.video, 0, 0, box.width, box.height);
    const slot = ui.camSlot || 'front';
    stopCamera();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    releaseCanvas(canvas);
    if (!blob) {
      ui.camMsg.textContent = 'The frame could not be copied. You can still upload a photo.';
      return;
    }
    await loadFile(slot, new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
  }

  async function readFront() {
    if (!slots.front.canvas) return;
    window.clearTimeout(idleTimer);
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    ui.readBtn.disabled = true;
    ui.cancelBtn.hidden = false;
    ui.progress.textContent = 'Starting the on-device text reader.';
    const sample = cropCanvas(slots.front.canvas, cropFractions());
    try {
      const reader = await readerOnce();
      const { readCardImage } = await import('./ocr.js');
      const text = await readCardImage(reader, sample, {
        signal: controller.signal,
        onProgress: showProgress,
      });
      if (controller.signal.aborted) return;
      ui.text.value = text;
      ui.progress.textContent = 'Text read on this device. Correct it if the words are wrong, then match again.';
      renderMatch(matchText(rows, text));
    } catch (err) {
      if (controller.signal.aborted || (err && err.name === 'AbortError')) {
        ui.progress.textContent = 'Cancelled. The photo was not uploaded.';
      } else {
        ui.progress.textContent = 'The on-device text reader failed. You can type the card text or search the list. The photo was not uploaded.';
      }
    } finally {
      releaseCanvas(sample);
      ui.cancelBtn.hidden = true;
      ui.readBtn.disabled = !slots.front.canvas;
      if (abort === controller) abort = null;
    }
  }

  function readerOnce() {
    if (!readerPromise) {
      readerPromise = import('./ocr.js').then((mod) => mod.openReader()).catch((err) => {
        readerPromise = null;
        throw err;
      });
    }
    return readerPromise;
  }

  function showProgress(message) {
    if (!message || typeof message !== 'object') return;
    const status = String(message.status || '');
    const labels = {
      'loading tesseract core': 'Loading the on-device text reader',
      'loading language traineddata': 'Loading English text data onto this device',
      'initializing tesseract': 'Starting the text reader',
      'initializing api': 'Starting the text reader',
      'recognizing text': 'Reading the photo',
    };
    const label = labels[status] || 'Working on this device';
    if (status === 'recognizing text' && typeof message.progress === 'number') {
      ui.progress.textContent = `${label}. Library progress ${Math.round(message.progress * 100)}%. This is job progress, not an identification score.`;
    } else {
      ui.progress.textContent = `${label}.`;
    }
  }

  function renderMatch(result) {
    confirmedKey = null;
    ui.identity.replaceChildren();
    ui.prices.replaceChildren(text('Confirm a catalog row to see stored prices.'));
    ui.summary.replaceChildren();
    if (result.empty) {
      ui.summary.textContent = 'No text yet.';
    } else {
      const bits = [
        result.readCodes.length ? `Set codes read: ${result.readCodes.join(', ')}.` : 'No set code was read.',
        result.readLanguage ? `Language tag in the text: ${result.readLanguage}.` : 'No language tag was read.',
        result.readEdition ? `Edition text: ${result.readEdition}.` : 'No edition text was read.',
        result.readRarity ? `Rarity text: ${result.readRarity}.` : 'No rarity text was read.',
      ];
      const unknown = result.readCodes.filter((code) => !rows.some((row) => row.parsed.setCode === code));
      if (unknown.length) bits.push(`These codes are not in the loaded list: ${unknown.join(', ')}.`);
      ui.summary.textContent = bits.join(' ');
    }
    ui.results.replaceChildren();
    if (!result.candidates.length) {
      ui.results.append(text('No loaded row matched that text. Search the list or correct the text. The print is unknown.'));
      return;
    }
    const lead = result.ambiguous
      ? 'More than one row fits, or the set code was not an exact clean match. Choose a row. Prices stay hidden until you do.'
      : 'One row matches the set code that was read. Confirm it before prices are shown.';
    ui.results.append(text(lead));
    for (const candidate of result.candidates) {
      const row = rows.find((item) => item.key === candidate.key);
      if (!row) continue;
      ui.results.append(rowButton(row, candidate.evidence));
    }
    if (result.hiddenCount) ui.results.append(text(`${result.hiddenCount} more rows matched. Search to narrow them.`));
  }

  function renderSearch(query) {
    const hits = searchCatalog(rows, query);
    if (!query.trim()) return;
    ui.results.replaceChildren(text(hits.length ? 'Search results. Choose a row to use it.' : 'No loaded row contains those words.'));
    for (const row of hits) ui.results.append(rowButton(row, []));
  }

  function rowButton(row, evidence) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn g scan-pick';
    button.dataset.key = row.key;
    const title = document.createElement('span');
    const bits = [row.name];
    if (row.parsed.setCode) bits.push(row.parsed.setCode);
    else bits.push('no set code');
    if (row.slug) bits.push(row.slug);
    if (row.kind === 'collection') bits.push('collection note');
    title.textContent = bits.join(' · ');
    button.append(title);
    if (evidence && evidence.length) {
      const ev = document.createElement('span');
      ev.className = 'scan-ev';
      ev.textContent = evidence.join(' ');
      button.append(ev);
    }
    return button;
  }

  async function confirmRow(row) {
    confirmedKey = row.key;
    ui.identity.replaceChildren();
    const banner = document.createElement('p');
    banner.className = 'scan-warn';
    banner.textContent = row.parsed.setCode
      ? 'You chose this catalog row. That choice is not an authenticity check and it is not a grade.'
      : 'This row does not name a set code. Prices below belong to the stored catalog row only. The exact print is unknown.';
    ui.identity.append(banner);
    const grid = document.createElement('div');
    grid.className = 'scan-id';
    for (const [label, value] of identityFields(row)) {
      const k = document.createElement('b');
      k.textContent = label;
      const v = document.createElement('span');
      v.textContent = value;
      grid.append(k, v);
    }
    ui.identity.append(grid);
    ui.prices.replaceChildren(text('Loading stored prices…'));
    try {
      const report = await lookup.report(row);
      if (confirmedKey !== row.key) return;
      renderPrices(report);
    } catch {
      if (confirmedKey !== row.key) return;
      ui.prices.replaceChildren(text('Stored prices could not be read. Nothing was sent out.'));
    }
  }

  function renderPrices(report) {
    ui.prices.replaceChildren();
    const intro = document.createElement('p');
    intro.textContent = report.exactSetNamed
      ? 'Prices for the confirmed catalog row. Grades with no stored figure stay unavailable.'
      : 'Prices for the confirmed catalog row. The row does not name a set, so these figures are not an exact-print quote.';
    ui.prices.append(intro);
    if (report.historyStart) {
      const start = document.createElement('p');
      start.className = 'note';
      start.textContent = `Earliest shipped history point: ${report.historyStart}.`;
      ui.prices.append(start);
    }
    const wrap = document.createElement('div');
    wrap.className = 'scan-table-wrap';
    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const label of ['Grade', 'Price', 'Currency', 'Source', 'Observed', 'Sales count', 'Notes']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.append(th);
    }
    const thead = document.createElement('thead');
    thead.append(head);
    const body = document.createElement('tbody');
    for (const grade of ['ungraded', 'psa5', 'psa6', 'psa7', 'psa8', 'psa9', 'psa10']) {
      for (const item of report.grades[grade]) body.append(priceRow(item));
    }
    table.append(thead, body);
    wrap.append(table);
    ui.prices.append(wrap);
  }

  function priceRow(item) {
    const tr = document.createElement('tr');
    tr.append(cell(item.label, 'Grade'));
    tr.append(cell(item.status === 'value' ? formatUsd(item.price) : 'Unavailable', 'Price'));
    tr.append(cell(item.currency || 'Unavailable', 'Currency'));
    const source = document.createElement('td');
    source.dataset.label = 'Source';
    if (item.source) source.append(document.createTextNode(item.source));
    else source.textContent = 'Unavailable';
    if (item.sourceUrl) {
      source.append(document.createTextNode(' '));
      const a = document.createElement('a');
      a.href = safeHttpUrl(item.sourceUrl);
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Source page';
      source.append(a);
    }
    tr.append(source);
    const when = document.createElement('td');
    when.dataset.label = 'Observed';
    if (item.observedAt) {
      when.textContent = item.stale ? `${item.observedAt} (stale)` : item.observedAt;
    } else when.textContent = 'Unavailable';
    tr.append(when);
    tr.append(cell(item.salesCount == null ? 'Unavailable' : String(item.salesCount), 'Sales count'));
    tr.append(cell(item.note || '', 'Notes'));
    return tr;
  }
}

function renderQuality(host, report) {
  host.replaceChildren();
  const res = report.resolution;
  host.append(text(`Resolution: ${res.originalWidth}×${res.originalHeight} original. ${res.state === 'low' ? 'The short side is under 500 px, which is low for small print.' : 'The short side is at least 500 px.'}`));
  const blur = {
    'low-detail': `Likely blurry or lacking detail (Laplacian variance ${report.blur.variance.toFixed(1)}).`,
    'not-flagged': `Blur was not flagged (Laplacian variance ${report.blur.variance.toFixed(1)}).`,
    'not-assessable': `Blur is not assessable (Laplacian variance ${report.blur.variance.toFixed(1)}).`,
  }[report.blur.state];
  host.append(text(blur));
  const pct = (report.glare.fraction * 100).toFixed(1);
  const glare = {
    'possible-glare': `Possible glare. Clipped highlights cover ${pct}% of the sample.`,
    'no-large-clipped-highlight': `No large clipped highlight. Clipped pixels are ${pct}%.`,
    'not-assessable': `Glare is not assessable. Clipped pixels are ${pct}% of the sample.`,
  }[report.glare.state];
  host.append(text(glare));
  host.append(text(centeringLine(report.centering)));
}

function centeringLine(centering) {
  if (centering.state === 'measured') {
    return `Centering measurement: left ${centering.leftPct.toFixed(0)}% / right ${centering.rightPct.toFixed(0)}% of the horizontal border pair, top ${centering.topPct.toFixed(0)}% / bottom ${centering.bottomPct.toFixed(0)}% of the vertical border pair. This is not a PSA centering subgrade.`;
  }
  return 'Centering: not assessable from this photo.';
}

function text(value) {
  const p = document.createElement('p');
  p.textContent = value;
  return p;
}

function cell(value, label) {
  const td = document.createElement('td');
  if (label) td.dataset.label = label;
  td.textContent = value;
  return td;
}

function build(section, missingList) {
  const h = document.createElement('h2');
  h.textContent = 'Scan a card';
  const intro = document.createElement('p');
  intro.className = 'note';
  intro.textContent = 'Photos stay in this tab. Reading uses a local English text engine that downloads only from this site, and only after you press Read text. Nothing on this screen uploads a photo or calls a cloud model. The back of a Yu-Gi-Oh or Magic card is usually the same for every card, so the back is kept for your eyes and is not used to name the card.';
  if (missingList) {
    const warn = document.createElement('p');
    warn.className = 'banner';
    warn.textContent = 'The card list did not load. Search and prices are unavailable until data.js loads.';
    section.append(warn);
  }

  const grid = document.createElement('div');
  grid.className = 'scan-grid';
  const front = slotBox('Front');
  const back = slotBox('Back');
  grid.append(front.box, back.box);

  const camMsg = document.createElement('p');
  camMsg.id = 'scan-cam-msg';
  const camBox = document.createElement('div');
  camBox.id = 'scan-cam';
  camBox.hidden = true;
  const video = document.createElement('video');
  video.id = 'scan-cam-video';
  video.className = 'scan-video';
  video.setAttribute('playsinline', '');
  video.muted = true;
  const camUse = button('Use this frame', 'scan-cam-use');
  const camStop = button('Close camera', 'scan-cam-stop', true);
  const camActions = document.createElement('div');
  camActions.className = 'scan-actions';
  camActions.append(camUse, camStop);
  camBox.append(video, camActions);

  const viewport = document.createElement('div');
  viewport.className = 'scan-viewport';
  viewport.id = 'scan-viewport';
  viewport.hidden = true;
  const stage = document.createElement('div');
  stage.className = 'scan-stage';
  stage.id = 'scan-stage';
  const rect = document.createElement('div');
  rect.className = 'scan-rect';
  stage.append(rect);
  viewport.append(stage);

  const zoom = slider('scan-zoom', '1', '4', '0.1', '1');
  const panX = slider('scan-pan-x', '-400', '400', '1', '0');
  const panY = slider('scan-pan-y', '-400', '400', '1', '0');
  const cropL = slider('scan-crop-l', '0', '95', '1', '0');
  const cropT = slider('scan-crop-t', '0', '95', '1', '0');
  const cropR = slider('scan-crop-r', '5', '100', '1', '100');
  const cropB = slider('scan-crop-b', '5', '100', '1', '100');
  const controls = document.createElement('div');
  controls.append(
    labeled('Zoom', zoom),
    labeled('Pan sideways', panX),
    labeled('Pan down', panY),
    labeled('Crop left %', cropL),
    labeled('Crop top %', cropT),
    labeled('Crop right %', cropR),
    labeled('Crop bottom %', cropB),
  );
  const suggestNote = document.createElement('p');
  suggestNote.id = 'scan-suggest-note';
  suggestNote.className = 'note';
  const suggestBtn = button('Use suggested crop', 'scan-suggest', true);
  suggestBtn.hidden = true;
  const qualityBtn = button('Check this crop', 'scan-quality-btn', true);
  const frontQuality = document.createElement('div');
  frontQuality.id = 'scan-front-quality';

  const readBtn = button('Read text on this device', 'scan-read');
  readBtn.disabled = true;
  const cancelBtn = button('Cancel', 'scan-cancel', true);
  cancelBtn.hidden = true;
  const readRow = document.createElement('div');
  readRow.className = 'scan-actions';
  readRow.append(readBtn, cancelBtn);
  const progress = document.createElement('p');
  progress.id = 'scan-progress';
  progress.setAttribute('role', 'status');

  const textArea = document.createElement('textarea');
  textArea.id = 'scan-text';
  textArea.spellcheck = false;
  const rematch = button('Match this text', 'scan-rematch', true);
  const summary = document.createElement('div');
  summary.id = 'scan-summary';
  const search = document.createElement('input');
  search.id = 'scan-search';
  search.type = 'search';
  search.placeholder = 'Search the loaded card list';
  search.autocomplete = 'off';
  const results = document.createElement('div');
  results.id = 'scan-results';
  const clearBtn = button('Clear chosen row', 'scan-clear', true);
  const identity = document.createElement('div');
  identity.id = 'scan-identity';
  const prices = document.createElement('div');
  prices.id = 'scan-prices';
  prices.append(text('Confirm a catalog row to see stored prices.'));

  const condition = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Condition notes';
  const condNote = document.createElement('p');
  condNote.className = 'note';
  condNote.textContent = 'Corners, edges, and surface are your own notes. This screen does not produce a PSA grade, a subgrade, or an authenticity result. Notes stay in this tab and are dropped when you leave it.';
  const centering = document.createElement('p');
  centering.id = 'scan-centering';
  centering.textContent = 'Centering: not assessable until a front photo is checked.';
  condition.append(legend, condNote, centering, choice('corners', 'Corners'), choice('edges', 'Edges'), choice('surface', 'Surface'));

  const backView = document.createElement('div');
  backView.className = 'scan-viewport';
  backView.hidden = true;
  const backStage = document.createElement('div');
  backStage.className = 'scan-stage';
  backView.append(backStage);
  const backQualityBtn = button('Check back photo', 'scan-back-quality', true);
  const backQuality = document.createElement('div');
  backQuality.id = 'scan-back-quality';
  back.box.append(backView, backQualityBtn, backQuality);

  const limits = document.createElement('p');
  limits.className = 'note';
  limits.append(document.createTextNode('English text only. Stylized titles, foils, and non-English cards often read wrong. The loaded list is the deal list in this app, not the full Yu-Gi-Oh or Magic catalog. PSA 5 through PSA 8 stay unavailable unless scan/verified-prices.json has a sourced figure. '));
  const more = document.createElement('a');
  more.href = 'scan/LIMITATIONS.md';
  more.textContent = 'Full limitations';
  limits.append(more);

  const panel = document.createElement('div');
  panel.className = 'scan-panel';
  panel.append(
    controls, suggestNote, suggestBtn, qualityBtn, frontQuality,
    readRow, progress, labeled('Text from the photo. Edit it if it is wrong.', textArea), rematch,
    summary, labeled('Or search the loaded list', search), results, clearBtn, identity, prices, condition, limits,
  );

  section.append(h, intro, grid, camMsg, camBox, viewport, panel);
  return {
    frontFile: front.file,
    backFile: back.file,
    frontCam: front.cam,
    backCam: back.cam,
    frontNote: front.note,
    backNote: back.note,
    camMsg,
    camBox,
    video,
    camUse,
    camStop,
    stream: null,
    camSlot: 'front',
    viewport,
    stage,
    rect,
    zoom,
    panX,
    panY,
    cropL,
    cropT,
    cropR,
    cropB,
    suggestNote,
    suggestBtn,
    qualityBtn,
    frontQuality,
    readBtn,
    cancelBtn,
    progress,
    text: textArea,
    rematch,
    summary,
    search,
    results,
    clearBtn,
    identity,
    prices,
    centering,
    backView,
    backStage,
    backQualityBtn,
    backQuality,
  };
}

function slotBox(name) {
  const box = document.createElement('div');
  box.className = 'scan-slot';
  const title = document.createElement('h3');
  title.textContent = name;
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/jpeg,image/png,image/webp,image/gif';
  file.id = name === 'Front' ? 'scan-front-file' : 'scan-back-file';
  const cam = button(name === 'Front' ? 'Use camera' : 'Use camera for back', name === 'Front' ? 'scan-front-cam' : 'scan-back-cam', true);
  const note = document.createElement('p');
  note.className = 'note';
  note.id = name === 'Front' ? 'scan-front-note' : 'scan-back-note';
  const fileLabel = labeled('Upload a photo', file);
  box.append(title, fileLabel, cam, note);
  return { box, file, cam, note };
}

function button(label, id, quiet) {
  const el = document.createElement('button');
  el.type = 'button';
  el.id = id;
  el.className = quiet ? 'btn g' : 'btn';
  el.textContent = label;
  return el;
}

function slider(id, min, max, step, value) {
  const el = document.createElement('input');
  el.type = 'range';
  el.id = id;
  el.min = min;
  el.max = max;
  el.step = step;
  el.value = value;
  return el;
}

function labeled(label, control) {
  const el = document.createElement('label');
  el.append(document.createTextNode(label), control);
  return el;
}

function choice(name, label) {
  const select = document.createElement('select');
  select.id = `scan-cond-${name}`;
  for (const [value, caption] of [
    ['unset', 'Not reviewed'],
    ['clean', 'Looks clean in this photo'],
    ['wear', 'Wear visible in this photo'],
    ['unassessable', 'Not assessable from these photos'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = caption;
    select.append(option);
  }
  return labeled(label, select);
}
