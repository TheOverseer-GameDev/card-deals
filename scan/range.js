/**
 * A photo grade range from centering, corners, edges, and surface.
 * A single grade is never promised. Poor photos widen the range and say so.
 */

export function estimateRange(grade, photo) {
  if (!grade || !Array.isArray(grade.range) || grade.range.length < 2) {
    return {
      low: null,
      high: null,
      confidence: 'none',
      text: 'Grade range: Unavailable.',
      notes: ['The photo did not produce centering, corner, edge, and surface scores. No grade is estimated.'],
    };
  }
  let low = grade.range[0];
  let high = grade.range[1];
  const notes = ['This is a range from the photo scores for centering, corners, edges, and surface. It is not a PSA grade and not a single promised grade.'];
  const poor = !!(photo && photo.poor);
  if (poor) {
    low = Math.max(1, low - 1);
    notes.push('Low confidence. The photo is dark, blurry, or glaring, so this range is wider and less reliable.');
  }
  if (low === high) {
    low = Math.max(1, high - 1);
    notes.push('A single grade is not shown.');
  }
  return {
    low,
    high,
    confidence: poor ? 'low' : 'limited',
    text: `Estimate: PSA ${low}–${high}.`,
    notes,
  };
}
