import type { DatabaseSync } from "node:sqlite";
import { databasePathFromUrl, openSqliteDatabase } from "./db/sqlite.js";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ServerEntity { profileId: string; entityType: string; entityId: string; revision: number; payload?: unknown; updatedAt: number; deviceId: string; deletedAt?: number; }
export interface Change extends ServerEntity { cursor: number; operation: "CREATE" | "UPDATE" | "DELETE"; }
export interface ShareRecord { shareId: string; code: string; packageBase64: string; contentHash: string; formatVersion: number; packageType?: "exam" | "vocabularySet"; storageKey?: string; createdAt: number; expiresAt?: number; ownerDeviceId?: string; ownerUserId?: string; deleted?: boolean; }
export interface ClosableRepository { close(): Promise<void>; }
export interface ServerRepository extends ClosableRepository { get(profileId: string, entityType: string, entityId: string): Promise<ServerEntity | undefined>; put(key: string, entity: ServerEntity): Promise<void>; purgeUser(userId:string): Promise<void>; searchExamIds(query:string,limit:number): Promise<ServerEntity[]>; }
export interface SyncRepository extends ClosableRepository { rememberMutation(mutationId: string, deviceId?: string): Promise<boolean>; append(change: Omit<Change, "cursor">): Promise<number>; pull(cursor: number, profileId: string, limit: number): Promise<{changes: Change[]; cursor: number; hasMore: boolean}>; transaction<T>(fn: () => Promise<T>): Promise<T>; }
export interface ShareRepository extends ClosableRepository { get(code: string): Promise<ShareRecord | undefined>; create(row: ShareRecord): Promise<void>; delete(code: string): Promise<void>; purgeUser(userId:string): Promise<void>; }

function isSqliteBusy(error: unknown) {
  const e = error as any;
  return e?.code === "SQLITE_BUSY" || e?.code === "SQLITE_LOCKED" || /database (is )?locked|database table is locked/i.test(String(e?.message ?? ""));
}

async function withSqliteRetry<T>(operation: () => T, attempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return operation(); }
    catch (error) {
      last = error;
      if (!isSqliteBusy(error) || i === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (i + 1)));
    }
  }
  throw last;
}

export class MemoryServerRepository implements ServerRepository { private readonly entities = new Map<string, ServerEntity>(); async get(profileId: string, entityType: string, entityId: string) { return this.entities.get(`${profileId}:${entityType}:${entityId}`); } async put(key: string, entity: ServerEntity) { this.entities.set(key, entity); } async purgeUser(userId:string){const prefix=`${userId}:`;for(const key of this.entities.keys())if(key.startsWith(prefix))this.entities.delete(key)} async searchExamIds(query:string,limit:number){return [...this.entities.values()].filter(x=>x.entityType==='exam'&&x.entityId.toLowerCase().includes(query.toLowerCase())).slice(0,limit)} async close() {} }
export class MemorySyncRepository implements SyncRepository { private readonly mutationIds = new Set<string>(); private readonly changes: Change[] = []; private cursor = 0; async rememberMutation(mutationId: string) { if (this.mutationIds.has(mutationId)) return false; this.mutationIds.add(mutationId); return true; } async append(change: Omit<Change, "cursor">) { const row = { ...change, cursor: ++this.cursor }; this.changes.push(row); return row.cursor; } async pull(cursor: number, profileId: string, limit: number) { const available = this.changes.filter(c => c.cursor > cursor); const page = available.filter(c => c.profileId === profileId).slice(0, limit); const scanned = available.slice(0, limit); const nextCursor = scanned.at(-1)?.cursor ?? cursor; return { changes: page, cursor: nextCursor, hasMore: available.some(c => c.cursor > nextCursor) }; } async transaction<T>(fn: () => Promise<T>) { return fn(); } async close() {} }
export class MemoryShareRepository implements ShareRepository { private readonly shares = new Map<string, ShareRecord>(); async get(code: string) { return this.shares.get(code); } async create(row: ShareRecord) { this.shares.set(row.code, row); } async delete(code: string) { const row = this.shares.get(code); if (row) row.deleted = true; } async purgeUser(userId:string){for(const row of this.shares.values())if(row.ownerUserId===userId)row.deleted=true} async close() {} }

