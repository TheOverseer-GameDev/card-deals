/**
 * Pure scan logic. No network, no DOM, no model calls.
 * Prices come only from values the caller already has.
 */

export const LIMITS = {
  maxFileBytes: 8 * 1024 * 1024,
  maxEdge: 1600,
  minShortEdge: 500,
};

/** A shipped observation older than this is labelled stale. It is still shown. */
export const STALE_AFTER_MS = 45 * 24 * 60 * 60 * 1000;

/** Laplacian variance below this, on a ~400px-wide sample, is low detail. */
export const BLUR_LOW = 30;
/** Variance above this is not flagged. Between the two, the check abstains. */
export const BLUR_HIGH = 120;

export const GRADE_ORDER = ['ungraded', 'psa5', 'psa6', 'psa7', 'psa8', 'psa9', 'psa10'];

export const GRADE_LABEL = {
  ungraded: 'Ungraded',
  psa5: 'PSA 5',
  psa6: 'PSA 6',
  psa7: 'PSA 7',
  psa8: 'PSA 8',
  psa9: 'PSA 9',
  psa10: 'PSA 10',
};

const HISTORY_SERIES = { ungraded: 'raw', psa9: 'p9', psa10: 'p10' };

const EDITIONS = [
  ['1st edition', '1st Edition'],
  ['first edition', '1st Edition'],
  ['unlimited', 'Unlimited'],
  ['limited edition', 'Limited Edition'],
];

const RARITIES = [
  ['quarter century secret rare', 'Quarter Century Secret Rare'],
  ['platinum secret rare', 'Platinum Secret Rare'],
  ['prismatic secret rare', 'Prismatic Secret Rare'],
  ['starlight rare', 'Starlight Rare'],
  ['ultimate rare', 'Ultimate Rare'],
  ['secret rare', 'Secret Rare'],
  ['ultra rare', 'Ultra Rare'],
  ['ghost rare', 'Ghost Rare'],
  ['gold rare', 'Gold Rare'],
  ["collector's rare", "Collector's Rare"],
];

const LANG = {
  EN: 'English',
  FR: 'French',
  DE: 'German',
  IT: 'Italian',
  ES: 'Spanish',
  PT: 'Portuguese',
  JA: 'Japanese',
  JP: 'Japanese',
  KR: 'Korean',
  KO: 'Korean',
  TC: 'Traditional Chinese',
  SC: 'Simplified Chinese',
  AE: 'Asian English',
};

const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'at', 'to', 'for', 'in', 'on']);

const CONFUSABLE = { 0: 'O', O: '0', 1: 'I', I: '1', 5: 'S', S: '5', 8: 'B', B: '8' };

const MAX_CANDIDATES = 12;

export function localPath(path) {
  if (typeof path !== 'string') throw new Error('refusing non-local path');
  const p = path.trim();
  if (!p || /^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//') || p.startsWith('/') || p.startsWith('\\') || p.includes('..') || p.includes('\\') || p.includes('\0') || p.includes('?') || p.includes('#')) {
    throw new Error('refusing non-local path');
  }
  if (
    p === 'scan/verified-prices.json'
    || /^h\/(ygo|mtg)\/[a-z0-9]+\.json$/i.test(p)
    || /^scan\/market\/(ygo|mtg)\/[a-z0-9]+\.json$/i.test(p)
  ) return p;
  throw new Error('refusing non-local path');
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function fileMessage(code) {
  switch (code) {
    case 'empty':
      return 'That file is empty.';
    case 'too-large':
      return 'That file is over 8 MB. Choose a smaller photo so the phone can process it on device.';
    case 'not-image':
      return 'That file is not a JPEG, PNG, WebP, or GIF photo.';
    case 'unsupported-image':
      return 'This photo format is not supported here. Use a JPEG, PNG, or WebP.';
    case 'heic':
      return 'HEIC photos are not decoded in this browser. Export a JPEG or PNG and upload that.';
    case 'undecodable':
      return 'The photo could not be read. It may be damaged.';
    default:
      return 'The photo could not be used.';
  }
}

export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (brand === 'heic' || brand === 'heix' || brand === 'heif' || brand === 'mif1' || brand === 'msf1') return 'heic';
  }
  return null;
}

export function validateFile(file) {
  const size = file && file.size;
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return { ok: false, code: 'empty' };
  if (size > LIMITS.maxFileBytes) return { ok: false, code: 'too-large' };
  const type = String((file && file.type) || '').toLowerCase();
  if (type && !type.startsWith('image/')) return { ok: false, code: 'not-image' };
  if (file.bytes) {
    const kind = sniffImage(file.bytes);
    if (kind === 'heic') return { ok: false, code: 'heic' };
    if (!kind) return { ok: false, code: type.startsWith('image/') ? 'unsupported-image' : 'not-image' };
    return { ok: true, kind };
  }
  if (type && !/^image\/(jpeg|jpg|png|webp|gif)$/.test(type)) return { ok: false, code: 'unsupported-image' };
  return { ok: true, kind: type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : 'jpeg' };
}

