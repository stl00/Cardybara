-- Plaid-linked credit cards (PLAID_PLAN.md). Applied after 0002 with the same `wrangler d1 migrations apply` command.
-- Every table is listed in TABLES in gateway/src/accounts.js; deleting an account calls Plaid /item/remove for each Item
-- and then empties each table for that user. The access token is stored only AES-GCM encrypted (gateway/src/plaid.js).
CREATE TABLE IF NOT EXISTS plaid_items (
  item_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  account_keys TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  error_code TEXT,
  initial_complete INTEGER NOT NULL DEFAULT 0,
  historical_complete INTEGER NOT NULL DEFAULT 0,
  accounts TEXT,
  liabilities TEXT,
  liabilities_at INTEGER,
  synced_at INTEGER,
  refreshed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plaid_items_user ON plaid_items (user_id);
CREATE TABLE IF NOT EXISTS plaid_transactions (
  transaction_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plaid_transactions_user ON plaid_transactions (user_id);
CREATE INDEX IF NOT EXISTS plaid_transactions_item ON plaid_transactions (item_id);
CREATE TABLE IF NOT EXISTS plaid_link_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT,
  link_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
