import { db } from '../../db/database';
import { generateId } from '@exam/utils';
import type { SyncChangeDto, SyncQueueItem, SyncState } from '@exam/shared-types';

export const syncRepository = {
  async enqueue(item: SyncQueueItem) {
    // Keep at most one pending mutation per entity/account. Replaying intermediate
    // states is unnecessary and dramatically increases conflict surface.
    await db.transaction('rw', db.syncQueue, async () => {
      const existing = (await db.syncQueue
        .where('[profileId+entityType+entityId+status]')
        .equals([item.profileId, item.entityType, item.entityId, 'pending'])
        .toArray()).filter(row=>row.accountId===item.accountId);
      const newest = existing.sort((a,b) => b.createdAt - a.createdAt)[0];
      if (!newest) { await db.syncQueue.put(item); return; }

      // CREATE followed by DELETE before the first sync cancels out entirely.
      if (newest.operation === 'CREATE' && item.operation === 'DELETE') {
        await db.syncQueue.bulkDelete(existing.map(x => x.id));
        return;
      }
      // Preserve CREATE for a locally-created entity; otherwise the server may
      // receive UPDATE for an entity it has never seen.
      const operation = newest.operation === 'CREATE' ? 'CREATE' : item.operation;
      await db.syncQueue.put({ ...newest, ...item, operation, id: newest.id, createdAt: newest.createdAt });
      await db.syncQueue.bulkDelete(existing.filter(x => x.id !== newest.id).map(x => x.id));
    });
  },
  async pending(profileId: string, accountId?: string, now = Date.now()) {
    return db.syncQueue.where('[profileId+status]').equals([profileId, 'pending']).toArray()
      .then(rows => rows.filter(r => r.accountId===accountId).filter(r => !r.nextRetryAt || r.nextRetryAt <= now).filter(r => !!r.entityType && !!r.entityId && !!r.operation).sort((a,b) => a.createdAt - b.createdAt));
  },
  async markDone(ids: string[]) { if (ids.length) await db.syncQueue.bulkDelete(ids); },
  async markFailed(id: string, error: string, nextRetryAt: number, attempts: number, terminal = false) {
    await db.syncQueue.update(id, { status: terminal ? 'failed' : 'pending', lastError: error, nextRetryAt, attempts, retryCount: attempts, updatedAt: Date.now() });
  },
  async markConflict(id: string, error: string) { await db.syncQueue.update(id, { status: 'failed', lastError: error, updatedAt: Date.now() }); },
  // Mutations queued while logged out carry no accountId, and pending() filters by
  // exact accountId match — without adoption they strand forever once the user is
  // logged back in. Adoption also clears any HTTP_401 failure that caused them.
  async adoptOrphaned(profileId: string, accountId: string) {
    const rows = await db.syncQueue.where('profileId').equals(profileId).toArray();
    const orphans = rows.filter(r => r.accountId === undefined || r.accountId === null);
    if (orphans.length) await db.syncQueue.bulkPut(orphans.map(r => ({ ...r, accountId, status: 'pending' as const, nextRetryAt: Date.now(), lastError: undefined, attempts: 0, retryCount: 0, updatedAt: Date.now() })));
  },
  async retryFailed(profileId: string, accountId?: string) { const rows=await db.syncQueue.where('[profileId+status]').equals([profileId, 'failed']).toArray(); const selected=rows.filter(r=>r.accountId===accountId); if(selected.length) await db.syncQueue.bulkPut(selected.map(r=>({...r,status:'pending' as const,nextRetryAt:Date.now(),lastError:undefined,attempts:0,retryCount:0,updatedAt:Date.now()}))); },
  async retryTransientFailures(profileId: string, accountId?: string) {
    const rows = (await db.syncQueue.where('[profileId+status]').equals([profileId, 'failed']).toArray()).filter(row=>row.accountId===accountId);
    const transient = rows.filter(row => {
      const error = String(row.lastError ?? '');
      return /^(HTTP_(405|408|429|500|502|503|504)|Failed to fetch|NetworkError|SYNC_REQUEST_FAILED)/i.test(error);
    });
    if (transient.length) {
      await db.syncQueue.bulkPut(transient.map(row => ({ ...row, status: 'pending' as const, nextRetryAt: Date.now(), lastError: undefined, attempts: 0, retryCount: 0, updatedAt: Date.now() })));
    }
  },
  async resolveAsLocalWinner(id: string, revision: number) { await db.syncQueue.update(id, { mutationId: generateId('mutation'), baseRevision: revision, status: 'pending', nextRetryAt: Date.now(), lastError: undefined, updatedAt: Date.now() }); },
  async delete(id: string) { await db.syncQueue.delete(id); },
  async state(profileId: string, accountId?: string) {
    const key = accountId ? `account:${accountId}:profile:${profileId}` : `profile:${profileId}`;
    const row = await db.syncState.get(key);
    return row ?? { key, profileId, accountId, status: 'IDLE', cursor: 0 } as SyncState;
  },
  async saveState(state: SyncState) { await db.syncState.put(state); },
  async changesExist(profileId: string, accountId?: string) { return (await this.pending(profileId,accountId)).length > 0; }
};

export function isSupportedChange(change: SyncChangeDto) {
  return ['exam', 'question', 'examAsset', 'vocabulary', 'vocabQuestion', 'vocabularySet', 'vocabularySetItem'].includes(change.entityType);
}
