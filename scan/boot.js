import {
  assessPhoto,
  captureSize,
  catalogFromSite,
  clampCrop,
  COPY,
  CRITICAL_REGIONS,
  fileMessage,
  formatMoney,
  formatUsd,
  groupBlocked,
  identityFields,
  LIMITS,
  matchText,
  REGION_GEOM,
  REGION_LABEL,
  retakePrompts,
  safeHttpUrl,
  searchCatalog,
  suggestCrop,
} from './engine.js';
import { buildSalesSeries, drawSalesChart } from './charts.js';
import { buildGauges } from './gauges.js';
import { cropCanvas, fileToCanvas, grayFromCanvas, releaseCanvas } from './image.js';
import { createLookup } from './lookup.js';
import { createPriceBook, emptyMarket } from './prices.js';
import { inspectSide } from './edges.js';
import { compareTilt } from './tilt.js';
import { matchArtwork } from './artmatch.js';
import { buildDefectMap } from './defects.js';
import { AUTO_CENTERING } from './engine.js';
import { psaEstimate } from './engine.js';
import { estimateBorders, formatGuide, gradePhoto, gradeSide, grayOf, measureCentering, straighten } from './pipeline.js';
import { mountGuides } from './manual.js';
import { collectionList, cardScreen, matchCard, priceRows } from './screens.js';
import { FEED_FAIL, priceFeed, refreshSaved } from './library.js';
import { drawLiveQuad, mountEdge, mountRing, startLive } from './live.js';

/** Device id only. Never a photo. v2 had no camera list because the preview stayed hidden until the shutter, and getUserMedia was not paired with enumerateDevices. */
const CAMERA_KEY = 'card-scan-camera';
let tiltReport = null;

function migrateSaved() {
  try {
    if (!localStorage.getItem('carddeals-coll-v1') && localStorage.getItem('cutline-coll-v1')) {
      localStorage.setItem('carddeals-coll-v1', localStorage.getItem('cutline-coll-v1'));
    }
    if (!localStorage.getItem('carddeals-obs-v1') && localStorage.getItem('cutline-obs-v1')) {
      localStorage.setItem('carddeals-obs-v1', localStorage.getItem('cutline-obs-v1'));
    }
  } catch { /* Private mode keeps nothing. */ }
}

if (!globalThis.__cardScan) {
  globalThis.__cardScan = true;
  migrateSaved();
  boot();
}

function loadCameraChoice() {
  try {
    const value = localStorage.getItem(CAMERA_KEY);
    if (value === 'facing:environment' || value === 'facing:user' || (typeof value === 'string' && value.startsWith('device:'))) return value;
  } catch { /* Private mode keeps the rear camera for this tab. */ }
  return 'facing:environment';
}

function saveCameraChoice(value) {
  if (value !== 'facing:environment' && value !== 'facing:user' && !(typeof value === 'string' && value.startsWith('device:') && value.length > 'device:'.length)) return;
  try { localStorage.setItem(CAMERA_KEY, value); } catch { /* Private mode keeps the choice for this tab. */ }
}

function wideResults() {
  return typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 840px)').matches;
}

function cameraOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
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
  const book = createPriceBook();
  const slots = {
    front: { canvas: null, originalWidth: 0, originalHeight: 0, token: 0, flat: null },
    back: { canvas: null, originalWidth: 0, originalHeight: 0, token: 0, flat: null },
  };
  const reports = { front: null, back: null };
  let readerPromise = null;
  let idleTimer = 0;
  let abort = null;
  let confirmedKey = null;
  let suggestBox = null;
  let drag = null;
  let mode = 'front-and-back';
  let captureSide = 'front';
  let camToken = 0;

  const ui = build(section, rows.length === 0);
  if (ui.tiltHost) ui.tiltHost.addEventListener('tilt-report', () => renderDefects());
  section.addEventListener('scan-official', (event) => rememberOfficial(event.detail));
  wire(ui);
  clearHarmfulZoom();
  pinNav();
  const followViewport = () => {
    clearHarmfulZoom();
    pinNav();
    const live = section.classList.contains('on') && !section.classList.contains('scan-review');
    if (live && phoneShell()) {
      if (!document.documentElement.classList.contains('scan-cam')) enterCapture();
      else placeCapture();
    } else if (document.documentElement.classList.contains('scan-cam') && !phoneShell()) {
      leaveCapture();
    }
    markTight();
  };
  window.addEventListener('resize', followViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', followViewport);
    window.visualViewport.addEventListener('scroll', followViewport);
  }

  document.addEventListener('click', (ev) => {
    const button = ev.target.closest && ev.target.closest('nav button');
    if (button && button.dataset.v === 'scan') {
      savedScroll = document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY;
    }
  }, true);
  document.addEventListener('click', (ev) => {
    const button = ev.target.closest && ev.target.closest('nav button');
    if (!button) return;
    const on = button.dataset.v === 'scan';
    section.classList.toggle('on', on);
    if (on) {
      window.clearTimeout(idleTimer);
      section.classList.remove('scan-review');
      enterCapture();
      openCamera(activeSlot());
    } else {
      section.classList.remove('scan-review');
      stopCamera();
      leaveCapture();
      idleTimer = window.setTimeout(() => dropReader(), 60000);
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ui.stream) stopCamera();
  });

  function dropReader() {
    readerPromise?.then((reader) => reader.terminate()).catch(() => {});
    readerPromise = null;
  }

  function activeSlot() {
    return captureSide === 'back' ? 'back' : 'front';
  }

  function paintThumbs() {
    if (!ui.thumbs) return;
    ui.thumbs.replaceChildren();
    let count = 0;
    for (const side of ['front', 'back']) {
      const source = slots[side].canvas;
      if (!source) continue;
      const thumb = document.createElement('canvas');
      thumb.width = 48;
      thumb.height = 67;
      thumb.getContext('2d').drawImage(source, 0, 0, 48, 67);
      ui.thumbs.append(thumb);
      count += 1;
    }
    ui.thumbs.hidden = count === 0;
  }

  function wire() {
    ui.frontFile.addEventListener('change', () => {
      const file = ui.frontFile.files && ui.frontFile.files[0];
      ui.frontFile.value = '';
      if (file) loadFile('front', file);
    });
    ui.backFile.addEventListener('change', () => {
      const file = ui.backFile.files && ui.backFile.files[0];
      ui.backFile.value = '';
      if (file) loadFile('back', file);
    });
    ui.gallery.addEventListener('click', () => {
      (activeSlot() === 'back' ? ui.backFile : ui.frontFile).click();
    });
    ui.frontCam.addEventListener('click', () => {
      if (ui.stream) useFrame();
      else openCamera(activeSlot());
    });
    ui.camStop.addEventListener('click', () => stopCamera());
    ui.camRetry.addEventListener('click', () => openCamera(activeSlot()));
    ui.close.addEventListener('click', () => {
      const lists = document.querySelector('nav button[data-v="lists"]');
      if (lists) lists.click();
    });
    ui.infoBtn.addEventListener('click', () => {
      ui.infoSheet.hidden = !ui.infoSheet.hidden;
    });
    ui.infoClose.addEventListener('click', () => {
      ui.infoSheet.hidden = true;
    });
    ui.camera.addEventListener('change', () => {
      saveCameraChoice(ui.camera.value);
      openCamera(activeSlot());
    });
    ui.modeFront.addEventListener('click', () => setMode('front-only'));
    ui.modeBoth.addEventListener('click', () => setMode('front-and-back'));
    ui.next.addEventListener('click', () => {
      if (mode === 'front-and-back' && captureSide === 'front') {
        setCapture('back');
        openCamera('back');
        return;
      }
      section.classList.add('scan-review');
      markTight();
      ui.psa.scrollIntoView({ block: 'nearest' });
    });
    ui.zoom.addEventListener('input', applyView);
    ui.panX.addEventListener('input', applyView);
    ui.panY.addEventListener('input', applyView);
    for (const slider of [ui.cropL, ui.cropT, ui.cropR, ui.cropB]) slider.addEventListener('input', () => {
      applyCropRect();
      if (slots.front.canvas) runQuality('front');
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
      resetMarket();
    });
    for (const side of ['front', 'back']) {
      for (const select of Object.values(ui.notes[side])) {
        select.addEventListener('change', () => renderPsa());
      }
    }
    const viewport = ui.viewport;
    viewport.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest && ev.target.closest('.scan-guide')) return;
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
    syncNotes('front', null);
    syncNotes('back', null);
    updateStep();
    renderPsa();
  }

  function setMode(next) {
    mode = next === 'front-and-back' ? 'front-and-back' : 'front-only';
    if (mode === 'front-only' && captureSide === 'back' && !slots.back.canvas) captureSide = 'front';
    updateStep();
    showActive();
    renderPsa();
  }

  function setCapture(side) {
    captureSide = side === 'back' ? 'back' : 'front';
    updateStep();
    showActive();
  }

  function updateStep() {
    const both = mode === 'front-and-back';
    ui.modeFront.classList.toggle('on', !both);
    ui.modeBoth.classList.toggle('on', both);
    ui.modeFront.setAttribute('aria-pressed', both ? 'false' : 'true');
    ui.modeBoth.setAttribute('aria-pressed', both ? 'true' : 'false');
    if (!both) ui.step.textContent = 'Front only. Scan or upload the front of your card.';
    else if (captureSide === 'back') ui.step.textContent = 'Step 2 of 2. Scan or upload the back of your card.';
    else ui.step.textContent = 'Step 1 of 2. Scan or upload the front of your card.';
    const frontReady = Boolean(slots.front.canvas);
    const backReady = Boolean(slots.back.canvas);
    ui.next.hidden = both ? !(frontReady && backReady) : !frontReady;
    ui.next.textContent = 'Review';
  }

  function showActive() {
    if (ui.stream) {
      ui.video.hidden = false;
      ui.outline.hidden = false;
      ui.viewport.hidden = true;
      ui.backView.hidden = true;
      return;
    }
    const backOn = activeSlot() === 'back' && !ui.stream;
    ui.viewport.hidden = backOn || !slots.front.canvas;
    ui.backView.hidden = !backOn || !slots.back.canvas;
    const hasPhoto = backOn ? slots.back.canvas : slots.front.canvas;
    ui.outline.hidden = Boolean(hasPhoto) && ui.video.hidden;
    renderMap(ui.map, backOn ? null : reports.front);
    if (backOn) renderMap(ui.backMap, reports.back);
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
      state.flat = null;
      note.textContent = fileMessage(decoded.code);
      renderCloseups();
      return;
    }
    if (state.canvas) releaseCanvas(state.canvas);
    state.canvas = decoded.canvas;
    if (ui.blocked) ui.blocked.hidden = true;
    state.originalWidth = decoded.originalWidth;
    state.originalHeight = decoded.originalHeight;
    note.textContent = `Working copy ${decoded.workingWidth}×${decoded.workingHeight} from ${decoded.originalWidth}×${decoded.originalHeight}. Longest side is capped at ${LIMITS.maxEdge} px.`;
    state.flat = null;
    if (slot === 'front' && ui.tiltHost && ui.tiltHost.reset) ui.tiltHost.reset();
    try {
      const shot = state.canvas.getContext('2d').getImageData(0, 0, state.canvas.width, state.canvas.height);
      const flat = straighten(shot.data, shot.width, shot.height);
      state.flattened = Boolean(flat.flattened);
      if (flat.flattened) {
        const next = document.createElement('canvas');
        next.width = 500;
        next.height = 700;
        next.getContext('2d').putImageData(new ImageData(flat.rgba, 500, 700), 0, 0);
        releaseCanvas(state.canvas);
        state.canvas = next;
        state.flat = {
          rgba: flat.rgba,
          width: 500,
          height: 700,
          centeringOk: Boolean(flat.centeringOk),
          parallel: !(flat.pose && flat.pose.parallel === false),
          edgesOk: flat.edgesOk !== false,
        };
        const gray = grayOf(flat.rgba, 500, 700);
        let autoLine = 'Measure centering yourself.';
        if (AUTO_CENTERING && flat.centeringOk) {
          const autoText = measureCentering(gray, 500, 700) || '';
          if (/\d+\.\d+\/\d+\.\d+/.test(autoText)) autoLine = autoText;
        }
        const autoHost = slot === 'back' ? ui.backAuto : ui.autoCenter;
        const guides = slot === 'back' ? ui.backManual : ui.frontManual;
        if (autoHost) autoHost.textContent = autoLine;
        if (guides) {
          guides.onChange = (result) => applyManualCentering(slot, result);
          guides.setBack(slot === 'back');
          guides.setImage(500, 700, AUTO_CENTERING ? estimateBorders(gray, 500, 700) : null);
        }
      } else if (slot === 'front') {
        note.textContent += ' Front is tilted.';
      }
    } catch { /* Keep the original photo when the warp cannot run. */ }
    captureSide = slot;
    renderCloseups();
    camToken += 1;
    releaseStream();
    ui.video.hidden = true;
    if (slot === 'front') {
      ui.stage.replaceChildren(state.canvas, ui.map, ui.rect, ui.defectLayer, ui.frontGuideHost);
      ui.readBtn.disabled = false;
      ui.video.hidden = true;
      runQuality('front');
      offerCrop();
    } else {
      ui.backStage.replaceChildren(state.canvas, ui.backMap, ui.backGuideHost);
      ui.video.hidden = true;
      runQuality('back');
    }
    updateStep();
    showActive();
    paintThumbs();
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
    ui.map.style.left = `${crop.left * 100}%`;
    ui.map.style.top = `${crop.top * 100}%`;
    ui.map.style.width = `${(crop.right - crop.left) * 100}%`;
    ui.map.style.height = `${(crop.bottom - crop.top) * 100}%`;
  }

  function applyView() {
    ui.stage.style.transform = `translate(${Number(ui.panX.value) || 0}px, ${Number(ui.panY.value) || 0}px) scale(${Number(ui.zoom.value) || 1})`;
  }

  function frontSample() {
    if (!slots.front.canvas) return null;
    const crop = cropFractions();
    const cropped = cropCanvas(slots.front.canvas, crop);
    const sample = grayFromCanvas(cropped, 400);
    releaseCanvas(cropped);
    sample.originalWidth = Math.max(1, Math.round(slots.front.originalWidth * (crop.right - crop.left)));
    sample.originalHeight = Math.max(1, Math.round(slots.front.originalHeight * (crop.bottom - crop.top)));
    return sample;
  }

  function applyManualCentering(slot, result) {
    slots[slot].manual = result || null;
    const report = reports[slot];
    if (!report) return;
    report.centering = result ? {
      state: 'measured',
      source: 'manual',
      leftPct: result.leftPct,
      rightPct: result.rightPct,
      topPct: result.topPct,
      bottomPct: result.bottomPct,
    } : { state: 'not-measured' };
    const host = slot === 'front' ? ui.frontQuality : ui.backQuality;
    if (host) renderQuality(host, report);
    if (slot === 'front' && ui.centering) ui.centering.textContent = centeringLine(report.centering);
    renderPsa();
  }

  function runQuality(slot) {
    const state = slots[slot];
    const host = slot === 'front' ? ui.frontQuality : ui.backQuality;
    if (!state.canvas) {
      host.textContent = 'Add a photo first.';
      reports[slot] = null;
      renderRetakes();
      renderPsa();
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
    reports[slot] = report;
    if (state.manual) {
      report.centering = {
        state: 'measured',
        source: 'manual',
        leftPct: state.manual.leftPct,
        rightPct: state.manual.rightPct,
        topPct: state.manual.topPct,
        bottomPct: state.manual.bottomPct,
      };
    }
    renderQuality(host, report);
    if (slot === 'front') ui.centering.textContent = centeringLine(report.centering);
    syncNotes(slot, report);
    renderRetakes();
    renderPsa();
    if (slot === 'front') renderMap(ui.map, report);
    else renderMap(ui.backMap, report);
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

  function cameraChoice() {
    const value = (ui.camera && ui.camera.value) || loadCameraChoice();
    if (value === 'facing:user') return { facingMode: 'user' };
    if (typeof value === 'string' && value.startsWith('device:')) return { deviceId: value.slice('device:'.length) };
    return { facingMode: 'environment' };
  }

  function cameraConstraints(choice) {
    const video = {};
    if (choice.deviceId) video.deviceId = { exact: choice.deviceId };
    else video.facingMode = { ideal: choice.facingMode || 'environment' };
    return { audio: false, video };
  }

  let savedScroll = 0;

  function phoneShell() {
    const vv = window.visualViewport;
    const visual = vv ? vv.width : window.innerWidth;
    const tall = vv ? vv.height : window.innerHeight;
    const layout = window.innerWidth;
    if (tall < 780) return true;
    if (visual <= 900) return true;
    if (layout - visual > 80) return true;
    return window.matchMedia('(pointer: coarse)').matches && visual < 1100;
  }

  function cssZoom() {
    const z = parseFloat(getComputedStyle(document.documentElement).zoom);
    return z > 0 && Number.isFinite(z) ? z : 1;
  }

  function clearHarmfulZoom() {
    // index.html zooms the page when the layout is wider than the screen.
    // That zoom and Chrome's desktop-site page scale disagree, so fixed
    // controls and hit testing land outside the visible viewport.
    if (cssZoom() > 1.05 && window.visualViewport && window.visualViewport.scale > 1.05) {
      document.documentElement.style.zoom = '1';
    }
  }

  function needsPin() {
    const vv = window.visualViewport;
    if (!vv) return false;
    if (cssZoom() > 1.05 || vv.scale > 1.05) return true;
    return window.innerWidth - vv.width > 80;
  }

  function pinNav() {
    const nav = document.querySelector('nav');
    const vv = window.visualViewport;
    if (!nav || !vv || !needsPin()) return;
    const z = cssZoom();
    const h = nav.offsetHeight || 56;
    nav.style.position = 'fixed';
    nav.style.top = `${(vv.offsetTop + vv.height) / z - h}px`;
    nav.style.bottom = 'auto';
    nav.style.left = `${vv.offsetLeft / z}px`;
    nav.style.width = `${vv.width / z}px`;
    nav.style.right = 'auto';
    nav.style.zIndex = '90';
  }

  function placeCapture() {
    if (!phoneShell()) {
      section.style.position = '';
      section.style.top = '';
      section.style.left = '';
      section.style.width = '';
      section.style.height = '';
      section.style.zIndex = '';
      return;
    }
    const vv = window.visualViewport;
    const z = cssZoom();
    section.style.position = 'fixed';
    section.style.zIndex = '100';
    section.style.margin = '0';
    section.style.maxWidth = 'none';
    section.style.right = 'auto';
    section.style.bottom = 'auto';
    section.style.top = `${((vv ? vv.offsetTop : 0) / z)}px`;
    section.style.left = `${((vv ? vv.offsetLeft : 0) / z)}px`;
    section.style.width = `${((vv ? vv.width : window.innerWidth) / z)}px`;
    section.style.height = `${((vv ? vv.height : window.innerHeight) / z)}px`;
  }

  function markTight() {
    const vv = window.visualViewport;
    const live = section.classList.contains('on') && !section.classList.contains('scan-review');
    const tight = Boolean(vv && live && (vv.height < 220 || vv.width < 340));
    document.documentElement.classList.toggle('scan-tight', tight);
  }

  function enterCapture() {
    if (!phoneShell()) return;
    savedScroll = document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY;
    document.documentElement.classList.add('scan-cam');
    placeCapture();
    markTight();
    if (document.scrollingElement) document.scrollingElement.scrollTop = savedScroll;
    if (!enterCapture.bound) {
      enterCapture.bound = true;
      window.addEventListener('scroll', () => {
        if (!document.documentElement.classList.contains('scan-cam')) return;
        if (Math.abs(window.scrollY - savedScroll) > 1) window.scrollTo(0, savedScroll);
      });
    }
  }

  function leaveCapture() {
    document.documentElement.classList.remove('scan-cam', 'scan-tight');
    section.style.position = '';
    section.style.top = '';
    section.style.left = '';
    section.style.width = '';
    section.style.height = '';
    section.style.zIndex = '';
    section.style.margin = '';
    section.style.right = '';
    section.style.bottom = '';
    section.style.maxWidth = '';
    if (document.scrollingElement) document.scrollingElement.scrollTop = savedScroll;
  }

  function showCamError(err) {
    ui.step.hidden = true;
    ui.camRetry.hidden = false;
    const name = err && err.name;
    ui.camMsg.textContent = 'Camera is blocked. Allow it, or choose a photo.';
    ui.blocked.hidden = false;
  }

  async function lockRearZoom(stream) {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') return;
    let caps = null;
    try { caps = track.getCapabilities(); } catch { caps = null; }
    const zoom = caps && caps.zoom;
    if (!zoom || typeof zoom.min !== 'number' || typeof zoom.max !== 'number') return;
    const target = zoom.min <= 1 && zoom.max >= 1 ? 1 : zoom.min;
    try { await track.applyConstraints({ advanced: [{ zoom: target }] }); } catch { /* The camera stays at its own 1×. */ }
  }

  async function fillCameraList() {
    const select = ui.camera;
    if (!select) return;
    let devices = [];
    if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
      try {
        const listed = await navigator.mediaDevices.enumerateDevices();
        devices = listed.filter((device) => device.kind === 'videoinput');
      } catch { devices = []; }
    }
    const current = select.value || loadCameraChoice();
    select.replaceChildren();
    select.append(cameraOption('facing:environment', 'Rear 1×'), cameraOption('facing:user', 'Front'));
    devices.forEach((device, index) => {
      const label = device.label && device.label.trim() ? device.label.trim() : `Camera ${index + 1}`;
      select.append(cameraOption(`device:${device.deviceId}`, label));
    });
    const values = [...select.options].map((option) => option.value);
    select.value = values.includes(current) ? current : 'facing:environment';
    select.hidden = devices.length < 2;
  }

  async function openCamera(slot) {
    const my = ++camToken;
    releaseStream();
    ui.camSlot = slot === 'back' ? 'back' : 'front';
    captureSide = ui.camSlot;
    updateStep();
    ui.camMsg.textContent = '';
    ui.camRetry.hidden = true;
    if (ui.blocked) ui.blocked.hidden = true;
    ui.step.hidden = false;
    ui.video.hidden = false;
    ui.outline.hidden = false;
    ui.viewport.hidden = true;
    ui.backView.hidden = true;
    const listed = fillCameraList();
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      await listed;
      ui.camMsg.textContent = 'Camera is blocked. Allow it, or choose a photo.';
      ui.camRetry.hidden = false;
      ui.blocked.hidden = false;
      return;
    }
    let stream = null;
    let failure = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(cameraChoice()));
    } catch (err) {
      failure = err;
      if (cameraChoice().deviceId) {
        try { stream = await navigator.mediaDevices.getUserMedia(cameraConstraints({ facingMode: 'environment' })); }
        catch (err2) { failure = err2; }
      }
    }
    if (my !== camToken) {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      return;
    }
    if (!stream) {
      showCamError(failure);
      await fillCameraList();
      return;
    }
    ui.stream = stream;
    const track = stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities && track.getCapabilities();
    if (ui.torch) ui.torch.hidden = !(caps && caps.torch);
    await lockRearZoom(stream);
    if (my !== camToken) {
      releaseStream();
      return;
    }
    ui.video.playsInline = true;
    ui.video.muted = true;
    ui.video.hidden = false;
    ui.outline.hidden = false;
    try { ui.video.srcObject = stream; } catch { /* A test double is not a real stream. The preview element is already on screen. */ }
    try { await ui.video.play(); } catch { /* The shutter still works after the video is ready. */ }
    await fillCameraList();
    if (my !== camToken || !ui.stream) return;
    ui.stopLive = startLive(ui.video, {
      onFrame(view) {
        if (ui.align) ui.align.textContent = view.hint;
        if (ui.tightNote) ui.tightNote.textContent = view.hint;
        if (ui.setCaptureProgress) ui.setCaptureProgress(view.progress);
        drawLiveQuad(ui.liveEdge, ui.video, view.quad, view.code);
      },
      onCapture() {
        useFrame().catch(() => {
          ui.camMsg.textContent = 'The frame could not be copied. You can still use the shutter.';
          ui.blocked.hidden = false;
        });
      },
    });
  }

  function renderCloseups() {
    const host = ui.edgesHost;
    if (!host) return;
    host.replaceChildren();
    const sides = ['front', 'back'].filter((side) => slots[side].flat);
    if (!sides.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const title = document.createElement('h3');
    title.textContent = 'Corner and edge close-ups';
    host.append(title);
    for (const side of sides) {
      const report = inspectSide(slots[side].flat.rgba, 500, 700, side, { edgesOk: slots[side].flat.edgesOk !== false });
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = report.note;
      host.append(note);
      const row = document.createElement('div');
      row.className = 'scan-crops';
      for (const item of report.crops) {
        const cell = document.createElement('div');
        cell.className = 'scan-crop';
        const canvas = document.createElement('canvas');
        canvas.width = item.width;
        canvas.height = item.height;
        canvas.getContext('2d').putImageData(new ImageData(item.rgba, item.width, item.height), 0, 0);
        const label = document.createElement('p');
        label.textContent = `${item.label}. ${item.text}`;
        cell.append(canvas, label);
        row.append(cell);
      }
      host.append(row);
    }
    renderArt();
    renderDefects();
  }

  let officialArt = null;
  let officialUrl = '';

  function renderArt() {
    const host = ui.artHost;
    if (!host) return;
    const flat = slots.front.flat;
    const note = host.querySelector('p');
    if (!flat) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    if (!officialArt) {
      note.textContent = matchArtwork(flat.rgba, flat.width, flat.height, null, 0, 0).note;
      return;
    }
    note.textContent = matchArtwork(flat.rgba, flat.width, flat.height, officialArt.rgba, officialArt.width, officialArt.height).note;
  }

  function rememberOfficial(url) {
    if (!url) {
      officialUrl = '';
      officialArt = null;
      renderArt();
      return;
    }
    if (url === officialUrl) {
      renderArt();
      return;
    }
    officialUrl = url;
    officialArt = null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (officialUrl !== url) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const shot = ctx.getImageData(0, 0, canvas.width, canvas.height);
        officialArt = { rgba: shot.data, width: canvas.width, height: canvas.height };
      } catch {
        officialArt = null;
      }
      renderArt();
    };
    img.onerror = () => {
      if (officialUrl !== url) return;
      officialArt = null;
      renderArt();
    };
    img.src = url;
  }

  function renderDefects() {
    const reports = ['front', 'back'].filter((side) => slots[side].flat).map((side) => inspectSide(slots[side].flat.rgba, 500, 700, side, { edgesOk: slots[side].flat.edgesOk !== false }));
    const map = buildDefectMap(reports, tiltReport);
    const host = ui.defectHost;
    if (host) {
      host.hidden = reports.length === 0;
      const note = host.querySelector('p');
      if (note) note.textContent = map.note;
    }
    const layer = ui.defectLayer;
    if (!layer) return;
    layer.replaceChildren();
    const shown = captureSide === 'back' ? 'back' : 'front';
    for (const mark of map.marks) {
      if (!mark.id.startsWith(shown) && !mark.id.startsWith('tilt-')) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'scan-defect';
      btn.style.left = `${mark.x * 100}%`;
      btn.style.top = `${mark.y * 100}%`;
      btn.style.width = `${Math.max(mark.w * 100, 8)}%`;
      btn.style.height = `${Math.max(mark.h * 100, 6)}%`;
      btn.textContent = mark.label;
      btn.setAttribute('aria-label', mark.label);
      btn.addEventListener('click', () => {
        const note = ui.defectHost && ui.defectHost.querySelector('p');
        if (note) note.textContent = `${mark.label}. ${mark.detail}`;
      });
      layer.append(btn);
    }
  }

  function releaseStream() {
    if (ui.stopLive) {
      ui.stopLive();
      ui.stopLive = null;
    }
    if (ui.setCaptureProgress) ui.setCaptureProgress(0);
    if (ui.align) ui.align.textContent = 'Align the card in the frame.';
    drawLiveQuad(ui.liveEdge, null, null, '');
    if (ui.stream) {
      for (const track of ui.stream.getTracks()) track.stop();
      ui.stream = null;
    }
    if (ui.video) ui.video.srcObject = null;
  }

  function stopCamera() {
    camToken += 1;
    releaseStream();
    ui.video.hidden = true;
    ui.camStop.hidden = true;
    showActive();
  }

  let resumeCamera = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      resumeCamera = Boolean(ui.stream);
      releaseStream();
      if (ui.video) ui.video.hidden = true;
      return;
    }
    if (resumeCamera) {
      resumeCamera = false;
      openCamera(ui.camSlot || 'front');
    }
  });
  window.addEventListener('pagehide', () => {
    resumeCamera = false;
    releaseStream();
  });

  async function useFrame() {
    const box = captureSize(ui.video.videoWidth, ui.video.videoHeight);
    if (!box) {
      ui.camMsg.textContent = 'The camera has no frame yet.';
      ui.blocked.hidden = false;
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = box.width;
    canvas.height = box.height;
    canvas.getContext('2d').drawImage(ui.video, 0, 0, box.width, box.height);
    const slot = ui.camSlot || activeSlot();
    stopCamera();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    releaseCanvas(canvas);
    if (!blob) {
      ui.camMsg.textContent = 'The frame could not be copied. You can still upload a photo.';
      ui.blocked.hidden = false;
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
    resetMarket();
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

  function readNotes(side) {
    const group = ui.notes[side];
    return {
      corners: group.corners.value,
      edges: group.edges.value,
      surface: group.surface.value,
    };
  }

  async function confirmRow(row) {
    confirmedKey = row.key;
    ui.identity.replaceChildren();
    const banner = document.createElement('p');
    banner.className = 'scan-warn';
    banner.textContent = row.parsed.setCode
      ? COPY.confirm
      : `${COPY.confirm} This row does not name a set code. Prices below belong to the stored catalog row only. The exact print is unavailable.`;
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
    resetMarket();
    try {
      const report = await lookup.report(row);
      if (confirmedKey !== row.key) return;
      renderPrices(report);
      let market = emptyMarket();
      if (row.id) market = await book.load(row.game, row.id);
      if (confirmedKey !== row.key) return;
      renderMarket(market);
      renderChart(market);
      renderGaugeSet(report, market);
    } catch {
      if (confirmedKey !== row.key) return;
      ui.prices.replaceChildren(text('Stored prices could not be read. Nothing was sent out.'));
    }
  }

  function renderPrices(report) {
    ui.prices.replaceChildren();
    const intro = document.createElement('p');
    intro.textContent = report.exactSetNamed
      ? 'Stored catalog figures for the confirmed row. Grades with no stored figure stay unavailable. Amounts are the stored currency, with no conversion.'
      : 'Stored catalog figures for the confirmed row. The row does not name a set, so these figures are not an exact-print quote. Amounts are the stored currency, with no conversion.';
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

  function resetMarket() {
    ui.sold.replaceChildren(text('Confirm a catalog row to see completed sales and asking prices.'));
    ui.asks.replaceChildren();
    ui.chartTitle.textContent = '';
    ui.chartNote.textContent = '';
    ui.chart.hidden = true;
    ui.gauges.replaceChildren();
  }

  function renderMarket(market) {
    fillQuotes(ui.sold, COPY.sold, market.sold, 'No sourced completed sales for this catalog row.');
    fillQuotes(ui.asks, COPY.ask, market.ask, 'No sourced asking prices for this catalog row.');
    const stale = market.sold.some((row) => row.stale) || market.ask.some((row) => row.stale);
    if (stale && ui.fresh && ui.fresh.hidden) {
      ui.fresh.hidden = false;
      ui.fresh.textContent = 'Some stored prices are past their verification window and are not buys.';
    }
  }

  function renderChart(market) {
    const sold = market.sold.map((row) => ({ price: row.price, observedAt: row.observedAt }));
    const asks = market.ask.map((row) => ({ price: row.price, observedAt: row.observedAt }));
    const series = sold.length
      ? buildSalesSeries(sold, { releasedAt: market.releasedAt, kind: 'sold' })
      : buildSalesSeries(asks, { releasedAt: market.releasedAt, kind: asks.length ? 'ask' : 'sold' });
    ui.chartTitle.textContent = series.title;
    ui.chartNote.textContent = series.gap;
    const hasBar = series.buckets.some((bucket) => typeof bucket.value === 'number');
    ui.chart.hidden = !hasBar;
    if (hasBar) drawSalesChart(ui.chart, series);
    if (ui.chartCard) ui.chartCard.open = wideResults();
  }

  function renderGaugeSet(report, market) {
    let photoUnknowns = 0;
    for (const side of [reports.front, reports.back]) {
      if (!side || !side.regions) continue;
      for (const id of CRITICAL_REGIONS) {
        const status = side.regions[id] && side.regions[id].status;
        if (status === 'fail' || status === 'unknown') photoUnknowns += 1;
      }
    }
    let pricesStale = false;
    for (const lines of Object.values(report.grades || {})) {
      if (lines.some((line) => line.stale)) pricesStale = true;
    }
    if (market.sold.some((row) => row.stale) || market.ask.some((row) => row.stale)) pricesStale = true;
    let newestSoldAt = null;
    for (const row of market.sold) {
      if (!newestSoldAt || Date.parse(row.observedAt) > Date.parse(newestSoldAt)) newestSoldAt = row.observedAt;
    }
    const gauges = buildGauges({
      printConfirmed: true,
      photoUnknowns,
      pricesStale,
      soldPrices: market.sold.map((row) => row.price),
      askPrices: market.ask.map((row) => row.price),
      newestSoldAt,
      now: Date.now(),
      backMissing: !slots.back.canvas,
      flags: market.flags,
      scenarios: market.scenarios,
    });
    const gaugeSummary = document.createElement('summary');
    gaugeSummary.textContent = 'Risk, value, and future potential';
    ui.gauges.replaceChildren(gaugeSummary, gaugeBox('Buying risk', gauges.risk), gaugeBox('Current value', gauges.value), futureBox(gauges.future));
    ui.gauges.open = wideResults();
  }

  function renderPsa() {
    ui.psa.replaceChildren();
    const heading = document.createElement('summary');
    heading.textContent = COPY.psaUi;
    ui.psa.append(heading);
    if (!reports.front) {
      ui.psa.append(text('Add a front photo before a potential grade range. Nothing here is a certification.'));
    } else {
      const estimate = psaEstimate({
        mode,
        front: reports.front,
        back: reports.back,
        notes: { front: readNotes('front'), back: readNotes('back') },
      });
      const line = document.createElement('p');
      line.textContent = estimate.range
        ? `Photo-supported range: ${estimate.range.low}–${estimate.range.high}. ${estimate.label}.`
        : estimate.message;
      ui.psa.append(line);
      if (estimate.basis.length) {
        const list = document.createElement('ul');
        for (const item of estimate.basis) {
          const li = document.createElement('li');
          li.textContent = item;
          list.append(li);
        }
        ui.psa.append(list);
      }
      const disclaimer = document.createElement('p');
      disclaimer.className = 'note';
      disclaimer.textContent = estimate.disclaimer;
      ui.psa.append(disclaimer);
    }
    const auth = document.createElement('p');
    auth.className = 'note';
    auth.textContent = COPY.authenticity;
    ui.psa.append(auth);
    ui.psa.open = wideResults();
  }

  function renderRetakes() {
    ui.retakes.replaceChildren();
    const prompts = [
      ...(reports.front ? retakePrompts('front', reports.front) : []),
      ...(reports.back ? retakePrompts('back', reports.back) : []),
    ];
    for (const prompt of prompts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn g scan-retake';
      button.textContent = prompt.line;
      button.addEventListener('click', () => {
        setCapture(prompt.side);
        openCamera(prompt.side);
      });
      ui.retakes.append(button);
    }
  }

  function syncNotes(side, report) {
    for (const group of ['corners', 'edges', 'surface']) {
      const select = ui.notes[side][group];
      const blocked = groupBlocked(report, group);
      const clean = [...select.options].find((option) => option.value === 'clean');
      if (clean) clean.disabled = blocked;
      if (blocked && select.value === 'clean') select.value = 'unassessable';
    }
  }
}

function fillQuotes(host, title, rows, emptyNote) {
  host.replaceChildren();
  const heading = document.createElement('summary');
  heading.textContent = rows.length ? `${title} · ${rows.length}` : `${title} · Unavailable`;
  host.append(heading);
  host.open = wideResults();
  if (!rows.length) {
    host.append(text(`Unavailable. ${emptyNote}`));
    return;
  }
  const list = document.createElement('ul');
  for (const row of rows) {
    const li = document.createElement('li');
    const when = row.observedAt ? (row.stale ? `${row.observedAt} (stale)` : row.observedAt) : 'Unavailable';
    li.append(document.createTextNode(`${formatMoney(row.price, row.currency)} · ${row.condition || 'Condition unavailable'} · ${row.source} · ${when}`));
    if (row.sourceUrl) {
      li.append(document.createTextNode(' '));
      const a = document.createElement('a');
      a.href = row.sourceUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Listing';
      li.append(a);
    }
    list.append(li);
  }
  host.append(list);
}

function gaugeBox(title, model) {
  const box = document.createElement('section');
  box.className = 'scan-gauge';
  const heading = document.createElement('h3');
  heading.textContent = title;
  box.append(heading);
  const score = document.createElement('p');
  score.textContent = model.score == null ? 'Unavailable' : String(model.score);
  box.append(score);
  if (model.score != null) {
    const bar = document.createElement('div');
    bar.className = 'scan-meter';
    const fill = document.createElement('i');
    fill.style.setProperty('--p', String(model.score));
    bar.append(fill);
    box.append(bar);
  }
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = model.disclaimer;
  box.append(note);
  const list = document.createElement('ul');
  for (const factor of model.factors || []) {
    const li = document.createElement('li');
    li.textContent = factor;
    list.append(li);
  }
  box.append(list);
  return box;
}

function futureBox(model) {
  const box = gaugeBox('Future potential', {
    score: model.available ? model.score : null,
    factors: [],
    disclaimer: model.disclaimer,
  });
  if (!model.available) {
    box.append(text('Unavailable. No scenario list was shipped for this card.'));
    return box;
  }
  const list = document.createElement('ul');
  for (const scenario of model.scenarios) {
    const li = document.createElement('li');
    const lean = scenario.lean ? ` (${scenario.lean})` : '';
    li.textContent = `${scenario.tag}${lean}. ${scenario.note}`.trim();
    list.append(li);
  }
  box.append(list);
  const extra = document.createElement('p');
  extra.className = 'note';
  extra.textContent = model.score == null
    ? 'No numeric score was supplied with these scenarios.'
    : 'The meter uses the average of tracker-supplied scenario weights.';
  box.append(extra);
  return box;
}

function renderMap(map, report) {
  if (!map) return;
  map.replaceChildren();
  if (!report || !report.regions) return;
  for (const [id, geom] of Object.entries(REGION_GEOM)) {
    if (id === 'border_box') continue;
    const region = report.regions[id];
    if (!region) continue;
    const el = document.createElement('div');
    el.className = `scan-reg scan-reg-${region.status}`;
    el.style.left = `${geom.x * 100}%`;
    el.style.top = `${geom.y * 100}%`;
    el.style.width = `${geom.w * 100}%`;
    el.style.height = `${geom.h * 100}%`;
    el.title = `${REGION_LABEL[id]}: ${region.status}`;
    map.append(el);
  }
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
  if (centering && centering.state === 'measured' && centering.source === 'manual') {
    return `Measured by you. Left/right ${centering.leftPct.toFixed(1)}/${centering.rightPct.toFixed(1)}. Top/bottom ${centering.topPct.toFixed(1)}/${centering.bottomPct.toFixed(1)}. This is not a PSA grade.`;
  }
  return 'Measure centering yourself. Centering is not measured.';
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
  intro.textContent = `${COPY.privacy} ${COPY.authenticity}`;
  const introNote = document.createElement('p');
  introNote.className = 'note';
  introNote.textContent = 'Reading uses a local English text engine that downloads only from this site, and only after you press Read text. The back of a Yu-Gi-Oh or Magic card is usually the same for every card, so the back is not used to name the card.';
  if (missingList) {
    const warn = document.createElement('p');
    warn.className = 'banner';
    warn.textContent = 'The card list did not load. Search and prices are unavailable until data.js loads.';
    section.append(warn);
  }

  const s22 = document.createElement('ol');
  s22.className = 'scan-s22';
  s22.id = 'scan-s22';
  for (const line of [
    'Rear camera, 1× (no ultra-wide, no tele, no digital zoom).',
    'No filters, Beauty, or AI enhance. Prefer the original JPEG.',
    'Soft diffuse light. Avoid a hard overhead spot on foil.',
    'Hold the phone parallel to the card. Keep the card flat on a dark, non-reflective background.',
  ]) {
    const li = document.createElement('li');
    li.textContent = line;
    s22.append(li);
  }
  const s22Note = document.createElement('p');
  s22Note.className = 'note';
  s22Note.textContent = 'Galaxy S22 capture notes. Pro mode is not listed here, and this screen does not invent ISO or exposure numbers.';

  const modeFront = modeButton('Front only', 'scan-mode-front', false);
  const modeBoth = modeButton('Front & back', 'scan-mode-both', true);
  const modeBar = document.createElement('div');
  modeBar.className = 'scan-mode';
  modeBar.append(modeFront, modeBoth);
  const step = document.createElement('p');
  step.id = 'scan-step';
  const priceLimitText = 'PSA 5 through PSA 8 stay unavailable unless scan/verified-prices.json has a sourced figure. Market shards that were not exported stay unavailable.';
  const priceLimitLive = document.createElement('p');
  priceLimitLive.id = 'scan-price-limit-live';
  priceLimitLive.className = 'note';
  priceLimitLive.textContent = priceLimitText;

  const finder = document.createElement('div');
  finder.className = 'scan-finder';
  finder.id = 'scan-finder';
  const video = document.createElement('video');
  video.id = 'scan-cam-video';
  video.className = 'scan-video';
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.hidden = true;
  const viewport = document.createElement('div');
  viewport.className = 'scan-viewport';
  viewport.id = 'scan-viewport';
  viewport.hidden = true;
  const stage = document.createElement('div');
  stage.className = 'scan-stage';
  stage.id = 'scan-stage';
  const map = document.createElement('div');
  map.className = 'scan-map';
  map.id = 'scan-map';
  const rect = document.createElement('div');
  rect.className = 'scan-rect';
  stage.append(map, rect);
  const defectLayer = document.createElement('div');
  defectLayer.id = 'scan-defect-map';
  stage.append(defectLayer);
  const frontGuideHost = document.createElement('div');
  frontGuideHost.id = 'scan-front-guides';
  stage.append(frontGuideHost);
  const frontManual = mountGuides(frontGuideHost);
  viewport.append(stage);
  const backView = document.createElement('div');
  backView.className = 'scan-viewport';
  backView.id = 'scan-back-view';
  backView.hidden = true;
  const backStage = document.createElement('div');
  backStage.className = 'scan-stage';
  const backMap = document.createElement('div');
  backMap.className = 'scan-map';
  backMap.style.left = '0';
  backMap.style.top = '0';
  backMap.style.width = '100%';
  backMap.style.height = '100%';
  backStage.append(backMap);
  const backGuideHost = document.createElement('div');
  backGuideHost.id = 'scan-back-guides';
  backStage.append(backGuideHost);
  const backManual = mountGuides(backGuideHost);
  backView.append(backStage);
  const outline = document.createElement('div');
  outline.className = 'scan-outline';
  outline.id = 'scan-outline';
  finder.append(video, viewport, backView, outline);
  const liveEdge = mountEdge(finder);

  const gallery = button('', 'scan-gallery', true);
  gallery.setAttribute('aria-label', 'Gallery');
  gallery.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 6h3l2-2h6l2 2h3v12H4V6zm8 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>';
  const frontCam = button('', 'scan-front-cam', false);
  frontCam.className = 'scan-shutter';
  frontCam.setAttribute('aria-label', 'Shutter');
  const shutterCore = document.createElement('span');
  shutterCore.className = 'scan-shutter-core';
  shutterCore.setAttribute('aria-hidden', 'true');
  frontCam.append(shutterCore);
  const next = button('Review', 'scan-next', true);
  next.hidden = true;
  const zoomHalf = button('.5x', 'scan-zoom-half', true);
  const zoomOne = button('1x', 'scan-zoom-one', true);
  zoomOne.classList.add('on');
  const zoomToggle = document.createElement('div');
  zoomToggle.id = 'scan-zoom-toggle';
  zoomToggle.append(zoomHalf, zoomOne);
  const camStop = button('Close', 'scan-cam-stop', true);
  camStop.hidden = true;
  const thumbs = document.createElement('div');
  thumbs.id = 'scan-thumbs';
  thumbs.hidden = true;
  const camLeft = document.createElement('div');
  camLeft.className = 'scan-cam-side scan-cam-left';
  camLeft.append(zoomToggle);
  const camRight = document.createElement('div');
  camRight.className = 'scan-cam-side scan-cam-right';
  camRight.append(gallery, next);
  const camBar = document.createElement('div');
  camBar.className = 'scan-cam-bar';
  const captureRing = mountRing(camBar);
  camBar.append(camLeft, camRight, frontCam);
  const camMsg = document.createElement('p');
  camMsg.id = 'scan-cam-msg';
  const camRetry = button('Retry', 'scan-cam-retry', false);
  camRetry.hidden = true;
  const blocked = document.createElement('div');
  blocked.id = 'scan-blocked';
  blocked.className = 'scan-blocked';
  blocked.hidden = true;
  const blockedGallery = button('', 'scan-blocked-gallery', true);
  blockedGallery.setAttribute('aria-label', 'Gallery');
  blockedGallery.innerHTML = gallery.innerHTML;
  blockedGallery.addEventListener('click', () => gallery.click());
  blocked.append(camMsg, camRetry, blockedGallery);
  const close = button('×', 'scan-close', true);
  close.setAttribute('aria-label', 'Close scan');
  const game = document.createElement('select');
  game.id = 'scan-game';
  game.setAttribute('aria-label', 'Game');
  for (const [value, label] of [['all', 'Both'], ['ygo', 'Yu-Gi-Oh'], ['mtg', 'Magic']]) {
    game.append(cameraOption(value, label));
  }
  const camera = document.createElement('select');
  camera.id = 'scan-camera';
  camera.setAttribute('aria-label', 'Camera');
  camera.append(cameraOption('facing:environment', 'Rear 1×'), cameraOption('facing:user', 'Front'));
  camera.value = loadCameraChoice();
  camera.hidden = true;
  const torch = button('', 'scan-torch', true);
  torch.setAttribute('aria-label', 'Torch');
  torch.hidden = true;
  const infoBtn = button('i', 'scan-info-btn', true);
  infoBtn.setAttribute('aria-label', 'Scan info');
  const top = document.createElement('div');
  top.className = 'scan-top';
  top.append(close, modeBar, torch, infoBtn, camera);

  const frontFile = fileInput('scan-front-file');
  const backFile = fileInput('scan-back-file');
  const frontNote = document.createElement('p');
  frontNote.className = 'note';
  frontNote.id = 'scan-front-note';
  const autoCenter = document.createElement('p');
  autoCenter.id = 'scan-auto-center';
  autoCenter.className = 'note';
  autoCenter.textContent = 'Measure centering yourself.';
  const backAuto = document.createElement('p');
  backAuto.id = 'scan-back-auto';
  backAuto.className = 'note';
  backAuto.textContent = 'Measure centering yourself.';
  const backNote = document.createElement('p');
  backNote.className = 'note';
  backNote.id = 'scan-back-note';
  const retakes = document.createElement('div');
  retakes.id = 'scan-retakes';

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
  const edgesHost = document.createElement('div');
  edgesHost.id = 'scan-edges';
  edgesHost.hidden = true;
  const tiltHost = document.createElement('div');
  tiltHost.id = 'scan-tilt';
  const tiltTitle = document.createElement('h3');
  tiltTitle.textContent = 'Tilt-light check';
  const tiltNote = document.createElement('p');
  tiltNote.id = 'scan-tilt-note';
  tiltNote.className = 'note';
  const tiltFrames = [];
  const tiltFile = fileInput('scan-tilt-file');
  const tiltBtn = button('Add angled photo', 'scan-tilt-add', true);
  tiltNote.textContent = compareTilt([]).note;
  tiltBtn.addEventListener('click', () => tiltFile.click());
  tiltFile.addEventListener('change', async () => {
    const file = tiltFile.files && tiltFile.files[0];
    tiltFile.value = '';
    if (!file) return;
    const decoded = await fileToCanvas(file);
    if (!decoded.ok) {
      tiltNote.textContent = fileMessage(decoded.code);
      return;
    }
    const shot = decoded.canvas.getContext('2d').getImageData(0, 0, decoded.canvas.width, decoded.canvas.height);
    tiltFrames.push({ rgba: shot.data, width: shot.width, height: shot.height });
    releaseCanvas(decoded.canvas);
    while (tiltFrames.length > 3) tiltFrames.shift();
    const report = compareTilt(tiltFrames);
    tiltNote.textContent = [report.note, ...report.findings.map((item) => item.text)].filter(Boolean).join(' ');
    tiltReport = report;
    tiltHost.dispatchEvent(new Event('tilt-report'));
  });
  tiltHost.reset = () => {
    tiltFrames.length = 0;
    tiltReport = null;
    tiltNote.textContent = compareTilt([]).note;
  };
  tiltHost.append(tiltTitle, tiltNote, tiltBtn, tiltFile);
  const artHost = document.createElement('div');
  artHost.id = 'scan-artmatch';
  artHost.hidden = true;
  const artTitle = document.createElement('h3');
  artTitle.textContent = 'Artwork check';
  const artNote = document.createElement('p');
  artNote.className = 'note';
  artHost.append(artTitle, artNote);
  const defectHost = document.createElement('div');
  defectHost.id = 'scan-defects';
  defectHost.hidden = true;
  const defectTitle = document.createElement('h3');
  defectTitle.textContent = 'Defect map';
  const defectNote = document.createElement('p');
  defectNote.className = 'note';
  defectHost.append(defectTitle, defectNote);
  const backQualityBtn = button('Check back photo', 'scan-back-quality-btn', true);
  const backQuality = document.createElement('div');
  backQuality.id = 'scan-back-quality';

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
  const psa = document.createElement('details');
  psa.id = 'scan-psa';
  psa.className = 'scan-block scan-card';
  const sold = document.createElement('details');
  sold.id = 'scan-sold';
  sold.className = 'scan-block scan-card';
  const asks = document.createElement('details');
  asks.id = 'scan-asks';
  asks.className = 'scan-block scan-card';
  const prices = document.createElement('div');
  prices.id = 'scan-prices';
  prices.className = 'scan-block';
  const storedHeading = document.createElement('h3');
  storedHeading.textContent = 'Stored catalog figures';
  prices.append(storedHeading, text('Confirm a catalog row to see stored prices.'));
  const priceLimit = document.createElement('p');
  priceLimit.id = 'scan-price-limit';
  priceLimit.className = 'note';
  priceLimit.textContent = priceLimitText;
  const chartCard = document.createElement('details');
  chartCard.id = 'scan-chart-card';
  chartCard.className = 'scan-card';
  const chartTitle = document.createElement('summary');
  chartTitle.id = 'scan-chart-title';
  chartTitle.textContent = 'Sales history';
  const chart = document.createElement('canvas');
  chart.id = 'scan-chart';
  chart.className = 'scan-chart';
  chart.hidden = true;
  const chartNote = document.createElement('p');
  chartNote.id = 'scan-chart-note';
  chartNote.className = 'note';
  chartCard.append(chartTitle, chart, chartNote);
  const gauges = document.createElement('details');
  gauges.id = 'scan-gauges';
  gauges.className = 'scan-gauges scan-card';

  const condition = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Condition notes';
  const condNote = document.createElement('p');
  condNote.className = 'note';
  condNote.textContent = 'Corners, edges, and surface are your own notes. This screen does not produce a PSA grade, a subgrade, or an authenticity result. A clean note is refused while the photo check for that area failed or abstained. Notes stay in this tab and are dropped when you leave it.';
  const centering = document.createElement('p');
  centering.id = 'scan-centering';
  centering.textContent = 'Centering: not assessable until a front photo is checked.';
  const frontNotes = {
    corners: choice('scan-cond-corners', 'Front corners'),
    edges: choice('scan-cond-edges', 'Front edges'),
    surface: choice('scan-cond-surface', 'Front surface'),
  };
  const backNotes = {
    corners: choice('scan-cond-back-corners', 'Back corners'),
    edges: choice('scan-cond-back-edges', 'Back edges'),
    surface: choice('scan-cond-back-surface', 'Back surface'),
  };
  condition.append(
    legend, condNote, centering,
    frontNotes.corners, frontNotes.edges, frontNotes.surface,
    backNotes.corners, backNotes.edges, backNotes.surface,
  );

  const limits = document.createElement('p');
  limits.className = 'note';
  limits.append(document.createTextNode('English text only. Stylized titles, foils, and non-English cards often read wrong. The loaded list is the deal list in this app, not the full Yu-Gi-Oh or Magic catalog. PSA 5 through PSA 8 stay unavailable unless scan/verified-prices.json has a sourced figure. Market shards that were not exported stay unavailable. '));
  const more = document.createElement('a');
  more.href = 'scan/LIMITATIONS.md';
  more.textContent = 'Full limitations';
  limits.append(more);

  const infoSheet = document.createElement('div');
  infoSheet.id = 'scan-info-sheet';
  infoSheet.hidden = true;
  const infoClose = button('Close', 'scan-info-close', true);
  infoSheet.append(infoClose, intro, introNote, s22, s22Note, limits);
  const capture = document.createElement('div');
  capture.className = 'scan-capture';
  const tightNote = document.createElement('p');
  tightNote.id = 'scan-tight-note';
  tightNote.textContent = 'Zoom out or turn upright to frame the card. Shutter and gallery still work.';
  const align = document.createElement('p');
  align.id = 'scan-align';
  align.textContent = 'Align the card in the frame.';
  capture.append(top, finder, align, step, priceLimitLive, tightNote, blocked, thumbs, camBar, infoSheet, frontFile, backFile);
  const fresh = document.createElement('p');
  fresh.id = 'scan-freshness';
  fresh.className = 'note';
  fresh.hidden = true;
  const health = (typeof window !== 'undefined' && window.D && window.D.health) || {};
  if (health.freshness && health.freshness !== 'current') {
    fresh.hidden = false;
    fresh.textContent = health.freshness_note || 'Prices are not current. Stale and failed checks are not buys.';
  }
  const panel = document.createElement('div');
  panel.className = 'scan-panel';
  panel.append(
    fresh,
    frontNote, autoCenter, frontManual.note, backNote, backAuto, backManual.note, retakes, backQualityBtn, backQuality,
    controls, suggestNote, suggestBtn, qualityBtn, frontQuality, edgesHost, tiltHost, artHost, defectHost,
    readRow, progress, labeled('Text from the photo. Edit it if it is wrong.', textArea), rematch,
    summary, labeled('Or search the loaded list', search), results, clearBtn,
    identity, psa, sold, asks, priceLimit, prices, chartCard, gauges, condition,
  );
  const layout = document.createElement('div');
  layout.className = 'scan-layout';
  layout.append(capture, panel);
  const deck = document.createElement('div');
  deck.id = 'scan-deck';
  deck.hidden = true;
  const sheets = {};
  for (const id of ['scan-search-sheet', 'scan-match', 'scan-card', 'scan-collection', 'scan-guide']) {
    const node = document.createElement('div');
    node.id = id;
    node.hidden = true;
    sheets[id] = node;
    deck.append(node);
  }
  const code = document.createElement('input');
  code.id = 'scan-code';
  code.placeholder = 'Name or set code';
  const lookupRow = document.createElement('div');
  const lookupBtn = document.createElement('button');
  lookupBtn.type = 'button';
  lookupBtn.id = 'scan-lookup';
  lookupBtn.textContent = 'Look up';
  lookupRow.append(code, lookupBtn);
  sheets['scan-search-sheet'].append(game, lookupRow);
  matchCard(sheets['scan-match'], null, null);
  const gray = new Float32Array(500 * 700);
  gray.fill(140);
  const sampleGrade = gradePhoto({
    front: { flattened: true, marks: gradeSide(gray, 500, 700, 'Centering: 55.0/45.0 left/right. 50.0/50.0 top/bottom.', true) },
    back: null,
    frontBack: true,
  });
  cardScreen(sheets['scan-card'], { name: 'No card open', grade: sampleGrade, grades: {} });
  let savedPrints = [];
  try { savedPrints = JSON.parse(localStorage.getItem('carddeals-coll-v1') || '[]'); } catch { savedPrints = []; }
  collectionList(sheets['scan-collection'], savedPrints);
  const feedNote = document.createElement('p');
  feedNote.id = 'scan-feed-note';
  sheets['scan-guide'].append(feedNote);
  const tabs = document.createElement('div');
  tabs.id = 'scan-tabs';
  tabs.setAttribute('role', 'tablist');
  const tabFor = { search: 'scan-search-sheet', match: 'scan-match', collection: 'scan-collection', prices: 'scan-guide', card: 'scan-card' };
  let lastMatch = null;
  function setZoom(scale, on, off) {
    video.style.transform = `scale(${scale})`;
    on.classList.add('on');
    off.classList.remove('on');
  }
  async function toggleTorch() {
    const track = video.srcObject && video.srcObject.getVideoTracks && video.srcObject.getVideoTracks()[0];
    if (!track || !track.applyConstraints) return;
    const next = torch.getAttribute('aria-pressed') !== 'true';
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      torch.setAttribute('aria-pressed', next ? 'true' : 'false');
    } catch { torch.setAttribute('aria-pressed', 'false'); }
  }
  async function lookUpCode() {
    const input = document.getElementById('scan-code');
    const printed = (input && input.value || '').trim();
    const { lookupSetCode, cadRate } = await import('./feeds.js');
    const rows = await lookupSetCode(printed);
    const rate = await cadRate();
    if (rows && rows.error) {
      matchCard(sheets['scan-match'], null, null);
      showDeck('match');
      return;
    }
    lastMatch = (rows && rows[0]) || null;
    matchCard(sheets['scan-match'], lastMatch, rate);
    section.dispatchEvent(new CustomEvent('scan-official', { detail: (lastMatch && lastMatch.image) || '' }));
    if (lastMatch) {
      cardScreen(sheets['scan-card'], {
        name: lastMatch.name,
        setName: lastMatch.setName,
        code: lastMatch.code,
        number: lastMatch.number || lastMatch.code,
        rarity: lastMatch.rarity,
        language: 'English',
        finish: lastMatch.finish || '',
        image: lastMatch.image,
        text: lastMatch.text,
        grade: sampleGrade,
        grades: lastMatch.price == null ? {} : {
          guide: {
            price: lastMatch.price,
            cad: rate && rate.rate ? lastMatch.price * rate.rate : null,
            source: 'YGOPRODeck set price',
          },
        },
      });
    }
    showDeck('match');
  }
  function saveMatch() {
    if (!lastMatch) return;
    const row = {
      name: lastMatch.name,
      code: lastMatch.code,
      usd: lastMatch.price,
      setName: lastMatch.setName,
      rarity: lastMatch.rarity,
    };
    const current = JSON.parse(localStorage.getItem('carddeals-coll-v1') || '[]');
    current.unshift(row);
    localStorage.setItem('carddeals-coll-v1', JSON.stringify(current));
    collectionList(sheets['scan-collection'], current);
  }
  async function refreshCollection() {
    const rows = JSON.parse(localStorage.getItem('carddeals-coll-v1') || '[]');
    const { lookupSetCode } = await import('./feeds.js');
    const result = await refreshSaved(rows, async (row) => {
      const found = await lookupSetCode(row.code || '');
      if (!found || found.error) return { error: true };
      const hit = found.find((item) => item.code === row.code) || found[0];
      return hit ? { price: hit.price } : { error: true };
    });
    localStorage.setItem('carddeals-coll-v1', JSON.stringify(result.rows));
    collectionList(sheets['scan-collection'], result.rows);
  }
  async function loadPrices() {
    const host = sheets['scan-guide'];
    if (host.dataset.loaded === '1') return;
    host.dataset.loaded = '1';
    const note = document.getElementById('scan-feed-note');
    const { loadStapleFeed, cadRate } = await import('./feeds.js');
    const result = await loadStapleFeed();
    const rate = await cadRate();
    if (!result || result.error) {
      if (note) note.textContent = FEED_FAIL;
      return;
    }
    const list = document.createElement('div');
    for (const item of result.items) {
      const guide = formatGuide(item.price, rate && rate.rate, rate && rate.date);
      const line = document.createElement('p');
      line.textContent = `${item.name} · ${item.code || ''} · ${guide.cadText} · ${guide.usdText}`;
      if (guide.note) line.textContent += ` ${guide.note}`;
      list.append(line);
    }
    if (note) host.insertBefore(list, note);
  }
  function showDeck(id) {
    const sheet = id !== 'scan';
    deck.hidden = !sheet;
    section.classList.toggle('scan-sheet', sheet);
    deck.classList.toggle('cd-theme', id === 'match' || id === 'card');
    for (const node of deck.children) node.hidden = node.id !== tabFor[id];
    for (const tab of tabs.children) tab.classList.toggle('on', tab.id === `scan-tab-${id}`);
    if (id === 'prices') loadPrices();
  }
  lookupBtn.addEventListener('click', () => lookUpCode());
  sheets['scan-collection'].addEventListener('click', (event) => {
    if (event.target && event.target.id === 'scan-refresh') refreshCollection();
  });
  sheets['scan-card'].addEventListener('click', (event) => {
    if (event.target && event.target.id === 'scan-done') showDeck('scan');
  });
  sheets['scan-match'].addEventListener('click', (event) => {
    if (event.target && event.target.id === 'scan-add-card') saveMatch();
  });
  zoomHalf.addEventListener('click', () => setZoom(0.5, zoomHalf, zoomOne));
  zoomOne.addEventListener('click', () => setZoom(1, zoomOne, zoomHalf));
  torch.addEventListener('click', () => toggleTorch());
  const tabIcons = {
    search: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="M15 15l5 5"/></svg>',
    scan: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/></svg>',
    collection: '<svg viewBox="0 0 24 24"><path d="M4 7h16v12H4zM8 7V4h8v3"/></svg>',
    prices: '<svg viewBox="0 0 24 24"><path d="M5 16l4-5 3 3 7-8"/></svg>',
    card: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="2"/></svg>',
  };
  for (const [id, label] of [['search', 'Search'], ['scan', 'Scan'], ['collection', 'Collection'], ['prices', 'Prices'], ['card', 'Card']]) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = `scan-tab-${id}`;
    const icon = document.createElement('span');
    icon.className = 'scan-tab-icon';
    icon.innerHTML = tabIcons[id];
    const text = document.createElement('span');
    text.textContent = label;
    tab.append(icon, text);
    tab.addEventListener('click', () => showDeck(id));
    tabs.append(tab);
  }
  tabs.querySelector('#scan-tab-scan').classList.add('on');
  section.append(h, layout, deck, tabs);
  return {
    frontFile,
    backFile,
    frontCam,
    gallery,
    next,
    close,
    blocked,
    thumbs,
    torch,
    infoBtn,
    infoClose,
    infoSheet,
    game,
    camera,
    chartCard,
    modeFront,
    modeBoth,
    step,
    frontNote,
    backNote,
    autoCenter,
    backAuto,
    frontManual,
    backManual,
    frontGuideHost,
    backGuideHost,
    camMsg,
    camRetry,
    video,
    align,
    tightNote,
    liveEdge,
    setCaptureProgress: captureRing.set,
    stopLive: null,
    camStop,
    stream: null,
    camSlot: 'front',
    outline,
    viewport,
    stage,
    map,
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
    edgesHost,
    tiltHost,
    artHost,
    defectHost,
    defectLayer,
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
    psa,
    sold,
    asks,
    fresh,
    prices,
    chart,
    chartTitle,
    chartNote,
    gauges,
    centering,
    retakes,
    backView,
    backStage,
    backMap,
    backQualityBtn,
    backQuality,
    notes: { front: unwrap(frontNotes), back: unwrap(backNotes) },
  };
}

function unwrap(groups) {
  return {
    corners: groups.corners.querySelector('select'),
    edges: groups.edges.querySelector('select'),
    surface: groups.surface.querySelector('select'),
  };
}

function fileInput(id) {
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/jpeg,image/png,image/webp,image/gif';
  file.id = id;
  file.className = 'scan-file';
  file.setAttribute('aria-label', id.includes('back') ? 'Upload a back photo' : 'Upload a front photo');
  return file;
}

function modeButton(label, id, on) {
  const el = document.createElement('button');
  el.type = 'button';
  el.id = id;
  el.className = on ? 'on' : '';
  el.setAttribute('aria-pressed', on ? 'true' : 'false');
  el.textContent = label;
  return el;
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

function choice(id, label) {
  const select = document.createElement('select');
  select.id = id;
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
