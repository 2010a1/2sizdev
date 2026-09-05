import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { db } from "../db/database";
import { vocabularyService } from "../domain/vocabulary/vocabulary.service";
import { vocabularyRepository } from "../domain/vocabulary/vocabulary.repository";
import { generateVocabularyQuestions } from "../domain/vocabulary/vocabulary.generator";
import { scoreVocabularyAnswer } from "../domain/vocabulary/vocabulary.scoring";
import { VocabularyPracticeEngine } from "../domain/vocabulary/vocabulary.engine";
import { vocabularySessionService } from "../domain/vocabulary/vocabulary.session.service";
import { DuplicateVocabularyError, VocabularySessionError } from "../domain/vocabulary/vocabulary.errors";
import type { Vocabulary } from "@exam/shared-types";

beforeEach(async () => {
  await db.vocabSessionAnswers.clear(); await db.vocabSessions.clear(); await db.vocabularySetItems.clear(); await db.vocabularySets.clear(); await db.vocabProgress.clear(); await db.vocabQuestions.clear(); await db.vocabularies.clear();
});

const now = 1_000;
function word(id:string, english:string, vietnamese:string):Vocabulary{return {id,profileId:"p1",english,vietnamese,normalizedEnglish:english.trim().toLowerCase(),normalizedVietnamese:vietnamese.trim(),createdAt:now,updatedAt:now,generation:1};}

describe("vocabulary normalization and CRUD",()=>{
 it("normalizes whitespace, preserves Vietnamese accents and supports CRUD/search",async()=>{
  const v=await vocabularyService.create("p1",{english:"  Apple  ",vietnamese:"  quả   táo "},now);
  expect(v.english).toBe("Apple"); expect(v.vietnamese).toBe("quả táo"); expect(v.normalizedEnglish).toBe("apple"); expect(v.normalizedVietnamese).toBe("quả táo");
  expect((await vocabularyService.search("p1","APPLE")).length).toBe(1);
  const updated=await vocabularyService.update("p1",v.id,{english:"Apple",vietnamese:"trái   táo"},2); expect(updated.generation).toBe(2);
  expect((await vocabularyService.get("p1",v.id)).vietnamese).toBe("trái táo");
  expect(await db.vocabQuestions.where("vocabularyId").equals(v.id).and(q=>q.vocabularyGeneration===1 && !!q.deletedAt).count()).toBe(4);
  await vocabularyService.delete("p1",v.id); expect(await vocabularyService.list("p1")).toHaveLength(0);
 });
 it("rejects duplicate normalized pair and isolates profiles",async()=>{
  const a=await vocabularyService.create("p1",{english:"Apple",vietnamese:"quả táo"},now); await expect(vocabularyService.create("p1",{english:" apple ",vietnamese:"quả   táo"},2)).rejects.toBeInstanceOf(DuplicateVocabularyError);
  expect(await vocabularyService.list("p2")).toHaveLength(0); await expect(vocabularyService.get("p2",a.id)).rejects.toThrow();
  await expect(vocabularyService.update("p2",a.id,{english:"X",vietnamese:"Y"})).rejects.toThrow(); await expect(vocabularyService.delete("p2",a.id)).rejects.toThrow();
 });
});

describe("deterministic generator",()=>{
 it("generates exactly four types deterministically",()=>{
  const v=word("v1","APPLE","quả táo"); const others=[v,word("v2","book","quyển sách"),word("v3","cat","con mèo"),word("v4","sun","mặt trời")];
  const a=generateVocabularyQuestions(v,others,10), b=generateVocabularyQuestions(v,others,10);
  expect(a).toEqual(b); expect(a).toHaveLength(4); expect(new Set(a.map(q=>q.type)).size).toBe(4);
  const mc=a.find(q=>q.type==="MC_EN_TO_VI")!; expect(mc.availability).toBe("available"); expect(mc.options).toHaveLength(4); expect(new Set(mc.options).size).toBe(4); expect(mc.options?.filter(x=>x===mc.answer)).toHaveLength(1);
  const order=a.find(q=>q.type==="LETTER_ORDER")!; expect(order.letters).toHaveLength(5); expect(order.letters?.filter(x=>x.toUpperCase()==="P")).toHaveLength(2); expect(order.answer).toBe("APPLE");
 });
 it("does not invent MC distractors when data is insufficient",()=>{const v=word("v1","apple","quả táo");const qs=generateVocabularyQuestions(v,[v],10);const mc=qs.find(q=>q.type==="MC_EN_TO_VI")!;expect(mc.availability).toBe("unavailable");expect(mc.options).toBeUndefined();expect(qs).toHaveLength(4);});
 it("handles one-letter and repeated-letter ordering",()=>{for(const w of ["A","AAAA","BOOK"]){const q=generateVocabularyQuestions(word("v"+w,w,w),[word("v"+w,w,w)],1).find(q=>q.type==="LETTER_ORDER")!;expect(q.letters).toHaveLength([...w].length);expect([...q.letters??[]].sort()).toEqual([...w].sort());}});
});

