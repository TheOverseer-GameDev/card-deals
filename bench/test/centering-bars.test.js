/**
 * Auto-centering stays unread when the edge is not straight.
 * On 6000 generated cards a reported left share is never more than 3 points off.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { recipesCount } from '../recipes/sealed.mjs';
import { labelFromParams } from '../label.mjs';
import { render } from '../procedural/render.mjs';
import { readCentering } from '../../scan/core/center.js';

test('centering readings on 6000 cards stay inside the dangerous bar', { timeout: 180000 }, () => {
  const params = recipesCount(6000, 1);
  let dangerous = 0;
  let ineligibleValue = 0;
  let guided = 0;
  let guidedValue = 0;
  let guidedHit = 0;
  let flat = 0;
  let flatValue = 0;
  let flatDanger = 0;
  let eligible = 0;
  let guideStart = 0;
  for (const item of params) {
    const label = labelFromParams(item);
    const cardOk = label.gate === 'ok' && label.pxPerMm >= 8 && Math.abs(label.tiltDeg) <= 3;
    const level = cardOk ? readCentering(render(label, item), label.image.w, label.image.h) : { state: 'unchecked' };
    const reported = level.state === 'ok' && Number.isFinite(level.lr);
    if (cardOk) eligible += 1;
    if (reported && !cardOk) ineligibleValue += 1;
    if (reported && cardOk && Math.abs(level.lr - label.centering.lr) <= 3) guideStart += 1;
    if (reported) {
      const err = Math.abs(level.lr - label.centering.lr);
      if (err > 3) dangerous += 1;
      if (label.family === 'G') {
        guidedValue += 1;
        if (err <= 2) guidedHit += 1;
      }
    }
    if (label.family === 'G') guided += 1;
    const flatCard = cardOk && label.rotDeg === 0 && label.tiltDeg === 0;
    if (flatCard) {
      flat += 1;
      if (reported) {
        flatValue += 1;
        if (Math.abs(level.lr - label.centering.lr) > 3) flatDanger += 1;
      }
    }
  }
  const within = guidedValue ? guidedHit / guidedValue : 0;
  const coverage = guided ? guidedValue / guided : 0;
  const readable = flat ? flatValue / flat : 0;
  const guideRate = eligible ? guideStart / eligible : 0;
  assert.equal(params.length, 6000);
  assert.equal(dangerous, 0);
  assert.equal(ineligibleValue, 0);
  assert.equal(flatDanger, 0);
  assert.ok(coverage >= 0.5, `guided coverage ${coverage}`);
  assert.ok(within >= 0.95, `guided within ${within}`);
  assert.ok(readable >= 0.9, `flat readable ${readable}`);
  assert.ok(guideRate >= 0.7, `guide start ${guideRate}`);
  console.log(JSON.stringify({ n: 6000, dangerous, coverage, within, readable, guideRate, flat }));
});
