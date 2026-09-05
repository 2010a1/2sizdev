import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.STORAGE_DRIVER = 'memory';
import { buildApp } from './app.js';
import { MemoryServerRepository, MemoryShareRepository, MemorySyncRepository } from './repositories.js';
import { exportExam, importExam } from '@exam/exam-format';

const require = createRequire(import.meta.url);

describe('Phase 7 API',()=>{
  async function authCookie(app:any, username='syncuser'){
    await app.inject({method:'POST',url:'/api/auth/register',payload:{name:username,username,password:'correct horse battery',confirmPassword:'correct horse battery'}});
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{username,password:'correct horse battery'}});
    return String(Array.isArray(login.headers['set-cookie'])?login.headers['set-cookie'][0]:login.headers['set-cookie']).split(';')[0];
  }
  it('push is idempotent and pull is profile scoped',async()=>{
    const app=buildApp(); const cookie=await authCookie(app);
    const mutation={mutationId:'m1',profileId:'p1',deviceId:'d1',entityType:'exam',entityId:'e1',operation:'CREATE',baseRevision:0,updatedAt:1,payload:{id:'e1',title:'A',subject:'English'}};
    const first=await app.inject({method:'POST',url:'/api/sync/push',headers:{cookie},payload:{deviceId:'d1',mutations:[mutation]}}); expect(first.statusCode).toBe(200);
    const second=await app.inject({method:'POST',url:'/api/sync/push',headers:{cookie},payload:{deviceId:'d1',mutations:[mutation]}}); expect(second.statusCode).toBe(200); expect(second.json().acknowledgements).toContain('m1');
    const p1=await app.inject({method:'GET',url:'/api/sync/pull?cursor=0&profileId=p1',headers:{cookie}}); const p2=await app.inject({method:'GET',url:'/api/sync/pull?cursor=0&profileId=p2',headers:{cookie}}); expect(p1.json().changes).toHaveLength(1); expect(p2.json().changes).toHaveLength(0); await app.close();
  });
  it('returns conflict for stale revision and honors deterministic winner',async()=>{
    const app=buildApp(); const cookie=await authCookie(app,'conflictuser');
    const base={profileId:'p1',entityType:'exam',entityId:'e1',deviceId:'d1',operation:'CREATE',baseRevision:0,updatedAt:100,payload:{id:'e1',title:'A',subject:'English'}};
    await app.inject({method:'POST',url:'/api/sync/push',headers:{cookie},payload:{deviceId:'d1',mutations:[{...base,mutationId:'m1'}]}});
    const stale=await app.inject({method:'POST',url:'/api/sync/push',headers:{cookie},payload:{deviceId:'d2',mutations:[{...base,mutationId:'m2',deviceId:'d2',updatedAt:90,payload:{id:'e1',title:'Older',subject:'English'}}]}}); expect(stale.json().conflicts).toHaveLength(1); await app.close();
  });

  it('defaults omitted share expiration to seven days', async()=>{
    const app=buildApp();
    const bytes=await exportExam({content:{id:'default-expiry',title:'Default expiry',subject:'English',questionCount:0,questions:[],source:'local',version:1,createdAt:1,updatedAt:1}});
    const imported=await importExam(bytes);
    const before=Date.now();
    const created=await app.inject({method:'POST',url:'/api/share',payload:{packageBase64:Buffer.from(bytes).toString('base64'),contentHash:imported.contentHash,formatVersion:imported.formatVersion}});
    expect(created.statusCode).toBe(200);
    const expiresAt=created.json().expiresAt as number;
    expect(expiresAt).toBeGreaterThanOrEqual(before+604_800_000-1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now()+604_800_000+1000);
    await app.close();
  });
  it('rejects invalid and expired shares',async()=>{
    const app=buildApp(); const invalid=await app.inject({method:'POST',url:'/api/share',payload:{packageBase64:'bad',contentHash:'sha256:'+'0'.repeat(64),formatVersion:1,expiresIn:'7d'}}); expect(invalid.statusCode).toBe(400);
    const bytes=await exportExam({content:{id:'e1',title:'Share',subject:'English',questionCount:0,questions:[],source:'local',version:1,createdAt:1,updatedAt:1}}); const imported=await importExam(bytes); const base64=Buffer.from(bytes).toString('base64');
    const created=await app.inject({method:'POST',url:'/api/share',payload:{packageBase64:base64,contentHash:imported.contentHash,formatVersion:1,expiresIn:'24h'}}); expect(created.statusCode).toBe(200); const code=created.json().shareCode; const fetched=await app.inject({method:'GET',url:`/api/share/${code}`}); expect(fetched.statusCode).toBe(200); await app.close();
  });
});


