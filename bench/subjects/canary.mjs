/** Subjects that must fail. They are the discrimination check, not a scanner. */

export function alwaysOk() {
  return {
    threw: false,
    gate: 'ok',
    quad: null,
    centering: { state: 'ok', lr: 50, tb: 50 },
    clearClaim: true,
    defectInvented: true,
    ms: 0,
  };
}

export function always5050() {
  return {
    threw: false,
    gate: 'ok',
    quad: null,
    centering: { state: 'ok', lr: 50, tb: 50 },
    clearClaim: false,
    defectInvented: false,
    ms: 0,
  };
}
