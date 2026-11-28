/**
 * Cheap on-device split between Magic and Pokémon after geometry says
 * they share the 63×88 class. The flag stays off until a real-photo bar exists.
 * A user choice always wins.
 */
export const GAME_CUE_ENABLED = false;

function pointAt(rgba, width, height, x, y) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return null;
  const i = (py * width + px) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2]];
}

function isYellow(r, g, b) {
  return r > 165 && g > 140 && b < 140 && r + g > b * 2.4;
}

function isBrown(r, g, b) {
  return r > 90 && g > 45 && g < 160 && b < 110 && r > b + 30;
}

function isBlue(r, g, b) {
  return b > 80 && b > r + 25 && b > g + 10;
}

function borderSamples(rgba, width, height, quad) {
  const cx = quad.reduce((sum, point) => sum + point.x, 0) / quad.length;
  const cy = quad.reduce((sum, point) => sum + point.y, 0) / quad.length;
  const colors = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const a = quad[edge];
    const b = quad[(edge + 1) % 4];
    for (let step = 1; step < 24; step += 1) {
      const t = step / 24;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const color = pointAt(rgba, width, height, x + (cx - x) * 0.06, y + (cy - y) * 0.06);
      if (color) colors.push(color);
    }
  }
  return colors;
}

function tally(colors, test) {
  if (!colors.length) return 0;
  let hit = 0;
  for (const [r, g, b] of colors) if (test(r, g, b)) hit += 1;
  return hit / colors.length;
}

/**
 * Fronts: a yellow border reads as Pokémon. Little yellow, among the shared
 * size class, reads as Magic. Backs: blue reads as Pokémon and brown as Magic.
 */
export function cueGame(rgba, width, height, quad, side = 'front') {
  if (!quad || quad.length !== 4) return { game: null, state: 'unchecked' };
  if (side === 'back') {
    const cx = quad.reduce((sum, point) => sum + point.x, 0) / quad.length;
    const cy = quad.reduce((sum, point) => sum + point.y, 0) / quad.length;
    const colors = [];
    for (let dy = -8; dy <= 8; dy += 2) {
      for (let dx = -8; dx <= 8; dx += 2) {
        const color = pointAt(rgba, width, height, cx + dx, cy + dy);
        if (color) colors.push(color);
      }
    }
    const blue = tally(colors, isBlue);
    const brown = tally(colors, isBrown);
    if (blue >= 0.45 && blue > brown) return { game: 'pokemon', state: 'estimated', blue, brown };
    if (brown >= 0.45 && brown > blue) return { game: 'mtg', state: 'estimated', blue, brown };
    return { game: null, state: 'unchecked', blue, brown };
  }
  const yellow = tally(borderSamples(rgba, width, height, quad), isYellow);
  if (yellow >= 0.12) return { game: 'pokemon', state: 'estimated', yellow };
  if (yellow <= 0.08) return { game: 'mtg', state: 'estimated', yellow };
  return { game: null, state: 'unchecked', yellow };
}

export function resolveGameCue({ enabled = GAME_CUE_ENABLED, userChoice, cue } = {}) {
  if (userChoice) return { game: userChoice, source: 'user' };
  if (!enabled || !cue || !cue.game) return { game: null, source: 'off' };
  return { game: cue.game, source: 'cue' };
}
