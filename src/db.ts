import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
 host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER,
 password: process.env.PGPASSWORD, database: process.env.PGDATABASE || 'postgres',
});
export async function migrate() {
 const db = await pool.connect();
 try {
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(86162026)');
  await db.query('CREATE TABLE IF NOT EXISTS vn_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const name of readdirSync(join(process.cwd(), 'db/migrations')).filter(n => n.endsWith('.sql')).sort()) {
   const sql = readFileSync(join(process.cwd(), 'db/migrations', name), 'utf8');
   const checksum = createHash('sha256').update(sql).digest('hex');
   const prior = await db.query('SELECT checksum FROM vn_migrations WHERE name=$1', [name]);
   if (prior.rowCount) { if (prior.rows[0].checksum !== checksum) throw new Error('Applied migration changed: ' + name); continue; }
   await db.query(sql);
   await db.query('INSERT INTO vn_migrations(name,checksum) VALUES($1,$2)', [name,checksum]);
  }
  await db.query('COMMIT');
 } catch(e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
}
if (require.main === module) migrate().then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
