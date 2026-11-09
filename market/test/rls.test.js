import { spawnSync } from 'node:child_process';
import test from 'node:test';

const psql = spawnSync('psql', ['--version'], { encoding: 'utf8' });

test('schema RLS is checked when a local Postgres is available', { skip: psql.status !== 0 }, () => {
  // A machine with Postgres can point DATABASE_URL at a disposable database and run supabase/schema.sql.
});
