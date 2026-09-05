import { generateId } from "@exam/utils";
import type { VocabProgress, Vocabulary } from "@exam/shared-types";
import { vocabularyRepository } from "./vocabulary.repository";
import { generateVocabularyQuestions, VOCABULARY_GENERATOR_VERSION, VOCABULARY_QUESTION_TYPES } from "./vocabulary.generator";
import { normalizeEnglish, normalizeVietnamese, normalizeWhitespace } from "./vocabulary.normalizer";
import { DuplicateVocabularyError, VocabularyNotFoundError, VocabularyValidationError } from "./vocabulary.errors";
import type { VocabularyInput } from "./vocabulary.types";
import { localMutationService } from '../../infrastructure/sync/local-mutation.service';

function validateId(value:string,label:string){if(!value || value.trim()!==value || value.length>200) throw new VocabularyValidationError(`${label} không hợp lệ.`);}

function validateInput(input: VocabularyInput): VocabularyInput {
  const english=normalizeWhitespace(input.english); const vietnamese=normalizeWhitespace(input.vietnamese);
  if (!english) throw new VocabularyValidationError("English không được để trống.");
  if (!vietnamese) throw new VocabularyValidationError("Tiếng Việt không được để trống.");
  if (english.length>200) throw new VocabularyValidationError("English tối đa 200 ký tự.");
  if (vietnamese.length>300) throw new VocabularyValidationError("Tiếng Việt tối đa 300 ký tự.");
  return { english, vietnamese, pronunciation: input.pronunciation ? normalizeWhitespace(input.pronunciation) : undefined, exampleSentence: input.exampleSentence ? normalizeWhitespace(input.exampleSentence) : undefined, note: input.note ? normalizeWhitespace(input.note) : undefined };
}

function progressFor(v: Vocabulary, type: typeof VOCABULARY_QUESTION_TYPES[number], now: number): VocabProgress {
  return { id:`${v.id}:${v.generation}:${type}`, vocabularyId:v.id, profileId:v.profileId, questionType:type, vocabularyGeneration:v.generation, correctCount:0, wrongCount:0, attemptCount:0, currentStreak:0, bestStreak:0, mastery:0, lastAttemptAt:undefined };
}

async function assertNoDuplicate(profileId:string, input:VocabularyInput, exceptId?:string) {
  const normalizedEnglish=normalizeEnglish(input.english), normalizedVietnamese=normalizeVietnamese(input.vietnamese);
  const rows=await vocabularyRepository.list(profileId);
  if (rows.some(v=>v.id!==exceptId && v.normalizedEnglish===normalizedEnglish && v.normalizedVietnamese===normalizedVietnamese)) throw new DuplicateVocabularyError();
}

export const vocabularyService = {
  async create(profileId:string,input:VocabularyInput,now=Date.now()) {
    validateId(profileId,"Profile");
    if(!Number.isFinite(now)) throw new VocabularyValidationError("Timestamp không hợp lệ.");
    const clean=validateInput(input); await assertNoDuplicate(profileId,clean);
    const v:Vocabulary={id:generateId("vocab"),profileId,english:clean.english,vietnamese:clean.vietnamese,normalizedEnglish:normalizeEnglish(clean.english),normalizedVietnamese:normalizeVietnamese(clean.vietnamese),pronunciation:clean.pronunciation,exampleSentence:clean.exampleSentence,note:clean.note,createdAt:now,updatedAt:now,generation:1};
    const all=await vocabularyRepository.all(profileId); const questions=generateVocabularyQuestions(v,[...all,v],now); const progress=VOCABULARY_QUESTION_TYPES.map(t=>progressFor(v,t,now));
    await vocabularyRepository.createWithQuestions(v,questions,progress); void localMutationService.vocabulary(v.id, 'CREATE', profileId); return v;
  },
  async get(profileId:string,id:string) { validateId(profileId,"Profile"); validateId(id,"Vocabulary ID"); const v=await vocabularyRepository.get(profileId,id); if(!v||v.deletedAt) throw new VocabularyNotFoundError(); return v; },
  async list(profileId:string) { return vocabularyRepository.list(profileId); },
  async search(profileId:string,query:string) { const q=normalizeWhitespace(query); return q ? vocabularyRepository.search(profileId,q) : vocabularyRepository.list(profileId); },
  async update(profileId:string,id:string,input:VocabularyInput,now=Date.now()) {
    validateId(profileId,"Profile"); validateId(id,"Vocabulary ID"); if(!Number.isFinite(now)) throw new VocabularyValidationError("Timestamp không hợp lệ.");
    const old=await this.get(profileId,id); const clean=validateInput(input); await assertNoDuplicate(profileId,clean,id);
    const next:Vocabulary={...old,english:clean.english,vietnamese:clean.vietnamese,normalizedEnglish:normalizeEnglish(clean.english),normalizedVietnamese:normalizeVietnamese(clean.vietnamese),pronunciation:clean.pronunciation,exampleSentence:clean.exampleSentence,note:clean.note,updatedAt:now,generation:old.generation+1,word:clean.english,meaning:clean.vietnamese};
    const all=(await vocabularyRepository.all(profileId)).filter(v=>v.id!==id); const questions=generateVocabularyQuestions(next,[...all,next],now); const progress=VOCABULARY_QUESTION_TYPES.map(t=>progressFor(next,t,now));
    await vocabularyRepository.updateDefinition(next,old.generation,questions,progress,now); void localMutationService.vocabulary(next.id, 'UPDATE', profileId); return next;
  },
  async delete(profileId:string,id:string) { const ok=await vocabularyRepository.softDelete(profileId,id); if(!ok) throw new VocabularyNotFoundError(); void localMutationService.vocabulary(id, 'DELETE', profileId); },
  async questions(profileId:string,id:string) { const v=await this.get(profileId,id); return vocabularyRepository.questions(profileId,id).then(qs=>qs.filter(q=>q.vocabularyGeneration===v.generation)); },
  async progress(profileId:string,id:string) { const v=await this.get(profileId,id); return vocabularyRepository.getProgress(profileId,id,v.generation); },
  async updateProgress(profileId:string,id:string,type:typeof VOCABULARY_QUESTION_TYPES[number],correct:boolean,now=Date.now()) {
    const v=await this.get(profileId,id); let p=await vocabularyRepository.getProgressType(profileId,id,v.generation,type);
    if(!p) p=progressFor(v,type,now);
    p={...p,attemptCount:p.attemptCount+1,correctCount:p.correctCount+(correct?1:0),wrongCount:p.wrongCount+(correct?0:1),currentStreak:correct?p.currentStreak+1:0,bestStreak:correct?Math.max(p.bestStreak,p.currentStreak+1):p.bestStreak,mastery:Math.round(((p.correctCount+(correct?1:0))/(p.attemptCount+1))*100),lastAttemptAt:now,lastCorrectAt:correct?now:p.lastCorrectAt,lastWrongAt:correct?p.lastWrongAt:now};
    await vocabularyRepository.saveProgress(p); return p;
  },
  generatorVersion: VOCABULARY_GENERATOR_VERSION
};
