import { generateId } from '@exam/utils';
import type { SyncMutationDto, SyncQueueItem, SyncStatus } from '@exam/shared-types';
import { apiSyncTransport } from './api.transport';
import { deviceService } from './device.service';
import { syncRepository } from './sync.repository';
import { applyRemoteChanges } from './sync.apply';
import type { LocalMutation, SyncTransport } from './sync.types';
import { logger } from '../logger';
import { useAuthStore } from '../../state/authStore';

const BACKOFF = [1000, 2000, 5000, 10000, 30000, 60000, 300000];
const MAX_RETRIES = 8;
const activeSyncs = new Map<string, Promise<SyncStatus>>();

export function retryDelay(attempt: number) { return BACKOFF[Math.min(Math.max(attempt - 1, 0), BACKOFF.length - 1)]; }

export const syncEngine = {
  async enqueue(mutation: LocalMutation) {
    const now = Date.now();
    const accountId=useAuthStore.getState().user?.id; const item: SyncQueueItem = { id: generateId('sync'), mutationId: generateId('mutation'), profileId: mutation.profileId, accountId, entityType: mutation.entityType, entityId: mutation.entityId, operation: mutation.operation, baseRevision: mutation.baseRevision ?? 0, payload: mutation.payload, status: 'pending', attempts: 0, retryCount: 0, createdAt: now, updatedAt: now };
    await syncRepository.enqueue(item);
  },
  async sync(profileId: string, transport: SyncTransport = apiSyncTransport): Promise<SyncStatus> {
    const accountIdForLock=useAuthStore.getState().user?.id; const lockKey=accountIdForLock?`account:${accountIdForLock}:profile:${profileId}`:`profile:${profileId}`; const existing = activeSyncs.get(lockKey);
    if (existing) return existing;
    const activeSync = (async () => {
    const accountId=useAuthStore.getState().user?.id;
    const key = accountId ? `account:${accountId}:profile:${profileId}` : `profile:${profileId}`;
    try {
      const deviceId = await deviceService.getDeviceId();
      let state = await syncRepository.state(profileId,accountId);
      // Recover queue items stranded by transient deployment/network failures
      // (including the old nginx HTTP_405 issue) once the API is reachable again.
      await syncRepository.retryTransientFailures(profileId,accountId);
      await syncRepository.saveState({ ...state, key, profileId, accountId, deviceId, status: 'SYNCING', lastError: undefined });
      const pending = await syncRepository.pending(profileId,accountId);
      const pushBatchSize = 400;
      for (let offset = 0; offset < pending.length; offset += pushBatchSize) {
        const batch = pending.slice(offset, offset + pushBatchSize);
        const mutations: SyncMutationDto[] = batch.map(item => ({ mutationId: item.mutationId!, profileId, deviceId, entityType: item.entityType!, entityId: item.entityId!, operation: item.operation!, baseRevision: item.baseRevision ?? 0, updatedAt: Number((item.payload as any)?.updatedAt ?? item.updatedAt ?? item.createdAt), payload: item.operation === 'DELETE' ? undefined : item.payload }));
        try {
          const pushed = await transport.push(deviceId, mutations);
          const ack = new Set(pushed.acknowledgements);
          await syncRepository.markDone(batch.filter(i => ack.has(i.mutationId!)).map(i => i.id));
          for (const conflict of pushed.conflicts) {
            const item = batch.find(i => i.mutationId === conflict.mutationId);
            if (!item) continue;
            const localUpdatedAt = Number((item.payload as any)?.updatedAt ?? item.updatedAt ?? 0);
            const remote = conflict.current;
            const localWins = localUpdatedAt > remote.updatedAt || (localUpdatedAt === remote.updatedAt && deviceId > remote.deviceId);
            if (localWins) await syncRepository.resolveAsLocalWinner(item.id, remote.revision);
            else {
              await applyRemoteChanges([remote], key, state.cursor ?? 0);
              await syncRepository.delete(item.id);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'SYNC_REQUEST_FAILED';
          for (const item of batch) { const attempts = (item.attempts ?? 0) + 1; await syncRepository.markFailed(item.id, message, Date.now() + retryDelay(attempts), attempts, attempts >= MAX_RETRIES); }
          logger.warn('sync request failed', { operation: 'sync', errorCode: 'SYNC_REQUEST_FAILED' });
          await syncRepository.saveState({ ...state, key, profileId, accountId, deviceId, status: 'ERROR', lastError: message });
          return 'ERROR';
        }
      }
      let cursor = state.cursor ?? 0;
      for (;;) {
        const pulled = await transport.pull(cursor, profileId);
        if (pulled.changes.length) await applyRemoteChanges(pulled.changes, key, pulled.cursor);
        cursor = pulled.cursor;
        if (!pulled.hasMore) break;
      }
      await syncRepository.saveState({ ...state, key, profileId, accountId, deviceId, cursor, lastSyncAt: Date.now(), status: 'IDLE', lastError: undefined });
      return 'IDLE';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SYNC_FAILED';
      await syncRepository.saveState({ key, profileId, accountId, status: 'ERROR', lastError: message });
      return 'ERROR';
    } finally { /* per-profile sync promise is cleared below */ }
    })();
    activeSyncs.set(lockKey, activeSync);
    try { return await activeSync; } finally { activeSyncs.delete(lockKey); }
  },
  async markOffline(profileId: string) { const accountId=useAuthStore.getState().user?.id; const state = await syncRepository.state(profileId,accountId); const key=accountId?`account:${accountId}:profile:${profileId}`:`profile:${profileId}`; await syncRepository.saveState({ ...state, key, profileId, accountId, status: 'OFFLINE' }); }
};
