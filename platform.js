/**
 * Native shell for the Android and iOS app.
 * The browser is only a preview: it does not pretend to be the store build.
 * Photos are never sent anywhere from here.
 */
(function (global) {
  function nativeShell() {
    const cap = global.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return true;
    if (cap && cap.isNative === true) return true;
    if (global.cordova) return true;
    return false;
  }

  function plugins() {
    const cap = global.Capacitor;
    return (cap && cap.Plugins) || {};
  }

  const stack = [];

  function push(layer) {
    if (!layer || typeof layer.close !== 'function') return;
    stack.push(layer);
  }

  function drop(id) {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i].id === id) stack.splice(i, 1);
    }
  }

  function back() {
    const layer = stack.pop();
    if (!layer) return false;
    try { layer.close(); } catch { /* The screen was already closed. */ }
    return true;
  }

  function applyChrome() {
    const root = document.documentElement;
    const native = nativeShell();
    root.dataset.shell = native ? 'native' : 'preview';
    if (native) {
      root.classList.add('phone');
      root.classList.remove('desktop');
    }
    const light = root.dataset.theme === 'light';
    const color = light ? '#F3F4F9' : '#06080F';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = color;
    const bar = plugins().StatusBar;
    if (!bar) return;
    if (typeof bar.setBackgroundColor === 'function') bar.setBackgroundColor({ color });
    if (typeof bar.setStyle === 'function') bar.setStyle({ style: light ? 'LIGHT' : 'DARK' });
    if (typeof bar.setOverlaysWebView === 'function') bar.setOverlaysWebView({ overlay: true });
  }

  function haptic(kind) {
    const kit = plugins().Haptics;
    if (kit && kind === 'reveal' && typeof kit.notification === 'function') {
      kit.notification({ type: 'SUCCESS' });
      return 'native';
    }
    if (kit && typeof kit.impact === 'function') {
      kit.impact({ style: kind === 'capture' ? 'MEDIUM' : 'LIGHT' });
      return 'native';
    }
    try {
      if (navigator.vibrate) {
        navigator.vibrate(kind === 'reveal' ? [10, 30, 16] : 18);
        return 'vibrate';
      }
    } catch { /* This device has no vibrator. */ }
    return 'none';
  }

  let splashHidden = false;

  function handoffSplash() {
    if (splashHidden) return;
    splashHidden = true;
    global.__splashHandoff = performance.now();
    document.documentElement.dataset.splash = 'gone';
    const splash = plugins().SplashScreen;
    if (splash && typeof splash.hide === 'function') splash.hide({ fadeOutDuration: 180 });
  }

  function bindSystemBack() {
    const app = plugins().App;
    if (app && typeof app.addListener === 'function') {
      app.addListener('backButton', () => {
        if (!back() && typeof app.exitApp === 'function') app.exitApp();
      });
    }
    if (!nativeShell()) return;
    try { history.pushState({ cd: 'shell' }, ''); } catch { /* History is unavailable. */ }
    global.addEventListener('popstate', () => {
      back();
      try { history.pushState({ cd: 'shell' }, ''); } catch { /* Keep this page in the webview. */ }
    });
  }

  function bindOutbound() {
    document.addEventListener('click', (event) => {
      if (!nativeShell()) return;
      const link = event.target && event.target.closest && event.target.closest('a[href]');
      if (!link) return;
      const browser = plugins().Browser;
      if (!browser || typeof browser.open !== 'function') return;
      if (!/^https?:/i.test(link.href)) return;
      event.preventDefault();
      browser.open({ url: link.href });
    });
  }

  function boot() {
    applyChrome();
    bindSystemBack();
    bindOutbound();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.CardDealsPlatform = {
    nativeShell,
    applyChrome,
    push,
    drop,
    back,
    haptic,
    handoffSplash,
    layers: () => stack.map((item) => item.id),
  };
}(window));