export class SqliteServerRepository implements ServerRepository {
  constructor(public readonly db: DatabaseSync) {}
  async get(profileId: string, entityType: string, entityId: string) { const r = this.db.prepare("SELECT * FROM server_entities WHERE profile_id=? AND entity_type=? AND entity_id=?").get(profileId, entityType, entityId) as any; return r ? decodeEntity(r) : undefined; }
  async put(_key: string, entity: ServerEntity) { await withSqliteRetry(() => this.db.prepare(`INSERT INTO server_entities(profile_id,entity_type,entity_id,revision,payload,updated_at,device_id,deleted_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at,device_id=excluded.device_id,deleted_at=excluded.deleted_at`).run(entity.profileId, entity.entityType, entity.entityId, entity.revision, entity.payload === undefined ? null : JSON.stringify(entity.payload), entity.updatedAt, entity.deviceId, entity.deletedAt ?? null)); }
  async purgeUser(userId:string){const prefix=`${userId}:%`;await withSqliteRetry(()=>{this.db.prepare("DELETE FROM changes WHERE profile_id LIKE ?").run(prefix);this.db.prepare("DELETE FROM server_entities WHERE profile_id LIKE ?").run(prefix);});}
  async searchExamIds(query:string,limit:number){const rows=this.db.prepare("SELECT * FROM server_entities WHERE entity_type='exam' AND entity_id LIKE ? ORDER BY updated_at DESC LIMIT ?").all(`%${query}%`,limit) as any[];return rows.map(decodeEntity)}
  async close() {}
}

