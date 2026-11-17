-- Passkeys (WebAuthn) for account sign-in (stl00/Cardybara#461, epic #410). Applied after 0001 with the same
-- `wrangler d1 migrations apply` command. Both tables are listed in TABLES in gateway/src/accounts.js; deleting an
-- account empties each of them for that user.
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys (user_id);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  user_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
