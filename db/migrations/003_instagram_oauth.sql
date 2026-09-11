CREATE TABLE vn_instagram_oauth_states (
 state_hash text PRIMARY KEY,
 browser_hash text NOT NULL,
 admin_hash text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE vn_instagram_connection (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 app_scoped_id text NOT NULL,
 instagram_user_id text NOT NULL,
 username text NOT NULL,
 account_type text NOT NULL,
 token_ciphertext text NOT NULL,
 permissions text[] NOT NULL,
 issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 connected_at timestamptz NOT NULL DEFAULT now(),
 refresh_status text NOT NULL DEFAULT 'ok'
);
-- The OAuth pilot is explicitly paused, including existing installations.
INSERT INTO vn_runtime_controls(key,value,updated_by)
VALUES ('auto_replies_enabled','false'::jsonb,'Instagram OAuth pilot')
ON CONFLICT(key) DO UPDATE SET value='false'::jsonb,updated_at=now(),updated_by=excluded.updated_by;