export class SqliteSyncRepository implements SyncRepository {
  private transactionTail: Promise<void> = Promise.resolve();
  constructor(public readonly db: DatabaseSync) {}
  async rememberMutation(mutationId: string, deviceId = "unknown") { const result = await withSqliteRetry(() => this.db.prepare("INSERT OR IGNORE INTO mutations(mutation_id,device_id,created_at) VALUES(?,?,?)").run(mutationId, deviceId, Date.now())); return Number(result.changes) === 1; }
  async append(change: Omit<Change, "cursor">) { const result = await withSqliteRetry(() => this.db.prepare(`INSERT INTO changes(profile_id,entity_type,entity_id,revision,operation,payload,updated_at,device_id,deleted_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(change.profileId, change.entityType, change.entityId, change.revision, change.operation, change.payload === undefined ? null : JSON.stringify(change.payload), change.updatedAt, change.deviceId, change.deletedAt ?? null)); return Number(result.lastInsertRowid); }
  async pull(cursor: number, profileId: string, limit: number) { const rows = this.db.prepare("SELECT * FROM changes WHERE cursor>? AND profile_id=? ORDER BY cursor LIMIT ?").all(cursor, profileId, limit) as any[]; const changes = rows.map(decodeChange); const nextCursor = changes.at(-1)?.cursor ?? cursor; const more = this.db.prepare("SELECT 1 FROM changes WHERE cursor>? AND profile_id=? LIMIT 1").get(nextCursor, profileId); return { changes, cursor: nextCursor, hasMore: Boolean(more) }; }
  async transaction<T>(fn: () => Promise<T>) {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      this.db.exec("BEGIN IMMEDIATE;");
      try {
        const result = await fn();
        this.db.exec("COMMIT;");
        return result;
      } catch (error) {
        try { this.db.exec("ROLLBACK;"); } catch {}
        throw error;
      }
    } finally {
      release();
    }
  }
  async close() { await this.transactionTail; }
}

export class SqliteShareRepository implements ShareRepository {
  private readonly storageDir: string;
  constructor(public readonly db: DatabaseSync, storageDir = process.env.SHARED_EXAMS_DIR ?? join(dirname(databasePathFromUrl(process.env.DATABASE_URL)), "shared-exams")) {
    this.storageDir = storageDir;
    mkdirSync(this.storageDir, { recursive: true });
  }
  async get(code: string) {
    const r = this.db.prepare("SELECT * FROM shares WHERE code=?").get(code) as any;
    if (!r) return undefined;
    const row = decodeShare(r);
    if (row.storageKey) {
      const extension = row.packageType === "vocabularySet" ? "json" : "exam";
      try { row.packageBase64 = readFileSync(join(this.storageDir, `${row.code}.${extension}`)).toString("base64"); } catch {}
    }
    return row;
  }
  async create(row: ShareRecord) {
    const extension = row.packageType === "vocabularySet" ? "json" : "exam";
    const storageKey = row.storageKey ?? `shared-exams/${row.code}.${extension}`;
    const filePath = join(this.storageDir, `${row.code}.${extension}`);
    const bytes = Buffer.from(row.packageBase64, "base64");

    // The SQLite row remains the durable source of truth. The code-named file is
    // materialized when the filesystem is writable (Railway Volume), but a
    // read-only/misconfigured share directory must not make the API return 500.
    // GET falls back to package_base64 stored in SQLite.
    let fileWritten = false;
    try {
      mkdirSync(this.storageDir, { recursive: true });
      writeFileSync(filePath, bytes, { flag: "wx" });
      fileWritten = true;
    } catch (error) {
      if ((error as any)?.code !== "EEXIST") {
        console.warn(JSON.stringify({ event: "share_file_materialize_failed", code: (error as any)?.code, message: String((error as any)?.message ?? error), storageDir: this.storageDir }));
      }
    }

    try {
      await withSqliteRetry(() => this.db.prepare(`INSERT INTO shares(share_id,code,package_base64,content_hash,format_version,package_type,storage_key,created_at,expires_at,owner_device_id,owner_user_id,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.shareId,row.code,row.packageBase64,row.contentHash,row.formatVersion,row.packageType ?? "exam",storageKey,row.createdAt,row.expiresAt ?? null,row.ownerDeviceId ?? null,row.ownerUserId ?? null,row.deleted ? row.createdAt : null));
    } catch (error) {
      if (fileWritten) { try { unlinkSync(filePath); } catch {} }
      throw error;
    }
  }
  async delete(code: string) {
    this.db.prepare("UPDATE shares SET deleted_at=? WHERE code=?").run(Date.now(), code);
    for (const extension of ["exam", "json"]) { try { unlinkSync(join(this.storageDir, `${code}.${extension}`)); } catch {} }
  }
  async purgeUser(userId:string){await withSqliteRetry(()=>this.db.prepare("UPDATE shares SET deleted_at=? WHERE owner_user_id=? AND deleted_at IS NULL").run(Date.now(),userId));}
  async close() { this.db.close(); }
}

function decodeEntity(r: any): ServerEntity { return { profileId:r.profile_id, entityType:r.entity_type, entityId:r.entity_id, revision:r.revision, payload:r.payload == null ? undefined : JSON.parse(r.payload), updatedAt:r.updated_at, deviceId:r.device_id, deletedAt:r.deleted_at ?? undefined }; }
function decodeChange(r: any): Change { return { ...decodeEntity(r), cursor:r.cursor, operation:r.operation }; }
function decodeShare(r: any): ShareRecord { return { shareId:r.share_id, code:r.code, packageBase64:r.package_base64, contentHash:r.content_hash, formatVersion:r.format_version, packageType:r.package_type ?? "exam", storageKey:r.storage_key ?? `shared-exams/${r.code}.exam`, createdAt:r.created_at, expiresAt:r.expires_at ?? undefined, ownerDeviceId:r.owner_device_id ?? undefined, ownerUserId:r.owner_user_id ?? undefined, deleted:Boolean(r.deleted_at) }; }

export function createSqliteRepositories(databaseUrl = process.env.DATABASE_URL) {
  const db = openSqliteDatabase(databaseUrl);
  return { db, serverRepository: new SqliteServerRepository(db), syncRepository: new SqliteSyncRepository(db), shareRepository: new SqliteShareRepository(db, process.env.SHARED_EXAMS_DIR ?? join(dirname(databasePathFromUrl(databaseUrl)), "shared-exams")) };
}