describe("scoring and progress",()=>{
 it("applies MC/text/accent/case and ordering policies",()=>{
  const qs=generateVocabularyQuestions(word("v","Apple","quả táo"),[],1); const mc=qs.find(q=>q.type==="MC_EN_TO_VI")!,envi=qs.find(q=>q.type==="TEXT_EN_TO_VI")!,vien=qs.find(q=>q.type==="TEXT_VI_TO_EN")!,ord=qs.find(q=>q.type==="LETTER_ORDER")!;
  expect(scoreVocabularyAnswer(mc,"  quả táo ")).toBe(false); // MC is unavailable with no distractors
  expect(scoreVocabularyAnswer(envi,"  QUẢ TÁO  ")).toBe(true); expect(scoreVocabularyAnswer(envi,"qua tao")).toBe(false); expect(scoreVocabularyAnswer(vien,"APPLE")).toBe(true); expect(scoreVocabularyAnswer(ord,"A p p l e")).toBe(false); expect(scoreVocabularyAnswer(ord,"APPLE")).toBe(true);
 });
 it("tracks correct/wrong/streak independently per type",async()=>{const v=await vocabularyService.create("p1",{english:"apple",vietnamese:"quả táo"},now);await vocabularyService.updateProgress("p1",v.id,"TEXT_EN_TO_VI",true,10);await vocabularyService.updateProgress("p1",v.id,"TEXT_EN_TO_VI",false,20);await vocabularyService.updateProgress("p1",v.id,"TEXT_VI_TO_EN",true,30);const p=await vocabularyService.progress("p1",v.id);const en=p.find(x=>x.questionType==="TEXT_EN_TO_VI")!;const vi=p.find(x=>x.questionType==="TEXT_VI_TO_EN")!;expect(en.correctCount).toBe(1);expect(en.wrongCount).toBe(1);expect(en.attemptCount).toBe(2);expect(en.currentStreak).toBe(0);expect(en.bestStreak).toBe(1);expect(vi.correctCount).toBe(1);});
});

describe("practice persistence/recovery",()=>{
 it("persists deterministic session order, answer, index and flags across reconstruction",async()=>{
  const v=await vocabularyService.create("p1",{english:"apple",vietnamese:"quả táo"},now);
  const s=await vocabularySessionService.create("p1",v.id,"practice",0); expect(s.questions).toHaveLength(4); const firstOrder=[...s.session.questionIds];
  await vocabularySessionService.abandon("p1",s.session.id,1); const s2=await vocabularySessionService.create("p1",v.id,"practice",2); expect(s2.session.questionIds).toEqual(firstOrder); await vocabularySessionService.abandon("p1",s2.session.id,3);
  const s3=await vocabularySessionService.create("p1",v.id,"practice",4); const answer=s3.questions[0].type==="MC_EN_TO_VI"?"":s3.questions[0].answer; await vocabularySessionService.answer("p1",s3.session.id,answer,5_000); const saved=await vocabularyRepository.getSessionAnswers(s3.session.id); expect(saved[0].timeSpent).toBe(4); await vocabularySessionService.next("p1",s3.session.id); await vocabularySessionService.flag("p1",s3.session.id);
  const active=await vocabularySessionService.resume("p1",v.id); expect(active?.currentQuestionIndex).toBe(1); expect(active?.session.questionIds).toEqual(firstOrder); expect(active?.answers[s3.questions[0].id]).toBeDefined(); expect(active?.session.flaggedQuestionIds.length).toBe(1);
 });
 it("rejects terminal mutations and submit twice",async()=>{const v=await vocabularyService.create("p1",{english:"apple",vietnamese:"quả táo"},1);const s=await vocabularySessionService.create("p1",v.id,"practice",0);await vocabularySessionService.submit("p1",s.session.id,10);await expect(vocabularySessionService.answer("p1",s.session.id,"apple",11)).rejects.toBeInstanceOf(VocabularySessionError);await expect(vocabularySessionService.next("p1",s.session.id)).rejects.toThrow();await expect(vocabularySessionService.submit("p1",s.session.id,12)).rejects.toThrow();});
});
