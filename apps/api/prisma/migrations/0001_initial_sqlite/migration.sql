-- Phase 9 canonical SQLite schema migration. Runtime migration runner applies the same schema transactionally.
CREATE TABLE IF NOT EXISTS server_entities (
  profile_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL, payload TEXT, updated_at INTEGER NOT NULL,
  device_id TEXT NOT NULL, deleted_at INTEGER,
  PRIMARY KEY(profile_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_entities_profile_type ON server_entities(profile_id, entity_type);
CREATE TABLE IF NOT EXISTS changes (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('CREATE','UPDATE','DELETE')),
  payload TEXT, updated_at INTEGER NOT NULL, device_id TEXT NOT NULL, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_changes_profile_cursor ON changes(profile_id, cursor);
CREATE TABLE IF NOT EXISTS mutations (mutation_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shares (
  share_id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, package_base64 TEXT NOT NULL,
  content_hash TEXT NOT NULL, format_version INTEGER NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER, owner_device_id TEXT, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at);
CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_sync_at INTEGER);