describe('Phase 8 API hardening', () => {
  it('sets security headers and rejects unknown request fields', async () => {
    const app = buildApp();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    const bad = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { deviceId: 'd', mutations: [], extra: true } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('requires the owner device for share deletion when an owner was recorded', async () => {
    const app = buildApp();
    const bytes = await exportExam({ content: { id: 'e2', title: 'Share', subject: 'English', questionCount: 0, questions: [], source: 'local', version: 1, createdAt: 1, updatedAt: 1 } });
    const imported = await importExam(bytes);
    const created = await app.inject({
      method: 'POST', url: '/api/share',
      payload: { packageBase64: Buffer.from(bytes).toString('base64'), contentHash: imported.contentHash, formatVersion: 1, expiresIn: '7d', ownerDeviceId: 'owner-1' }
    });
    const code = created.json().shareCode;
    const denied = await app.inject({ method: 'DELETE', url: `/api/share/${code}`, headers: { 'x-device-id': 'attacker' } });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({ method: 'DELETE', url: `/api/share/${code}`, headers: { 'x-device-id': 'owner-1' } });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it('deletes exam and vocabulary shares when the client sends a JSON content-type with no body (browser fetch behavior)', async () => {
    // Regression for a real bug: the web client always sent
    // 'content-type: application/json' on DELETE, even though DELETE never
    // carries a body. Fastify's default JSON parser rejects that combination
    // (content-type says JSON, body is empty) with its own 400 before the
    // route handler ever runs, independent of the share code, ownership, or
    // packageType. Exercise the exact header shape the browser sends, for
    // both share kinds, to make sure the empty-body case is accepted.
    const app = buildApp();
    const examBytes = await exportExam({ content: { id: 'ct-exam', title: 'Exam', subject: 'English', questionCount: 0, questions: [], source: 'local', version: 1, createdAt: 1, updatedAt: 1 } });
    const importedExam = await importExam(examBytes);
    const examShare = await app.inject({ method: 'POST', url: '/api/share', payload: { packageType: 'exam', packageBase64: Buffer.from(examBytes).toString('base64'), contentHash: importedExam.contentHash, formatVersion: importedExam.formatVersion, expiresIn: '7d', ownerDeviceId: 'owner-dev' } });
    expect(examShare.statusCode).toBe(200);
    const examDelete = await app.inject({ method: 'DELETE', url: `/api/share/${examShare.json().shareCode}`, headers: { 'content-type': 'application/json', 'x-device-id': 'owner-dev' }, payload: '' });
    expect(examDelete.statusCode).toBe(200);

    const vocabBytes = Buffer.from(JSON.stringify({ type: 'vocabularySet', version: 1, set: { name: 'Set' }, words: [] }));
    const vocabContentHash = `sha256:${createHash('sha256').update(vocabBytes).digest('hex')}`;
    const vocabShare = await app.inject({ method: 'POST', url: '/api/share', payload: { packageType: 'vocabularySet', packageBase64: vocabBytes.toString('base64'), contentHash: vocabContentHash, formatVersion: 1, expiresIn: '7d', ownerDeviceId: 'owner-dev' } });
    expect(vocabShare.statusCode).toBe(200);
    const vocabDelete = await app.inject({ method: 'DELETE', url: `/api/share/${vocabShare.json().shareCode}`, headers: { 'content-type': 'application/json', 'x-device-id': 'owner-dev' }, payload: '' });
    expect(vocabDelete.statusCode).toBe(200);
    // Ownerless shares are readable by code holders but never deletable by them.
    const orphanShare = await app.inject({ method: 'POST', url: '/api/share', payload: { packageType: 'vocabularySet', packageBase64: vocabBytes.toString('base64'), contentHash: vocabContentHash, formatVersion: 1, expiresIn: '7d' } });
    const orphanDelete = await app.inject({ method: 'DELETE', url: `/api/share/${orphanShare.json().shareCode}` });
    expect(orphanDelete.statusCode).toBe(403);
    await app.close();
  });

  it('returns NOT_FOUND, not a 500, when deleting a share code that does not exist', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/share/NOCODE1' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    await app.close();
  });

  it('deleting a share removes only the share record, never the source exam or the synced entity it points at', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'shareprune', username: 'shareprune', password: 'correct horse battery', confirmPassword: 'correct horse battery' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'shareprune', password: 'correct horse battery' } });
    const cookie = String(Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie']).split(';')[0];
    // The exam this share points at (sourceEntityId) lives in the sync/server
    // repository, a completely separate store from shares. Push it first so
    // we can prove deleting the share never touches it.
    const mutation = { mutationId: 'prune-m1', profileId: 'p1', deviceId: 'd1', entityType: 'exam', entityId: 'prune-exam-1', operation: 'CREATE', baseRevision: 0, updatedAt: 1, payload: { id: 'prune-exam-1', title: 'Keep me', subject: 'English' } };
    const pushed = await app.inject({ method: 'POST', url: '/api/sync/push', headers: { cookie }, payload: { deviceId: 'd1', mutations: [mutation] } });
    expect(pushed.statusCode).toBe(200);

    const bytes = await exportExam({ content: { id: 'prune-exam-1', title: 'Keep me', subject: 'English', questionCount: 0, questions: [], source: 'local', version: 1, createdAt: 1, updatedAt: 1 } });
    const imported = await importExam(bytes);
    const created = await app.inject({ method: 'POST', url: '/api/share', headers: { cookie }, payload: { packageType: 'exam', packageBase64: Buffer.from(bytes).toString('base64'), contentHash: imported.contentHash, formatVersion: imported.formatVersion, expiresIn: '7d', sourceEntityId: 'prune-exam-1' } });
    expect(created.statusCode).toBe(200);
    const code = created.json().shareCode;

    const deleted = await app.inject({ method: 'DELETE', url: `/api/share/${code}`, headers: { cookie } });
    expect(deleted.statusCode).toBe(200);

    // Share is gone (deleted/tombstoned)...
    const afterDelete = await app.inject({ method: 'GET', url: `/api/share/${code}` });
    expect(afterDelete.statusCode).toBe(404);
    // ...but the synced exam entity the share pointed at is untouched.
    const pulled = await app.inject({ method: 'GET', url: '/api/sync/pull?cursor=0&profileId=p1', headers: { cookie } });
    expect(pulled.statusCode).toBe(200);
    const stillThere = pulled.json().changes.find((c: any) => c.entityId === 'prune-exam-1');
    expect(stillThere).toBeTruthy();
    expect(stillThere.operation).toBe('CREATE');
    await app.close();
  });

  it('accepts a JSON content-type with an empty body on the other admin DELETE endpoints too (same browser fetch pattern)', async () => {
    const { MemoryAuthStore, hashPassword } = await import('./auth.js');
    const store = new MemoryAuthStore();
    await store.createUser({ id: 'admin-prune', username: 'admin-prune', displayName: 'Admin', passwordHash: hashPassword('correct horse battery'), role: 'ADMIN' });
    const app = buildApp({ authStore: store });
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'prune-target', username: 'prune-target', password: 'correct horse battery', confirmPassword: 'correct horse battery' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin-prune', password: 'correct horse battery' } });
    const cookie = String(Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie']).split(';')[0];
    const target = await app.inject({ method: 'GET', url: '/api/admin/users?search=prune-target', headers: { cookie } });
    const targetId = target.json().users[0].id;

    const deleteUser = await app.inject({ method: 'DELETE', url: `/api/admin/users/${targetId}`, headers: { cookie, 'content-type': 'application/json' }, payload: '' });
    expect(deleteUser.statusCode).toBe(200);

    // Non-existent ids: the point is these still resolve to their normal
    // NOT_FOUND contract instead of a body-parsing 400.
    const deleteAiKeyRes = await app.inject({ method: 'DELETE', url: '/api/admin/ai/keys/does-not-exist', headers: { cookie, 'content-type': 'application/json' }, payload: '' });
    expect(deleteAiKeyRes.statusCode).toBe(404);
    const deleteOfficial = await app.inject({ method: 'DELETE', url: '/api/admin/official-exams/does-not-exist', headers: { cookie, 'content-type': 'application/json' }, payload: '' });
    expect(deleteOfficial.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a share whose supplied hash does not match the package', async () => {
    const app = buildApp();
    const bytes = await exportExam({ content: { id: 'e3', title: 'Hash check', subject: 'English', questionCount: 0, questions: [], source: 'local', version: 1, createdAt: 1, updatedAt: 1 } });
    const imported = await importExam(bytes);
    const created = await app.inject({
      method: 'POST', url: '/api/share',
      payload: { packageBase64: Buffer.from(bytes).toString('base64'), contentHash: 'sha256:' + 'f'.repeat(64), formatVersion: imported.formatVersion, expiresIn: '7d' }
    });
    expect(created.statusCode).toBe(400);
    expect(created.json().error.code).toBe('HASH_MISMATCH');
    await app.close();
  });

  it('rejects oversized/invalid share bodies without exposing internals', async () => {
    const app = buildApp();
    const invalid = await app.inject({ method: 'POST', url: '/api/share', payload: { packageBase64: 'not-base64!!!', contentHash: 'sha256:' + '0'.repeat(64), formatVersion: 1, expiresIn: '7d' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain('node_modules');
    await app.close();
  });
});

describe('share code contract',()=>{
  it('generates six-character human-enterable codes and resolves case-insensitively',async()=>{
    const app=buildApp();
    const bytes=await exportExam({content:{id:'code-e1',title:'Code',subject:'English',questionCount:0,questions:[],source:'local',version:1,createdAt:1,updatedAt:1}});
    const imported=await importExam(bytes);
    const created=await app.inject({method:'POST',url:'/api/share',payload:{packageType:'exam',packageBase64:Buffer.from(bytes).toString('base64'),contentHash:imported.contentHash,formatVersion:imported.formatVersion,expiresIn:'7d',ownerDeviceId:'code-owner'}});
    expect(created.statusCode).toBe(200);
    const code=created.json().shareCode as string;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const fetched=await app.inject({method:'GET',url:`/api/share/${code.toLowerCase()}`});
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().shareCode).toBe(code);
    expect(fetched.json().storageKey).toBe(`shared-exams/${code}.exam`);
    const traversal=await app.inject({method:'GET',url:'/api/share/../../secret'});
    expect([400,404]).toContain(traversal.statusCode);
    // Regression: codes containing 0/1/I/O are accepted for deletion too,
    // so legacy/manual codes cannot get stuck behind the newer alphabet rule.
    const legacyRepo = {
      async get(code:string) { return code === '9BNWF6' ? {shareId:'legacy',code:'9BNWF6',packageBase64:'AA==',contentHash:'sha256:'+'0'.repeat(64),formatVersion:1,createdAt:1,ownerDeviceId:'legacy-owner'} : undefined; },
      async listByOwner() { return []; },
      async create() {},
      async update() {},
      async incrementAccess() {},
      async delete() {},
      async purgeUser() {},
      async purgeExpired() { return 0; }, async listAll() { return []; }, async hardDelete() {},
      async countByOwner() { return 0; },
      async close() {}
    };
    const legacyApp = buildApp({shareRepository:legacyRepo});
    const legacyDelete = await legacyApp.inject({method:'DELETE',url:'/api/share/9BNWF6',headers:{'x-device-id':'legacy-owner'}});
    expect(legacyDelete.statusCode).toBe(200);
    await legacyApp.close();
    await app.close();
  });
});

describe('share collision handling',()=>{
  it('returns a controlled failure when every generated code collides',async()=>{
    const occupied = {
      async get() { return {shareId:'occupied',code:'AAAAAA',packageBase64:'AA==',contentHash:'sha256:'+'0'.repeat(64),formatVersion:1,createdAt:1}; },
      async listByOwner() { return []; },
      async create() {},
      async update() {},
      async incrementAccess() {},
      async delete() {},
      async purgeUser() {},
      async purgeExpired() { return 0; }, async listAll() { return []; }, async hardDelete() {},
      async countByOwner() { return 0; },
      async close() {}
    };
    const app = buildApp({shareRepository: occupied});
    const bytes=await exportExam({content:{id:'collision-e1',title:'Collision',subject:'English',questionCount:0,questions:[],source:'local',version:1,createdAt:1,updatedAt:1}});
    const imported=await importExam(bytes);
    const created=await app.inject({method:'POST',url:'/api/share',payload:{packageType:'exam',packageBase64:Buffer.from(bytes).toString('base64'),contentHash:imported.contentHash,formatVersion:imported.formatVersion,expiresIn:'7d'}});
    expect(created.statusCode).toBe(503);
    expect(created.json().error.code).toBe('CODE_EXHAUSTED');
    await app.close();
  });
});


describe('Authentication and admin authorization',()=>{
  it('registers, logs in with an opaque HttpOnly session, and protects admin APIs',async()=>{
    const app=buildApp();
    const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'alice',username:'alice',password:'correct horse battery',confirmPassword:'correct horse battery'}});
    expect(reg.statusCode).toBe(201);
    const user=reg.json().user; expect(user.role).toBe('USER');
    const denied=await app.inject({method:'GET',url:'/api/admin/stats'}); expect(denied.statusCode).toBe(401);
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{name:'alice',username:'alice',password:'correct horse battery'}}); expect(login.statusCode).toBe(200);
    const cookie=login.headers['set-cookie']; const cookieHeader=Array.isArray(cookie)?cookie[0]:cookie; expect(String(cookieHeader)).toContain('HttpOnly'); expect(String(cookieHeader)).not.toContain('correct horse');
    const adminDenied=await app.inject({method:'GET',url:'/api/admin/stats',headers:{cookie:String(cookieHeader).split(';')[0]}}); expect(adminDenied.statusCode).toBe(403);
    await app.close();
  });
  it('keeps generic 401s and only locks when failures span multiple IPs (single-IP brute force cannot lock out a victim)',async()=>{
    const app=buildApp(); await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'bruteuser',username:'bruteuser',password:'correct horse battery',confirmPassword:'correct horse battery'}});
    // 5 same-IP failures: counter rises but no hard lock — the per-IP rate
    // limiter owns that attacker, and locking here would let anyone DoS a victim.
    for(let i=0;i<5;i++){const r=await app.inject({method:'POST',url:'/api/auth/login',payload:{name:'bruteuser',username:'bruteuser',password:'wrong password'}});expect(r.statusCode).toBe(401);expect(r.json().error.message).toBe('Thông tin đăng nhập không chính xác.');}
    const ok=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'bruteuser',password:'correct horse battery'}});expect(ok.statusCode).toBe(200);
    // Distributed failures (2+ IPs within 30 min) at threshold 5 do lock.
    for(let i=0;i<4;i++)await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'bruteuser',password:'wrong password'}});
    await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'bruteuser',password:'wrong password'},remoteAddress:'10.9.9.9'});
    // The IP check reads events written before the current attempt, so the
    // second IP only counts from the NEXT failure on.
    await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'bruteuser',password:'wrong password'},remoteAddress:'10.9.9.10'});
    const locked=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'bruteuser',password:'correct horse battery'},remoteAddress:'10.9.9.11'});
    expect(locked.statusCode).toBe(401);await app.close();
  });
});

  it('rejects user sync mutations that masquerade as official exams',async()=>{
    const app=buildApp();
    await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'officialuser',username:'officialuser',password:'correct horse battery',confirmPassword:'correct horse battery'}});
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'officialuser',password:'correct horse battery'}});
    const cookie=String(Array.isArray(login.headers['set-cookie'])?login.headers['set-cookie'][0]:login.headers['set-cookie']).split(';')[0];
    const bytes=await exportExam({content:{id:'official-e1',title:'Official',subject:'Math',questionCount:0,questions:[],source:'official',version:1,createdAt:1,updatedAt:1}});
    const imported=await importExam(bytes);
    const create=await app.inject({method:'POST',url:'/api/sync/push',headers:{cookie},payload:{deviceId:'d1',mutations:[{mutationId:'official-create',profileId:'p1',deviceId:'d1',entityType:'exam',entityId:'official-e1',operation:'CREATE',baseRevision:0,updatedAt:1,payload:{id:'official-e1',title:'Official',subject:'Math',source:'official',version:1}}]}});
    expect(create.statusCode).toBe(403);
    await app.close();
  });

  it('namespaces authenticated sync by server user so guessed profile ids cannot cross accounts',async()=>{
    const app=buildApp();
    await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'usera',username:'usera',password:'correct horse battery',confirmPassword:'correct horse battery'}});
    const loginA=await app.inject({method:'POST',url:'/api/auth/login',payload:{name:'usera',username:'usera',password:'correct horse battery'}}); const cookieA=Array.isArray(loginA.headers['set-cookie'])?loginA.headers['set-cookie'][0]:loginA.headers['set-cookie'];
    const pushed=await app.inject({method:'POST',url:'/api/sync/push',headers:{cookie:String(cookieA).split(';')[0]},payload:{deviceId:'d1',mutations:[{mutationId:'a1',profileId:'same-profile',deviceId:'d1',entityType:'exam',entityId:'e1',operation:'CREATE',baseRevision:0,updatedAt:1,payload:{id:'e1',title:'A',subject:'Math',source:'local'}}]}}); expect(pushed.statusCode).toBe(200);
    const anonymous=await app.inject({method:'GET',url:'/api/sync/pull?cursor=0&profileId=same-profile'}); expect(anonymous.statusCode).toBe(401);
    await app.close();
  });

