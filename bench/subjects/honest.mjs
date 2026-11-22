/** Reports the label. Used to prove a metric can pass, and that canaries cannot. */

export function honest(label) {
  const refused = label.gate !== 'ok';
  return {
    threw: false,
    gate: label.gate,
    quad: refused ? null : label.quad,
    centering: refused ? null : { state: 'ok', lr: label.centering.lr, tb: label.centering.tb },
    clearClaim: false,
    defectInvented: false,
    ms: 1,
  };
}
