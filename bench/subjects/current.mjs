import { straighten } from '../../scan/pipeline.js';

/** The scanner as it is on this commit. No new engine behaviour. */
export function current(label, rgba) {
  const started = performance.now();
  try {
    const flat = straighten(rgba, label.image.w, label.image.h);
    return {
      threw: false,
      gate: flat && flat.flattened ? 'ok' : 'NO_CARD',
      quad: flat && flat.quad ? flat.quad : null,
      centering: null,
      clearClaim: false,
      defectInvented: false,
      ms: performance.now() - started,
    };
  } catch {
    return {
      threw: true,
      gate: 'NO_CARD',
      quad: null,
      centering: null,
      clearClaim: false,
      defectInvented: false,
      ms: performance.now() - started,
    };
  }
}
