CREATE TABLE IF NOT EXISTS vn_runtime_controls (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'system'
);

INSERT INTO vn_runtime_controls(key, value, updated_by)
VALUES ('auto_replies_enabled', 'false'::jsonb, 'migration')
ON CONFLICT (key) DO NOTHING;
