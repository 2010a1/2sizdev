import { mkdirSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type SqliteDatabase = DatabaseSyncType;

export function databasePathFromUrl(url = process.env.DATABASE_URL ?? "file:./data/exam-platform.db") {
  if (url === ":memory:" || url === "file::memory:") return ":memory:";
  if (url.startsWith("file:")) return resolve(process.cwd(), url.slice(5));
  return resolve(process.cwd(), url);
}

export function openSqliteDatabase(url?: string): SqliteDatabase {
  const filename = databasePathFromUrl(url);
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

function migrate(db: SqliteDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
  const applied = new Set<string>((db.prepare("SELECT id FROM _migrations ORDER BY id").all() as Array<{id: string}>).map(r => r.id));
  const migrations: Array<[string, string]> = [
    ["0001_initial", `
      CREATE TABLE IF NOT EXISTS server_entities (
        profile_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        payload TEXT,
        updated_at INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        deleted_at INTEGER,
        PRIMARY KEY(profile_id, entity_type, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_entities_profile_type ON server_entities(profile_id, entity_type);
      CREATE TABLE IF NOT EXISTS changes (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('CREATE','UPDATE','DELETE')),
        payload TEXT,
        updated_at INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_changes_profile_cursor ON changes(profile_id, cursor);
      CREATE TABLE IF NOT EXISTS mutations (
        mutation_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shares (
        share_id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        package_base64 TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        format_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        owner_device_id TEXT,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at);
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_sync_at INTEGER
      );
    `],
    ["0003_auth_admin", `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('USER','ADMIN')) DEFAULT 'USER',
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','LOCKED','LIMITED')) DEFAULT 'ACTIVE',
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS security_events (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        username TEXT,
        action TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('INFO','WARNING','HIGH','CRITICAL')),
        ip TEXT,
        user_agent TEXT,
        endpoint TEXT,
        result TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_security_created ON security_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_security_action ON security_events(action,created_at);
      CREATE INDEX IF NOT EXISTS idx_security_user ON security_events(user_id,created_at);
      CREATE TABLE IF NOT EXISTS exam_activity (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        profile_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('practice','tournament','english')),
        exam_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_created ON exam_activity(created_at);
      CREATE INDEX IF NOT EXISTS idx_activity_user ON exam_activity(user_id,created_at);
      CREATE TABLE IF NOT EXISTS official_exams (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        grade INTEGER,
        version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        package_base64 TEXT NOT NULL,
        question_count INTEGER NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        published_at INTEGER,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_official_subject_grade ON official_exams(subject,grade);
      CREATE INDEX IF NOT EXISTS idx_official_updated ON official_exams(updated_at);
    `],
    ["0002_share_storage", `
      ALTER TABLE shares ADD COLUMN package_type TEXT NOT NULL DEFAULT 'exam';
      ALTER TABLE shares ADD COLUMN storage_key TEXT;
      UPDATE shares SET storage_key = CASE WHEN package_type = 'vocabularySet' THEN 'shared-exams/' || code || '.json' ELSE 'shared-exams/' || code || '.exam' END WHERE storage_key IS NULL;
    `]
    , ["0004_account_security_features", `
      ALTER TABLE users RENAME TO users_old;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('USER','ADMIN')) DEFAULT 'USER',
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED','BANNED','DELETED','LOCKED','LIMITED')) DEFAULT 'ACTIVE',
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        suspended_until INTEGER,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      INSERT INTO users(id,username,password_hash,role,status,failed_attempts,locked_until,created_at,last_login_at)
        SELECT id,username,password_hash,role,status,failed_attempts,locked_until,created_at,last_login_at FROM users_old;
      ALTER TABLE sessions RENAME TO sessions_old;
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        user_agent TEXT,
        ip TEXT
      );
      INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at,last_seen_at)
        SELECT id,user_id,token_hash,expires_at,created_at,last_seen_at FROM sessions_old;
      DROP TABLE sessions_old;
      DROP TABLE users_old;
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
      CREATE TABLE IF NOT EXISTS security_alerts (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('INFO','WARNING','HIGH','CRITICAL')),
        status TEXT NOT NULL CHECK(status IN ('NEW','REVIEWED','RESOLVED')) DEFAULT 'NEW', user_id TEXT, ip TEXT, reason TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 1, metadata TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_created ON security_alerts(created_at);
      CREATE INDEX IF NOT EXISTS idx_alerts_status ON security_alerts(status,updated_at);
      CREATE INDEX IF NOT EXISTS idx_alerts_user ON security_alerts(user_id,created_at);
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, ip TEXT, user_agent TEXT,
        result TEXT NOT NULL, metadata TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_id,created_at);
      CREATE TABLE IF NOT EXISTS feature_flags (
        key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, updated_by TEXT
      );
    `]
    , ["0005_security_hardening", `
      ALTER TABLE shares ADD COLUMN owner_user_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_shares_owner_user ON shares(owner_user_id,created_at);
      CREATE INDEX IF NOT EXISTS idx_security_ip_created ON security_events(ip,created_at);
      CREATE INDEX IF NOT EXISTS idx_security_user_action_created ON security_events(user_id,action,created_at);
      CREATE INDEX IF NOT EXISTS idx_alerts_type_ip_created ON security_alerts(type,ip,created_at);
    `]
    , ["0006_display_name", `
      ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
      UPDATE users SET display_name = username WHERE TRIM(display_name) = '';
      CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name COLLATE NOCASE);
    `]
    , ["0007_ai_keys", `
      CREATE TABLE IF NOT EXISTS ai_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        failures INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ai_keys_enabled ON ai_keys(enabled,cooldown_until);
    `]
    , ["0008_admin_ai_settings", `
      CREATE TABLE IF NOT EXISTS ai_settings (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      );
      INSERT OR IGNORE INTO ai_settings(key,value,updated_at) VALUES
        ('AI_CHAT_RATE_LIMIT_PER_MINUTE',20,0),
        ('AI_EXPLAIN_RATE_LIMIT_PER_MINUTE',10,0),
        ('AI_JSON_RATE_LIMIT_PER_MINUTE',5,0);
    `]
    , ["0009_gemini_ai_pool", `
      ALTER TABLE ai_keys ADD COLUMN provider TEXT NOT NULL DEFAULT 'gemini';
      ALTER TABLE ai_keys ADD COLUMN rpm_limit INTEGER NOT NULL DEFAULT 15;
      ALTER TABLE ai_keys ADD COLUMN window_start INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ai_keys ADD COLUMN window_count INTEGER NOT NULL DEFAULT 0;
      UPDATE ai_keys SET provider='gemini', rpm_limit=15 WHERE provider IS NULL OR provider='groq';
    `]
    , ["0010_share_management", `
      ALTER TABLE shares ADD COLUMN updated_at INTEGER;
      ALTER TABLE shares ADD COLUMN source_entity_id TEXT;
      ALTER TABLE shares ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE shares ADD COLUMN last_access_at INTEGER;
      UPDATE shares SET updated_at = created_at WHERE updated_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_shares_owner_updated ON shares(owner_user_id,updated_at);
    `]
    , ["0011_notifications_settings", `
      CREATE TABLE IF NOT EXISTS notification_messages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'announcement',
        link TEXT,
        status TEXT NOT NULL CHECK(status IN ('DRAFT','SCHEDULED','SENT')) DEFAULT 'DRAFT',
        audience TEXT NOT NULL CHECK(audience IN ('ALL','USERS')) DEFAULT 'ALL',
        target_user_ids TEXT,
        scheduled_at INTEGER,
        sent_at INTEGER,
        sent_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notification_messages_status ON notification_messages(status, scheduled_at);
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        notification_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'announcement',
        link TEXT,
        read_at INTEGER,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      );
    `]
  ];
  for (const [id, sql] of migrations) {
    if (applied.has(id)) continue;
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations(id, applied_at) VALUES(?, ?)").run(id, Date.now());
      db.exec("COMMIT;");
    } catch (error) {
      try { db.exec("ROLLBACK;"); } catch {}
      throw error;
    }
  }

  // Repair databases created by older releases where the tables already existed
  // before the runtime migration ledger was introduced. CREATE TABLE IF NOT EXISTS
  // cannot add columns to such tables, so make the required share columns explicit.
  const userColumns = new Set((db.prepare("PRAGMA table_info(users)").all() as Array<{name:string}>).map(r => r.name));
  const userMissing: Array<[string,string]> = [["display_name","TEXT NOT NULL DEFAULT ''"],["email","TEXT"],["suspended_until","INTEGER"],["must_change_password","INTEGER NOT NULL DEFAULT 0"],["deleted_at","INTEGER"]];
  for (const [name, definition] of userMissing) if (!userColumns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  db.exec("UPDATE users SET display_name = username WHERE TRIM(display_name) = ''");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name COLLATE NOCASE)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL");
  const sessionColumns = new Set((db.prepare("PRAGMA table_info(sessions)").all() as Array<{name:string}>).map(r => r.name));
  for (const [name, definition] of [["user_agent","TEXT"],["ip","TEXT"]] as Array<[string,string]>) if (!sessionColumns.has(name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${definition}`);
  const shareColumns = new Set((db.prepare("PRAGMA table_info(shares)").all() as Array<{name:string}>).map(r => r.name));
  const missingShareColumns: Array<[string,string]> = [
    ["package_type", "TEXT NOT NULL DEFAULT 'exam'"],
    ["storage_key", "TEXT"],
    ["owner_user_id", "TEXT"],
    ["owner_name", "TEXT"],
    ["owner_avatar", "TEXT"],
    ["updated_at", "INTEGER"],
    ["source_entity_id", "TEXT"],
    ["access_count", "INTEGER NOT NULL DEFAULT 0"],
    ["last_access_at", "INTEGER"],
  ];
  for (const [name, definition] of missingShareColumns) {
    if (!shareColumns.has(name)) db.exec(`ALTER TABLE shares ADD COLUMN ${name} ${definition}`);
  }
  db.exec("UPDATE shares SET storage_key = CASE WHEN package_type = 'vocabularySet' THEN 'shared-exams/' || code || '.json' ELSE 'shared-exams/' || code || '.exam' END WHERE storage_key IS NULL");
  db.exec("UPDATE shares SET updated_at = created_at WHERE updated_at IS NULL");
  db.exec("CREATE INDEX IF NOT EXISTS idx_shares_owner_user ON shares(owner_user_id,created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_shares_owner_updated ON shares(owner_user_id,updated_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_security_ip_created ON security_events(ip,created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_security_user_action_created ON security_events(user_id,action,created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_alerts_type_ip_created ON security_alerts(type,ip,created_at)");
}

export function assertSqliteDatabase(url = process.env.DATABASE_URL ?? "file:./data/exam-platform.db") {
  const path = databasePathFromUrl(url);
  if (path !== ":memory:" && !existsSync(path)) throw new Error(`SQLite database does not exist: ${path}`);
}

export function backupSqlite(source: string, destination: string) {
  const sourcePath = databasePathFromUrl(source);
  if (sourcePath === ":memory:") throw new Error("Cannot backup an in-memory database");
  mkdirSync(dirname(resolve(destination)), { recursive: true });
  const db = new DatabaseSync(sourcePath);
  try { db.exec(`VACUUM INTO '${resolve(destination).replaceAll("'", "''")}'`); }
  finally { db.close(); }
}

export function restoreSqlite(source: string, destination: string) {
  const sourcePath = resolve(source);
  const destinationPath = databasePathFromUrl(destination);
  if (destinationPath === ":memory:") throw new Error("Cannot restore into an in-memory database");
  if (!existsSync(sourcePath)) throw new Error(`Backup does not exist: ${sourcePath}`);
  const validation = new DatabaseSync(sourcePath);
  try {
    const row = validation.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
    if (row.integrity_check !== "ok") throw new Error("Backup failed SQLite integrity_check");
    validation.prepare("SELECT 1 FROM _migrations LIMIT 1").get();
  } finally { validation.close(); }
  mkdirSync(dirname(destinationPath), { recursive: true });
  const tmp = `${destinationPath}.restore-${process.pid}-${Date.now()}`;
  copyFileSync(sourcePath, tmp);
  const check = new DatabaseSync(tmp); check.close();
  copyFileSync(tmp, destinationPath); unlinkSync(tmp);
}
