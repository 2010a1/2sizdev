import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../db/database';
import { syncRepository } from '../infrastructure/sync/sync.repository';
import type { SyncQueueItem } from '@exam/shared-types';

function item(overrides: Partial<SyncQueueItem>): SyncQueueItem {
  return { id: 'sq_' + Math.random().toString(36).slice(2), mutationId: 'mutation_x', profileId: 'p1', accountId: undefined, entityType: 'exam', entityId: 'e1', operation: 'CREATE', baseRevision: 0, payload: { id: 'e1' }, status: 'pending', attempts: 0, retryCount: 0, createdAt: 1, updatedAt: 1, ...overrides };
}

describe('logged-out mutation adoption', () => {
  it('adopts orphaned pending and 401-failed rows once an account syncs the profile', async () => {
    await db.open();
    await db.syncQueue.clear();
    const pending = item({});
    const failedAuth = item({ id: 'sq_failed', entityId: 'e2', status: 'failed' as const, lastError: 'HTTP_401', nextRetryAt: 1, attempts: 3 });
    const owned = item({ id: 'sq_owned', entityId: 'e3', accountId: 'other-account' });
    await db.syncQueue.bulkPut([pending, failedAuth, owned]);

    await syncRepository.adoptOrphaned('p1', 'acct-1');

    const rows = await db.syncQueue.toArray();
    expect(rows.find(r => r.id === pending.id)?.accountId).toBe('acct-1');
    const revived = rows.find(r => r.id === 'sq_failed');
    expect(revived?.accountId).toBe('acct-1');
    expect(revived?.status).toBe('pending');
    expect(revived?.lastError).toBeUndefined();
    // Rows already owned by another account stay untouched.
    expect(rows.find(r => r.id === 'sq_owned')?.accountId).toBe('other-account');
    const visible = await syncRepository.pending('p1', 'acct-1');
    expect(visible.map(r => r.id).sort()).toEqual([pending.id, 'sq_failed'].sort());
  });
});
