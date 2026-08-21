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
    const mutation = { mutationId:"persist-1", profileId:"p1", deviceId:"d1", entityType:"exam", entityId:"e1", operation:"CREATE" as const, baseRevision:0, updatedAt:1, payload:{id:"e1",title:"Persisted",subject:"English"} };
    const pushed = await app.inject({method:"POST", url:"/api/sync/push", payload:{deviceId:"d1", mutations:[mutation]}});
    expect(pushed.statusCode).toBe(200);
    await app.close();

    const second = createSqliteRepositories(t.url);
    const app2 = buildApp(second);
    const pull = await app2.inject({method:"GET", url:"/api/sync/pull?cursor=0&profileId=p1"});
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
});
