CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  encrypted_data TEXT NOT NULL,
  iv TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_expires_at ON secrets(expires_at);
