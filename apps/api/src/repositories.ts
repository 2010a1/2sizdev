import type { DatabaseSync } from "node:sqlite";
import { databasePathFromUrl, openSqliteDatabase } from "./db/sqlite.js";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ServerEntity { profileId: string; entityType: string; entityId: string; revision: number; payload?: unknown; updatedAt: number; deviceId: string; deletedAt?: number; }
export interface Change extends ServerEntity { cursor: number; operation: "CREATE" | "UPDATE" | "DELETE"; }
export interface ShareRecord { shareId: string; code: string; packageBase64: string; contentHash: string; formatVersion: number; packageType?: "exam" | "vocabularySet"; storageKey?: string; createdAt: number; updatedAt?: number; expiresAt?: number; ownerDeviceId?: string; ownerUserId?: string; ownerName?: string; ownerAvatar?: string; sourceEntityId?: string; accessCount?: number; lastAccessAt?: number; deleted?: boolean; }
export interface ClosableRepository { close(): Promise<void>; }
export type ExamListRow = { profileId: string; ownerUserId: string; entityId: string; title: string; questionCount: number; revision: number; updatedAt: number; deletedAt?: number };
export interface ServerRepository extends ClosableRepository { get(profileId: string, entityType: string, entityId: string): Promise<ServerEntity | undefined>; put(key: string, entity: ServerEntity): Promise<void>; purgeUser(userId:string): Promise<void>; searchExamIds(query:string,limit:number): Promise<ServerEntity[]>; purgeDeleted(cutoff:number): Promise<{entities:number;changes:number}>; countExamsByUser(userId:string): Promise<number>; listExams(opts:{owner?:string;search?:string;offset:number;limit:number}):Promise<{rows:ExamListRow[];total:number}>; softDeleteExamsByOwner(ownerUserId:string,entityId:string):Promise<ServerEntity[]>; }
export interface SyncRepository extends ClosableRepository { rememberMutation(mutationId: string, deviceId?: string): Promise<boolean>; append(change: Omit<Change, "cursor">): Promise<number>; pull(cursor: number, profileId: string, limit: number): Promise<{changes: Change[]; cursor: number; hasMore: boolean}>; transaction<T>(fn: () => Promise<T>): Promise<T>; purgeMutations(cutoff:number): Promise<number>; }
export type ShareSummary = Omit<ShareRecord, "packageBase64"> & { sizeBytes: number };
export interface ShareRepository extends ClosableRepository { get(code: string): Promise<ShareRecord | undefined>; listByOwner(userId:string): Promise<ShareRecord[]>; listAll(offset:number, limit:number): Promise<ShareSummary[]>; countByOwner(userId:string): Promise<number>; create(row: ShareRecord): Promise<void>; update(row: ShareRecord): Promise<void>; incrementAccess(code:string): Promise<void>; delete(code: string): Promise<void>; purgeUser(userId:string): Promise<void>; purgeExpired(cutoff:number): Promise<number>; hardDelete(code:string): Promise<void>; }

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