export function captureSize(width, height, maxEdge = LIMITS.maxEdge) {
  if (!(width > 0) || !(height > 0)) return null;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function clampCrop(left, top, right, bottom) {
  let L = clamp01(left);
  let T = clamp01(top);
  let R = clamp01(right);
  let B = clamp01(bottom);
  if (R < L) [L, R] = [R, L];
  if (B < T) [T, B] = [B, T];
  if (R - L < 0.05) R = Math.min(1, L + 0.05);
  if (B - T < 0.05) B = Math.min(1, T + 0.05);
  if (R > 1) { R = 1; L = Math.min(L, 0.95); }
  if (B > 1) { B = 1; T = Math.min(T, 0.95); }
  return { left: L, top: T, right: R, bottom: B };
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function languageFromCode(code) {
  const right = String(code || '').split('-')[1] || '';
  const m = right.match(/^(EN|FR|DE|IT|ES|PT|JA|JP|KR|KO|TC|SC|AE)(?=[0-9])/);
  return m ? LANG[m[1]] : null;
}

export function parsePrintName(name) {
  const raw = String(name || '').replace(/[\u2010-\u2015]/g, '-');
  const codeMatch = raw.match(/\b[A-Z0-9]{2,5}-[A-Z]{0,4}[0-9]{2,4}\b/i);
  const setCode = codeMatch ? codeMatch[0].toUpperCase() : null;
  const numMatch = raw.match(/#\s*(\d{1,4})\b/);
  const collectorNumber = numMatch ? String(Number(numMatch[1])) : null;
  let work = raw;
  if (codeMatch) work = work.replace(codeMatch[0], ' ');
  if (numMatch) work = work.replace(numMatch[0], ' ');
  const lower = work.toLowerCase();
  let edition = null;
  for (const [phrase, label] of EDITIONS) {
    if (lower.includes(phrase)) { edition = label; break; }
  }
  let rarity = null;
  for (const [phrase, label] of RARITIES) {
    if (lower.includes(phrase)) { rarity = label; break; }
  }
  const finish = /\bfoil\b/i.test(work) ? 'Foil' : null;
  let tokenSource = lower;
  for (const [phrase] of EDITIONS) tokenSource = tokenSource.split(phrase).join(' ');
  for (const [phrase] of RARITIES) tokenSource = tokenSource.split(phrase).join(' ');
  tokenSource = tokenSource.replace(/\bfoil\b/g, ' ');
  const tokens = [];
  for (const part of tokenSource.split(/[^a-z0-9]+/)) {
    if (part.length < 2 || STOP.has(part) || tokens.includes(part)) continue;
    tokens.push(part);
  }
  return {
    setCode,
    language: setCode ? languageFromCode(setCode) : null,
    edition,
    rarity,
    finish,
    collectorNumber,
    tokens,
  };
}

export function normalizeOcr(text) {
  return String(text || '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\b([A-Z0-9]{2,5})\s*-\s*([A-Z0-9]{2,8})\b/gi, (_, a, b) => `${a}-${b}`);
}

export function extractSetCodes(text) {
  const found = normalizeOcr(text).toUpperCase().match(/\b[A-Z0-9]{2,5}-[A-Z]{0,4}[0-9]{2,4}\b/g) || [];
  return [...new Set(found)];
}

/** A second OCR pass is worth doing only when the first pass saw no set code. */
export function needsCodePass(text) {
  return extractSetCodes(text).length === 0;
}

export function productSlug(url) {
  const m = String(url || '').match(/\/game\/([^/?#]+)\//i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

function positiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function volumeNote(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/&nbsp;|&#160;/gi, '').replace(/\u00a0/g, '').trim();
  return /^\d+ sales? per (day|week|month)$/i.test(s) ? s : null;
}

export function catalogFromSite(D) {
  const rows = [];
  const packagedAt = D && D.built ? String(D.built) : null;
  for (const game of ['ygo', 'mtg']) {
    const cards = D && D[game] && Array.isArray(D[game].cards) ? D[game].cards : [];
    cards.forEach((card, index) => {
      if (!card || typeof card.name !== 'string') return;
      const parsed = parsePrintName(card.name);
      rows.push({
        key: `${game}:${card.id || index}`,
        game,
        id: typeof card.id === 'string' ? card.id : null,
        name: card.name,
        url: typeof card.url === 'string' ? card.url : '',
        slug: productSlug(card.url),
        kind: 'deal',
        parsed,
        norm: card.name.toLowerCase(),
        snapshot: {
          ungraded: positiveNumber(card.raw),
          psa9: positiveNumber(card.p9),
          psa10: positiveNumber(card.p10),
        },
        packagedAt,
        volumeNote: volumeNote(card.vol),
        historyStart: typeof card.h0 === 'number' && card.h0 > 0 ? card.h0 : null,
      });
    });
  }
  const coll = D && Array.isArray(D.coll) ? D.coll : [];
  coll.forEach((row, index) => {
    if (!row || typeof row.name !== 'string') return;
    const parsed = parsePrintName(`${row.name} ${row.set_code || ''}`);
    if (row.set_code) {
      parsed.setCode = String(row.set_code).toUpperCase();
      parsed.language = languageFromCode(parsed.setCode);
    }
    if (row.rarity) parsed.rarity = String(row.rarity);
    if (row.edition) parsed.edition = String(row.edition);
    rows.push({
      key: `coll:${index}`,
      game: 'coll',
      id: null,
      name: row.name,
      url: '',
      slug: null,
      kind: 'collection',
      parsed,
      norm: `${row.name} ${row.set_code || ''} ${row.rarity || ''} ${row.edition || ''}`.toLowerCase(),
      snapshot: { ungraded: null, psa9: null, psa10: null },
      packagedAt,
      volumeNote: null,
      historyStart: null,
    });
  });
  return rows;
}

function oneConfusable(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (CONFUSABLE[a[i]] !== b[i]) return false;
    diff += 1;
  }
  return diff === 1;
}

export function matchText(rows, text) {
  const raw = normalizeOcr(text);
  const base = {
    readCodes: [],
    readEdition: null,
    readRarity: null,
    readLanguage: null,
    readNumber: null,
    candidates: [],
    hiddenCount: 0,
    ambiguous: true,
    confirmation: 'required',
    empty: true,
  };
  if (!raw.trim()) return base;
  const readCodes = extractSetCodes(raw);
  const readParsed = parsePrintName(raw);
  const readTokens = new Set(readParsed.tokens);
  const known = new Set(rows.map((r) => r.parsed.setCode).filter(Boolean));
  const readKnown = readCodes.filter((c) => known.has(c));
  const candidates = [];
  for (const row of rows) {
    const code = row.parsed.setCode;
    const exactCode = Boolean(code && readCodes.includes(code));
    if (readKnown.length > 0 && !exactCode) continue;
    const nameHits = row.parsed.tokens.filter((t) => readTokens.has(t));
    let fuzzyCode = false;
    let fuzzyFrom = null;
    if (!exactCode && readKnown.length === 0 && code) {
      for (const rc of readCodes) {
        if (oneConfusable(rc, code) && nameHits.length > 0) {
          fuzzyCode = true;
          fuzzyFrom = rc;
          break;
        }
      }
    }
    const number = row.parsed.collectorNumber;
    const readNumber = readParsed.collectorNumber;
    if (number && readNumber && number !== readNumber && !exactCode) continue;
    const allNames = row.parsed.tokens.length > 0 && nameHits.length === row.parsed.tokens.length;
    const enoughNames = nameHits.length >= 2 && nameHits.length >= Math.ceil(row.parsed.tokens.length * 0.6);
    const numberMatch = Boolean(number && readNumber && number === readNumber && nameHits.length > 0);
    if (!(exactCode || fuzzyCode || allNames || enoughNames || numberMatch)) continue;
    const disagreements = [];
    if (row.parsed.edition && readParsed.edition && row.parsed.edition !== readParsed.edition) {
      disagreements.push(`Edition text says ${readParsed.edition} and this row says ${row.parsed.edition}.`);
    }
    if (row.parsed.rarity && readParsed.rarity && row.parsed.rarity !== readParsed.rarity) {
      disagreements.push(`Rarity text says ${readParsed.rarity} and this row says ${row.parsed.rarity}.`);
    }
    const evidence = [];
    if (exactCode) evidence.push(`Exact set code ${code}.`);
    if (fuzzyCode) evidence.push(`Set code ${fuzzyFrom} differs from ${code} by one similar character. This is not an exact code match.`);
    if (nameHits.length) evidence.push(`Name words found: ${nameHits.join(', ')}.`);
    if (numberMatch) evidence.push(`Collector number ${number} matches this row.`);
    if (!number && readNumber) evidence.push(`Collector number ${readNumber} was read and this row does not list one.`);
    if (row.parsed.edition && readParsed.edition && row.parsed.edition === readParsed.edition) {
      evidence.push(`Edition text matches ${row.parsed.edition}.`);
    }
    if (row.parsed.rarity && readParsed.rarity && row.parsed.rarity === readParsed.rarity) {
      evidence.push(`Rarity text matches ${row.parsed.rarity}.`);
    }
    if (!code) evidence.push('This row does not name a set code.');
    evidence.push(...disagreements);
    candidates.push({
      key: row.key,
      exactCode,
      fuzzyCode,
      nameHits,
      numberMatch,
      disagreements,
      evidence,
    });
  }
  candidates.sort((a, b) => candidateRank(b) - candidateRank(a));
  const hiddenCount = Math.max(0, candidates.length - MAX_CANDIDATES);
  const shown = candidates.slice(0, MAX_CANDIDATES);
  const ambiguous = shown.length !== 1 || !shown[0].exactCode || shown[0].disagreements.length > 0 || hiddenCount > 0;
  return {
    readCodes,
    readEdition: readParsed.edition,
    readRarity: readParsed.rarity,
    readLanguage: readParsed.language,
    readNumber: readParsed.collectorNumber,
    candidates: shown,
    hiddenCount,
    ambiguous,
    confirmation: 'required',
    empty: false,
  };
}

function candidateRank(c) {
  return (c.exactCode ? 100 : 0) + (c.fuzzyCode ? 40 : 0) + (c.numberMatch ? 15 : 0) + c.nameHits.length * 5 - c.disagreements.length * 3;
}

export function searchCatalog(rows, query) {
  const tokens = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (!tokens.length) return [];
  const hits = [];
  for (const row of rows) {
    if (tokens.every((t) => row.norm.includes(t))) hits.push(row);
    if (hits.length >= 30) break;
  }
  return hits;
}

export function identityFields(row) {
  const p = row.parsed || {};
  const missing = 'Unavailable';
  const game = row.game === 'ygo' ? 'Yu-Gi-Oh' : row.game === 'mtg' ? 'Magic' : row.game === 'coll' ? 'Collection note' : missing;
  const list = row.kind === 'collection' ? 'Collection note' : row.game === 'ygo' ? 'Yu-Gi-Oh deals' : row.game === 'mtg' ? 'Magic deals' : missing;
  const link = safeHttpUrl(row.url);
  return [
    ['Game', game],
    ['Name', row.name || missing],
    ['List', list],
    ['Set code', p.setCode || missing],
    ['Set name', row.setName || missing],
    ['Edition', p.edition || missing],
    ['Rarity', p.rarity || missing],
    ['Language', p.language || missing],
    ['Finish', p.finish || missing],
    ['Collector number', p.collectorNumber || missing],
    ['Catalog id', row.id || missing],
    ['Price page', row.slug || missing],
    ['Catalog link', link || missing],
  ];
}

export function formatMoney(amount, currency) {
  if (currency === 'USD') return formatUsd(amount);
  const v = Math.round(Number(amount) * 100) / 100;
  return `${v.toFixed(2)} ${currency || ''}`.trim();
}

export function formatUsd(n) {
  const v = Math.round(Number(n) * 100) / 100;
  const [whole, frac] = v.toFixed(2).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '');
  return `${sign}$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

function formatUtc(ms) {
  const t = typeof ms === 'number' ? ms : Date.parse(ms);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

export function validateGrade(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return [null, 'grade is not an object'];
  const price = raw.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return [null, 'price must be a positive number'];
  const currency = raw.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return [null, 'currency must be a 3-letter code'];
  const source = typeof raw.source === 'string' ? raw.source.trim() : '';
  if (source.length < 2 || source.length > 80) return [null, 'source is missing'];
  const observedRaw = raw.observedAt || raw.observed_at;
  const t = Date.parse(observedRaw || '');
  if (!Number.isFinite(t)) return [null, 'observed_at is missing'];
  if (t - now > 2 * 864e5) return [null, 'observed_at is far in the future'];
  let sourceUrl = null;
  const u = raw.sourceUrl || raw.source_url || '';
  if (u) {
    sourceUrl = safeHttpUrl(u);
    if (!sourceUrl) return [null, 'source_url must be http or https'];
  }
  let salesCount = null;
  if (raw.salesCount != null || raw.sales_count != null) {
    const n = raw.salesCount != null ? raw.salesCount : raw.sales_count;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return [null, 'sales_count must be a non-negative integer'];
    salesCount = n;
  }
  return [{
    price,
    currency,
    source,
    sourceUrl,
    observedAt: new Date(t).toISOString(),
    salesCount,
  }, null];
}

export function validateVerifiedFile(doc, now = Date.now()) {
  const prints = {};
  const rejected = [];
  const src = doc && doc.prints;
  const entries = [];
  if (Array.isArray(src)) {
    for (const item of src) {
      if (!item || typeof item !== 'object') continue;
      entries.push([`${item.game}:${item.id}`, item.grades]);
    }
  } else if (src && typeof src === 'object') {
    for (const [key, item] of Object.entries(src)) entries.push([key, item && item.grades]);
  }
  for (const [key, grades] of entries) {
    if (!/^(ygo|mtg):[A-Za-z0-9_-]+$/.test(key)) {
      rejected.push({ print: String(key), grade: '', reason: 'print key must be ygo:id or mtg:id' });
      continue;
    }
    if (!grades || typeof grades !== 'object') continue;
    const kept = {};
    for (const [grade, raw] of Object.entries(grades)) {
      if (!GRADE_ORDER.includes(grade)) {
        rejected.push({ print: key, grade, reason: 'unknown grade' });
        continue;
      }
      const [clean, reason] = validateGrade(raw, now);
      if (!clean) {
        rejected.push({ print: key, grade, reason });
        continue;
      }
      kept[grade] = clean;
    }
    if (Object.keys(kept).length) prints[key] = { grades: kept };
  }
  return { prints, rejected };
}

function historyPoint(history, grade) {
  const key = HISTORY_SERIES[grade];
  if (!key || !history || !Array.isArray(history[key])) return null;
  let best = null;
  let latestT = null;
  let latestPositive = false;
  for (const pt of history[key]) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const t = Number(pt[0]);
    const p = Number(pt[1]);
    if (!Number.isFinite(t)) continue;
    if (latestT == null || t >= latestT) {
      latestT = t;
      latestPositive = Number.isFinite(p) && p > 0;
    }
    if (!Number.isFinite(p) || p <= 0) continue;
    if (!best || t >= best.t) best = { t, p };
  }
  if (!best) return null;
  best.skippedNonPositive = latestT != null && !latestPositive;
  return best;
}

function lineBase(grade) {
  return {
    grade,
    label: GRADE_LABEL[grade],
    status: 'value',
    price: null,
    currency: null,
    source: null,
    sourceUrl: null,
    observedAt: null,
    salesCount: null,
    volumeText: null,
    stale: false,
    kind: 'none',
    note: '',
  };
}

export function priceReport(row, history, verifiedPrint, now = Date.now()) {
  const verifiedGrades = verifiedPrint && verifiedPrint.grades ? verifiedPrint.grades : {};
  const grades = {};
  for (const grade of GRADE_ORDER) {
    const verified = verifiedGrades[grade] || null;
    const snap = row.snapshot ? row.snapshot[grade] : null;
    const hist = historyPoint(history, grade);
    const lines = [];
    if (verified) {
      const t = Date.parse(verified.observedAt);
      const stale = Number.isFinite(t) && now - t > STALE_AFTER_MS;
      const item = lineBase(grade);
      item.price = verified.price;
      item.currency = verified.currency;
      item.source = verified.source;
      item.sourceUrl = verified.sourceUrl || null;
      item.observedAt = verified.observedAt;
      item.salesCount = verified.salesCount == null ? null : verified.salesCount;
      item.stale = stale;
      item.kind = 'verified';
      item.note = stale
        ? 'Verified record in scan/verified-prices.json. Stale: the observation is older than 45 days on this device clock.'
        : 'Verified record in scan/verified-prices.json.';
      lines.push(item);
    }
    if (snap && (!verified || Math.abs(verified.price - snap) > 0.009)) {
      const item = lineBase(grade);
      item.price = snap;
      item.currency = 'USD';
      item.source = 'PriceCharting figure stored in data.js';
      item.sourceUrl = safeHttpUrl(row.url);
      item.kind = 'snapshot';
      item.volumeText = grade === 'ungraded' ? row.volumeNote : null;
      const notes = ['Packaged snapshot figure from data.js. Observation time is not stored on this figure.'];
      if (row.packagedAt) notes.push(`Snapshot packaged ${row.packagedAt}.`);
      if (verified) notes.push('This snapshot figure differs from the verified record. Neither value was changed.');
      if (item.volumeText) notes.push(`Volume text from the snapshot: ${item.volumeText}. This is not a sales count.`);
      item.note = notes.join(' ');
      lines.push(item);
    } else if (snap && verified && grade === 'ungraded' && row.volumeNote) {
      lines[0].volumeText = row.volumeNote;
      lines[0].note += ` Volume text from the snapshot: ${row.volumeNote}. This is not a sales count.`;
    }
    if (hist) {
      const stale = now - hist.t > STALE_AFTER_MS;
      const item = lineBase(grade);
      item.price = hist.p;
      item.currency = 'USD';
      item.source = row.id && (row.game === 'ygo' || row.game === 'mtg')
        ? `Shipped history h/${row.game}/${row.id}.json`
        : 'Shipped history';
      item.observedAt = new Date(hist.t).toISOString();
      item.stale = stale;
      item.kind = 'history';
      const notes = ['Latest positive point in the shipped history file. Missing grades were not filled in.'];
      if (hist.skippedNonPositive) notes.push('A later history point had no positive price and was left unused.');
      if (stale) notes.push('Stale: this history point is older than 45 days on this device clock.');
      item.note = notes.join(' ');
      lines.push(item);
    }
    if (!lines.length) {
      const item = lineBase(grade);
      item.status = 'unavailable';
      item.note = 'No price in verified-prices.json, the packaged snapshot, or shipped history.';
      lines.push(item);
    }
    grades[grade] = lines;
  }
  return {
    key: row.key,
    exactSetNamed: Boolean(row.parsed && row.parsed.setCode),
    packagedAt: row.packagedAt || null,
    historyStart: row.historyStart ? formatUtc(row.historyStart) : null,
    grades,
  };
}

export function laplacianVariance(gray, width, height) {
  if (!gray || width < 3 || height < 3) return 0;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - width] + gray[i - 1] + gray[i + 1] + gray[i + width] - 4 * gray[i];
      sum += v;
      sum2 += v * v;
      n += 1;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

export function clippedFraction(gray) {
  if (!gray || !gray.length) return 0;
  let n = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] >= 250) n += 1;
  return n / gray.length;
}

function mean(nums) {
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function stdev(nums) {
  const m = mean(nums);
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) * (v - m), 0) / nums.length);
}

export function measureCentering(gray, width, height) {
  const fail = { state: 'not-assessable' };
  if (!gray || width < 40 || height < 40) return fail;
  const ys = [0.2, 0.35, 0.5, 0.65, 0.8].map((f) => Math.round(f * (height - 1)));
  const xs = [0.2, 0.35, 0.5, 0.65, 0.8].map((f) => Math.round(f * (width - 1)));
  const maxX = Math.floor(width * 0.22);
  const maxY = Math.floor(height * 0.22);
  const lefts = [];
  const rights = [];
  const tops = [];
  const bottoms = [];
  for (const y of ys) {
    const L = edgeRun(gray, width, height, 'left', y, maxX);
    const R = edgeRun(gray, width, height, 'right', y, maxX);
    if (L == null || R == null) return fail;
    lefts.push(L);
    rights.push(R);
  }
  for (const x of xs) {
    const T = edgeRun(gray, width, height, 'top', x, maxY);
    const B = edgeRun(gray, width, height, 'bottom', x, maxY);
    if (T == null || B == null) return fail;
    tops.push(T);
    bottoms.push(B);
  }
  if (stdev(lefts) > 2.5 || stdev(rights) > 2.5 || stdev(tops) > 2.5 || stdev(bottoms) > 2.5) return fail;
  const left = mean(lefts);
  const right = mean(rights);
  const top = mean(tops);
  const bottom = mean(bottoms);
  if (left < width * 0.02 || right < width * 0.02 || top < height * 0.02 || bottom < height * 0.02) return fail;
  if (left > width * 0.2 || right > width * 0.2 || top > height * 0.2 || bottom > height * 0.2) return fail;
  const hx = left + right;
  const hy = top + bottom;
  if (!(hx > 0) || !(hy > 0)) return fail;
  return {
    state: 'measured',
    leftPct: (left / hx) * 100,
    rightPct: (right / hx) * 100,
    topPct: (top / hy) * 100,
    bottomPct: (bottom / hy) * 100,
  };
}

function edgeRun(gray, width, height, side, fixed, maxRun) {
  const refAt = (i) => gray[i];
  let run = 0;
  let ref = 0;
  let inside = 0;
  if (side === 'left' || side === 'right') {
    const y = fixed;
    ref = side === 'left' ? refAt(y * width) : refAt(y * width + width - 1);
    while (run < maxRun) {
      const x = side === 'left' ? run : width - 1 - run;
      if (Math.abs(refAt(y * width + x) - ref) > 26) break;
      run += 1;
    }
    if (run < 2 || run >= maxRun) return null;
    const ix = side === 'left' ? Math.min(width - 1, run + 2) : Math.max(0, width - 1 - run - 2);
    inside = refAt(y * width + ix);
  } else {
    const x = fixed;
    ref = side === 'top' ? refAt(x) : refAt((height - 1) * width + x);
    while (run < maxRun) {
      const y = side === 'top' ? run : height - 1 - run;
      if (Math.abs(refAt(y * width + x) - ref) > 26) break;
      run += 1;
    }
    if (run < 2 || run >= maxRun) return null;
    const iy = side === 'top' ? Math.min(height - 1, run + 2) : Math.max(0, height - 1 - run - 2);
    inside = refAt(iy * width + x);
  }
  if (Math.abs(inside - ref) < 30) return null;
  return run;
}

export function suggestCrop(gray, width, height) {
  const fail = (reason) => ({ state: 'not-assessable', reason });
  if (!gray || width < 40 || height < 40) return fail('image is too small');
  const corners = [gray[0], gray[width - 1], gray[(height - 1) * width], gray[height * width - 1]];
  const bg = corners.slice().sort((a, b) => a - b)[1];
  if (corners.some((c) => Math.abs(c - bg) > 12)) return fail('background is not a flat field');
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.abs(gray[y * width + x] - bg) <= 28) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return fail('no subject against the background');
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (bw < width * 0.2 || bh < height * 0.2) return fail('subject is too small');
  const edge = 0.02;
  const touches = minX <= width * edge && minY <= height * edge && maxX >= width - 1 - width * edge && maxY >= height - 1 - height * edge;
  if (touches) return fail('subject fills the frame');
  const ratio = bw / bh;
  const portrait = ratio > 0.64 && ratio < 0.8;
  const landscape = ratio > 1 / 0.8 && ratio < 1 / 0.64;
  if (!portrait && !landscape) return fail('bounds are not a card shape');
  return {
    state: 'suggested',
    left: minX / width,
    top: minY / height,
    right: (maxX + 1) / width,
    bottom: (maxY + 1) / height,
  };
}

/** Original short side of a region, in pixels, below which that region fails. */
export const REGION_MIN_SHORT_PX = 32;
/** Sampled region short side below which blur and glare abstain. */
export const REGION_SAMPLE_MIN = 12;
/** This many critical regions in fail or unknown blocks a numeric estimate. */
export const PSA_BLOCK_AT = 4;

export const REGION_GEOM = {
  corner_tl: { x: 0, y: 0, w: 0.10, h: 0.10 },
  corner_tr: { x: 0.90, y: 0, w: 0.10, h: 0.10 },
  corner_bl: { x: 0, y: 0.90, w: 0.10, h: 0.10 },
  corner_br: { x: 0.90, y: 0.90, w: 0.10, h: 0.10 },
  edge_top: { x: 0.10, y: 0, w: 0.80, h: 0.08 },
  edge_bottom: { x: 0.10, y: 0.92, w: 0.80, h: 0.08 },
  edge_left: { x: 0, y: 0.10, w: 0.08, h: 0.80 },
  edge_right: { x: 0.92, y: 0.10, w: 0.08, h: 0.80 },
  center_field: { x: 0.15, y: 0.15, w: 0.70, h: 0.70 },
  print_register: { x: 0.18, y: 0.12, w: 0.64, h: 0.22 },
  border_box: { x: 0, y: 0, w: 1, h: 1 },
};

export const CRITICAL_REGIONS = [
  'corner_tl', 'corner_tr', 'corner_bl', 'corner_br',
  'edge_top', 'edge_right', 'edge_bottom', 'edge_left',
  'center_field',
];

export const GROUP_IDS = {
  corners: ['corner_tl', 'corner_tr', 'corner_bl', 'corner_br'],
  edges: ['edge_top', 'edge_right', 'edge_bottom', 'edge_left'],
  surface: ['center_field'],
};

export const REGION_LABEL = {
  corner_tl: 'top-left corner',
  corner_tr: 'top-right corner',
  corner_bl: 'bottom-left corner',
  corner_br: 'bottom-right corner',
  edge_top: 'top edge',
  edge_right: 'right edge',
  edge_bottom: 'bottom edge',
  edge_left: 'left edge',
  center_field: 'center surface',
  print_register: 'print / title area',
  border_box: 'borders',
};

const RETAKE_WHY = {
  glare: 'specular glare (clipped highlights)',
  blur: 'blur / low detail',
  'low-resolution': 'resolution is too low to inspect this region',
  'not-assessable': 'detail is not assessable in this photo',
  'out-of-frame': 'region is out of frame',
};

const RETAKE_TIP = {
  glare: 'Tilt slightly or use softer side light.',
  blur: 'Tap to focus on the edge; hold steady; no digital zoom.',
  'low-resolution': 'Move closer with the rear camera at 1×. No digital zoom.',
  'not-assessable': 'Retake with the card flat, in focus, and evenly lit.',
  'out-of-frame': 'Fit the whole card inside the outline with a margin of background around it.',
};

const WEAR_CAP = { corners: 7, edges: 6, surface: 7 };

export const PSA_LABEL = 'Potential PSA grade estimate (not a certification)';
export const PSA_DISCLAIMER = 'Photos cannot prove hidden defects, alterations, or authenticity. PSA may grade higher or lower.';
export const ESTIMATE_UNAVAILABLE = 'Estimate unavailable — retake required';

export const COPY = {
  psaUi: 'Potential PSA grade estimate — not a PSA certification.',
  privacy: 'Photos stay on this device. Nothing is uploaded to grade or identify your card.',
  sold: 'Completed sales',
  ask: 'Asking prices',
  gap: 'No sourced sales in this period.',
  future: 'Future potential is scenario-based, not a promise.',
  authenticity: 'This app cannot verify authenticity or alterations.',
  confirm: 'You confirmed this catalog print. This is not proof of authenticity or of the physical edition in hand.',
  risk: 'Risk score from listed factors — not a probability of loss.',
  value: 'Describes data quality / level of current comps, not a price target.',
};

export function classifyRegion({ variance, clipped, shortPx, sampleShort }) {
  if (!(shortPx >= REGION_MIN_SHORT_PX)) return { status: 'fail', reasons: ['low-resolution'] };
  if (!(sampleShort >= REGION_SAMPLE_MIN)) return { status: 'unknown', reasons: ['not-assessable'] };
  if (clipped > 0.2) return { status: 'unknown', reasons: ['glare'] };
  if (clipped >= 0.005) return { status: 'fail', reasons: ['glare'] };
  if (!(variance > BLUR_HIGH)) {
    if (variance < BLUR_LOW) return { status: 'fail', reasons: ['blur'] };
    return { status: 'unknown', reasons: ['not-assessable'] };
  }
  if (clipped >= 0.002) return { status: 'warn', reasons: ['glare'] };
  return { status: 'pass', reasons: [] };
}

function sliceGray(gray, width, height, geom) {
  let x0 = Math.round(geom.x * width);
  let y0 = Math.round(geom.y * height);
  let w = Math.max(1, Math.round(geom.w * width));
  let h = Math.max(1, Math.round(geom.h * height));
  if (x0 >= width) x0 = width - 1;
  if (y0 >= height) y0 = height - 1;
  if (x0 + w > width) w = width - x0;
  if (y0 + h > height) h = height - y0;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = gray[(y0 + y) * width + (x0 + x)] || 0;
  }
  return { gray: out, width: w, height: h };
}

function borderBoxRegion(centering, shortSide) {
  if (shortSide < LIMITS.minShortEdge) {
    return { id: 'border_box', status: 'fail', reasons: ['low-resolution'], shortPx: shortSide, variance: 0, clipped: 0 };
  }
  if (!centering || centering.state !== 'measured') {
    return { id: 'border_box', status: 'unknown', reasons: ['not-assessable'], shortPx: shortSide, variance: 0, clipped: 0 };
  }
  return { id: 'border_box', status: 'pass', reasons: [], shortPx: shortSide, variance: 0, clipped: 0 };
}

export function assessPhoto({ gray, width, height, originalWidth, originalHeight }) {
  const ow = originalWidth || width;
  const oh = originalHeight || height;
  const shortSide = Math.min(ow, oh);
  const variance = laplacianVariance(gray, width, height);
  let blurState = 'not-assessable';
  if (width >= 20 && height >= 20) {
    if (variance < BLUR_LOW) blurState = 'low-detail';
    else if (variance > BLUR_HIGH) blurState = 'not-flagged';
  }
  const fraction = clippedFraction(gray);
  let glareState = 'not-assessable';
  if (fraction < 0.005) glareState = 'no-large-clipped-highlight';
  else if (fraction <= 0.2) glareState = 'possible-glare';
  const centering = measureCentering(gray, width, height);
  const regions = {};
  if (gray && width > 0 && height > 0) {
    for (const [id, geom] of Object.entries(REGION_GEOM)) {
      if (id === 'border_box') continue;
      const slice = sliceGray(gray, width, height, geom);
      const regionVariance = laplacianVariance(slice.gray, slice.width, slice.height);
      const regionClipped = clippedFraction(slice.gray);
      const shortPx = Math.min(geom.w * ow, geom.h * oh);
      const sampleShort = Math.min(slice.width, slice.height);
      const classified = classifyRegion({
        variance: regionVariance,
        clipped: regionClipped,
        shortPx,
        sampleShort,
      });
      regions[id] = {
        id,
        status: classified.status,
        reasons: classified.reasons,
        variance: regionVariance,
        clipped: regionClipped,
        shortPx,
      };
    }
  }
  regions.border_box = borderBoxRegion(centering, shortSide);
  return {
    resolution: {
      state: shortSide < LIMITS.minShortEdge ? 'low' : 'ok',
      originalWidth: ow,
      originalHeight: oh,
      workingWidth: width,
      workingHeight: height,
    },
    blur: { state: blurState, variance },
    glare: { state: glareState, fraction },
    centering,
    regions,
  };
}

export function retakePrompts(side, report) {
  if (!report || !report.regions) return [];
  const sideLabel = side === 'back' ? 'Back' : 'Front';
  const prompts = [];
  for (const [id, region] of Object.entries(report.regions)) {
    if (!region || (region.status !== 'fail' && region.status !== 'unknown')) continue;
    const reason = (region.reasons && region.reasons[0]) || 'not-assessable';
    const why = RETAKE_WHY[reason] || RETAKE_WHY['not-assessable'];
    const tip = RETAKE_TIP[reason] || RETAKE_TIP['not-assessable'];
    const label = REGION_LABEL[id] || id;
    prompts.push({
      side: side === 'back' ? 'back' : 'front',
      regionId: id,
      label,
      reason,
      why,
      tip,
      line: `Retake needed: ${sideLabel} ${label} — Why: ${why} — Tip: ${tip}`,
    });
  }
  return prompts;
}

export function groupBlocked(report, group) {
  const ids = GROUP_IDS[group] || [];
  if (!report || !report.regions) return true;
  return ids.some((id) => {
    const status = report.regions[id] && report.regions[id].status;
    return status !== 'pass' && status !== 'warn';
  });
}

export function groupReadable(report, group) {
  const ids = GROUP_IDS[group] || [];
  if (!report || !report.regions) return false;
  return ids.some((id) => {
    const status = report.regions[id] && report.regions[id].status;
    return status === 'pass' || status === 'warn';
  });
}

export function centeringCeiling(centering, side) {
  if (!centering || centering.state !== 'measured') return null;
  const worst = Math.max(centering.leftPct, centering.rightPct, centering.topPct, centering.bottomPct);
  const table = side === 'back'
    ? [[75, 10], [90, 9]]
    : [[55, 10], [65, 9], [70, 8], [75, 7], [80, 6], [85, 5], [90, 3]];
  for (const [limit, grade] of table) {
    if (worst <= limit) return grade;
  }
  return 1;
}

function unavailableResult(blockedReasons) {
  return {
    label: PSA_LABEL,
    range: null,
    basis: [],
    blocked_reasons: blockedReasons,
    message: ESTIMATE_UNAVAILABLE,
    disclaimer: PSA_DISCLAIMER,
  };
}

function hasWarn(report) {
  if (!report || !report.regions) return false;
  return Object.values(report.regions).some((region) => region && region.status === 'warn');
}

function applyNotes(report, notes, sideLabel, basis, lower) {
  for (const group of Object.keys(WEAR_CAP)) {
    if (notes[group] === 'wear' && groupReadable(report, group)) {
      lower(WEAR_CAP[group]);
      basis.push(`${sideLabel} ${group}: wear visible in the photo — ceiling reduced`);
    }
  }
}

function noteIgnoredClean(report, notes, sideLabel, basis) {
  for (const group of Object.keys(WEAR_CAP)) {
    if (notes[group] === 'clean' && groupBlocked(report, group)) {
      basis.push(`${sideLabel} ${group}: a clean note was not counted because the photo check failed or abstained`);
    }
  }
}

function centeringCap(report, sideLabel, basis) {
  const centering = report && report.centering;
  const side = sideLabel === 'Back' ? 'back' : 'front';
  if (!centering || centering.state !== 'measured') {
    basis.push(`${sideLabel} centering: unknown — ceiling reduced`);
    return 8;
  }
  const cap = centeringCeiling(centering, side);
  const lr = `${Math.round(centering.leftPct)}/${Math.round(centering.rightPct)}`;
  const tb = `${Math.round(centering.topPct)}/${Math.round(centering.bottomPct)}`;
  basis.push(`${sideLabel} centering measured ${lr} left/right and ${tb} top/bottom (assessable). This is not a PSA centering subgrade.`);
  return cap == null ? 8 : cap;
}

export function psaEstimate(input) {
  const mode = input && input.mode === 'front-and-back' ? 'front-and-back' : 'front-only';
  const front = input && input.front;
  const back = input && input.back;
  const notes = (input && input.notes) || {};
  const frontNotes = notes.front || {};
  const backNotes = notes.back || {};
  if (!front) {
    return unavailableResult([
      'Retake needed: Front — Why: no front photo — Tip: Photograph the front with the rear camera at 1×.',
    ]);
  }
  if (mode === 'front-and-back' && !back) {
    return unavailableResult([
      'Retake needed: Back — Why: back photo is missing — Tip: Photograph the back with the rear camera at 1×, parallel to the card.',
    ]);
  }
  const blocked = [];
  for (const prompt of retakePrompts('front', front)) blocked.push(prompt);
  if (back) {
    for (const prompt of retakePrompts('back', back)) blocked.push(prompt);
  }
  const critical = blocked.filter((item) => CRITICAL_REGIONS.includes(item.regionId));
  if (critical.length >= PSA_BLOCK_AT) {
    const result = unavailableResult(blocked.map((item) => item.line));
    result.basis = blocked.map((item) => `${item.side === 'back' ? 'Back' : 'Front'} ${item.label}: ${item.why} — not counted as clean`);
    noteIgnoredClean(front, frontNotes, 'Front', result.basis);
    if (back) noteIgnoredClean(back, backNotes, 'Back', result.basis);
    return result;
  }
  let high = 10;
  const basis = [];
  if (critical.length) {
    high -= critical.length;
    for (const item of critical) {
      basis.push(`${item.side === 'back' ? 'Back' : 'Front'} ${item.label}: ${item.why} — ceiling reduced`);
    }
  }
  const extras = blocked.filter((item) => !CRITICAL_REGIONS.includes(item.regionId) && item.regionId !== 'border_box');
  if (extras.length) {
    high -= extras.length;
    for (const item of extras) {
      basis.push(`${item.side === 'back' ? 'Back' : 'Front'} ${item.label}: ${item.why} — ceiling reduced`);
    }
  }
  if (!back) {
    high = Math.min(high, 8);
    basis.push('Back: unknown (not photographed) — ceiling reduced');
  }
  high = Math.min(high, centeringCap(front, 'Front', basis));
  if (back) high = Math.min(high, centeringCap(back, 'Back', basis));
  if (hasWarn(front) || (back && hasWarn(back))) {
    high = Math.min(high, 9);
    basis.push('A region is only partly assessable — ceiling reduced');
  }
  applyNotes(front, frontNotes, 'Front', basis, (cap) => { high = Math.min(high, cap); });
  if (back) applyNotes(back, backNotes, 'Back', basis, (cap) => { high = Math.min(high, cap); });
  noteIgnoredClean(front, frontNotes, 'Front', basis);
  if (back) noteIgnoredClean(back, backNotes, 'Back', basis);
  high = Math.max(1, Math.min(10, Math.trunc(high)));
  const low = high === 1 ? 1 : high - 1;
  return {
    label: PSA_LABEL,
    range: { low, high },
    basis,
    blocked_reasons: blocked.map((item) => item.line),
    message: null,
    disclaimer: PSA_DISCLAIMER,
  };
}
