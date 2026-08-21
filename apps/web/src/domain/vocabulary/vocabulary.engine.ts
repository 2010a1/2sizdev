import type { VocabQuestion } from "@exam/shared-types";
import { VocabularySessionError } from "./vocabulary.errors";
import { scoreVocabularyAnswer } from "./vocabulary.scoring";

export interface VocabularyEngineState { currentQuestionIndex:number; answers:Record<string,string>; visitedQuestionIds:string[]; flaggedQuestionIds:string[]; status:"in_progress"|"submitted"|"abandoned"; startedAt:number; finishedAt?:number; questionEnteredAt?:number; }

export class VocabularyPracticeEngine {
  private state:VocabularyEngineState;
  constructor(private readonly questions:VocabQuestion[], options:{startedAt:number;currentIndex?:number;answers?:Record<string,string>;visited?:string[];flagged?:string[];status?:VocabularyEngineState["status"];finishedAt?:number;questionEnteredAt?:number}) {
    const idx=Math.min(Math.max(options.currentIndex??0,0),Math.max(questions.length-1,0));
    this.state={currentQuestionIndex:idx,answers:{...(options.answers??{})},visitedQuestionIds:[...new Set(options.visited??[])],flaggedQuestionIds:[...new Set(options.flagged??[])],status:options.status??"in_progress",startedAt:options.startedAt,finishedAt:options.finishedAt,questionEnteredAt:options.questionEnteredAt??options.startedAt};
    if(questions[idx]) this.touch(questions[idx].id);
  }
  private ensureActive(){if(this.state.status!=="in_progress")throw new VocabularySessionError("Phiên luyện tập đã kết thúc.");}
  private touch(id:string){if(!this.state.visitedQuestionIds.includes(id))this.state.visitedQuestionIds.push(id);}
  getState():VocabularyEngineState{return {...this.state,answers:{...this.state.answers},visitedQuestionIds:[...this.state.visitedQuestionIds],flaggedQuestionIds:[...this.state.flaggedQuestionIds]};}
  getCurrentQuestion(){return this.questions[this.state.currentQuestionIndex];}
  getProgress(){return {current:this.state.currentQuestionIndex+1,total:this.questions.length,answered:Object.keys(this.state.answers).length,visited:this.state.visitedQuestionIds.length};}
  answer(answer:string,now=Date.now()){this.ensureActive();const q=this.getCurrentQuestion();if(!q)throw new VocabularySessionError("Không có câu hỏi.");this.state.answers[q.id]=answer;const timeSpent=Math.max(0,Math.floor((now-(this.state.questionEnteredAt??this.state.startedAt))/1000));return {correct:scoreVocabularyAnswer(q,answer),timeSpent};}
  next(now=Date.now()){this.ensureActive();if(this.state.currentQuestionIndex<this.questions.length-1){this.state.currentQuestionIndex++;this.state.questionEnteredAt=now;this.touch(this.questions[this.state.currentQuestionIndex].id);}}
  previous(now=Date.now()){this.ensureActive();if(this.state.currentQuestionIndex>0){this.state.currentQuestionIndex--;this.state.questionEnteredAt=now;this.touch(this.questions[this.state.currentQuestionIndex].id);}}
  jump(index:number,now=Date.now()){this.ensureActive();if(!Number.isInteger(index)||index<0||index>=this.questions.length)throw new VocabularySessionError("Câu hỏi không hợp lệ.");this.state.currentQuestionIndex=index;this.state.questionEnteredAt=now;this.touch(this.questions[index].id);}
  flag(){this.ensureActive();const q=this.getCurrentQuestion();if(!q)return;const s=new Set(this.state.flaggedQuestionIds);s.has(q.id)?s.delete(q.id):s.add(q.id);this.state.flaggedQuestionIds=[...s];}
  submit(now=Date.now()){this.ensureActive();this.state.status="submitted";this.state.finishedAt=now;return this.getState();}
  finish(now=Date.now()){return this.submit(now);}
}