function examRowFrom(entity: ServerEntity): ExamListRow { const payload = (entity.payload ?? {}) as any; return { profileId: entity.profileId, ownerUserId: entity.profileId.split(":")[0], entityId: entity.entityId, title: typeof payload?.title === "string" ? payload.title : "", questionCount: Array.isArray(payload?.questions) ? payload.questions.length : 0, revision: entity.revision, updatedAt: entity.updatedAt, deletedAt: entity.deletedAt }; }
export class MemoryServerRepository implements ServerRepository { private readonly entities = new Map<string, ServerEntity>(); async get(profileId: string, entityType: string, entityId: string) { return this.entities.get(`${profileId}:${entityType}:${entityId}`); } async put(key: string, entity: ServerEntity) { this.entities.set(key, entity); } async purgeUser(userId:string){const prefix=`${userId}:`;for(const key of this.entities.keys())if(key.startsWith(prefix))this.entities.delete(key)} async searchExamIds(query:string,limit:number){return [...this.entities.values()].filter(x=>x.entityType==='exam'&&x.entityId.toLowerCase().includes(query.toLowerCase())).slice(0,limit)} async purgeDeleted(cutoff:number){let entities=0;for(const [key,entity] of this.entities)if(entity.deletedAt!==undefined&&entity.deletedAt<cutoff){this.entities.delete(key);entities++}return{entities,changes:0}} async countExamsByUser(userId:string){let n=0;for(const e of this.entities.values())if(e.entityType==='exam'&&e.profileId.startsWith(`${userId}:`)&&e.deletedAt===undefined)n++;return n} async listExams(opts:{owner?:string;search?:string;offset:number;limit:number}){const q=(opts.search??"").toLowerCase();const all=[...this.entities.values()].filter(e=>e.entityType==='exam'&&e.deletedAt===undefined&&(!opts.owner||e.profileId.startsWith(`${opts.owner}:`))).map(examRowFrom).filter(r=>!q||r.entityId.toLowerCase().includes(q)||r.title.toLowerCase().includes(q)).sort((a,b)=>b.updatedAt-a.updatedAt);return{rows:all.slice(opts.offset,opts.offset+opts.limit),total:all.length}} async softDeleteExamsByOwner(ownerUserId:string,entityId:string){const now=Date.now();const removed:ServerEntity[]=[];for(const [k,e] of this.entities){if(e.entityType!=='exam'||e.entityId!==entityId||!e.profileId.startsWith(`${ownerUserId}:`)||e.deletedAt!==undefined)continue;const deleted:ServerEntity={...e,revision:e.revision+1,payload:undefined,updatedAt:now,deviceId:'admin-moderation',deletedAt:now};this.entities.set(k,deleted);removed.push(deleted);}return removed} async close() {} }
export class MemorySyncRepository implements SyncRepository { private readonly mutationIds = new Map<string, number>(); private readonly changes: Change[] = []; private cursor = 0; async rememberMutation(mutationId: string) { if (this.mutationIds.has(mutationId)) return false; this.mutationIds.set(mutationId, Date.now()); return true; } async append(change: Omit<Change, "cursor">) { const row = { ...change, cursor: ++this.cursor }; this.changes.push(row); return row.cursor; }  async pull(cursor: number, profileId: string, limit: number) { const mine = this.changes.filter(c => c.profileId === profileId && c.cursor > cursor); const page = mine.slice(0, limit); const nextCursor = page.at(-1)?.cursor ?? cursor; return { changes: page, cursor: nextCursor, hasMore: mine.some(c => c.cursor > nextCursor) }; } async transaction<T>(fn: () => Promise<T>) { return fn(); } async purgeMutations(cutoff:number){let purged=0;for(const [id,at] of this.mutationIds)if(at<cutoff){this.mutationIds.delete(id);purged++}return purged} async close() {} }
export class MemoryShareRepository implements ShareRepository { private readonly shares = new Map<string, ShareRecord>(); async get(code: string) { return this.shares.get(code); } async listByOwner(userId:string){return [...this.shares.values()].filter(r=>r.ownerUserId===userId&&!r.deleted).sort((a,b)=>(b.updatedAt??b.createdAt)-(a.updatedAt??a.createdAt));} async listAll(offset:number,limit:number){return [...this.shares.values()].sort((a,b)=>b.createdAt-a.createdAt).slice(offset,offset+limit).map(({packageBase64,...row})=>({...row,sizeBytes:packageBase64.length}));} async countByOwner(userId:string){let n=0;for(const r of this.shares.values())if(r.ownerUserId===userId&&!r.deleted)n++;return n} async create(row: ShareRecord) { if (this.shares.has(row.code)) { const error:any = new Error("Share code already exists"); error.code = "EEXIST"; throw error; } this.shares.set(row.code, row); } async update(row: ShareRecord){this.shares.set(row.code,row)} async incrementAccess(code:string){const row=this.shares.get(code);if(row){row.accessCount=(row.accessCount??0)+1;row.lastAccessAt=Date.now();}} async delete(code: string) { const row = this.shares.get(code); if (row) row.deleted = true; } async purgeUser(userId:string){for(const row of this.shares.values())if(row.ownerUserId===userId)row.deleted=true} async purgeExpired(cutoff:number){let purged=0;for(const [code,row] of this.shares)if((row.expiresAt!==undefined&&row.expiresAt<cutoff)||(row.deleted&&row.createdAt<cutoff)){this.shares.delete(code);purged++}return purged} async hardDelete(code:string){this.shares.delete(code)} async close() {} }

