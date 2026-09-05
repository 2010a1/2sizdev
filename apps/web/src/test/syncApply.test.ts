import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../db/database';
import { applyRemoteChanges } from '../infrastructure/sync/sync.apply';
import type { SyncChangeDto } from '@exam/shared-types';

const change = (overrides: Partial<SyncChangeDto>): SyncChangeDto => ({ cursor: 1, profileId: 'p1', entityType: 'exam', entityId: 'e1', revision: 1, operation: 'UPDATE', updatedAt: 1, deviceId: 'd1', payload: { title: 'De hop le', subject: 'Toan' }, ...overrides });

describe('applyRemoteChanges poison-change handling', () => {
  it('skips a malformed change, still applies the good ones, and advances the cursor', async () => {
    await db.open();
    await db.syncState.clear();
    const good = change({});
    const poison = change({ cursor: 2, entityId: 'e-bad', payload: { subject: 'thieu title' } as any });
    const good2 = change({ cursor: 3, entityId: 'e2', payload: { title: 'De thu hai', subject: 'Ly' } });

    await applyRemoteChanges([good, poison, good2], 'profile:p1', 3);

    expect((await db.exams.get('e1'))?.title).toBe('De hop le');
    expect(await db.exams.get('e-bad')).toBeUndefined();
    expect((await db.exams.get('e2'))?.title).toBe('De thu hai');
    expect((await db.syncState.get('profile:p1'))?.cursor).toBe(3);
  });
});