describe('Account management and security center',()=>{
  it('changes password, revokes other sessions, and deletes the account with strong confirmation',async()=>{
    const app=buildApp();
    await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'accountuser',username:'accountuser',password:'correct horse battery',confirmPassword:'correct horse battery'}});
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{name:'accountuser',username:'accountuser',password:'correct horse battery'}}); const cookie=Array.isArray(login.headers['set-cookie'])?login.headers['set-cookie'][0]:login.headers['set-cookie'];
    const changed=await app.inject({method:'POST',url:'/api/auth/change-password',headers:{cookie:String(cookie).split(';')[0]},payload:{currentPassword:'correct horse battery',newPassword:'new secure password',confirmPassword:'new secure password'}});expect(changed.statusCode).toBe(200);
    const sessions=await app.inject({method:'GET',url:'/api/account/sessions',headers:{cookie:String(cookie).split(';')[0]}});expect(sessions.statusCode).toBe(200);expect(sessions.json().sessions.length).toBe(1);
    const badDelete=await app.inject({method:'POST',url:'/api/account/delete',headers:{cookie:String(cookie).split(';')[0]},payload:{password:'new secure password',confirmation:'delete'}});expect(badDelete.statusCode).toBe(400);
    const deleted=await app.inject({method:'POST',url:'/api/account/delete',headers:{cookie:String(cookie).split(';')[0]},payload:{password:'new secure password',confirmation:'DELETE'}});expect(deleted.statusCode).toBe(200);
    const after=await app.inject({method:'GET',url:'/api/account',headers:{cookie:String(cookie).split(';')[0]}});expect(after.statusCode).toBe(401);await app.close();
  });
  it('protects admin-only features and supports feature flag enforcement',async()=>{
    const { MemoryAuthStore }=await import('./auth.js'); const store=new MemoryAuthStore(); await store.createUser({id:'admin-1',username:'root',displayName:'Root',passwordHash:(await import('./auth.js')).hashPassword('correct horse battery'),role:'ADMIN'}); await store.setFeatureFlag('REGISTRATION',false);
    const app=buildApp({authStore:store}); const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'blocked',username:'blocked',password:'correct horse battery',confirmPassword:'correct horse battery'}});expect(reg.statusCode).toBe(403);
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{name:'root',username:'root',password:'correct horse battery'}});expect(login.statusCode).toBe(200);const cookie=Array.isArray(login.headers['set-cookie'])?login.headers['set-cookie'][0]:login.headers['set-cookie'];
    const flags=await app.inject({method:'GET',url:'/api/admin/features',headers:{cookie:String(cookie).split(';')[0]}});expect(flags.statusCode).toBe(200);expect(flags.json().flags.some((f:any)=>f.key==='REGISTRATION'&&f.enabled===false)).toBe(true);await app.close();
  });
});

