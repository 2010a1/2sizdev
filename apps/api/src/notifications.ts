import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

// Notification system: admin-authored messages fan out to per-user rows.
// Storage mirrors the ai-pool pattern: one module-level SQLite handle when the
// app runs on the sqlite driver, in-memory maps for injected-repo test builds.

export type NotificationCategory = "announcement" | "info" | "warning" | "success";
export type MessageStatus = "DRAFT" | "SCHEDULED" | "SENT";

export type NotificationMessage = {
  id: string; title: string; body: string; category: NotificationCategory; link?: string;
  status: MessageStatus; audience: "ALL" | "USERS"; targetUserIds?: string[];
  scheduledAt?: number; sentAt?: number; sentCount: number;
  createdBy: string; createdAt: number; updatedAt: number;
};

export type UserNotification = {
  id: string; notificationId: string; title: string; body: string;
  category: NotificationCategory; link?: string; readAt?: number; createdAt: number;
};

// Per-user row cap: the fan-out of "ALL" messages is bounded so a long-lived
// account cannot accumulate unbounded rows. Oldest rows are pruned on insert.
const PER_USER_CAP = 100;
const CATEGORIES: NotificationCategory[] = ["announcement", "info", "warning", "success"];

let db: DatabaseSync | undefined;
let seeded = false;
const memoryMessages = new Map<string, NotificationMessage>();
const memoryRows = new Map<string, UserNotification & { userId: string }>(); // id -> row

export function initNotifications(database?: DatabaseSync) {
  // Reset the memory maps too: buildApp can be called several times per test
  // process, and stale rows from a previous instance would leak into the next.
  memoryMessages.clear(); memoryRows.clear();
  db = database; seeded = false; seed();
}

function seed() {
  if (seeded || !db) return; seeded = true;
  db.exec(`
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
  `);
}

// Write-time defense-in-depth sanitizer. The web client additionally renders
// bodies through RichContent's allowlist parser, so rendering is safe even if
// a different producer ever writes a row; this pass keeps stored data clean.
export function sanitizeNotificationHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link)\b[^>]*\/?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*data:(?!image\/)[^"']*\2/gi, "")
    // unquoted attribute forms: href=javascript:alert(1)
    .replace(/(href|src)\s*=\s*(javascript|vbscript)\s*:[^\s>]*/gi, "")
    .slice(0, 20_000);
}

function decodeMessage(r: any): NotificationMessage {
  return {
    id: String(r.id), title: String(r.title), body: String(r.body),
    category: (CATEGORIES.includes(r.category) ? r.category : "announcement") as NotificationCategory,
    link: r.link == null ? undefined : String(r.link),
    status: r.status as MessageStatus,
    audience: r.audience === "USERS" ? "USERS" : "ALL",
    targetUserIds: r.target_user_ids ? JSON.parse(String(r.target_user_ids)) : undefined,
    scheduledAt: r.scheduled_at == null ? undefined : Number(r.scheduled_at),
    sentAt: r.sent_at == null ? undefined : Number(r.sent_at),
    sentCount: Number(r.sent_count ?? 0),
    createdBy: String(r.created_by), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at)
  };
}
function decodeRow(r: any): UserNotification {
  return {
    id: String(r.id), notificationId: String(r.notification_id), title: String(r.title), body: String(r.body),
    category: (CATEGORIES.includes(r.category) ? r.category : "announcement") as NotificationCategory,
    link: r.link == null ? undefined : String(r.link),
    readAt: r.read_at == null ? undefined : Number(r.read_at),
    createdAt: Number(r.created_at)
  };
}

