/**
 * Places visible findings on the straightened card.
 * Unchecked areas are named, not drawn as damage.
 */
export function buildDefectMap(edgeReports, tiltReport) {
  const marks = [];
  const unchecked = [];
  for (const report of edgeReports || []) {
    for (const crop of report.crops || []) {
      if (!crop.trusted) {
        unchecked.push(crop.label);
        continue;
      }
      if (!crop.flag || crop.flag === 'clear') continue;
      marks.push({
        id: crop.id,
        x: crop.x,
        y: crop.y,
        w: crop.w,
        h: crop.h,
        label: crop.label,
        detail: crop.text,
        seen: true,
      });
    }
  }
  if (tiltReport && tiltReport.status === 'marked' && tiltReport.box) {
    for (const finding of tiltReport.findings || []) {
      marks.push({
        id: `tilt-${finding.kind}`,
        x: tiltReport.box.x,
        y: tiltReport.box.y,
        w: tiltReport.box.w,
        h: tiltReport.box.h,
        label: finding.kind === 'print-line' ? 'Possible print lines' : 'Possible surface mark',
        detail: finding.text,
        seen: true,
      });
    }
  }
  const parts = ['Marks are what these photos show. They are not a grade, and they do not show the card is genuine.'];
  if (unchecked.length) parts.push('Some close-ups were too dark or too glary to trust, so they are not marked as damage.');
  if (!marks.length) parts.push('Nothing on the checked crops stood out.');
  return { marks, note: parts.join(' ') };
}
