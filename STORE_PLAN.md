# Card Deals store plan

Card Deals ships as a Google Play app and an Apple App Store app. The page in this repo is the app UI. A browser or installed PWA is only the dev preview. Do not create store accounts, signing keys, or listings from this file, and do not publish.

## What the web code already does

`platform.js` is the shell adapter.

- Native shell when `Capacitor.isNativePlatform()`, `Capacitor.isNative`, or Cordova is present. Otherwise `document.documentElement.dataset.shell` is `preview`.
- Safe areas use `env(safe-area-inset-*)` on the header, intro skip, scan chrome, and tab bar. A native shell forces the phone layout and hides the PC-view control.
- Android back uses `App.addListener('backButton')`. It closes the top screen (scan info, then scan) and exits only when nothing is open. iOS swipe-back uses the same stack through `history`.
- Haptics: `Haptics.impact` on capture and `Haptics.notification` when a grade is revealed. The preview falls back to `navigator.vibrate`.
- Status bar: `theme-color` plus `StatusBar` overlay, dark or light with the theme. The splash stays up until `#app-intro` is on screen, then `SplashScreen.hide`.
- Outbound `http` links in the shell open with the Browser plugin when it exists.
- Intro audio still comes from `intro-audio.js`. Native plays it at launch. The preview waits for a tap. Sound off, silent, and media volume `0` stay quiet.

`scan/camera-source.js` is the camera path.

- If `Capacitor.Plugins.CameraPreview` has `start` and `capture`, that is the camera. It starts behind the webview (`toBack: true`), with `storeToFile: false` and `saveToGallery: false`.
- The shutter copies one frame into a canvas in memory and then the existing on-device grade. The bytes are not stored in `localStorage` and are not uploaded.
- If the plugin is missing or `start` throws, the preview uses `getUserMedia`. That path is for the browser only.

Photos stay on the phone. The info sheet says so.

## Wrapper setup

The draft wrapper is in this repo. It is not signed and it is not published.

1. Capacitor `webDir` is `www`, filled from this app by `node native/sync-web.mjs`. Release config does not set `server.url`.
2. Add Android and iOS projects. The WebView background is transparent so the camera preview shows behind the guide.
3. Copy `store/icon-1024.png`, `store/adaptive-foreground.png`, `store/adaptive-background.png`, and `store/splash.png` into the native icon and splash slots. `icon-192.png` and `icon-512.png` are the same original mark for the preview.
4. Confirm a cold launch: splash, then the 2 second intro, then home. Sound on plays the sting. Sound off and silent mode do not.
5. Confirm the rear camera preview, shutter, grade, and retake never leave the device. Airplane mode still opens a bundled scan.

## Plugins

Add only these, when the wrapper is created:

- `@capacitor/app` for Android back and iOS state
- `@capacitor/splash-screen`
- `@capacitor/status-bar`
- `@capacitor/haptics`
- `@capacitor/browser` for a listing the user taps
- A camera preview plugin that can start a live preview and return one frame without saving it to the gallery (`CameraPreview` in `scan/camera-source.js`)

Do not add analytics, ads, crash reporters, or any plugin that receives a photo. Do not add a microphone permission. The sting is generated in `intro-audio.js` and needs no audio file.

## Permissions

iOS `Info.plist` usage strings:

- `NSCameraUsageDescription`: Card Deals uses the camera to look at a card on this iPhone. The photo stays on the device.
- `NSPhotoLibraryUsageDescription`: Card Deals can open a card photo you choose. The photo stays on the device.

No location, tracking, microphone, contacts, or Bluetooth.

Android:

- `android.permission.CAMERA`
- Read-photos permission only for the gallery pick, and only the photo the user chooses
- No gallery write

`AndroidManifest` and `Info.plist` are created with the wrapper. Paste the strings above. Do not request permissions at first launch; ask when the user opens Scan.

## Privacy and data safety

Listing text for both stores:

Card Deals does not collect personal data. Card photos are graded on the device and are not uploaded. There is no account. Price guides that ship inside the app are not a photo of your card. Opening a shop listing leaves the app only when you tap that link.

Play Data safety: data collected, no; data shared, no; photos are not collected. App Store privacy nutrition label: data not collected. The privacy policy page, when we have a URL, should say the same thing and nothing broader.

## Age rating

The app shows card prices and a photo grade estimate. It is not a game, not gambling, and not a marketplace checkout. No user chat, no unrestricted web, no third-party brands. Answer the questionnaires for the lowest age band that allows a shopping-information reference tool (Play Everyone, App Store 4+). The grade is an estimate, not an official grade from any grading company.

## No third-party IP

Card backs in the rain, the intro sting, and the app icon are original. Do not add game logos, card photos from a publisher, franchise music, or a grading company's marks. The wordmarks Yu-Gi-Oh and Magic may appear as the names of the lists the app ranks. They are not logos.

## Icons and splash

The mark is a plain card back: brown frame, tan field, five original dots. No letters and no game symbol.

- `icon-192.png`, `icon-512.png` for the preview manifest
- `store/apple-touch-icon.png` (180) and `store/icon-1024.png` for Apple
- `store/adaptive-foreground.png` and `store/adaptive-background.png` (`#06080F`) for Android adaptive icons
- `store/splash.png` is the navy field the intro opens on. The native splash hides when the intro is visible (`platform.js` `handoffSplash`)

## Signing

When we ship, and not before:

- Android: one upload key in Play App Signing. The keystore stays out of git. Build an AAB, not an APK, for the store track.
- Apple: an App Store distribution certificate and a provisioning profile for this bundle id. Archive in Xcode or with the Capacitor iOS project. Upload with the Transporter or Xcode, to TestFlight first.

No key, password, or account is stored in this repo.

## Play listing checklist

- App name Card Deals, default language English
- Short description and full description from the privacy text above, plus what the scan estimates
- Icon 512 and feature graphic that use this original mark only
- Phone screenshots, 9:16, of home, scan, and the grade. No publisher card art
- Camera permission declaration matching the strings above
- Data safety form: no collection
- Content rating questionnaire
- Ads: no
- Target API level current Play requirement
- Internal testing track before any production release

## App Store checklist

- Name, subtitle, description, keywords without other companies' trademarks used as our brand
- 1024 icon, iPhone 6.7 inch and 6.1 inch screenshots
- Privacy nutrition label: data not collected
- Age rating 4+
- Camera usage string shown above
- Export compliance: the app only uses HTTPS that the system provides, no extra encryption
- TestFlight before App Store review
- Review notes: photos stay on device; the browser preview is not the submitted binary

## Scanner work that continues on this shell

Outline, centering, live coaching, and the phone overlay stay on-device. Live frames come from the native preview or, in the browser only, from the camera element. A check that cannot see still says so. Nothing in those phases may upload a photo or add a web-only control.
