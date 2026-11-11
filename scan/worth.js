/**
 * Compare a grading fee with the stored price jump.
 * CAD is used when the figure is already CAD, or when a USD figure has a rate.
 * A missing price or fee stays Unavailable. Nothing is guessed.
 */

const GRADE_KEY = {
  5: 'psa5', 6: 'psa6', 7: 'psa7', 8: 'psa8', 9: 'psa9', 10: 'psa10',
};

export function toCad(amount, currency, rate) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (currency === 'CAD') return Math.round(value * 100) / 100;
  if (currency === 'USD' && Number(rate) > 0) return Math.round(value * Number(rate) * 100) / 100;
  return null;
}

function lineMoney(lines) {
  if (!Array.isArray(lines)) return null;
  for (const item of lines) {
    if (item && item.status !== 'unavailable' && Number(item.price) > 0 && item.currency) {
      return { price: Number(item.price), currency: item.currency };
    }
  }
  return null;
}

export function gradingWorth({ grades, low, high, feeCad, rate }) {
  const raw = lineMoney(grades && grades.ungraded);
  const rawCad = raw ? toCad(raw.price, raw.currency, rate) : null;
  const considered = [];
  if (Number.isFinite(low) && Number.isFinite(high)) {
    for (let grade = low; grade <= high; grade++) {
      const key = GRADE_KEY[grade];
      if (!key) continue;
      const money = lineMoney(grades && grades[key]);
      considered.push({ grade, cad: money ? toCad(money.price, money.currency, rate) : null });
    }
  }
  const priced = considered.filter((item) => item.cad != null);
  const missing = considered.filter((item) => item.cad == null).map((item) => item.grade);
  const parts = [];
  parts.push(rawCad == null ? 'Ungraded price: Unavailable.' : `Ungraded: CAD ${rawCad.toFixed(2)}.`);
  if (!priced.length) {
    parts.push('Graded price: Unavailable.');
    parts.push('Grading fee comparison: Unavailable.');
    return { text: parts.join(' ') };
  }
  let chosen = priced[0];
  for (const item of priced) {
    if (rawCad == null) break;
    const jump = item.cad - rawCad;
    const best = chosen.cad - rawCad;
    if (jump < best) chosen = item;
  }
  parts.push(`PSA ${chosen.grade}: CAD ${chosen.cad.toFixed(2)}.`);
  if (missing.length) parts.push(`PSA ${missing.join(', PSA ')}: Unavailable.`);
  if (rawCad == null) {
    parts.push('Price jump: Unavailable.');
    parts.push('Grading fee comparison: Unavailable.');
    return { text: parts.join(' ') };
  }
  const jump = Math.round((chosen.cad - rawCad) * 100) / 100;
  parts.push(`Stored jump from ungraded to PSA ${chosen.grade}: CAD ${jump.toFixed(2)}.`);
  const fee = Number(feeCad);
  if (!Number.isFinite(fee) || fee <= 0) {
    parts.push('Grading fee: Unavailable. The jump is not compared with a fee.');
    return { text: parts.join(' '), jump, grade: chosen.grade };
  }
  const feeText = `CAD ${fee.toFixed(2)}`;
  if (jump > fee) {
    parts.push(`The stored jump is larger than the fee you entered (${feeText}). This is not a recommendation to grade the card.`);
  } else {
    parts.push(`The stored jump is not larger than the fee you entered (${feeText}). This is not a recommendation.`);
  }
  return { text: parts.join(' '), jump, grade: chosen.grade };
}
