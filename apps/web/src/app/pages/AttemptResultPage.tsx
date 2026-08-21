import { useEffect, useState } from "react";
import { aiApi } from "../../infrastructure/api/ai";
import { Link, useParams } from "react-router-dom";
import { examService } from "../../domain/exam/exam.service";
import { examRepository } from "../../domain/exam/exam.repository";
import { attemptService } from "../../domain/exam/attempt.service";
import { practiceService } from "../../domain/practice/practice.service";
import { tournamentService } from "../../domain/tournament/tournament.service";
import { isAnswerCorrect } from "../../domain/practice/practice.scoring";
import type { AnswerValue, Exam, Question } from "../../domain/exam/exam.types";
import type { PracticeResult } from "../../domain/practice/practice.types";
import type { TournamentResult } from "../../domain/tournament/tournament.types";
import { MathText } from '../components/exam/MathText';
import { RichContent } from '../components/exam/RichContent';

function fmt(seconds: number) { const s=Math.max(0,Math.floor(seconds)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; }
function AnswerView({q,answer}:{q:Question;answer?:AnswerValue}){if(!answer)return <span className="text-gray-400">— Bỏ trống</span>;if(answer.type==='ABCD'&&q.type==='ABCD')return <span><MathText text={q.options.find(o=>o.id===answer.selectedOptionId)?.text??'Không chọn'} /></span>;if(answer.type==='TRUE_FALSE'&&q.type==='TRUE_FALSE')return <span>{typeof answer.selectedAnswer==='boolean'?(answer.selectedAnswer?'ĐÚNG':'SAI'):'Không chọn'}</span>;if(answer.type==='SHORT_ANSWER')return <span>{answer.text||'(trống)'}</span>;return <span>Không có đáp án</span>;}

function AiMarkdown({text}:{text:string}){
 const normalized=text.replace(/\\\*\\\*/g,"**").trim();
 const renderInline=(line:string)=>{
  const parts=line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part,i)=>part.startsWith("**")&&part.endsWith("**")
    ? <strong key={i}>{part.slice(2,-2)}</strong>
    : <span key={i}>{part}</span>);
 };
 return <div className="space-y-1.5">{normalized.split(/\r?\n/).map((line,i)=>{
   const trimmed=line.trim();
   if(!trimmed)return <div key={i} className="h-1"/>;
   const bullet=trimmed.match(/^[-*]\s+(.*)$/);
   if(bullet)return <div key={i} className="flex gap-2"><span className="mt-0.5">•</span><span>{renderInline(bullet[1])}</span></div>;
   return <div key={i}>{renderInline(trimmed)}</div>;
 })}</div>;
}


