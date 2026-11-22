# Native wrapper notes

The app is still a web app. This file is the later step for a Play Store shell. Do not add that shell until the scanner work is ready to ship.

## What is already in the web app

`intro-audio.js` is the only place that starts the intro sting. `intro.js` asks it whether this launch is a native shell, whether sound is allowed, and then calls `play`.

- Native shell: `window.Capacitor.isNativePlatform()` or `window.Capacitor.isNative` or `window.cordova`. The sting starts with the intro. No tap is required.
- Browser and installed PWA: the same sting waits for a tap. Autoplay stays blocked.
- Sound toggle: `localStorage` key `cd-sound` (`on` or `off`). Both shells use it. Off means no sting.
- Device silent and media volume: set `window.CardDealsNative` before `intro-audio.js` runs.

```js
window.CardDealsNative = { silent: false, volume: 1 };
```

`silent: true` or `volume: 0` skips the sting even if the in-app toggle is on. Any other volume is left to the device. The page does not change the system volume.

The tone is built with the Web Audio API in `CardDealsAudio.scheduleSting`. There is no audio file and no third-party sample. A shell that would rather play a file can render that function once with `OfflineAudioContext` and bundle the wav. Keep that render in our code so the file stays the same sting.

## Later Capacitor steps

1. Add Capacitor only when we choose to ship. Do not add it for scanner development.
2. Use one WebView that loads this same `index.html`. Do not fork the intro.
3. Set `window.CardDealsNative` from the native side before the page scripts run:
   - Android: `AudioManager.getRingerMode()` and `getStreamVolume(STREAM_MUSIC)`.
   - iOS: the silent switch and `AVAudioSession` output volume.
4. Let Web Audio play on the media stream so the hardware volume keys apply. Do not force a volume above the device.
5. Confirm a cold launch with sound on plays the sting at once, sound off stays quiet, and silent mode stays quiet.
6. Keep the browser tap path. A PWA install is not a native shell.

## Out of scope here

No Capacitor config, no Android or iOS project, and no store listing.
