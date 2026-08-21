import type { SyncEntityType, SyncMutationOperation } from '@exam/shared-types';
export interface LocalMutation {
  profileId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncMutationOperation;
  payload?: unknown;
  updatedAt: number;
  baseRevision?: number;
}
export interface SyncTransport {
  push(deviceId: string, mutations: import('@exam/shared-types').SyncMutationDto[]): Promise<import('@exam/shared-types').SyncPushResponse>;
  pull(cursor: number, profileId: string): Promise<import('@exam/shared-types').SyncPullResponse>;
}
