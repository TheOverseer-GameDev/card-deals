/**
 * Imports a set-list pack. Rows are game, set id, name, date, count, and source.
 * A native SQLite connection is used when the plugin is on the phone.
 * Tests and the browser preview use the memory table. No image bytes are stored.
 */

const COLUMNS = ['game', 'set_id', 'name', 'release_date', 'card_count', 'source'];

export function memoryCatalog() {
  const rows = [];
  return {
    kind: 'memory',
    async run(_sql, row) {
      rows.push(row);
    },
    async all() {
      return rows.map((row) => ({ ...row }));
    },
  };
}

export async function importCatalog(db, pack) {
  const rows = pack && Array.isArray(pack.rows) ? pack.rows : [];
  for (const row of rows) {
    for (const key of COLUMNS) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) throw new Error(`catalog row missing ${key}`);
    }
    await db.run(
      'INSERT INTO sets (game, set_id, name, release_date, card_count, source) VALUES (?, ?, ?, ?, ?, ?)',
      row,
    );
  }
  return rows.length;
}

const DB = 'card-deals-catalog';

export async function openCatalog(scope) {
  const plugin = scope && scope.Capacitor && scope.Capacitor.Plugins && scope.Capacitor.Plugins.CapacitorSQLite;
  if (!plugin || typeof plugin.createConnection !== 'function') return memoryCatalog();
  await plugin.createConnection({
    database: DB,
    version: 1,
    encrypted: false,
    mode: 'no-encryption',
    readonly: false,
  });
  if (typeof plugin.open === 'function') await plugin.open({ database: DB, readonly: false });
  if (typeof plugin.execute === 'function') {
    await plugin.execute({
      database: DB,
      statements: 'CREATE TABLE IF NOT EXISTS sets (game TEXT, set_id TEXT, name TEXT, release_date TEXT, card_count INTEGER, source TEXT);',
      transaction: false,
    });
  }
  return {
    kind: 'sqlite',
    async run(sql, row) {
      await plugin.run({
        database: DB,
        statement: sql,
        values: COLUMNS.map((key) => row[key]),
        transaction: false,
      });
    },
    async all() {
      const result = await plugin.query({
        database: DB,
        statement: 'SELECT game, set_id, name, release_date, card_count, source FROM sets',
        values: [],
      });
      return (result && result.values) || [];
    },
  };
}
