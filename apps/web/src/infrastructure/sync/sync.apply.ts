import { db } from '../../db/database';
import type { SyncChangeDto } from '@exam/shared-types';

function asRecord(value: unknown): Record<string, any> { if (!value || typeof value !== 'object') throw new Error('SYNC_INVALID_PAYLOAD'); return value as Record<string, any>; }
function base64ToBytes(value: string) { const raw = atob(value); const out = new Uint8Array(raw.length); for (let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out; }
function validateChange(c: SyncChangeDto, p?: Record<string, any>) { if (c.operation === 'DELETE') return; if (!p) throw new Error('SYNC_INVALID_PAYLOAD'); if (c.entityType === 'question' && (!p.examId || !Number.isInteger(p.order) || !p.type || !p.content)) throw new Error('SYNC_INVALID_QUESTION'); if (c.entityType === 'exam' && (!p.title || !p.subject)) throw new Error('SYNC_INVALID_EXAM'); if (c.entityType === 'exam' && p.source === 'official') throw new Error('SYNC_OFFICIAL_EXAM_PROTECTED'); if (c.entityType === 'vocabulary' && (!p.english || !p.vietnamese || !p.profileId)) throw new Error('SYNC_INVALID_VOCABULARY'); if (c.entityType === 'vocabQuestion' && (!p.vocabularyId || !p.type || !p.prompt)) throw new Error('SYNC_INVALID_VOCAB_QUESTION'); if (c.entityType === 'examAsset' && (!p.examId || !p.path || typeof p.data !== 'string' || !p.hash)) throw new Error('SYNC_INVALID_ASSET'); }

export async function applyRemoteChanges(changes: SyncChangeDto[], cursorStateKey: string, nextCursor: number) {
  await db.transaction('rw', [db.exams, db.questions, db.examAssets, db.vocabularies, db.vocabQuestions, db.vocabularySets, db.vocabularySetItems, db.sharedExams, db.syncState], async () => {
    for (const c of changes) {
      const p = c.payload ? asRecord(c.payload) : undefined;
      validateChange(c, p);
      const record = p ? { ...p, id: c.entityId, profileId: c.profileId, syncRevision: c.revision, syncOrigin: c.deviceId, ...(c.entityType === 'examAsset' && typeof p.data === 'string' ? { data: base64ToBytes(p.data) } : {}) } : undefined;
      if (c.entityType === 'exam') { if (c.operation === 'DELETE') { await db.exams.update(c.entityId, { deletedAt: c.deletedAt ?? c.updatedAt, updatedAt: c.updatedAt } as any); await db.questions.where('examId').equals(c.entityId).delete(); await db.examAssets.where('examId').equals(c.entityId).delete(); await db.sharedExams.where('examId').equals(c.entityId).delete(); } else await db.exams.put(record as any); }
      if (c.entityType === 'question') c.operation === 'DELETE' ? await db.questions.delete(c.entityId) : await db.questions.put(record as any);
      if (c.entityType === 'examAsset') c.operation === 'DELETE' ? await db.examAssets.delete(c.entityId) : await db.examAssets.put(record as any);
      if (c.entityType === 'vocabQuestion') c.operation === 'DELETE' ? await db.vocabQuestions.delete(c.entityId) : await db.vocabQuestions.put(record as any);
      if (c.entityType === 'vocabulary') c.operation === 'DELETE' ? await db.vocabularies.update(c.entityId, { deletedAt: c.deletedAt ?? c.updatedAt, updatedAt: c.updatedAt } as any) : await db.vocabularies.put(record as any);
      if (c.entityType === 'vocabularySet') c.operation === 'DELETE' ? await db.vocabularySets.update(c.entityId, { deletedAt: c.deletedAt ?? c.updatedAt, updatedAt: c.updatedAt } as any) : await db.vocabularySets.put(record as any);
      if (c.entityType === 'vocabularySetItem') c.operation === 'DELETE' ? await db.vocabularySetItems.delete(c.entityId) : await db.vocabularySetItems.put(record as any);
    }
    const current = await db.syncState.get(cursorStateKey);
    await db.syncState.put({ ...(current ?? { key: cursorStateKey }), key: cursorStateKey, cursor: nextCursor, lastSyncAt: Date.now(), status: 'IDLE', lastError: undefined });
  });
}
