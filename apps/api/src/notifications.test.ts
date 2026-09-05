import { describe, expect, it } from 'vitest';
process.env.NODE_ENV = 'test';
process.env.STORAGE_DRIVER = 'memory';
import { buildApp } from './app.js';
import { exportExam, importExam } from '@exam/exam-format';
import { MemoryAuthStore, hashPassword } from './auth.js';

async function adminApp(adminId: string, username: string) {
  const store = new MemoryAuthStore();
  await store.createUser({ id: adminId, username, displayName: 'Admin', passwordHash: hashPassword('correct horse battery'), role: 'ADMIN' });
  return { store, app: buildApp({ authStore: store }) };
}
async function login(app: any, username: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'correct horse battery' } });
  return String(Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'][0] : r.headers['set-cookie']).split(';')[0];
}
async function registerAndLogin(app: any, username: string) {
  await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: username, username, password: 'correct horse battery', confirmPassword: 'correct horse battery' } });
  return login(app, username);
}

describe('Notifications system', () => {
  it('admin creates and publishes to all users; users read/mark/delete; permissions enforced', async () => {
    const { app } = await adminApp('notif-admin', 'notifadmin');
    const adminCookie = await login(app, 'notifadmin');
    await registerAndLogin(app, 'nuser1');
    const u1Cookie = await login(app, 'nuser1');
    await registerAndLogin(app, 'nuser2');

    // permission boundaries
    expect((await app.inject({ method: 'GET', url: '/api/admin/notifications', headers: { cookie: u1Cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/notifications', headers: { cookie: u1Cookie }, payload: { title: 'x', body: 'y' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/notifications' })).statusCode).toBe(401);

    // publish with XSS payload in body — sanitized on write
    const created = await app.inject({ method: 'POST', url: '/api/admin/notifications', headers: { cookie: adminCookie }, payload: { title: 'Bảo trì hệ thống', body: '<p>Xin chào</p><script>alert(1)</script><img src=x onerror=alert(2)>', category: 'warning', publish: true } });
    expect(created.statusCode).toBe(200);
    const message = created.json().message;
    expect(message.status).toBe('SENT');
    expect(message.sentCount).toBe(3); // admin + 2 users
    expect(message.body).not.toContain('<script');
    expect(message.body).not.toContain('onerror');
    expect(message.body).toContain('Xin chào');

    // sent messages are immutable
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/notifications/${message.id}`, headers: { cookie: adminCookie }, payload: { title: 'edit' } })).statusCode).toBe(409);

    // user sees unread badge + list
    const list = await app.inject({ method: 'GET', url: '/api/notifications', headers: { cookie: u1Cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().unread).toBe(1);
    expect(list.json().notifications[0].title).toBe('Bảo trì hệ thống');
    const notifId = list.json().notifications[0].id;

    // foreign id delete is 404, never a leak
    const u2Cookie = await login(app, 'nuser2');
    expect((await app.inject({ method: 'DELETE', url: `/api/notifications/${crypto.randomUUID()}`, headers: { cookie: u2Cookie } })).statusCode).toBe(404);

    // mark read / mark all / delete
    expect((await app.inject({ method: 'POST', url: '/api/notifications/read', headers: { cookie: u1Cookie }, payload: { ids: [notifId] } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/notifications', headers: { cookie: u1Cookie } })).json().unread).toBe(0);
    expect((await app.inject({ method: 'POST', url: '/api/notifications/read', headers: { cookie: u2Cookie }, payload: { all: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/notifications/${notifId}`, headers: { cookie: u1Cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/notifications', headers: { cookie: u1Cookie } })).json().total).toBe(0);
    await app.close();
  });

  it('targets specific users, supports draft/schedule/edit/delete, validates inputs', async () => {
    const { store, app } = await adminApp('notif-admin2', 'notifadmin2');
    await store.createUser({ id: 'target-u', username: 'targetu', displayName: 'Target', passwordHash: hashPassword('correct horse battery') });
    await store.createUser({ id: 'other-u', username: 'otheru', displayName: 'Other', passwordHash: hashPassword('correct horse battery') });
    const cookie = await login(app, 'notifadmin2');

    expect((await app.inject({ method: 'POST', url: '/api/admin/notifications', headers: { cookie }, payload: { title: 't', body: 'b', audience: 'USERS', targetUserIds: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/admin/notifications', headers: { cookie }, payload: { title: 't', body: 'b', audience: 'USERS', targetUserIds: ['ghost'] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/admin/notifications', headers: { cookie }, payload: { title: 't', body: 'b', scheduledAt: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/admin/notifications', headers: { cookie }, payload: { title: 't', body: 'b', link: 'https://evil.example' } })).statusCode).toBe(400);

    const draft = await app.inject({ method: 'POST', url: '/api/admin/notifications', headers: { cookie }, payload: { title: 'Draft', body: '<p>Nháp</p>', audience: 'USERS', targetUserIds: ['target-u'] } });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().message.status).toBe('DRAFT');
    const id = draft.json().message.id;
    const edited = await app.inject({ method: 'PATCH', url: `/api/admin/notifications/${id}`, headers: { cookie }, payload: { title: 'Final', category: 'success' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().message.title).toBe('Final');
    const published = await app.inject({ method: 'POST', url: `/api/admin/notifications/${id}/publish`, headers: { cookie } });
    expect(published.statusCode).toBe(200);
    expect(published.json().message.sentCount).toBe(1);

    // scheduled future stays SCHEDULED
    const sched = await app.inject({ method: 'POST', url: '/api/admin/notifications', headers: { cookie }, payload: { title: 'Later', body: 'b', scheduledAt: Date.now() + 3600_000, publish: true } });
    expect(sched.json().message.status).toBe('SCHEDULED');
    const list = await app.inject({ method: 'GET', url: '/api/admin/notifications', headers: { cookie } });
    expect(list.json().messages.some((m: any) => m.status === 'SCHEDULED')).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/notifications/${id}`, headers: { cookie } })).statusCode).toBe(200);
    await app.close();
  });
});

describe('System settings and resource caps', () => {
  it('admin reads/updates settings with range validation; anonymous and users forbidden', async () => {
    const { app } = await adminApp('set-admin', 'setadmin');
    const cookie = await login(app, 'setadmin');
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: { cookie }, payload: { maxExamsPerUser: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: { cookie }, payload: { nope: 1 } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: { cookie }, payload: { maxExamsPerUser: 2, maxQuestionsPerExam: 2 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.maxExamsPerUser).toBe(2);
    await app.close();
  });

  it('maxExamsPerUser blocks exam creation beyond the cap; admin exam list/delete enforceable', async () => {
    const { app } = await adminApp('cap-admin', 'capadmin');
    const adminCookie = await login(app, 'capadmin');
    await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: { cookie: adminCookie }, payload: { maxExamsPerUser: 2 } });
    const cookie = await registerAndLogin(app, 'capuser');
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json().user;
    const capUserId = me.id as string;
    const exam = (eid: string, mid: string) => ({ mutationId: mid, profileId: 'p1', deviceId: 'd1', entityType: 'exam', entityId: eid, operation: 'CREATE', baseRevision: 0, updatedAt: Date.now(), payload: { id: eid, title: 'T', subject: 'S', questions: [] } });
    expect((await app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: { deviceId: 'd1', mutations: [exam('c1', 'm1')] } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: { deviceId: 'd1', mutations: [exam('c2', 'm2')] } })).statusCode).toBe(200);
    // third create → 403 even split across separate slow requests
    const blocked = await app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: { deviceId: 'd1', mutations: [exam('c3', 'm3')] } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('LIMIT_REACHED');
    // updates to existing exams still pass
    expect((await app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: { deviceId: 'd1', mutations: [{ ...exam('c1', 'm4'), operation: 'UPDATE', baseRevision: 1 }] } })).statusCode).toBe(200);
    // admin views
    const userExams = await app.inject({ method: 'GET', url: `/api/admin/users/${capUserId}/exams`, headers: { cookie: adminCookie } });
    expect(userExams.statusCode).toBe(200);
    expect(userExams.json().total).toBe(2);
    const globalExams = await app.inject({ method: 'GET', url: `/api/admin/exams?owner=${capUserId}`, headers: { cookie: adminCookie } });
    expect(globalExams.statusCode).toBe(200);
    expect(globalExams.json().total).toBe(2);
    // user cannot use admin endpoints
    expect((await app.inject({ method: 'GET', url: '/api/admin/exams', headers: { cookie } })).statusCode).toBe(403);
    // admin soft-deletes one exam; creating again fits under the cap
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/exams/${capUserId}/c2`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: { deviceId: 'd1', mutations: [exam('c4', 'm5')] } })).statusCode).toBe(200);
    await app.close();
  });

  it('maxQuestionsPerExam and maxSharesPerUser are enforced on direct API calls', async () => {
    const { app } = await adminApp('q-admin', 'qadmin');
    const adminCookie = await login(app, 'qadmin');
    await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: { cookie: adminCookie }, payload: { maxQuestionsPerExam: 1, maxSharesPerUser: 10 } });
    const cookie = await registerAndLogin(app, 'quser');

    const big = await app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: { deviceId: 'd1', mutations: [{ mutationId: 'qm1', profileId: 'p1', deviceId: 'd1', entityType: 'exam', entityId: 'q1', operation: 'CREATE', baseRevision: 0, updatedAt: Date.now(), payload: { id: 'q1', title: 'T', subject: 'S', questions: [{}, {}, {}] } }] } });
    expect(big.statusCode).toBe(400);
    expect(big.json().error.code).toBe('TOO_MANY_QUESTIONS');

    const mkBytes = async (id: string) => { const bytes = await exportExam({ content: { id, title: 'S' + id, subject: 'English', questionCount: 0, questions: [], source: 'local', version: 1, createdAt: 1, updatedAt: 1 } }); const imported = await importExam(bytes); return { base64: Buffer.from(bytes).toString('base64'), hash: imported.contentHash }; };
    const s1 = await mkBytes('q-share-1');
    expect((await app.inject({ method: 'POST', url: '/api/share', headers: { cookie }, payload: { packageBase64: s1.base64, contentHash: s1.hash, formatVersion: 1 } })).statusCode).toBe(200);

    // question cap fires on share create
    const twoQ = await exportExam({ content: { id: 'q-share-3', title: 'Two', subject: 'English', questionCount: 2, questions: [{ id: 'a', examId: 'q-share-3', order: 0, type: 'TRUE_FALSE', content: 'a?', correctAnswer: true }, { id: 'b', examId: 'q-share-3', order: 1, type: 'TRUE_FALSE', content: 'b?', correctAnswer: false }], source: 'local', version: 1, createdAt: 1, updatedAt: 1 } });
    const imported = await importExam(twoQ);
    const qBlocked = await app.inject({ method: 'POST', url: '/api/share', headers: { cookie }, payload: { packageBase64: Buffer.from(twoQ).toString('base64'), contentHash: imported.contentHash, formatVersion: imported.formatVersion } });
    expect(qBlocked.statusCode).toBe(403);
    expect(qBlocked.json().error.code).toBe('TOO_MANY_QUESTIONS');

    // then tighten the share cap: second live share → LIMIT_REACHED
    await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: { cookie: adminCookie }, payload: { maxSharesPerUser: 1 } });
    const s2 = await mkBytes('q-share-2');
    const shareBlocked = await app.inject({ method: 'POST', url: '/api/share', headers: { cookie }, payload: { packageBase64: s2.base64, contentHash: s2.hash, formatVersion: 1 } });
    expect(shareBlocked.statusCode).toBe(403);
    expect(shareBlocked.json().error.code).toBe('LIMIT_REACHED');
    await app.close();
  });
});