function AiExplainButton({q,userAnswer,correctAnswer,existingExplanation}:{q:any;userAnswer:any;correctAnswer:any;existingExplanation?:string}){
 const [answer,setAnswer]=useState(""); const [busy,setBusy]=useState(false); const [err,setErr]=useState("");
 async function explain(){
  setBusy(true);setErr("");
  try {
    const answerText = (question:any, a:any) => {
      if(!a) return "Không trả lời";
      if(a.type === "ABCD") {
        const option=Array.isArray(question?.options)?question.options.find((o:any)=>o.id===a.selectedOptionId):undefined;
        return `Trắc nghiệm: ${option?.text ? String(option.text) : "Không chọn"}`;
      }
      if(a.type === "TRUE_FALSE") return `Đúng/Sai: ${a.selectedAnswer===true?"Đúng":a.selectedAnswer===false?"Sai":"Không chọn"}`;
      if(a.type === "SHORT_ANSWER") return `Trả lời ngắn: ${String(a.text ?? "")}`;
      return JSON.stringify(a);
    };
    const r=await aiApi.explain({
      question:typeof q.content === "string" ? q.content : String(q.content ?? ""),
      userAnswer:answerText(q,userAnswer),
      correctAnswer:answerText(q,correctAnswer),
      existingExplanation:typeof existingExplanation === "string" ? existingExplanation : undefined
    });
    setAnswer(String(r?.answer ?? "AI không trả về nội dung giải thích."));
  } catch(e) {
    setErr(e instanceof Error?e.message:"AI hiện không khả dụng");
  } finally {setBusy(false);}
}
 return <div className="mt-2">{!answer&&!busy&&<button className="btn-secondary text-xs" onClick={()=>void explain()}>✨ Giải thích bằng AI</button>}{busy&&<span className="text-xs text-slate-400">AI đang giải thích…</span>}{err&&<p className="text-xs text-red-600 mt-1">{err}</p>}{answer&&<div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-sm"><strong className="text-indigo-800">AI giải thích:</strong><div className="mt-2 text-slate-700"><AiMarkdown text={answer}/></div></div>}</div>
}

export function AttemptResultPage({ mode }: { mode: "practice" | "tournament" }) {
  const { attemptId } = useParams();
  const [exam,setExam]=useState<Exam>(); const [questions,setQuestions]=useState<Question[]>([]); const [result,setResult]=useState<PracticeResult|TournamentResult>(); const [loading,setLoading]=useState(true);
  useEffect(()=>{(async()=>{if(!attemptId)return;try{const attempt=await attemptService.getAttempt(attemptId);const e=await examService.getExam(attempt.examId);const qs=await examRepository.getQuestionsByExam(e.id);setExam(e);setQuestions(qs);setResult(mode==="practice"?await practiceService.result(attemptId):await tournamentService.result(attemptId));}finally{setLoading(false)}})()},[attemptId,mode]);
  if(loading)return <div className="card">Đang tải kết quả...</div>;
  if(!exam||!result)return <div className="card">Không tìm thấy kết quả.</div>;
  const practice=mode==="practice"?result as PracticeResult:undefined; const tournament=mode==="tournament"?result as TournamentResult:undefined; const answers=result.answers;
  return <div className="space-y-4"><div className="card text-center"><div className="text-4xl mb-2">{tournament?.status==="won"?"🏆":tournament?.status==="lost"?"❌":"📊"}</div><h1 className="text-2xl font-bold">{tournament?.status==="won"?"Hoàn thành":tournament?.status==="lost"?"Kết thúc":"Kết quả luyện tập"}</h1>{practice&&<><div className="text-4xl font-bold mt-3">{practice.score} điểm</div><p className="text-gray-500">{practice.percentage.toFixed(0)}% đúng · {practice.correctQuestions} đúng · {practice.wrongQuestions} sai · {practice.unansweredQuestions} bỏ trống</p></>}{tournament&&<><div className="text-4xl font-bold mt-3">{tournament.correctCount}/{tournament.totalQuestions}</div><p className="text-gray-500">{tournament.percentage.toFixed(0)}% · Streak tốt nhất {tournament.bestStreak}</p></>}<p className="text-sm text-gray-400 mt-2">Thời gian {fmt(result.duration)}</p><div className="flex justify-center gap-2 mt-4"><Link className="btn-secondary" to={`/library/${exam.id}`}>Về đề</Link><Link className="btn-primary" to={mode==="practice"?`/practice/${exam.id}`:`/tournament/${exam.id}`}>Làm lại</Link></div></div>
    {tournament?.status==="lost"&&<div className="card"><p className="font-medium">Câu sai</p><p className="text-sm text-gray-500 mt-1">Bạn đã trả lời sai nên bài thi kết thúc ngay.</p></div>}
    <div className="space-y-3"><h2 className="font-semibold">Xem lại đáp án</h2>{questions.map((q,i)=>{const a=answers[q.id];const correct=!!a&&isAnswerCorrect(q,a);const unanswered=!a;const cardClass=unanswered?"card border-slate-200 bg-slate-50/60":correct?"card border-emerald-200 bg-emerald-50/35":"card border-red-200 bg-red-50/35";const statusClass=unanswered?"bg-slate-100 text-slate-600":correct?"bg-emerald-100 text-emerald-700":"bg-red-100 text-red-700";return <div className={cardClass} key={q.id}><div className="flex justify-between items-center gap-2"><span className="font-semibold">Câu {i+1}</span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>{unanswered?"— Bỏ trống":correct?"✓ Đúng":"✗ Sai"}</span></div><div className="mt-2 whitespace-pre-wrap"><RichContent html={q.content} /></div><div className="mt-3 text-sm space-y-2"><p className={correct?"text-emerald-700":"text-slate-600"}>Đáp án của bạn: <span className="font-medium"><AnswerView q={q} answer={a}/></span></p><p className="text-slate-600">Đáp án đúng: <span className="font-medium text-emerald-700"><AnswerView q={q} answer={correctAnswer(q)}/></span></p>{q.explanation&&<p className="mt-2 p-2.5 bg-white/70 border border-slate-200 rounded-lg">Giải thích: {q.explanation}</p>}{!correct&&a&&<AiExplainButton q={q} userAnswer={a} correctAnswer={correctAnswer(q)} existingExplanation={q.explanation}/>} </div></div>})}</div></div>;
  function correctAnswer(q:Question):AnswerValue{if(q.type==='ABCD')return {type:'ABCD',selectedOptionId:q.correctOptionId};if(q.type==='TRUE_FALSE')return {type:'TRUE_FALSE',selectedAnswer:q.correctAnswer};return {type:'SHORT_ANSWER',text:q.acceptedAnswers[0]??''};}
}