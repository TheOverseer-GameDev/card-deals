/**
 * Camera for the store app.
 * A native preview plugin is the capture path. The browser camera is only the dev preview.
 * Frames stay in memory on this phone. This module never uploads a photo.
 */

export function captureKind(scope) {
  const cap = scope && scope.Capacitor;
  const preview = cap && cap.Plugins && cap.Plugins.CameraPreview;
  if (preview && typeof preview.start === 'function' && typeof preview.capture === 'function') return 'native';
  const media = scope && scope.navigator && scope.navigator.mediaDevices;
  if (media && typeof media.getUserMedia === 'function') return 'web';
  return 'none';
}

export async function startNativePreview(scope, facing) {
  const preview = scope.Capacitor.Plugins.CameraPreview;
  await preview.start({
    position: facing === 'user' ? 'front' : 'rear',
    toBack: true,
    storeToFile: false,
    saveToGallery: false,
    disableAudio: true,
    enableZoom: true,
  });
  return {
    kind: 'native',
    async capture() {
      const shot = await preview.capture({ quality: 92, saveToGallery: false });
      const raw = shot && (shot.value || shot.base64 || shot.data || '');
      if (!raw) throw new Error('The camera returned an empty frame.');
      return String(raw).replace(/^data:image\/\w+;base64,/, '');
    },
    async stop() {
      if (typeof preview.stop === 'function') await preview.stop();
    },
  };
}
