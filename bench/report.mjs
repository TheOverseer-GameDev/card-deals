import { ruleOfThree } from './score/score.mjs';

const ORDER = ['M1', 'M2', 'M2b', 'M2f', 'M3', 'M4', 'M4f', 'M5', 'M5b', 'M6a', 'M6b', 'M6c', 'M7', 'M8', 'M8b', 'M8c', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M16', 'M17', 'M18', 'M18b', 'M19', 'M20', 'E15'];

export function diffMarkdown(info) {
  const lines = [
    `head ${info.head} phase ${info.phase}`,
    `parent ${info.parent}`,
    `spec ${info.specHash}`,
    `baseline ${info.baselineHash}`,
    `truth ${info.truthHash}`,
    `determinism ${info.determinism}`,
    `verdict ${info.verdict}`,
    '| id | metric | bar | value | prev | d | |',
  ];
  for (const id of ORDER) {
    const row = info.metrics[id];
    if (!row) continue;
    lines.push(`| ${id} | ${row.metric} | ${row.bar} | ${shown(row)} | ${info.prev[id] ?? ''} | ${delta(row, info.prev[id])} | ${row.pass ? 'PASS' : 'FAIL'} |`);
  }
  const fails = Object.values(info.metrics).filter((row) => !row.pass && row.cases && row.cases.length);
  if (fails.length) {
    const bits = fails.slice(0, 4).map((row) => `${row.id}:${row.cases.slice(0, 5).join(',')}`);
    lines.push(`cases ${bits.join(' ')}`);
  }
  lines.push(`nondiscriminating ${info.nondiscriminating}`);
  lines.push(`specdiff ${info.specDiff || 'none'}`);
  return `${lines.slice(0, 40).join('\n')}\n`;
}

function shown(row) {
  if (row.value == null) return 'n/a';
  const bound = row.better === 'lower' && row.value === 0 ? ruleOfThree(0, row.n || 1) : null;
  const base = typeof row.value === 'number' ? trim(row.value) : String(row.value);
  return bound ? `${base} (3/${row.n || 1})` : base;
}

function delta(row, prev) {
  if (prev == null || row.value == null || typeof prev !== 'number') return '';
  return trim(row.value - prev);
}

function trim(n) {
  return String(Math.round(n * 1000) / 1000);
}
