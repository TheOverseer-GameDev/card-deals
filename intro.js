/**
 * One short original intro per cold launch.
 * The sting is synthesized here. Nothing is fetched.
 * The scanner boots underneath and is not asked to wait.
 */
(function () {
  const FULL_MS = 2000;
  const FADE_MS = 700;
  const SOUND_KEY = 'cd-sound';
  if (window.__introPlayed) return;
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
  const stage = document.createElement('div');
  stage.className = 'intro-stage';
  const card = document.createElement('canvas');
  card.className = 'intro-card';
  card.width = 180;
  card.height = 262;
  const sheen = document.createElement('div');
  sheen.className = 'intro-sheen';
  const burst = document.createElement('div');
  burst.className = 'intro-burst';
  const mark = document.createElement('div');
  mark.className = 'intro-mark';
  mark.textContent = 'Card Deals';
  const tap = document.createElement('button');
  tap.type = 'button';
  tap.id = 'intro-tap';
  tap.textContent = 'Tap for sound';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.id = 'intro-skip';
  skip.textContent = 'Skip';
  stage.append(card, sheen, burst, mark, tap);
  root.append(skip, stage);
  document.body.append(root);
  drawBack(card.getContext('2d'), card.width, card.height);

  let audio = null;
  let ended = false;
  let timer = 0;
  const started = performance.now();
  window.__intro = { audio: false, started, duration, reduced: reduce };

  function scheduleSting(ctx, when) {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, when);
    master.gain.exponentialRampToValueAtTime(0.16, when + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, when + 1.65);
    master.connect(ctx.destination);
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 2 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      const t = when + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + 0.46);
    });
    const count = Math.floor(ctx.sampleRate * 0.35);
    const buffer = ctx.createBuffer(1, count, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < count; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / count);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(420, when);
    filter.frequency.exponentialRampToValueAtTime(2200, when + 0.3);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.05, when);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.36);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(when);
    noise.stop(when + 0.36);
  }

  window.__scheduleSting = scheduleSting;

  function playSting() {
    if (!soundOn() || window.__intro.audio || ended) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio = new Ctx();
    scheduleSting(audio, audio.currentTime + 0.02);
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

  tap.hidden = !soundOn();
  tap.addEventListener('click', (event) => {
    event.stopPropagation();
    playSting();
  });
  skip.addEventListener('click', (event) => {
    event.stopPropagation();
    finish();
  });
  root.addEventListener('click', () => {
    if (soundOn() && !window.__intro.audio) {
      playSting();
      return;
    }
    finish();
  });

  const sound = document.getElementById('sound');
  if (sound) {
    sound.textContent = soundOn() ? 'Sound on' : 'Sound off';
    sound.addEventListener('click', () => setSound(!soundOn()));
  }

  requestAnimationFrame(() => root.classList.add('is-run'));
  timer = setTimeout(finish, duration + 40);
}());

function drawBack(ctx, w, h) {
  ctx.fillStyle = '#6e4b2a';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 16);
  ctx.fill();
  ctx.fillStyle = '#c4a574';
  ctx.beginPath();
  ctx.roundRect(14, 14, w - 28, h - 28, 12);
  ctx.fill();
  const colors = ['#f4f1e6', '#2d6cb5', '#1c1c1c', '#c4473a', '#2f8a49'];
  colors.forEach((color, i) => {
    const ang = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(w / 2 + Math.cos(ang) * 28, h / 2 + Math.sin(ang) * 36, 12, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
}