describe('Security hardening regression coverage',()=>{
  it('persists session IP and exposes it only for the current user session',async()=>{
    const app=buildApp();
    await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'ipuser',username:'ipuser',password:'correct horse battery',confirmPassword:'correct horse battery'}});
    const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-forwarded-for':'203.0.113.10'},payload:{name:'ipuser',username:'ipuser',password:'correct horse battery'}});
    const cookie=String(Array.isArray(login.headers['set-cookie'])?login.headers['set-cookie'][0]:login.headers['set-cookie']).split(';')[0];
    const sessions=await app.inject({method:'GET',url:'/api/account/sessions',headers:{cookie}});
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().sessions[0].ip).toBe('127.0.0.1');
    await app.close();
  });

  it('rejects client-controlled role and owner fields',async()=>{
    const app=buildApp();
    const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'spoofuser',username:'spoofuser',password:'correct horse battery',confirmPassword:'correct horse battery',role:'ADMIN',ownerId:'admin',isAdmin:true}});
    expect(reg.statusCode).toBe(400);
    await app.close();
  });

  it('binds authenticated shares to the server-side account, not a client device id',async()=>{
    const app=buildApp();
    await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'shareowner',username:'shareowner',password:'correct horse battery',confirmPassword:'correct horse battery'}});
    const loginA=await app.inject({method:'POST',url:'/api/auth/login',payload:{name:'shareowner',username:'shareowner',password:'correct horse battery'}});
    const cookieA=String(Array.isArray(loginA.headers['set-cookie'])?loginA.headers['set-cookie'][0]:loginA.headers['set-cookie']).split(';')[0];
    const bytes=await exportExam({content:{id:'owned-share',title:'Owned',subject:'English',questionCount:0,questions:[],source:'local',version:1,createdAt:1,updatedAt:1}});
    const imported=await importExam(bytes);
    const created=await app.inject({method:'POST',url:'/api/share',headers:{cookie:cookieA,'x-device-id':'owner-device'},payload:{packageBase64:Buffer.from(bytes).toString('base64'),contentHash:imported.contentHash,formatVersion:imported.formatVersion,expiresIn:'7d',ownerDeviceId:'attacker-controlled'}});
    expect(created.statusCode).toBe(200);
    const code=created.json().shareCode;
    const denied=await app.inject({method:'DELETE',url:`/api/share/${code}`,headers:{'x-device-id':'owner-device'}});
    expect(denied.statusCode).toBe(403);
    const allowed=await app.inject({method:'DELETE',url:`/api/share/${code}`,headers:{cookie:cookieA,'x-device-id':'wrong-device'}});
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it('enforces feature flags on direct API access, not just the UI',async()=>{
    const {MemoryAuthStore,hashPassword}=await import('./auth.js');
    const store=new MemoryAuthStore();
    await store.createUser({id:'feature-admin',username:'feature-admin',displayName:'Feature Admin',passwordHash:hashPassword('correct horse battery'),role:'ADMIN'});
    await store.setFeatureFlag('OFFICIAL_EXAM',false);
    const app=buildApp({authStore:store});
    const direct=await app.inject({method:'GET',url:'/api/official-exams/does-not-exist'});
    expect(direct.statusCode).toBe(403);
    await app.close();
  });
});

