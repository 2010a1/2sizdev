import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it, afterEach } from "vitest";
import { ExamDatabase } from "../db/database";

const baseStores = {
  profiles: "id", exams: "id", questions: "id", attempts: "id", answers: "id",
  vocabularies: "id, profileId", vocabQuestions: "id, vocabularyId, profileId",
  vocabProgress: "id, vocabularyId, profileId", sharedExams: "id",
  syncQueue: "id, profileId, type, status", syncState: "key", settings: "key"
};

describe("Phase 8 migration hardening", () => {
  const names: string[] = [];
  let sequence = 0;
  afterEach(async () => {
    for (const name of names.splice(0)) await Dexie.delete(name);
  });

  for (const fromVersion of [1, 2, 3, 4, 5]) {
    it(`upgrades v${fromVersion} to the current schema without data loss`, async () => {
      const name = `phase8-migration-${fromVersion}-${Date.now()}-${sequence++}`;
      names.push(name);
      const old = new Dexie(name);
      old.version(fromVersion).stores({
        ...baseStores,
        ...(fromVersion >= 2 ? { examAssets: "id, examId, path, hash" } : {}),
        ...(fromVersion >= 3 ? {
          vocabularies: "id, profileId, normalizedEnglish",
          vocabQuestions: "id, vocabularyId, profileId",
          vocabProgress: "id, vocabularyId, profileId",
          vocabSessions: "id, profileId, vocabularyId"
        } : {}),
        ...(fromVersion >= 4 ? {
          vocabularySets: "id, profileId",
          vocabularySetItems: "id, setId, profileId"
        } : {}),
        ...(fromVersion >= 5 ? {
          exams: "id, deletedAt",
          sharedExams: "id, expiresAt",
          syncQueue: "id, profileId, entityType, entityId, operation, status",
          syncState: "key, profileId, deviceId, status, cursor"
        } : {})
      });
      await old.open();
      await old.table("profiles").add({ id: "p1", name: "migration", updatedAt: 1, lastActiveAt: 1 });
      await old.close();

      const current = new ExamDatabase(name);
      await current.open();
      expect(await current.profiles.get("p1")).toMatchObject({ id: "p1", name: "migration" });
      expect(current.verno).toBe(5);
      await current.close();
    });
  }
});
