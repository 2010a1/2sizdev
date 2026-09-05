import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AuthStore } from "./auth.js";
import { databasePathFromUrl } from "./db/sqlite.js";
import type { ServerRepository, ShareRepository, SyncRepository } from "./repositories.js";

/** Disk-budget GC. Railway volumes are small (~500MB) and before this module
 * nothing ever deleted expired shares, soft-deleted share rows, sync mutation
 * markers, long-deleted entities, or their change-log rows — every one of those
 * grew without bound. Retention defaults are generous (well beyond any client
 * retry window) so no live sync/share flow ever notices the purges. */
export interface GcOptions {
  /** How long a share survives past its expiry (or past a soft delete) before the row and file are removed. */
  shareGraceMs?: number;
  /** How long sync idempotency markers (mutation ids) are kept. */
  mutationTtlMs?: number;
  /** How long a deleted sync entity (and its change rows) is kept before hard purge. */
  entityTtlMs?: number;
  /** "auto" vacuums only after a meaningful purge, "always"/"never" force it. VACUUM rewrites the DB file — that is the only thing that actually returns bytes to the disk. */
  vacuum?: "auto" | "always" | "never";
}

export interface GcReport {
  sharesPurged: number;
  mutationsPurged: number;
  entitiesPurged: number;
  changesPurged: number;
  vacuumed: boolean;
  dbBytesBefore: number;
  dbBytesAfter: number;
}

export const DAY = 86_400_000;

export async function runStorageGc(
  db: DatabaseSync | undefined,
  repos: { serverRepository: ServerRepository; syncRepository: SyncRepository; shareRepository: ShareRepository; authStore: AuthStore },
  options: GcOptions = {},
): Promise<GcReport> {
  const now = Date.now();
  const shareGrace = options.shareGraceMs ?? 7 * DAY;
  const mutationTtl = options.mutationTtlMs ?? 7 * DAY;
  const entityTtl = options.entityTtlMs ?? 30 * DAY;
  const vacuum = options.vacuum ?? "auto";
  const dbFile = sqliteFilePath(db);
  const dbBytesBefore = fileSize(dbFile);
  const sharesPurged = await repos.shareRepository.purgeExpired(now - shareGrace);
  const mutationsPurged = await repos.syncRepository.purgeMutations(now - mutationTtl);
  const { entities: entitiesPurged, changes: changesPurged } = await repos.serverRepository.purgeDeleted(now - entityTtl);
  // sessions / security_events / alerts already have retention logic in
  // AuthStore.cleanup(); it just was never scheduled in production.
  try { repos.authStore.cleanup(); } catch {}
  const purgedTotal = sharesPurged + mutationsPurged + entitiesPurged + changesPurged;
  let vacuumed = false;
  if (db && vacuum !== "never" && (vacuum === "always" || purgedTotal > 500)) {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      db.exec("VACUUM;");
      vacuumed = true;
    } catch {}
  }
  return { sharesPurged, mutationsPurged, entitiesPurged, changesPurged, vacuumed, dbBytesBefore, dbBytesAfter: fileSize(dbFile) };
}

export interface StorageStats {
  driver: "sqlite" | "memory";
  dbBytes: number;
  walBytes: number;
  sharedExamsBytes: number;
  sharedExamsFiles: number;
  tables?: Record<string, number>;
  topShareOwners?: Array<{ ownerUserId: string | null; shares: number; bytes: number }>;
}

export function storageStats(db: DatabaseSync | undefined, sharedExamsDir: string | undefined): StorageStats {
  const dbFile = sqliteFilePath(db);
  const stats: StorageStats = {
    driver: dbFile ? "sqlite" : "memory",
    dbBytes: fileSize(dbFile),
    walBytes: dbFile ? fileSize(`${dbFile}-wal`) : 0,
    sharedExamsBytes: 0,
    sharedExamsFiles: 0,
  };
  if (sharedExamsDir) {
    try {
      for (const name of readdirSync(sharedExamsDir)) {
        stats.sharedExamsFiles += 1;
        stats.sharedExamsBytes += fileSize(join(sharedExamsDir, name));
      }
    } catch {}
  }
  if (db) {
    try {
      stats.tables = {
        shares: count(db, "SELECT COUNT(*) c FROM shares"),
        sharesDeleted: count(db, "SELECT COUNT(*) c FROM shares WHERE deleted_at IS NOT NULL"),
        // Not-deleted only: sharesDeleted already counts rows with deleted_at set, so
        // including them here double-counted the same row in the admin KPI card.
        sharesExpired: count(db, "SELECT COUNT(*) c FROM shares WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at < " + Date.now()),
        serverEntities: count(db, "SELECT COUNT(*) c FROM server_entities"),
        serverEntitiesDeleted: count(db, "SELECT COUNT(*) c FROM server_entities WHERE deleted_at IS NOT NULL"),
        changes: count(db, "SELECT COUNT(*) c FROM changes"),
        mutations: count(db, "SELECT COUNT(*) c FROM mutations"),
        sessions: count(db, "SELECT COUNT(*) c FROM sessions"),
        securityEvents: count(db, "SELECT COUNT(*) c FROM security_events"),
        securityAlerts: count(db, "SELECT COUNT(*) c FROM security_alerts"),
        auditLogs: count(db, "SELECT COUNT(*) c FROM audit_logs"),
        examActivity: count(db, "SELECT COUNT(*) c FROM exam_activity"),
      };
      stats.topShareOwners = (db.prepare("SELECT owner_user_id owner, COUNT(*) shares, SUM(LENGTH(package_base64)) bytes FROM shares WHERE deleted_at IS NULL GROUP BY owner_user_id ORDER BY bytes DESC LIMIT 10").all() as Array<{ owner: string | null; shares: number; bytes: number | null }>).map(r => ({ ownerUserId: r.owner, shares: Number(r.shares), bytes: Number(r.bytes ?? 0) }));
    } catch {}
  }
  return stats;
}

function sqliteFilePath(db: DatabaseSync | undefined): string | undefined {
  // An injected test db has no known file path; stats degrade to 0 instead of failing.
  if (!db) return undefined;
  try { return databasePathFromUrl(); } catch { return undefined; }
}

function fileSize(path: string | undefined): number {
  if (!path) return 0;
  try { return statSync(path).size; } catch { return 0; }
}

function count(db: DatabaseSync, sql: string): number {
  return Number((db.prepare(sql).get() as { c: number }).c);
}
