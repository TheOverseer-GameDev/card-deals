/**
 * Intro sting for the browser and for a future native shell.
 * The tone is synthesized here. No samples are fetched.
 * A native shell may play it at launch. The browser waits for a tap.
 */
(function (global) {
  const SOUND_KEY = 'cd-sound';

  function nativeShell() {
    const platform = global.CardDealsPlatform;
    if (platform && typeof platform.nativeShell === 'function') return platform.nativeShell();
    const cap = global.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return true;
    if (cap && cap.isNative === true) return true;
    if (global.cordova) return true;
    return false;
  }

  function soundOn() {
    try { return global.localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
  }

  function outputAllowed() {
    if (!soundOn()) return false;
    const device = global.CardDealsNative || {};
    if (device.silent === true) return false;
    if (typeof device.volume === 'number' && device.volume <= 0) return false;
    return true;
  }

  function hit(ctx, master, when, freq, hold, level) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + hold);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + hold + 0.02);
  }

  function scheduleSting(ctx, when) {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, when);
    master.gain.exponentialRampToValueAtTime(0.2, when + 0.04);
    master.gain.exponentialRampToValueAtTime(0.0001, when + 1.55);
    master.connect(ctx.destination);
    const count = Math.floor(ctx.sampleRate * 0.42);
    const buffer = ctx.createBuffer(1, count, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < count; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / count);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(280, when);
    filter.frequency.exponentialRampToValueAtTime(1800, when + 0.42);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, when);
    noiseGain.gain.exponentialRampToValueAtTime(0.08, when + 0.2);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.48);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(when);
    noise.stop(when + 0.5);
    [392, 523.25, 659.25].forEach((freq) => hit(ctx, master, when + 0.52, freq, 0.28, 0.2));
    [523.25, 783.99, 1046.5].forEach((freq) => hit(ctx, master, when + 1.05, freq, 0.36, 0.24));
  }

  function play(ctx) {
    if (!outputAllowed() || !ctx) return false;
    scheduleSting(ctx, ctx.currentTime + 0.02);
    return true;
  }

  global.CardDealsAudio = { nativeShell, soundOn, outputAllowed, scheduleSting, play };
}(window));