export function listMessages(): NotificationMessage[] {
  seed();
  if (!db) return [...memoryMessages.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return (db.prepare("SELECT * FROM notification_messages ORDER BY updated_at DESC LIMIT 200").all() as any[]).map(decodeMessage);
}
export function getMessage(id: string): NotificationMessage | undefined {
  seed();
  if (!db) return memoryMessages.get(id);
  const r = db.prepare("SELECT * FROM notification_messages WHERE id=?").get(id) as any;
  return r ? decodeMessage(r) : undefined;
}

export type MessageInput = {
  title: string; body: string; category: NotificationCategory; link?: string;
  audience: "ALL" | "USERS"; targetUserIds?: string[]; scheduledAt?: number; createdBy: string;
};

export function createMessage(input: MessageInput): NotificationMessage {
  seed();
  const now = Date.now();
  const status: MessageStatus = input.scheduledAt && input.scheduledAt > now ? "SCHEDULED" : "DRAFT";
  const msg: NotificationMessage = {
    id: crypto.randomUUID(), title: input.title, body: sanitizeNotificationHtml(input.body),
    category: input.category, link: input.link, status, audience: input.audience,
    targetUserIds: input.audience === "USERS" ? [...new Set(input.targetUserIds ?? [])] : undefined,
    scheduledAt: input.scheduledAt, sentCount: 0, createdBy: input.createdBy, createdAt: now, updatedAt: now
  };
  if (!db) memoryMessages.set(msg.id, msg);
  else db.prepare("INSERT INTO notification_messages(id,title,body,category,link,status,audience,target_user_ids,scheduled_at,sent_at,sent_count,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)")
    .run(msg.id, msg.title, msg.body, msg.category, msg.link ?? null, msg.status, msg.audience, msg.targetUserIds ? JSON.stringify(msg.targetUserIds) : null, msg.scheduledAt ?? null, msg.sentCount, msg.createdBy, msg.createdAt, msg.updatedAt);
  return msg;
}

export function updateMessage(id: string, patch: Partial<MessageInput> & { status?: MessageStatus }): NotificationMessage | undefined {
  seed();
  const current = getMessage(id);
  if (!current) return undefined;
  if (current.status === "SENT") return undefined; // sent history is immutable
  const next: NotificationMessage = {
    ...current,
    ...("title" in patch && patch.title !== undefined ? { title: patch.title } : {}),
    ...("body" in patch && patch.body !== undefined ? { body: sanitizeNotificationHtml(patch.body) } : {}),
    ...("category" in patch && patch.category !== undefined ? { category: patch.category } : {}),
    ...("link" in patch ? { link: patch.link } : {}),
    ...("audience" in patch && patch.audience !== undefined ? { audience: patch.audience } : {}),
    ...(patch.audience === "USERS" || (patch.audience === undefined && patch.targetUserIds !== undefined)
      ? { targetUserIds: patch.targetUserIds !== undefined ? [...new Set(patch.targetUserIds)] : current.targetUserIds }
      : patch.audience === "ALL" ? { targetUserIds: undefined } : {}),
    ...("scheduledAt" in patch ? { scheduledAt: patch.scheduledAt } : {}),
    ...("status" in patch && patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: Date.now()
  };
  // Recompute scheduling status like createMessage does: a PATCH that sets a
  // future scheduledAt on a DRAFT must move it to SCHEDULED (and clearing the
  // time returns it to DRAFT), or the sweep would never pick it up.
  if (next.status !== "SENT") next.status = next.scheduledAt && next.scheduledAt > next.updatedAt ? "SCHEDULED" : "DRAFT";
  if (!db) memoryMessages.set(id, next);
  else db.prepare("UPDATE notification_messages SET title=?,body=?,category=?,link=?,status=?,audience=?,target_user_ids=?,scheduled_at=?,updated_at=? WHERE id=?")
    .run(next.title, next.body, next.category, next.link ?? null, next.status, next.audience, next.targetUserIds ? JSON.stringify(next.targetUserIds) : null, next.scheduledAt ?? null, next.updatedAt, id);
  return next;
}

export function deleteMessage(id: string): boolean {
  seed();
  if (!db) {
    let removed = memoryMessages.delete(id);
    for (const [rowId, row] of memoryRows) if (row.notificationId === id) { memoryRows.delete(rowId); removed = true; }
    return removed;
  }
  db.prepare("DELETE FROM notifications WHERE notification_id=?").run(id);
  return Number(db.prepare("DELETE FROM notification_messages WHERE id=?").run(id).changes) === 1;
}

// Fan out a message to resolved recipient ids and mark it SENT. Recipient
// resolution stays in app.ts (it owns the auth store).
export function deliverMessage(id: string, recipientIds: string[]): NotificationMessage | undefined {
  seed();
  const msg = getMessage(id);
  if (!msg || msg.status === "SENT") return msg;
  const now = Date.now();
  const unique = [...new Set(recipientIds)];
  for (const userId of unique) {
    const rowId = crypto.randomUUID();
    const row = { id: rowId, userId, notificationId: id, title: msg.title, body: msg.body, category: msg.category, link: msg.link, createdAt: now };
    if (!db) memoryRows.set(rowId, row as any);
    else db.prepare("INSERT INTO notifications(id,user_id,notification_id,title,body,category,link,read_at,deleted_at,created_at) VALUES(?,?,?,?,?,?,?,NULL,NULL,?)")
      .run(rowId, userId, id, msg.title, msg.body, msg.category, msg.link ?? null, now);
  }
  // Enforce the per-user cap for every recipient of this message. The keep-set
  // counts only LIVE rows: soft-deleted rows must not occupy cap slots, or a
  // user who deletes notifications would lose older still-visible ones.
  if (!db) {
    for (const userId of unique) {
      const rows = [...memoryRows.values()].filter(r => r.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
      for (const r of rows.slice(0, Math.max(0, rows.length - PER_USER_CAP))) memoryRows.delete(r.id);
    }
  } else {
    for (const userId of unique) db.prepare(
      "DELETE FROM notifications WHERE user_id=? AND deleted_at IS NULL AND id NOT IN (SELECT id FROM notifications WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?)"
    ).run(userId, userId, PER_USER_CAP);
  }
  const sent: NotificationMessage = { ...msg, status: "SENT", sentAt: now, sentCount: unique.length, updatedAt: now };
  if (!db) memoryMessages.set(id, sent);
  else db.prepare("UPDATE notification_messages SET status='SENT',sent_at=?,sent_count=?,updated_at=? WHERE id=?").run(now, sent.sentCount, now, id);
  return sent;
}

export function dueScheduledMessages(): NotificationMessage[] {
  seed();
  const now = Date.now();
  if (!db) return [...memoryMessages.values()].filter(m => m.status === "SCHEDULED" && (m.scheduledAt ?? Infinity) <= now);
  return (db.prepare("SELECT * FROM notification_messages WHERE status='SCHEDULED' AND scheduled_at IS NOT NULL AND scheduled_at<=?").all(now) as any[]).map(decodeMessage);
}

export function listForUser(userId: string, offset: number, limit: number): { rows: UserNotification[]; total: number; unread: number } {
  seed();
  if (!db) {
    const mine = [...memoryRows.values()].filter(r => r.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
    return { rows: mine.slice(offset, offset + limit).map(({ userId: _u, ...r }) => r), total: mine.length, unread: mine.filter(r => !r.readAt).length };
  }
  const rows = (db.prepare("SELECT * FROM notifications WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?").all(userId, limit, offset) as any[]).map(decodeRow);
  const total = Number((db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND deleted_at IS NULL").get(userId) as any).c);
  const unread = Number((db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND deleted_at IS NULL AND read_at IS NULL").get(userId) as any).c);
  return { rows, total, unread };
}

export function markRead(userId: string, ids?: string[]): number {
  seed();
  const now = Date.now();
  if (!db) {
    let n = 0;
    for (const r of memoryRows.values()) if (r.userId === userId && !r.readAt && (ids === undefined || ids.includes(r.id))) { r.readAt = now; n++; }
    return n;
  }
  if (ids === undefined) return Number(db.prepare("UPDATE notifications SET read_at=? WHERE user_id=? AND deleted_at IS NULL AND read_at IS NULL").run(now, userId).changes);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => "?").join(",");
  return Number(db.prepare(`UPDATE notifications SET read_at=? WHERE user_id=? AND deleted_at IS NULL AND read_at IS NULL AND id IN (${placeholders})`).run(now, userId, ...ids).changes);
}

export function deleteForUser(userId: string, id: string): boolean {
  seed();
  if (!db) {
    const r = memoryRows.get(id);
    if (!r || r.userId !== userId) return false;
    memoryRows.delete(id); return true;
  }
  return Number(db.prepare("UPDATE notifications SET deleted_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL").run(Date.now(), id, userId).changes) === 1;
}

// Called when an account is deleted (self-service or admin): notification rows
// are user data and must not outlive the account.
export function purgeUser(userId: string): void {
  seed();
  if (!db) { for (const [id, r] of memoryRows) if (r.userId === userId) memoryRows.delete(id); return; }
  db.prepare("DELETE FROM notifications WHERE user_id=?").run(userId);
}
