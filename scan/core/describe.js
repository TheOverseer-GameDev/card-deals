/** The only place a check may say nothing was seen. It refuses an unseen area. */
export function describe(result) {
  if (!result || result.state !== 'ok' || !(Number(result.coverage) >= 0.9)) {
    throw new Error('An area that was not measured cannot be described as clear.');
  }
  return result.note || 'This area was measured. No issue stood out.';
}