describe('CSRF origin enforcement', () => {
  it('rejects a cookie-authenticated POST from a foreign origin with 403, not a 500', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'csrftest', username: 'csrftest', password: 'correct horse battery', confirmPassword: 'correct horse battery' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'csrftest', password: 'correct horse battery' } });
    const cookie = String(Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie']).split(';')[0];
    const evil = await app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie, origin: 'https://evil.example' }, payload: { deviceId: 'd', mutations: [] } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error.code).toBe('CSRF_ORIGIN_DENIED');
    const good = await app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie, origin: 'http://localhost:5173' }, payload: { deviceId: 'd', mutations: [] } });
    expect(good.statusCode).toBe(200);
    await app.close();
  });
});

describe('Vocabulary translate proxy', () => {
  it('translates words via the online API, caches, and filters echoed words', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (url: any) => {
      calls++;
      if (String(url).includes('q=happy')) return { ok: true, json: async () => [[['Vui vẻ', 'happy']]] } as any;
      if (String(url).includes('q=zzquota')) return { ok: true, json: async () => [[['zzquota', 'zzquota']]] } as any; // Google echoes unrecognized words
      throw new Error('network down');
    }) as any;
    try {
      const app = buildApp();
      await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'vocuser', username: 'vocuser', password: 'correct horse battery', confirmPassword: 'correct horse battery' } });
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'vocuser', password: 'correct horse battery' } });
      const cookie = String(Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie']).split(';')[0];
      const anon = await app.inject({ method: 'GET', url: '/api/vocabulary/translate?words=happy' });
      expect(anon.statusCode).toBe(401);
      const res = await app.inject({ method: 'GET', url: '/api/vocabulary/translate?words=happy,zzquota,ZZbad!!word', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const t = res.json().translations;
      expect(t.happy).toBe('Vui vẻ');
      expect(t.zzquota).toBeNull(); // echoed word filtered
      expect(t['zzbad!!word']).toBeUndefined(); // invalid shape dropped
      // second call for the same word is served from cache (no extra fetch)
      const before = calls;
      await app.inject({ method: 'GET', url: '/api/vocabulary/translate?words=happy', headers: { cookie } });
      expect(calls).toBe(before);
      await app.close();
    } finally { globalThis.fetch = originalFetch; }
  });
});
