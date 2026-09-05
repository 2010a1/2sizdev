import { db } from "../../db/database";
import type { Profile } from "@exam/shared-types";

/**
 * Repository pattern: all direct Dexie access for profiles goes through
 * here so domain/service code (and eventually tests) never talk to
 * `db.profiles` directly. Keeps IndexedDB an implementation detail.
 */
export const profileRepository = {
  async list(): Promise<Profile[]> {
    return db.profiles.orderBy("lastActiveAt").reverse().toArray();
  },

  async get(id: string): Promise<Profile | undefined> {
    return db.profiles.get(id);
  },

  async create(profile: Profile): Promise<void> {
    await db.profiles.add(profile);
  },

  async update(id: string, patch: Partial<Profile>): Promise<void> {
    await db.profiles.update(id, patch);
  },

  async remove(id: string): Promise<void> {
    // Cascade: remove everything scoped to this profile so nothing orphaned
    // is left behind (exams themselves stay — they're shared across
    // profiles on the same device). This must be one transaction: if it
    // partially failed, we could end up with e.g. answers pointing at a
    // deleted attempt, or a syncQueue entry for a profile that no longer
    // exists (which would otherwise try to sync a ghost profile's data
    // forever).
    // Array form (rather than listing tables as separate args) because
    // Dexie's TS overloads for the variadic-args form only go up to 5
    // tables — we need 7 here.
    await db.transaction(
      "rw",
      [db.profiles, db.attempts, db.answers, db.vocabularies, db.vocabQuestions, db.vocabProgress, db.vocabSessions, db.vocabSessionAnswers, db.vocabularySets, db.vocabularySetItems, db.syncQueue, db.syncState],
      async () => {
        const attempts = await db.attempts.where("profileId").equals(id).toArray();
        const attemptIds = attempts.map((a) => a.id);
        if (attemptIds.length) {
          await db.answers.where("attemptId").anyOf(attemptIds).delete();
          await db.attempts.bulkDelete(attemptIds);
        }
        const vocabSessions = await db.vocabSessions.where("profileId").equals(id).toArray();
        const vocabSessionIds = vocabSessions.map(s => s.id);
        if (vocabSessionIds.length) await db.vocabSessionAnswers.where("sessionId").anyOf(vocabSessionIds).delete();
        await db.vocabSessions.where("profileId").equals(id).delete();
        await db.vocabularySetItems.where("profileId").equals(id).delete();
        await db.vocabularySets.where("profileId").equals(id).delete();
        await db.vocabProgress.where("profileId").equals(id).delete();
        await db.vocabQuestions.where("profileId").equals(id).delete();
        await db.vocabularies.where("profileId").equals(id).delete();
        await db.syncQueue.where("profileId").equals(id).delete(); await db.syncState.delete(`profile:${id}`);
        await db.profiles.delete(id);
      }
    );
  },

  async count(): Promise<number> {
    return db.profiles.count();
  }
};
