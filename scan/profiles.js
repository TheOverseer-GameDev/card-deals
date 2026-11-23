/**
 * Guide sizes for the games the scanner already frames.
 * The numbers start as the shipped guide and are replaced by the profile file when it loads.
 */
export const GUIDE = {
  yugioh: { w: 59, h: 86 },
  mtg: { w: 63, h: 88 },
};

export async function refreshGuides(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return GUIDE;
  for (const id of Object.keys(GUIDE)) {
    try {
      const res = await fetchImpl(`registry/profiles/${id}.json`);
      if (!res || !res.ok) continue;
      const profile = await res.json();
      const size = profile && profile.size_mm;
      if (!size || !Number.isFinite(size.w) || !Number.isFinite(size.h)) continue;
      GUIDE[id] = { w: size.w, h: size.h };
    } catch {
      /* The shipped size stays. */
    }
  }
  return GUIDE;
}
