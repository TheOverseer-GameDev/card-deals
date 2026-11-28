/**
 * Card outlines the guide can draw. Shipped Yu-Gi-Oh and Magic sizes stay
 * 59×86 and 63×88. The other classes are provisional until a caliper sample
 * of at least 10 cards locks them.
 */
export const SIZE_CLASSES = {
  yugioh: { id: 'yugioh', w: 59, h: 86, provisional: false },
  'standard-tcg': { id: 'standard-tcg', w: 63, h: 88, provisional: false },
  sports: { id: 'sports', w: 63.5, h: 88.9, provisional: true },
  'vintage-1952': { id: 'vintage-1952', w: 66.7, h: 95.3, provisional: true },
  'tobacco-t206': { id: 'tobacco-t206', w: 36.5, h: 66.7, provisional: true },
  'caramel-e90': { id: 'caramel-e90', w: 38.1, h: 69.9, provisional: true },
  'oversized-5x7': { id: 'oversized-5x7', w: 127, h: 177.8, provisional: true },
  'cabinet-t3': { id: 'cabinet-t3', w: 146.1, h: 203.2, provisional: true },
};

export function classForSize(width, height) {
  let best = null;
  let bestDist = Infinity;
  for (const row of Object.values(SIZE_CLASSES)) {
    const dist = Math.hypot(row.w - width, row.h - height);
    if (dist < bestDist) {
      best = row;
      bestDist = dist;
    }
  }
  if (!best || bestDist > 1.5) return { id: 'custom', w: width, h: height, provisional: true };
  return best;
}

export { guideForSelect } from './games.js';