describe('Rate limiter and aggregated security alert hardening',()=>{
  it('uses a synchronous single-instance rate limiter without bypass under concurrent calls',async()=>{
    const {MemoryRateLimiter}=await import('./rate-limit.js');
    const limiter=new MemoryRateLimiter();
    const results=await Promise.all(Array.from({length:20},()=>Promise.resolve(limiter.consume('same-key',10))));
    expect(results.filter(r=>r.allowed)).toHaveLength(10);
    expect(results.at(-1)?.count).toBe(20);
  });

  it('atomically aggregates concurrent SQLite security alerts into one row',async()=>{
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const {SqliteAuthStore}=await import('./auth.js');
    const db=new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE security_alerts(id TEXT PRIMARY KEY,type TEXT NOT NULL,severity TEXT NOT NULL,status TEXT NOT NULL,user_id TEXT,ip TEXT,reason TEXT NOT NULL,request_count INTEGER NOT NULL,metadata TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`);
    const store=new SqliteAuthStore(db);
    const now=Date.now();
    await Promise.all(Array.from({length:100},(_,i)=>store.upsertSecurityAlert({id:String(i),type:'BRUTE_FORCE_DETECTED',severity:'HIGH',status:'NEW',userId:'u1',ip:'203.0.113.10',reason:'test',requestCount:1,createdAt:now+i,updatedAt:now+i,metadata:{username:'alice',userAgent:'test'}})));
    const row=db.prepare('SELECT COUNT(*) AS c, MAX(request_count) AS n FROM security_alerts').get() as any;
    expect(Number(row.c)).toBe(1);
    expect(Number(row.n)).toBe(100);
  });
});

describe('storage gc',()=>{
  it('hard-purges expired shares and stale sync garbage, and is admin-only',async()=>{
    const { MemoryAuthStore, hashPassword }=await import('./auth.js');
    const store=new MemoryAuthStore();
    await store.createUser({id:'gc-admin',username:'gc-admin',displayName:'Admin',passwordHash:hashPassword('correct horse battery'),role:'ADMIN'});
    const serverRepository=new MemoryServerRepository();
    const syncRepository=new MemorySyncRepository();
    const shareRepository=new MemoryShareRepository();
    const app=buildApp({authStore:store,serverRepository,syncRepository,shareRepository});
    // Stale share: expired long past any grace period.
    await shareRepository.create({shareId:'gc-old',code:'OLDAAA',packageBase64:'AA==',contentHash:'sha256:'+'0'.repeat(64),formatVersion:1,createdAt:1,expiresAt:1});
    // Live share: expires in the future, must survive.
    await shareRepository.create({shareId:'gc-live',code:'LIVEAA',packageBase64:'AA==',contentHash:'sha256:'+'0'.repeat(64),formatVersion:1,createdAt:Date.now(),expiresAt:Date.now()+86_400_000});
    // Deleted entity past retention + one live entity.
    await serverRepository.put('u1:exam:e1',{profileId:'u1',entityType:'exam',entityId:'e1',revision:1,payload:{},updatedAt:1,deviceId:'d',deletedAt:1});
    await serverRepository.put('u1:exam:e2',{profileId:'u1',entityType:'exam',entityId:'e2',revision:1,payload:{},updatedAt:Date.now(),deviceId:'d'});
    // Stale mutation marker (deleted 8 days ago in gc terms).
    syncRepository['mutationIds'].set('m-old',1);
    syncRepository['mutationIds'].set('m-live',Date.now());

    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'gc-admin',password:'correct horse battery'}});
    const cookie=String(Array.isArray(login.headers['set-cookie'])?login.headers['set-cookie'][0]:login.headers['set-cookie']).split(';')[0];

    const anon=await app.inject({method:'POST',url:'/api/admin/storage/gc',payload:{}});
    expect(anon.statusCode).toBe(401);

    const run=await app.inject({method:'POST',url:'/api/admin/storage/gc',headers:{cookie},payload:{}});
    expect(run.statusCode).toBe(200);
    const report=run.json().report;
    expect(report.sharesPurged).toBe(1);
    expect(report.entitiesPurged).toBe(1);
    expect(report.mutationsPurged).toBe(1);
    expect(await shareRepository.get('OLDAAA')).toBeUndefined();
    expect((await shareRepository.get('LIVEAA'))?.code).toBe('LIVEAA');
    expect(await serverRepository.get('u1','exam','e2')).toBeDefined();
    expect(await serverRepository.get('u1','exam','e1')).toBeUndefined();

    const stats=await app.inject({method:'GET',url:'/api/admin/storage',headers:{cookie}});
    expect(stats.statusCode).toBe(200);
    expect(stats.json().driver).toBe('memory');

    // Admin share listing: metadata only (no packageBase64), newest first, paginated.
    await shareRepository.create({shareId:'gc-live2',code:'LIVEBB',packageBase64:'AAA=',contentHash:'sha256:'+'0'.repeat(64),formatVersion:1,createdAt:Date.now()-1000,expiresAt:Date.now()+86_400_000});
    const list=await app.inject({method:'GET',url:'/api/admin/shares?page=1&limit=1',headers:{cookie}});
    expect(list.statusCode).toBe(200);
    const body=list.json();
    expect(body.shares).toHaveLength(1);
    expect(body.hasMore).toBe(true);
    expect(body.shares[0].packageBase64).toBeUndefined();
    expect(body.shares[0].sizeBytes).toBeGreaterThan(0);
    // Admin delete hard-removes the share immediately.
    const del=await app.inject({method:'DELETE',url:`/api/admin/shares/${body.shares[0].code}`,headers:{cookie}});
    expect(del.statusCode).toBe(200);
    expect(await shareRepository.get(body.shares[0].code)).toBeUndefined();
    // Admin-deleting one share must not collateral-hard-delete other shares that
    // are expired but still inside the 7-day grace (recoverable via PUT /api/share).
    await shareRepository.create({shareId:'gc-grace',code:'GRACEA',packageBase64:'AA==',contentHash:'sha256:'+'0'.repeat(64),formatVersion:1,createdAt:Date.now()-86_400_000,expiresAt:Date.now()-3600_000});
    const del2=await app.inject({method:'DELETE',url:'/api/admin/shares/LIVEBB',headers:{cookie}});
    expect(del2.statusCode).toBe(200);
    expect((await shareRepository.get('GRACEA'))?.code).toBe('GRACEA');
    expect(await shareRepository.get('LIVEBB')).toBeUndefined();
    const anonList=await app.inject({method:'GET',url:'/api/admin/shares'});
    expect(anonList.statusCode).toBe(401);
    await app.close();
  });
});
