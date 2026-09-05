import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createSqliteRepositories } from "../repositories.js";
import { buildApp } from "../app.js";

function tempDb() { const dir = mkdtempSync(join(tmpdir(), "exam-phase9-")); return { dir, url: `file:${join(dir, "exam.db")}` }; }

describe("Phase 9 SQLite persistence", () => {
  it("persists sync mutations and shares across repository recreation", async () => {
    const t = tempDb();
    const first = createSqliteRepositories(t.url);
    const app = buildApp(first);
    // Sync is authenticated (Phase 8 hardening): register + log in to get a session
    // cookie, then push under that authenticated identity.
    await app.inject({method:"POST", url:"/api/auth/register", payload:{name:"persistuser", username:"persistuser", password:"correct horse battery", confirmPassword:"correct horse battery"}});
    const login = await app.inject({method:"POST", url:"/api/auth/login", payload:{username:"persistuser", password:"correct horse battery"}});
    const cookie = String(Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"][0] : login.headers["set-cookie"]).split(";")[0];
    const mutation = { mutationId:"persist-1", profileId:"p1", deviceId:"d1", entityType:"exam", entityId:"e1", operation:"CREATE" as const, baseRevision:0, updatedAt:1, payload:{id:"e1",title:"Persisted",subject:"English"} };
    const pushed = await app.inject({method:"POST", url:"/api/sync/push", headers:{cookie}, payload:{deviceId:"d1", mutations:[mutation]}});
    expect(pushed.statusCode).toBe(200);
    await app.close();

    const second = createSqliteRepositories(t.url);
    const app2 = buildApp(second);
    const login2 = await app2.inject({method:"POST", url:"/api/auth/login", payload:{username:"persistuser", password:"correct horse battery"}});
    const cookie2 = String(Array.isArray(login2.headers["set-cookie"]) ? login2.headers["set-cookie"][0] : login2.headers["set-cookie"]).split(";")[0];
    const pull = await app2.inject({method:"GET", url:"/api/sync/pull?cursor=0&profileId=p1", headers:{cookie:cookie2}});
    expect(pull.statusCode).toBe(200);
    expect(pull.json().changes[0].entityId).toBe("e1");
    const shareRepo = second.shareRepository;
    await shareRepo.create({shareId:"s1",code:"ABCD23",packageBase64:"AA==",contentHash:"sha256:"+"0".repeat(64),formatVersion:1,createdAt:1});
    await app2.close();

    const third = createSqliteRepositories(t.url);
    expect(await third.shareRepository.get("ABCD23")).toBeTruthy();
    expect(existsSync(join(t.dir, "shared-exams", "ABCD23.exam"))).toBe(true);
    await third.shareRepository.delete("ABCD23");
    await third.shareRepository.close();
    rmSync(t.dir, {recursive:true, force:true});
  });

  it("preserves tombstones, unique mutation ids and deleted shares across reopen", async () => {
    const t = tempDb();
    const first = createSqliteRepositories(t.url);
    await first.syncRepository.transaction(async () => {
      await first.syncRepository.rememberMutation("m-delete", "d1");
      await first.serverRepository.put("p1:exam:e1", { profileId:"p1", entityType:"exam", entityId:"e1", revision:2, updatedAt:2, deviceId:"d1", deletedAt:2 });
      await first.syncRepository.append({ profileId:"p1", entityType:"exam", entityId:"e1", revision:2, operation:"DELETE", updatedAt:2, deviceId:"d1", deletedAt:2 });
    });
    await first.shareRepository.create({shareId:"s1",code:"ABCD24",packageBase64:"AA==",contentHash:"sha256:"+"0".repeat(64),formatVersion:1,createdAt:1});
    await first.shareRepository.delete("ABCD24");
    await first.shareRepository.close();

    const second = createSqliteRepositories(t.url);
    expect(await second.syncRepository.rememberMutation("m-delete", "d1")).toBe(false);
    expect((await second.serverRepository.get("p1","exam","e1"))?.deletedAt).toBe(2);
    expect((await second.shareRepository.get("ABCD24"))?.deleted).toBe(true);
    await second.shareRepository.close();
    rmSync(t.dir, {recursive:true, force:true});
  });

  it("rolls back mutation, entity and change together", async () => {
    const t = tempDb();
    const repos = createSqliteRepositories(t.url);
    await expect(repos.syncRepository.transaction(async () => {
      await repos.syncRepository.rememberMutation("rollback-1", "d1");
      await repos.serverRepository.put("p1:exam:e1", {profileId:"p1",entityType:"exam",entityId:"e1",revision:1,payload:{id:"e1"},updatedAt:1,deviceId:"d1"});
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await repos.syncRepository.pull(0,"p1",10)).toMatchObject({changes:[]});
    expect(await repos.serverRepository.get("p1","exam","e1")).toBeUndefined();
    expect(await repos.syncRepository.rememberMutation("rollback-1","d1")).toBe(true);
    await repos.shareRepository.close();
    rmSync(t.dir, {recursive:true, force:true});
  });

  // Notifications + settings also have an in-memory driver used by unit tests;
  // this exercises the SQLite SQL itself (a placeholder-count bug in the
  // message INSERT passed every memory-driver test and only broke here).
  it("persists notifications and settings via the sqlite driver", async () => {
    const t = tempDb();
    const repos = createSqliteRepositories(t.url);
    const app = buildApp(repos);
    await app.inject({method:"POST", url:"/api/auth/register", payload:{name:"notifsqlite", username:"notifsqlite", password:"correct horse battery", confirmPassword:"correct horse battery"}});
    const login = await app.inject({method:"POST", url:"/api/auth/login", payload:{username:"notifsqlite", password:"correct horse battery"}});
    const cookie = String(Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"][0] : login.headers["set-cookie"]).split(";")[0];
    await app.inject({method:"POST", url:"/api/auth/register", payload:{name:"notifsqlite2", username:"notifsqlite2", password:"correct horse battery", confirmPassword:"correct horse battery"}});
    const created = await app.inject({method:"POST", url:"/api/admin/notifications", headers:{cookie}, payload:{title:"Sqlite thông báo", body:"<p>Nội dung</p>", publish:true, category:"info"}});
    expect(created.statusCode).toBe(403); // regular user cannot author notifications
    const denied = await app.inject({method:"GET", url:"/api/admin/notifications", headers:{cookie}});
    expect(denied.statusCode).toBe(403);
    await app.close();

    // Reopen the same file and run the full admin publish flow: proves the
    // message INSERT/UPDATE and fan-out SQL survive a restart. Promote the
    // second registered user to admin directly in SQLite so the auth store
    // (and the fan-out audience) stays the persisted one.
    const second = createSqliteRepositories(t.url);
    second.db.prepare("UPDATE users SET role='ADMIN' WHERE username='notifsqlite2'").run();
    const app2 = buildApp(second);
    const adminLogin = await app2.inject({method:"POST", url:"/api/auth/login", payload:{username:"notifsqlite2", password:"correct horse battery"}});
    const adminCookie = String(Array.isArray(adminLogin.headers["set-cookie"]) ? adminLogin.headers["set-cookie"][0] : adminLogin.headers["set-cookie"]).split(";")[0];
    const sent = await app2.inject({method:"POST", url:"/api/admin/notifications", headers:{cookie:adminCookie}, payload:{title:"Sqlite thông báo", body:"<p>Nội dung</p>", category:"info", publish:true}});
    expect(sent.statusCode).toBe(200);
    expect(sent.json().message.status).toBe("SENT");
    expect(sent.json().message.sentCount).toBe(2); // both registered users

    // settings persist too
    const set = await app2.inject({method:"PATCH", url:"/api/admin/settings", headers:{cookie:adminCookie}, payload:{maxExamsPerUser: 7}});
    expect(set.statusCode).toBe(200);
    await app2.close();

    const third = createSqliteRepositories(t.url);
    const app3 = buildApp(third);
    const userLogin = await app3.inject({method:"POST", url:"/api/auth/login", payload:{username:"notifsqlite", password:"correct horse battery"}});
    const userCookie = String(Array.isArray(userLogin.headers["set-cookie"]) ? userLogin.headers["set-cookie"][0] : userLogin.headers["set-cookie"]).split(";")[0];
    const list = await app3.inject({method:"GET", url:"/api/notifications", headers:{cookie:userCookie}});
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);
    expect(list.json().unread).toBe(1);
    const settings = await app3.inject({method:"GET", url:"/api/admin/settings"});
    expect(settings.statusCode).toBe(401); // anonymous
    await app3.close();
    rmSync(t.dir, {recursive:true, force:true});
  });

  // Regression: sqlite listExams once crashed (500) because raw snake_case rows
  // reached the camelCase mapper — the memory driver passed every unit test.
  it("admin exam listing works on the sqlite driver", async () => {
    const t = tempDb();
    const repos = createSqliteRepositories(t.url);
    await repos.serverRepository.put("u1:p1:exam", { profileId:"u1:p1", entityType:"exam", entityId:"exam", revision:1, payload:{ id:"exam", title:"Sqlite đề", questions:[1,2,3] }, updatedAt:1, deviceId:"d1" });
    const listed = await repos.serverRepository.listExams({ offset:0, limit:20 });
    expect(listed.total).toBe(1);
    expect(listed.rows[0]).toMatchObject({ ownerUserId:"u1", entityId:"exam", title:"Sqlite đề", questionCount:3 });
    const searched = await repos.serverRepository.listExams({ offset:0, limit:20, search:"sqlite đề" });
    expect(searched.total).toBe(1);
    expect((await repos.serverRepository.listExams({ offset:0, limit:20, search:"zzz" })).total).toBe(0);
    expect(await repos.serverRepository.countExamsByUser("u1")).toBe(1);
    const removed = await repos.serverRepository.softDeleteExamsByOwner("u1", "exam");
    expect(removed.length).toBe(1);
    expect((await repos.serverRepository.listExams({ offset:0, limit:20 })).total).toBe(0);
    await repos.shareRepository.close();
    rmSync(t.dir, {recursive:true, force:true});
  });
});
