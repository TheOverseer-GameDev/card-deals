/**
 * One short original intro per cold launch.
 * The sting is synthesized here. Nothing is fetched.
 * The scanner boots underneath and is not asked to wait.
 */
(function () {
  const FULL_MS = 2000;
  const FADE_MS = 700;
  const SOUND_KEY = 'cd-sound';
  if (window.__introPlayed) {
    if (window.CardDealsPlatform) window.CardDealsPlatform.handoffSplash();
    return;
  }
  window.__introPlayed = true;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduce ? FADE_MS : FULL_MS;

  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
  }
  function setSound(on) {
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* private mode keeps the choice for this tab */ }
    const button = document.getElementById('sound');
    if (button) button.textContent = on ? 'Sound on' : 'Sound off';
    if (!on) stopSting();
  }

  const root = document.createElement('div');
  root.id = 'app-intro';
  root.className = reduce ? 'is-reduced' : 'is-full';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Card Deals');
  const shake = document.createElement('div');
  shake.className = 'intro-shake';
  const stage = document.createElement('div');
  stage.className = 'intro-stage';
  const spin = document.createElement('div');
  spin.className = 'intro-spin';
  const face = document.createElement('div');
  face.className = 'intro-face';
  const card = document.createElement('canvas');
  card.className = 'intro-card';
  card.width = 180;
  card.height = 262;
  const sheen = document.createElement('div');
  sheen.className = 'intro-sheen';
  const holo = document.createElement('div');
  holo.className = 'intro-holo';
  face.append(card, sheen, holo);
  spin.append(face);
  const streak = document.createElement('div');
  streak.className = 'intro-streak';
  const glow = document.createElement('div');
  glow.className = 'intro-glow';
  const burst = document.createElement('div');
  burst.className = 'intro-burst';
  const shock = document.createElement('div');
  shock.className = 'intro-shock';
  const mark = document.createElement('div');
  mark.className = 'intro-mark';
  mark.textContent = 'Card Deals';
  const glint = document.createElement('div');
  glint.className = 'intro-glint';
  mark.append(glint);
  const sparks = [];
  for (let i = 0; i < 8; i += 1) {
    const spark = document.createElement('span');
    spark.className = 'intro-spark';
    spark.style.setProperty('--a', `${i * 45}deg`);
    sparks.push(spark);
  }
  const tap = document.createElement('button');
  tap.type = 'button';
  tap.id = 'intro-tap';
  tap.textContent = 'Tap for sound';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.id = 'intro-skip';
  skip.textContent = 'Skip';
  stage.append(streak, glow, burst, shock, spin, ...sparks, mark);
  shake.append(stage);
  root.append(skip, tap, shake);
  document.body.append(root);
  drawBack(card.getContext('2d'), card.width, card.height);
  if (window.CardDealsPlatform) window.CardDealsPlatform.handoffSplash();

  let audio = null;
  let ended = false;
  let timer = 0;
  const started = performance.now();
  const audioApi = window.CardDealsAudio;
  const shell = audioApi && audioApi.nativeShell() ? 'native' : 'browser';
  window.__intro = { audio: false, started, duration, reduced: reduce, shell };
  window.__scheduleSting = audioApi && audioApi.scheduleSting;

  function playSting() {
    if (!audioApi || window.__intro.audio || ended || !audioApi.outputAllowed()) return;
    if (shell === 'browser' && !window.__introGesture) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio = new Ctx();
    if (!audioApi.play(audio)) {
      audio.close().catch(() => {});
      audio = null;
      return;
    }
    window.__intro.audio = true;
    tap.hidden = true;
  }

  function stopSting() {
    if (audio) audio.close().catch(() => {});
    audio = null;
  }

  function finish() {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    stopSting();
    root.remove();
    window.__intro.ended = performance.now() - started;
  }

  tap.hidden = shell === 'native' || !soundOn();
  tap.addEventListener('click', (event) => {
    event.stopPropagation();
    window.__introGesture = true;
    playSting();
  });
  skip.addEventListener('click', (event) => {
    event.stopPropagation();
    finish();
  });
  root.addEventListener('click', () => {
    if (shell === 'browser' && soundOn() && !window.__intro.audio) {
      window.__introGesture = true;
      playSting();
      return;
    }
    finish();
  });
  if (shell === 'native') playSting();

  const sound = document.getElementById('sound');
  if (sound) {
    sound.textContent = soundOn() ? 'Sound on' : 'Sound off';
    sound.addEventListener('click', () => setSound(!soundOn()));
  }

  requestAnimationFrame(() => root.classList.add('is-run'));
  if (!window.__holdIntro && !reduce) {
    setTimeout(() => { if (!ended) root.classList.add('is-out'); }, 1860);
  }
  if (!window.__holdIntro) timer = setTimeout(finish, duration + 40);
}());

function drawBack(ctx, w, h) {
  ctx.fillStyle = '#07101f';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = '#24365c';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#10203a';
  ctx.beginPath();
  ctx.roundRect(12, 12, w - 24, h - 24, 12);
  ctx.fill();
  const cx = w / 2;
  const cy = h / 2 - 8;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#7C5CFF';
  ctx.fillRect(-28, -28, 56, 56);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = '#3DCEC2';
  ctx.lineWidth = 3;
  ctx.strokeRect(-34, -34, 68, 68);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(cx, cy - 46);
  ctx.lineTo(cx + 22, cy);
  ctx.lineTo(cx, cy + 46);
  ctx.lineTo(cx - 22, cy);
  ctx.closePath();
  ctx.fillStyle = '#1a3c6e';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#3DCEC2';
  ctx.stroke();
  ctx.fillStyle = '#F4F6FF';
  ctx.font = '700 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CD', cx, cy);
}
