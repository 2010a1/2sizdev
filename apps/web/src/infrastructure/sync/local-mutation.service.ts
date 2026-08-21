import { db } from '../../db/database';
import { syncEngine } from './sync.engine';
import { profileRepository } from '../../domain/profile/profile.repository';
import type { SyncEntityType, SyncMutationOperation } from '@exam/shared-types';

async function scopeProfile(profileId?: string) {
  if (profileId) return profileId;
  const active = typeof localStorage !== 'undefined' ? localStorage.getItem('thi-thu:active-profile-id') : null;
  if (active) return active;
  const profiles = await profileRepository.list();
  return profiles[0]?.id ?? 'local';
}

function bytesToBase64(data: Uint8Array) { let out=''; const chunk=0x8000; for(let i=0;i<data.length;i+=chunk) out += String.fromCharCode(...data.subarray(i,i+chunk)); return btoa(out); }

export const localMutationService = {
  async enqueue(profileId: string | undefined, entityType: SyncEntityType, entityId: string, operation: SyncMutationOperation, payload?: unknown, updatedAt = Date.now(), baseRevision = 0) {
    const scope = await scopeProfile(profileId); await syncEngine.enqueue({ profileId: scope, entityType, entityId, operation, payload, updatedAt, baseRevision }); if (typeof navigator !== 'undefined' && navigator.onLine) void syncEngine.sync(scope);
  },
  async exam(examId: string, operation: SyncMutationOperation, profileId?: string) {
    const exam = await db.exams.get(examId); if (!exam && operation !== 'DELETE') return;
    await this.enqueue(profileId, 'exam', examId, operation, exam, exam?.updatedAt ?? Date.now(), (exam as any)?.syncRevision ?? 0);
    if (operation === 'DELETE') return;
    const questions = await db.questions.where('examId').equals(examId).toArray();
    for (const q of questions) await this.enqueue(profileId, 'question', q.id, 'UPDATE', q, Date.now());
    const assets = await db.examAssets.where('examId').equals(examId).toArray();
    for (const a of assets) { const payload = { ...a, data: bytesToBase64(a.data) }; await this.enqueue(profileId, 'examAsset', a.id, 'UPDATE', payload, Date.now(), (a as any)?.syncRevision ?? 0); }
  },
  async question(questionId: string, operation: SyncMutationOperation, profileId?: string, snapshot?: unknown) {
    const q = snapshot ?? await db.questions.get(questionId); await this.enqueue(profileId, 'question', questionId, operation, q, Date.now(), (q as any)?.syncRevision ?? 0);
  },
  async vocabulary(vocabularyId: string, operation: SyncMutationOperation, profileId: string) {
    const row = await db.vocabularies.get(vocabularyId); await this.enqueue(profileId, 'vocabulary', vocabularyId, operation, row, row?.updatedAt ?? Date.now(), (row as any)?.syncRevision ?? 0);
    const questions = await db.vocabQuestions.where('vocabularyId').equals(vocabularyId).toArray();
    for (const q of questions) {
      if (operation === 'DELETE') await this.enqueue(profileId, 'vocabQuestion', q.id, 'DELETE', { id:q.id, vocabularyId }, Date.now(), (q as any)?.syncRevision ?? 0);
      else if (!q.deletedAt) await this.enqueue(profileId, 'vocabQuestion', q.id, 'UPDATE', q, q.updatedAt, (q as any)?.syncRevision ?? 0);
    }
  },
  async vocabularySet(setId: string, operation: SyncMutationOperation, profileId: string) {
    const row = await db.vocabularySets.get(setId); await this.enqueue(profileId, 'vocabularySet', setId, operation, row, row?.updatedAt ?? Date.now(), (row as any)?.syncRevision ?? 0);
    const items = await db.vocabularySetItems.where('[profileId+setId]').equals([profileId,setId]).toArray();
    for (const item of items) await this.enqueue(profileId, 'vocabularySetItem', item.id, 'UPDATE', item, item.updatedAt);
  },
  async vocabularySetItem(itemId: string, operation: SyncMutationOperation, profileId: string) {
    const row = await db.vocabularySetItems.get(itemId); await this.enqueue(profileId, 'vocabularySetItem', itemId, operation, row, row?.updatedAt ?? Date.now(), (row as any)?.syncRevision ?? 0);
  }
};
