import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db/database";
import { profileRepository } from "../domain/profile/profile.repository";
import { profileService } from "../domain/profile/profile.service";
import { generateId, nowTs } from "@exam/utils";

async function resetDb() {
  await db.transaction(
    "rw",
    [db.profiles, db.attempts, db.answers, db.vocabularies, db.vocabQuestions, db.vocabProgress, db.vocabSessions, db.vocabSessionAnswers, db.syncQueue],
    async () => {
      await Promise.all([
        db.profiles.clear(),
        db.attempts.clear(),
        db.answers.clear(),
        db.vocabularies.clear(),
        db.vocabQuestions.clear(),
        db.vocabProgress.clear(),
        db.vocabSessions.clear(),
        db.vocabSessionAnswers.clear(),
        db.syncQueue.clear()
      ]);
    }
  );
}

beforeEach(async () => {
  await resetDb();
});

describe("profileService: basic CRUD", () => {
  it("creates a profile with generated id and timestamps", async () => {
    const profile = await profileService.createProfile({ name: "Akats", avatar: "🦊" });
    expect(profile.id).toMatch(/^profile_/);
    expect(profile.name).toBe("Akats");
    expect(profile.avatar).toBe("🦊");
    expect(profile.createdAt).toBeGreaterThan(0);
  });

  it("rejects an empty name", async () => {
    await expect(profileService.createProfile({ name: "" })).rejects.toThrow();
  });

  it("lists profiles most-recently-active first", async () => {
    const a = await profileService.createProfile({ name: "Minh" });
    await new Promise((r) => setTimeout(r, 2));
    const b = await profileService.createProfile({ name: "Nam" });
    const list = await profileService.listProfiles();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it("selects/switches a profile and bumps lastActiveAt", async () => {
    const a = await profileService.createProfile({ name: "Minh" });
    const before = a.lastActiveAt;
    await new Promise((r) => setTimeout(r, 2));
    const switched = await profileService.switchProfile(a.id);
    expect(switched?.id).toBe(a.id);
    const reloaded = await profileRepository.get(a.id);
    expect(reloaded!.lastActiveAt).toBeGreaterThan(before);
  });

  it("renames a profile", async () => {
    const a = await profileService.createProfile({ name: "Minh" });
    await profileService.renameProfile(a.id, "Minh Nguyễn");
    const reloaded = await profileRepository.get(a.id);
    expect(reloaded!.name).toBe("Minh Nguyễn");
  });

  it("changes avatar", async () => {
    const a = await profileService.createProfile({ name: "Minh" });
    await profileService.changeAvatar(a.id, "🐼");
    const reloaded = await profileRepository.get(a.id);
    expect(reloaded!.avatar).toBe("🐼");
  });
});

describe("profileService: delete cascade", () => {
  async function seedProfileWithData(profileId: string) {
    const attemptId = generateId("attempt");
    await db.attempts.add({
      id: attemptId,
      profileId,
      examId: "exam_1",
      mode: "practice",
      status: "completed",
      score: 100,
      correctCount: 2,
      wrongCount: 0,
      skippedCount: 0,
      startedAt: nowTs(),
      finishedAt: nowTs(),
      streak: 0,
      bestStreak: 0
    });
    await db.answers.add({
      id: generateId("answer"),
      attemptId,
      questionId: "q1",
      answer: "b",
      correct: true,
      answeredAt: nowTs(),
      timeSpent: 5
    });
    const vocabId = generateId("vocab");
    await db.vocabularies.add({
      id: vocabId,
      profileId,
      english: "beautiful",
      vietnamese: "xinh đẹp",
      normalizedEnglish: "beautiful",
      normalizedVietnamese: "xinh đẹp",
      generation: 1,
      createdAt: nowTs(),
      updatedAt: nowTs()
    });
    await db.vocabProgress.add({
      id: `${vocabId}:1:MC_EN_TO_VI`,
      vocabularyId: vocabId,
      profileId,
      questionType: "MC_EN_TO_VI",
      correctCount: 1,
      wrongCount: 0,
      attemptCount: 1,
      currentStreak: 1,
      bestStreak: 1,
      vocabularyGeneration: 1,
      mastery: 20
    });
    await db.vocabQuestions.add({
      id: generateId("vq"),
      vocabularyId: vocabId,
      profileId,
      type: "MC_EN_TO_VI",
      prompt: "beautiful nghĩa là gì?",
      answer: "xinh đẹp",
      availability: "available",
      generatorVersion: 1,
      vocabularyGeneration: 1,
      createdAt: nowTs(),
      updatedAt: nowTs()
    });
    const sessionId = generateId("vsession");
    await db.vocabSessions.add({
      id: sessionId, profileId, vocabularyId: vocabId, mode: "practice", questionIds: [], currentIndex: 0,
      startedAt: nowTs(), status: "submitted", visitedQuestionIds: [], flaggedQuestionIds: [], finishedAt: nowTs()
    });
    await db.vocabSessionAnswers.add({
      id: `${sessionId}:q`, sessionId, questionId: "q", answer: "xinh đẹp", correct: true, timeSpent: 3, answeredAt: nowTs()
    });
    await db.syncQueue.add({
      id: generateId("sync"),
      profileId,
      type: "upload_attempt",
      payload: { attemptId },
      status: "pending",
      attempts: 0,
      createdAt: nowTs()
    });
    return { attemptId, vocabId, sessionId };
  }

  it("removes attempts, answers, vocabulary, vocab progress and sync queue entries for the deleted profile", async () => {
    const profile = await profileService.createProfile({ name: "Akats" });
    const { attemptId, sessionId } = await seedProfileWithData(profile.id);

    await profileService.deleteProfile(profile.id);

    expect(await db.profiles.get(profile.id)).toBeUndefined();
    expect(await db.attempts.where("profileId").equals(profile.id).count()).toBe(0);
    expect(await db.answers.where("attemptId").equals(attemptId).count()).toBe(0);
    expect(await db.vocabularies.where("profileId").equals(profile.id).count()).toBe(0);
    expect(await db.vocabProgress.where("profileId").equals(profile.id).count()).toBe(0);
    expect(await db.vocabQuestions.where("profileId").equals(profile.id).count()).toBe(0);
    expect(await db.vocabSessions.where("profileId").equals(profile.id).count()).toBe(0);
    expect(await db.vocabSessionAnswers.where("sessionId").equals(sessionId).count()).toBe(0);
    expect(await db.syncQueue.where("profileId").equals(profile.id).count()).toBe(0);
  });

  it("does not touch another profile's data", async () => {
    const keep = await profileService.createProfile({ name: "Nam" });
    const remove = await profileService.createProfile({ name: "Akats" });
    await seedProfileWithData(keep.id);
    await seedProfileWithData(remove.id);

    await profileService.deleteProfile(remove.id);

    expect(await db.profiles.get(keep.id)).toBeDefined();
    expect(await db.attempts.where("profileId").equals(keep.id).count()).toBe(1);
    expect(await db.vocabularies.where("profileId").equals(keep.id).count()).toBe(1);
    expect(await db.syncQueue.where("profileId").equals(keep.id).count()).toBe(1);
  });
});
