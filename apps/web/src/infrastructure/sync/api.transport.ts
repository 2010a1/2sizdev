import type { SyncMutationDto, SyncPullResponse, SyncPushResponse } from '@exam/shared-types';
import type { SyncTransport } from './sync.types';

import { apiUrl } from '../api/base';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(apiUrl(path), { ...init, credentials: 'include', signal: controller.signal, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json() as Promise<T>;
  } finally { clearTimeout(timer); }
}

export const apiSyncTransport: SyncTransport = {
  push(deviceId: string, mutations: SyncMutationDto[]): Promise<SyncPushResponse> {
    return request('/api/sync/push', { method: 'POST', body: JSON.stringify({ deviceId, mutations }) });
  },
  pull(cursor: number, profileId: string): Promise<SyncPullResponse> {
    return request(`/api/sync/pull?cursor=${encodeURIComponent(cursor)}&profileId=${encodeURIComponent(profileId)}`);
  }
};
