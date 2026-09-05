import { db } from '../../db/database';
import { generateId } from '@exam/utils';

const KEY = 'sync:device-id';
export const deviceService = {
  async getDeviceId(): Promise<string> {
    const row = await db.settings.get(KEY);
    if (row && typeof row.value === 'string' && row.value) return row.value;
    const id = generateId('device');
    await db.settings.put({ key: KEY, value: id });
    return id;
  }
};
