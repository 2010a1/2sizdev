import type { AnswerValue, Question } from '../../../domain/exam/exam.types';
import { MathText } from './MathText';
import { RichContent } from './RichContent';
import { QuestionImage } from './QuestionImage';

export function QuestionRenderer({question,answer,onAnswer,shuffleSeed=''}:{question:Question;answer?:AnswerValue;onAnswer:(a:AnswerValue)=>void;shuffleSeed?:string}){
 const body = question.type==='ABCD' ? <ABCDRenderer question={question} answer={answer} onAnswer={onAnswer}/> : question.type==='TRUE_FALSE' ? <TrueFalseRenderer question={question} answer={answer} onAnswer={onAnswer} shuffleSeed={shuffleSeed}/> : <ShortRenderer answer={answer} onAnswer={onAnswer}/>;
 return <div className="space-y-3"><QuestionImage assetId={question.imageAssetId} remoteUrl={question.imageUrl}/>{body}</div>;
}
function ABCDRenderer({question,answer,onAnswer}:{question:Extract<Question,{type:'ABCD'}>;answer?:AnswerValue;onAnswer:(a:AnswerValue)=>void}){return <div className="space-y-2">{question.options.map((o,i)=><label key={o.id} className="quiz-answer-card flex gap-3 items-center card cursor-pointer"><input type="radio" checked={answer?.type==='ABCD'&&answer.selectedOptionId===o.id} onChange={()=>onAnswer({type:'ABCD',selectedOptionId:o.id})}/><span className="font-semibold">{String.fromCharCode(65+i)}.</span><div className="min-w-0 flex-1"><RichContent html={o.text} /></div></label>)}</div>}

function TrueFalseRenderer({question,answer,onAnswer,shuffleSeed}:{question:Extract<Question,{type:'TRUE_FALSE'}>;answer?:AnswerValue;onAnswer:(a:AnswerValue)=>void;shuffleSeed:string}){
 const statements=question.statements?.length===4?shuffleStatements(question.statements,`${shuffleSeed}:${question.id}`):undefined;
 if(!statements) return <div className="grid grid-cols-2 gap-3"><button type="button" className={answer?.type==='TRUE_FALSE'&&answer.selectedAnswer===true?'btn-primary':'btn-secondary'} onClick={()=>onAnswer({type:'TRUE_FALSE',selectedAnswer:true})}>ĐÚNG</button><button type="button" className={answer?.type==='TRUE_FALSE'&&answer.selectedAnswer===false?'btn-primary':'btn-secondary'} onClick={()=>onAnswer({type:'TRUE_FALSE',selectedAnswer:false})}>SAI</button></div>;
 const selected=answer?.type==='TRUE_FALSE'?answer.selectedAnswers??{}:{};
 return <div className="tf-four-statements">
   <div className="tf-four-head"><span>Đánh giá từng mệnh đề</span><span>Chọn Đúng hoặc Sai</span></div>
   <div className="tf-four-list">{statements.map((statement,index)=>{
     const value=selected[statement.id];
     return <div className="tf-statement" key={statement.id}>
       <div className="tf-statement-content"><span className="tf-statement-number">{index+1}</span><div><RichContent html={statement.text}/></div></div>
       <div className="tf-choice-group" role="group" aria-label={`Mệnh đề ${index+1}`}>
         <button type="button" className="tf-choice" aria-pressed={value===true} onClick={()=>onAnswer({type:'TRUE_FALSE',selectedAnswers:{...selected,[statement.id]:true}})}>Đúng</button>
         <button type="button" className="tf-choice" aria-pressed={value===false} onClick={()=>onAnswer({type:'TRUE_FALSE',selectedAnswers:{...selected,[statement.id]:false}})}>Sai</button>
       </div>
     </div>;
   })}</div>
 </div>;
}
export function getShuffledTrueFalseStatements<T extends {id:string}>(items:T[],seed:string){return shuffleStatements(items,seed);}
function hash(input:string){let h=2166136261>>>0;for(const ch of input){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function shuffleStatements<T extends {id:string}>(items:T[],seed:string){const out=[...items];let x=hash(seed)||0x9e3779b9;const rand=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296};for(let i=out.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
function ShortRenderer({answer,onAnswer}:{answer?:AnswerValue;onAnswer:(a:AnswerValue)=>void}){return <input className="input" value={answer?.type==='SHORT_ANSWER'?answer.text:''} onChange={e=>onAnswer({type:'SHORT_ANSWER',text:e.target.value})} placeholder="Nhập đáp án"/>}
