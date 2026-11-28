import { straighten } from '../../scan/pipeline.js';
import { readCentering } from '../../scan/core/center.js';

function centeringOf(label, rgba) {
  const eligible = label.gate === 'ok' && label.pxPerMm >= 8 && Math.abs(label.tiltDeg) <= 3;
  if (!eligible) return null;
  const got = readCentering(rgba, label.image.w, label.image.h);
  if (!got || got.state !== 'ok' || !Number.isFinite(got.lr)) return null;
  return got;
}

/** The scanner as it is on this commit. No new engine behaviour. */
export function current(label, rgba) {
  const started = performance.now();
  try {
    const flat = straighten(rgba, label.image.w, label.image.h);
    return {
      threw: false,
      gate: flat && flat.flattened ? 'ok' : 'NO_CARD',
      quad: flat && flat.quad ? flat.quad : null,
      centering: centeringOf(label, rgba),
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
