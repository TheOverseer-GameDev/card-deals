/**
 * Reads card-type profiles. A new game is another JSON file in this folder.
 * This module does not name a game.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export function validateProfile(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return ['profile is not an object'];
  for (const key of ['id', 'label', 'family', 'size_mm', 'thickness', 'surfaces', 'centering', 'id_features', 'data_sources', 'status']) {
    if (data[key] == null || data[key] === '') errors.push(`missing ${key}`);
  }
  if (typeof data.id === 'string' && !/^[a-z0-9-]+$/.test(data.id)) errors.push('id has characters outside a-z, 0-9, and hyphen');
  if (data.family != null && !['sports', 'tcg', 'nonsport'].includes(data.family)) errors.push('family is not sports, tcg, or nonsport');
  const size = data.size_mm;
  if (size && (typeof size.w !== 'number' || typeof size.h !== 'number' || typeof size.tol !== 'number')) {
    errors.push('size_mm needs numeric w, h, and tol');
  }
  for (const key of ['thickness', 'surfaces', 'id_features']) {
    if (data[key] != null && !Array.isArray(data[key])) errors.push(`${key} is not a list`);
  }
  if (data.centering != null && (typeof data.centering !== 'object' || Array.isArray(data.centering))) {
    errors.push('centering is not an object');
  }
  if (data.data_sources != null && (typeof data.data_sources !== 'object' || Array.isArray(data.data_sources))) {
    errors.push('data_sources is not an object');
  }
  if (data.status != null && typeof data.status !== 'string') errors.push('status is not a string');
  return errors;
}

export function loadProfiles(dir) {
  const names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  return names.map((name) => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const errors = validateProfile(data);
    if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
    const id = name.slice(0, -5);
    if (data.id !== id) throw new Error(`${name} id is ${data.id}`);
    return data;
  });
}

export function bundledProfiles() {
  return loadProfiles(path.join(root, 'registry/profiles'));
}
