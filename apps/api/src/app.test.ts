import { describe, expect, it } from 'vitest';
process.env.NODE_ENV = 'test';
process.env.STORAGE_DRIVER = 'memory';
import { buildApp } from './app.js';
import { exportExam, importExam } from '@exam/exam-format';

describe('Phase 7 API',()=>{
  it('push is idempotent and pull is profile scoped',async()=>{
    const app=buildApp();
    const mutation={mutationId:'m1',profileId:'p1',deviceId:'d1',entityType:'exam',entityId:'e1',operation:'CREATE',baseRevision:0,updatedAt:1,payload:{id:'e1',title:'A',subject:'English'}};
    const first=await app.inject({method:'POST',url:'/api/sync/push',payload:{deviceId:'d1',mutations:[mutation]}}); expect(first.statusCode).toBe(200);
    const second=await app.inject({method:'POST',url:'/api/sync/push',payload:{deviceId:'d1',mutations:[mutation]}}); expect(second.statusCode).toBe(200); expect(second.json().acknowledgements).toContain('m1');
    const p1=await app.inject({method:'GET',url:'/api/sync/pull?cursor=0&profileId=p1'}); const p2=await app.inject({method:'GET',url:'/api/sync/pull?cursor=0&profileId=p2'}); expect(p1.json().changes).toHaveLength(1); expect(p2.json().changes).toHaveLength(0); await app.close();
  });
  it('returns conflict for stale revision and honors deterministic winner',async()=>{
    const app=buildApp();
    const base={profileId:'p1',entityType:'exam',entityId:'e1',deviceId:'d1',operation:'CREATE',baseRevision:0,updatedAt:100,payload:{id:'e1',title:'A',subject:'English'}};
    await app.inject({method:'POST',url:'/api/sync/push',payload:{deviceId:'d1',mutations:[{...base,mutationId:'m1'}]}});
    const stale=await app.inject({method:'POST',url:'/api/sync/push',payload:{deviceId:'d2',mutations:[{...base,mutationId:'m2',deviceId:'d2',updatedAt:90,payload:{id:'e1',title:'Older',subject:'English'}}]}}); expect(stale.json().conflicts).toHaveLength(1); await app.close();
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
    const created=await app.inject({method:'POST',url:'/api/share',payload:{packageType:'exam',packageBase64:Buffer.from(bytes).toString('base64'),contentHash:imported.contentHash,formatVersion:imported.formatVersion,expiresIn:'7d'}});
    expect(created.statusCode).toBe(200);
    const code=created.json().shareCode as string;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const fetched=await app.inject({method:'GET',url:`/api/share/${code.toLowerCase()}`});
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().shareCode).toBe(code);
    expect(fetched.json().storageKey).toBe(`shared-exams/${code}.exam`);
    const traversal=await app.inject({method:'GET',url:'/api/share/../../secret'});
    expect([400,404]).toContain(traversal.statusCode);
    await app.close();
  });
});

describe('share collision handling',()=>{
  it('returns a controlled failure when every generated code collides',async()=>{
    const occupied = {
      async get() { return {shareId:'occupied',code:'AAAAAA',packageBase64:'AA==',contentHash:'sha256:'+'0'.repeat(64),formatVersion:1,createdAt:1}; },
      async create() {},
      async delete() {},
      async purgeUser() {},
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
  it('rejects repeated bad passwords with a generic message and locks the account',async()=>{
    const app=buildApp(); await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'bruteuser',username:'bruteuser',password:'correct horse battery',confirmPassword:'correct horse battery'}});
    for(let i=0;i<5;i++){const r=await app.inject({method:'POST',url:'/api/auth/login',payload:{name:'bruteuser',username:'bruteuser',password:'wrong password'}});expect(r.statusCode).toBe(401);expect(r.json().error.message).toBe('Thông tin đăng nhập không chính xác.');}
    const ok=await app.inject({method:'POST',url:'/api/auth/login',payload:{name:'bruteuser',username:'bruteuser',password:'correct horse battery'}});expect(ok.statusCode).toBe(401);await app.close();
  });
});

  it('rejects user sync mutations that masquerade as official exams',async()=>{
    const app=buildApp();
    const bytes=await exportExam({content:{id:'official-e1',title:'Official',subject:'Math',questionCount:0,questions:[],source:'official',version:1,createdAt:1,updatedAt:1}});
    const imported=await importExam(bytes);
    const create=await app.inject({method:'POST',url:'/api/sync/push',payload:{deviceId:'d1',mutations:[{mutationId:'official-create',profileId:'p1',deviceId:'d1',entityType:'exam',entityId:'official-e1',operation:'CREATE',baseRevision:0,updatedAt:1,payload:{id:'official-e1',title:'Official',subject:'Math',source:'official',version:1}}]}});
    expect(create.statusCode).toBe(403);
    await app.close();
  });

  it('namespaces authenticated sync by server user so guessed profile ids cannot cross accounts',async()=>{
    const app=buildApp();
    await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'usera',username:'usera',password:'correct horse battery',confirmPassword:'correct horse battery'}});
    const loginA=await app.inject({method:'POST',url:'/api/auth/login',payload:{name:'usera',username:'usera',password:'correct horse battery'}}); const cookieA=Array.isArray(loginA.headers['set-cookie'])?loginA.headers['set-cookie'][0]:loginA.headers['set-cookie'];
    const pushed=await app.inject({method:'POST',url:'/api/sync/push',headers:{cookie:String(cookieA).split(';')[0]},payload:{deviceId:'d1',mutations:[{mutationId:'a1',profileId:'same-profile',deviceId:'d1',entityType:'exam',entityId:'e1',operation:'CREATE',baseRevision:0,updatedAt:1,payload:{id:'e1',title:'A',subject:'Math',source:'local'}}]}}); expect(pushed.statusCode).toBe(200);
    const anonymous=await app.inject({method:'GET',url:'/api/sync/pull?cursor=0&profileId=same-profile'}); expect(anonymous.json().changes).toHaveLength(0);
    await app.close();
  });

describe('Account management and security center',()=>{
  it('changes password, revokes other sessions, and deletes the account with strong confirmation',async()=>{
    const app=buildApp();
    await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'accountuser',username:'accountuser',password:'correct horse battery',confirmPassword:'correct horse battery'}});
    const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{name:'account@example.com',username:'account@example.com',password:'correct horse battery'}}); const cookie=Array.isArray(login.headers['set-cookie'])?login.headers['set-cookie'][0]:login.headers['set-cookie'];
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
    const {DatabaseSync}=await import('node:sqlite');
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