export class SqliteServerRepository implements ServerRepository {
  constructor(public readonly db: DatabaseSync) {}
  async get(profileId: string, entityType: string, entityId: string) { const r = this.db.prepare("SELECT * FROM server_entities WHERE profile_id=? AND entity_type=? AND entity_id=?").get(profileId, entityType, entityId) as any; return r ? decodeEntity(r) : undefined; }
  async put(_key: string, entity: ServerEntity) { await withSqliteRetry(() => this.db.prepare(`INSERT INTO server_entities(profile_id,entity_type,entity_id,revision,payload,updated_at,device_id,deleted_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at,device_id=excluded.device_id,deleted_at=excluded.deleted_at`).run(entity.profileId, entity.entityType, entity.entityId, entity.revision, entity.payload === undefined ? null : JSON.stringify(entity.payload), entity.updatedAt, entity.deviceId, entity.deletedAt ?? null)); }
  async purgeUser(userId:string){const prefix=`${userId}:%`;await withSqliteRetry(()=>{this.db.prepare("DELETE FROM changes WHERE profile_id LIKE ?").run(prefix);this.db.prepare("DELETE FROM server_entities WHERE profile_id LIKE ?").run(prefix);});}
  async purgeDeleted(cutoff:number){return withSqliteRetry(()=>{const changes=Number((this.db.prepare("SELECT COUNT(*) c FROM changes WHERE (profile_id,entity_type,entity_id) IN (SELECT profile_id,entity_type,entity_id FROM server_entities WHERE deleted_at IS NOT NULL AND deleted_at<?)").get(cutoff) as {c:number}).c);this.db.prepare("DELETE FROM changes WHERE (profile_id,entity_type,entity_id) IN (SELECT profile_id,entity_type,entity_id FROM server_entities WHERE deleted_at IS NOT NULL AND deleted_at<?)").run(cutoff);const entities=Number(this.db.prepare("DELETE FROM server_entities WHERE deleted_at IS NOT NULL AND deleted_at<?").run(cutoff).changes);return{entities,changes};});}
  async searchExamIds(query:string,limit:number){const rows=this.db.prepare("SELECT * FROM server_entities WHERE entity_type='exam' AND entity_id LIKE ? ORDER BY updated_at DESC LIMIT ?").all(`%${query}%`,limit) as any[];return rows.map(decodeEntity)}
  async countExamsByUser(userId:string){return Number((this.db.prepare("SELECT COUNT(*) c FROM server_entities WHERE entity_type='exam' AND profile_id LIKE ? AND deleted_at IS NULL").get(`${userId}:%`) as {c:number}).c)}
  // Title/question counts live inside the JSON payload; parse in JS instead of
  // leaning on SQLite JSON functions so behavior matches the memory driver.
  // Rows go through decodeEntity (snake_case -> camelCase) before examRowFrom.
  async listExams(opts:{owner?:string;search?:string;offset:number;limit:number}){const q=(opts.search??"").trim().toLowerCase();if(!q){const total=this.db.prepare(`SELECT COUNT(*) c FROM server_entities WHERE entity_type='exam' AND deleted_at IS NULL${opts.owner?" AND profile_id LIKE ?":""}`).get(...(opts.owner?[`${opts.owner}:%`]:[])) as {c:number};const rows=this.db.prepare(`SELECT profile_id,entity_id,revision,payload,updated_at,deleted_at FROM server_entities WHERE entity_type='exam' AND deleted_at IS NULL${opts.owner?" AND profile_id LIKE ?":""} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...(opts.owner?[`${opts.owner}:%`]:[]),opts.limit,opts.offset) as any[];return{rows:rows.map(decodeEntity).map(examRowFrom),total:Number(total.c)}}
    // Search: fetch a bounded window and filter on parsed title/entityId.
    const rows=this.db.prepare(`SELECT profile_id,entity_id,revision,payload,updated_at,deleted_at FROM server_entities WHERE entity_type='exam' AND deleted_at IS NULL${opts.owner?" AND profile_id LIKE ?":""} ORDER BY updated_at DESC LIMIT ?`).all(...(opts.owner?[`${opts.owner}:%`]:[]),2000) as any[];
    const filtered=rows.map(decodeEntity).map(examRowFrom).filter(r=>r.entityId.toLowerCase().includes(q)||r.title.toLowerCase().includes(q));
    return{rows:filtered.slice(opts.offset,opts.offset+opts.limit),total:filtered.length}}
  async softDeleteExamsByOwner(ownerUserId:string,entityId:string){return withSqliteRetry(()=>{const now=Date.now();const rows=this.db.prepare("SELECT profile_id,entity_id,revision,updated_at,device_id FROM server_entities WHERE entity_type='exam' AND entity_id=? AND profile_id LIKE ? AND deleted_at IS NULL").all(entityId,`${ownerUserId}:%`) as any[];const removed:ServerEntity[]=[];for(const r of rows){const entity:ServerEntity={profileId:String(r.profile_id),entityType:'exam',entityId:String(r.entity_id),revision:Number(r.revision)+1,payload:undefined,updatedAt:now,deviceId:'admin-moderation',deletedAt:now};this.db.prepare("INSERT INTO server_entities(profile_id,entity_type,entity_id,revision,payload,updated_at,device_id,deleted_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET revision=excluded.revision,payload=NULL,updated_at=excluded.updated_at,device_id=excluded.device_id,deleted_at=excluded.deleted_at").run(entity.profileId,entity.entityType,entity.entityId,entity.revision,null,now,'admin-moderation',now);removed.push(entity);}return removed;})}
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
  async purgeMutations(cutoff: number) { return withSqliteRetry(() => Number(this.db.prepare("DELETE FROM mutations WHERE created_at<?").run(cutoff).changes)); }
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
      await withSqliteRetry(() => this.db.prepare(`INSERT INTO shares(share_id,code,package_base64,content_hash,format_version,package_type,storage_key,created_at,updated_at,expires_at,owner_device_id,owner_user_id,owner_name,owner_avatar,source_entity_id,access_count,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.shareId,row.code,row.packageBase64,row.contentHash,row.formatVersion,row.packageType ?? "exam",storageKey,row.createdAt,row.updatedAt ?? row.createdAt,row.expiresAt ?? null,row.ownerDeviceId ?? null,row.ownerUserId ?? null,row.ownerName ?? null,row.ownerAvatar ?? null,row.sourceEntityId ?? null,row.accessCount ?? 0,row.deleted ? row.createdAt : null));
    } catch (error) {
      if (fileWritten) { try { unlinkSync(filePath); } catch {} }
      throw error;
    }
  }
  async listByOwner(userId:string){ const rows=this.db.prepare("SELECT * FROM shares WHERE owner_user_id=? AND deleted_at IS NULL ORDER BY COALESCE(updated_at,created_at) DESC").all(userId) as any[]; return rows.map(decodeShare); }
  async countByOwner(userId:string){ return Number((this.db.prepare("SELECT COUNT(*) c FROM shares WHERE owner_user_id=? AND deleted_at IS NULL").get(userId) as {c:number}).c); }
  // Admin listing deliberately does not SELECT package_base64 itself (only its
  // length): one page of shares can otherwise ship tens of MB of payloads.
  async listAll(offset: number, limit: number) {
    const rows = this.db.prepare("SELECT share_id,code,content_hash,format_version,package_type,storage_key,created_at,updated_at,expires_at,owner_device_id,owner_user_id,owner_name,owner_avatar,source_entity_id,access_count,last_access_at,deleted_at,LENGTH(package_base64) AS size_bytes FROM shares ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as any[];
    return rows.map(r => { const { size_bytes, ...rest } = r; return { ...decodeShare(rest), sizeBytes: Number(size_bytes ?? 0) }; });
  }
  async update(row: ShareRecord){
    const extension = row.packageType === "vocabularySet" ? "json" : "exam";
    const filePath = join(this.storageDir, `${row.code}.${extension}`);
    const bytes = Buffer.from(row.packageBase64, "base64");
    try { writeFileSync(filePath, bytes); } catch {}
    await withSqliteRetry(()=>this.db.prepare(`UPDATE shares SET package_base64=?,content_hash=?,format_version=?,package_type=?,storage_key=?,updated_at=?,expires_at=?,owner_avatar=?,source_entity_id=? WHERE code=? AND deleted_at IS NULL`).run(row.packageBase64,row.contentHash,row.formatVersion,row.packageType??"exam",row.storageKey??`shared-exams/${row.code}.${extension}`,row.updatedAt??Date.now(),row.expiresAt??null,row.ownerAvatar??null,row.sourceEntityId??null,row.code));
  }
  async incrementAccess(code:string){ await withSqliteRetry(()=>this.db.prepare("UPDATE shares SET access_count=COALESCE(access_count,0)+1,last_access_at=? WHERE code=? AND deleted_at IS NULL").run(Date.now(),code)); }
  async delete(code: string) {
    // Deletion is a normal write and can briefly collide with another SQLite
    // writer (for example an access-count update). Use the same bounded retry
    // policy as the other share mutations instead of leaking SQLITE_BUSY/LOCKED
    // as a generic HTTP 500.
    await withSqliteRetry(() => this.db.prepare("UPDATE shares SET deleted_at=? WHERE code=? AND deleted_at IS NULL").run(Date.now(), code));
    for (const extension of ["exam", "json"]) { try { unlinkSync(join(this.storageDir, `${code}.${extension}`)); } catch {} }
  }
  async purgeUser(userId:string){await withSqliteRetry(()=>this.db.prepare("UPDATE shares SET deleted_at=? WHERE owner_user_id=? AND deleted_at IS NULL").run(Date.now(),userId));}
  async purgeExpired(cutoff: number) {
    // Hard-delete rows past their expiry/deletion grace period and remove the
    // materialized files with them; this is the only path that ever shrinks
    // the shares table and shared-exams directory.
    const rows = this.db.prepare("SELECT code FROM shares WHERE (expires_at IS NOT NULL AND expires_at<?) OR (deleted_at IS NOT NULL AND deleted_at<?)").all(cutoff, cutoff) as Array<{ code: string }>;
    if (!rows.length) return 0;
    const codes = rows.map(r => r.code);
    const placeholders = codes.map(() => "?").join(",");
    await withSqliteRetry(() => this.db.prepare(`DELETE FROM shares WHERE code IN (${placeholders})`).run(...codes));
    for (const code of codes) for (const extension of ["exam", "json"]) { try { unlinkSync(join(this.storageDir, `${code}.${extension}`)); } catch {} }
    return codes.length;
  }
  // Hard-delete exactly one code (row + materialized files) without touching
  // anything else. Admin delete must NOT reuse purgeExpired(now+epsilon):
  // that would also hard-delete every other expired-but-still-in-grace share.
  async hardDelete(code: string) {
    await withSqliteRetry(() => this.db.prepare("DELETE FROM shares WHERE code=?").run(code));
    for (const extension of ["exam", "json"]) { try { unlinkSync(join(this.storageDir, `${code}.${extension}`)); } catch {} }
  }
  async close() { this.db.close(); }
}

function decodeEntity(r: any): ServerEntity { return { profileId:r.profile_id, entityType:r.entity_type, entityId:r.entity_id, revision:r.revision, payload:r.payload == null ? undefined : JSON.parse(r.payload), updatedAt:r.updated_at, deviceId:r.device_id, deletedAt:r.deleted_at ?? undefined }; }
function decodeChange(r: any): Change { return { ...decodeEntity(r), cursor:r.cursor, operation:r.operation }; }
function decodeShare(r: any): ShareRecord { return { shareId:r.share_id, code:r.code, packageBase64:r.package_base64, contentHash:r.content_hash, formatVersion:r.format_version, packageType:r.package_type ?? "exam", storageKey:r.storage_key ?? `shared-exams/${r.code}.exam`, createdAt:r.created_at, updatedAt:r.updated_at ?? undefined, expiresAt:r.expires_at ?? undefined, ownerDeviceId:r.owner_device_id ?? undefined, ownerUserId:r.owner_user_id ?? undefined, ownerName:r.owner_name ?? undefined, ownerAvatar:r.owner_avatar ?? undefined, sourceEntityId:r.source_entity_id ?? undefined, accessCount:Number(r.access_count??0), lastAccessAt:r.last_access_at ?? undefined, deleted:Boolean(r.deleted_at) }; }

export function defaultSharedExamsDir(databaseUrl = process.env.DATABASE_URL) {
  return process.env.SHARED_EXAMS_DIR ?? join(dirname(databasePathFromUrl(databaseUrl)), "shared-exams");
}

export function createSqliteRepositories(databaseUrl = process.env.DATABASE_URL) {
  const db = openSqliteDatabase(databaseUrl);
  return { db, serverRepository: new SqliteServerRepository(db), syncRepository: new SqliteSyncRepository(db), shareRepository: new SqliteShareRepository(db, defaultSharedExamsDir(databaseUrl)) };
}
