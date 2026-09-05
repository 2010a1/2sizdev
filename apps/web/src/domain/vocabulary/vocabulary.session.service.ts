import { generateId } from "@exam/utils";
import { vocabularyRepository } from "./vocabulary.repository";
import { vocabularyService } from "./vocabulary.service";
import { VocabularyNotFoundError, VocabularySessionError } from "./vocabulary.errors";
import { VocabularyPracticeEngine, type VocabularyEngineState } from "./vocabulary.engine";
import { scoreVocabularyAnswer } from "./vocabulary.scoring";
import type { VocabularyResult, VocabularySessionState } from "./vocabulary.types";
import type { VocabQuestion, VocabularySession } from "@exam/shared-types";

function sessionOrder(questions: VocabQuestion[], vocabularyId: string): VocabQuestion[] {
  return [...questions].sort((a,b) => {
    const hash=(id:string)=>{let h=2166136261>>>0;for(const c of `${vocabularyId}|${id}`){h^=c.codePointAt(0)!;h=Math.imul(h,16777619)>>>0;}return h;};
    return hash(a.id)-hash(b.id);
  });
}

function answerMap(rows: Awaited<ReturnType<typeof vocabularyRepository.getSessionAnswers>>) { return Object.fromEntries(rows.map(r=>[r.questionId,r.answer])); }
async function load(profileId:string,sessionId:string):Promise<{session:VocabularySession;questions:VocabQuestion[];engine:VocabularyPracticeEngine}> {
  const session=await vocabularyRepository.getSession(profileId,sessionId); if(!session)throw new VocabularySessionError("Không tìm thấy phiên luyện tập.");
  const all=await vocabularyRepository.questions(profileId,session.vocabularyId,true); const byId=new Map(all.map(q=>[q.id,q])); const questions=session.questionIds.map(id=>byId.get(id)).filter((q):q is VocabQuestion=>!!q);
  if(questions.length!==session.questionIds.length)throw new VocabularySessionError("Dữ liệu câu hỏi của phiên không đầy đủ.");
  const answers=answerMap(await vocabularyRepository.getSessionAnswers(sessionId));
  const engine=new VocabularyPracticeEngine(questions,{startedAt:session.startedAt,currentIndex:session.currentIndex,answers,visited:session.visitedQuestionIds,flagged:session.flaggedQuestionIds,status:session.status,finishedAt:session.finishedAt,questionEnteredAt:session.questionEnteredAt});
  return {session,questions,engine};
}
async function persist(sessionId:string,state:VocabularyEngineState){await vocabularyRepository.updateSession(sessionId,{currentIndex:state.currentQuestionIndex,visitedQuestionIds:state.visitedQuestionIds,flaggedQuestionIds:state.flaggedQuestionIds,status:state.status,finishedAt:state.finishedAt,questionEnteredAt:state.questionEnteredAt});}

export const vocabularySessionService = {
  async resume(profileId:string,vocabularyId:string,mode:"practice"|"quick_review"="practice") {
    const existing=await vocabularyRepository.findActiveSession(profileId,vocabularyId,mode); return existing ? this.state(profileId,existing.id) : undefined;
  },
  async create(profileId:string,vocabularyId:string,mode:"practice"|"quick_review"="practice",startedAt=Date.now()):Promise<VocabularySessionState>{
    const vocabulary=await vocabularyService.get(profileId,vocabularyId); const questions=await vocabularyService.questions(profileId,vocabularyId); if(!questions.length)throw new VocabularyNotFoundError();
    const questionIds=sessionOrder(questions,vocabularyId).map(q=>q.id); const session:VocabularySession={id:generateId("vsession"),profileId,vocabularyId,mode,questionIds,currentIndex:0,startedAt,questionEnteredAt:startedAt,status:"in_progress",visitedQuestionIds:[],flaggedQuestionIds:[]};
    await vocabularyRepository.createSession(session); return this.state(profileId,session.id);
  },
  async state(profileId:string,sessionId:string){const {session,questions,engine}=await load(profileId,sessionId);return {session,questions,answers:engine.getState().answers,currentQuestionIndex:engine.getState().currentQuestionIndex};},
  async answer(profileId:string,sessionId:string,answer:string,now=Date.now()){
    const {session,questions,engine}=await load(profileId,sessionId);const q=engine.getCurrentQuestion();if(!q)throw new VocabularySessionError("Không có câu hỏi.");const scored=engine.answer(answer,now);const correct=scored.correct;await vocabularyRepository.saveSessionAnswer({id:`${sessionId}:${q.id}`,sessionId,questionId:q.id,answer,correct,timeSpent:scored.timeSpent,answeredAt:now});await vocabularyService.updateProgress(profileId,session.vocabularyId,q.type,correct,now);await persist(sessionId,engine.getState());return {correct,state:engine.getState()};
  },
  async next(profileId:string,sessionId:string){const {engine}=await load(profileId,sessionId);engine.next(Date.now());await persist(sessionId,engine.getState());return engine.getState();},
  async previous(profileId:string,sessionId:string){const {engine}=await load(profileId,sessionId);engine.previous(Date.now());await persist(sessionId,engine.getState());return engine.getState();},
  async jump(profileId:string,sessionId:string,index:number){const {engine}=await load(profileId,sessionId);engine.jump(index,Date.now());await persist(sessionId,engine.getState());return engine.getState();},
  async flag(profileId:string,sessionId:string){const {engine}=await load(profileId,sessionId);engine.flag();await persist(sessionId,engine.getState());return engine.getState();},
  async submit(profileId:string,sessionId:string,now=Date.now()){const {engine}=await load(profileId,sessionId);const state=engine.submit(now);await persist(sessionId,state);return this.result(profileId,sessionId);},
  async abandon(profileId:string,sessionId:string,now=Date.now()){const {session}=await load(profileId,sessionId);await vocabularyRepository.updateSession(session.id,{status:"abandoned",finishedAt:now});},
  async latestResult(profileId:string,vocabularyId:string){const s=await vocabularyRepository.latestFinishedSession(profileId,vocabularyId);if(!s)throw new VocabularySessionError("Chưa có kết quả luyện tập.");return this.result(profileId,s.id);},
  async result(profileId:string,sessionId:string):Promise<VocabularyResult>{const {session,questions}=await load(profileId,sessionId);const answers=await vocabularyRepository.getSessionAnswers(sessionId);const answerByQuestion=new Map(answers.map(a=>[a.questionId,a]));const byType={MC_EN_TO_VI:{correct:0,total:0},TEXT_EN_TO_VI:{correct:0,total:0},TEXT_VI_TO_EN:{correct:0,total:0},LETTER_ORDER:{correct:0,total:0}} as VocabularyResult["byType"];let correct=0;for(const q of questions){if(q.availability!=="available")continue;byType[q.type].total++;const a=answerByQuestion.get(q.id);if(a&&scoreVocabularyAnswer(q,a.answer)){correct++;byType[q.type].correct++;}}const wrong=Math.max(0,answers.filter(a=>questions.some(q=>q.id===a.questionId)).length-correct);return {sessionId,correct,wrong,percentage:questions.length?Math.round((correct/questions.filter(q=>q.availability==="available").length)*100):0,byType};}
};
