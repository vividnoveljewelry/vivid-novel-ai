import { pool } from '../db';

export async function getAutoRepliesEnabled(): Promise<boolean> {
  const result = await pool.query(
    "SELECT value FROM vn_runtime_controls WHERE key='auto_replies_enabled'"
  );
  return result.rows[0]?.value === true;
}

export async function setAutoRepliesEnabled(enabled: boolean, actor: string): Promise<void> {
  await pool.query(
    `INSERT INTO vn_runtime_controls(key,value,updated_by)
     VALUES('auto_replies_enabled',$1::jsonb,$2)
     ON CONFLICT(key) DO UPDATE
     SET value=excluded.value, updated_at=now(), updated_by=excluded.updated_by`,
    [JSON.stringify(enabled), actor]
  );
}

export async function runtimeStatus() {
  const result = await pool.query(
    "SELECT value, updated_at, updated_by FROM vn_runtime_controls WHERE key='auto_replies_enabled'"
  );
  const row = result.rows[0];
  return {
    autoRepliesEnabled: row?.value === true,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}
