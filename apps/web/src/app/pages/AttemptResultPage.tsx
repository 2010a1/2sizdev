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
import { Skeleton } from '../components/Skeleton';
import { QuestionImage } from '../components/exam/QuestionImage';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

function fmt(seconds: number) { const s=Math.max(0,Math.floor(seconds)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; }

function answerAsText(q: Question, a: AnswerValue | undefined): string {
  if (!a) return "Không trả lời";
  if (a.type === "ABCD" && q.type === "ABCD") {
    const option = q.options.find(o => o.id === a.selectedOptionId);
    return `Trắc nghiệm: ${option?.text ? String(option.text) : "Không chọn"}`;
  }
  if (a.type === "TRUE_FALSE" && q.type === "TRUE_FALSE") {
    if (q.statements?.length === 4) {
      const selected = a.selectedAnswers ?? {};
      return `Đúng/Sai: ${q.statements.map((st, i) => `${i + 1}:${selected[st.id] === true ? "Đ" : selected[st.id] === false ? "S" : "—"}`).join(" · ")}`;
    }
    return `Đúng/Sai: ${a.selectedAnswer === true ? "Đúng" : a.selectedAnswer === false ? "Sai" : "Không chọn"}`;
  }
  if (a.type === "SHORT_ANSWER") return `Trả lời ngắn: ${a.text}`;
  return JSON.stringify(a);
}

function AnswerView({q,answer}:{q:Question;answer?:AnswerValue}){
  if(!answer)return <span>— Bỏ trống</span>;
  if(answer.type==='ABCD'&&q.type==='ABCD')return <span><MathText text={q.options.find(o=>o.id===answer.selectedOptionId)?.text??'Không chọn'} /></span>;
  if(answer.type==='TRUE_FALSE'&&q.type==='TRUE_FALSE'){
    if(q.statements?.length===4){const selected=answer.selectedAnswers??{};return <div className="space-y-1">{q.statements.map((st,i)=><div key={st.id}>Mệnh đề {i+1}: {typeof selected[st.id]==='boolean'?(selected[st.id]?'ĐÚNG':'SAI'):'Không chọn'}</div>)}</div>}
    return <span>{typeof answer.selectedAnswer==='boolean'?(answer.selectedAnswer?'ĐÚNG':'SAI'):'Không chọn'}</span>;
  }
  if(answer.type==='SHORT_ANSWER')return <span>{answer.text||'(trống)'}</span>;
  return <span>Không có đáp án</span>;
}

function AiMarkdown({text}:{text:string}){
  const renderInline=(line:string)=>{
    const parts=line.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part,i)=>part.startsWith("**")&&part.endsWith("**")
      ? <strong key={i}>{part.slice(2,-2)}</strong>
      : <span key={i}>{part}</span>);
  };
  return <div className="space-y-1.5">{text.trim().split(/\r?\n/).map((line,i)=>{
    const trimmed=line.trim();
    if(!trimmed)return <div key={i} className="h-1"/>;
    const bullet=trimmed.match(/^[-*]\s+(.*)$/);
    if(bullet)return <div key={i} className="flex gap-2"><span className="mt-0.5">•</span><span>{renderInline(bullet[1])}</span></div>;
    return <div key={i}>{renderInline(trimmed)}</div>;
  })}</div>;
}

function AiExplainButton({q,userAnswer,correctAnswerText,existingExplanation}:{q:Question;userAnswer:AnswerValue|undefined;correctAnswerText:AnswerValue;existingExplanation?:string}){
  const [answer,setAnswer]=useState(""); const [busy,setBusy]=useState(false); const [err,setErr]=useState("");
  async function explain(){
    setBusy(true);setErr("");
    try{
      const r=await aiApi.explain({
        question:typeof q.content==="string"?q.content:String(q.content??""),
        userAnswer:answerAsText(q,userAnswer),
        correctAnswer:answerAsText(q,correctAnswerText),
        existingExplanation:typeof existingExplanation==="string"?existingExplanation:undefined
      });
      setAnswer(String(r?.answer??"AI không trả về nội dung giải thích."));
    }catch(e){
      setErr(e instanceof Error?e.message:"AI hiện không khả dụng");
    }finally{setBusy(false);}
  }
  return <div className="mt-2">{!answer&&!busy&&<button className="btn-secondary text-xs" onClick={()=>void explain()}>✨ Giải thích bằng AI</button>}{busy&&<span className="text-xs result-muted">AI đang giải thích…</span>}{err&&<p className="text-xs result-wrong mt-1">{err}</p>}{answer&&<div className="result-ai-note"><strong>AI giải thích:</strong><div className="mt-2"><AiMarkdown text={answer}/></div></div>}</div>;
}

export function AttemptResultPage({ mode }: { mode: "practice" | "tournament" }) {
  const { attemptId } = useParams();
  const online = useOnlineStatus();
  const [exam,setExam]=useState<Exam>(); const [questions,setQuestions]=useState<Question[]>([]); const [result,setResult]=useState<PracticeResult|TournamentResult>(); const [loading,setLoading]=useState(true); const [wrongOnly,setWrongOnly]=useState(false);
  useEffect(()=>{(async()=>{if(!attemptId)return;try{const attempt=await attemptService.getAttempt(attemptId);const e=await examService.getExam(attempt.examId);const qs=await examRepository.getQuestionsByExam(e.id);setExam(e);setQuestions(qs);setResult(mode==="practice"?await practiceService.result(attemptId):await tournamentService.result(attemptId));}catch{/* attempt/exam missing → "Không tìm thấy kết quả." below */}finally{setLoading(false)}})()},[attemptId,mode]);
  if(loading)return <div className="space-y-4"><div className="card space-y-4"><Skeleton className="h-8 w-56"/><Skeleton className="h-4 w-40"/><div className="grid grid-cols-3 gap-3">{[0,1,2].map(i=><Skeleton key={i} className="h-20 rounded-xl"/>)}</div></div><div className="card space-y-3"><Skeleton className="h-5 w-1/3"/><Skeleton className="h-4 w-full"/><Skeleton className="h-4 w-4/5"/><Skeleton className="h-4 w-3/5"/></div></div>;
  if(!exam||!result)return <div className="card">Không tìm thấy kết quả.</div>;
  const practice=mode==="practice"?result as PracticeResult:undefined; const tournament=mode==="tournament"?result as TournamentResult:undefined; const answers=result.answers;
  const correctAnswer=(q:Question):AnswerValue=>{
    if(q.type==='ABCD')return {type:'ABCD',selectedOptionId:q.correctOptionId};
    if(q.type==='TRUE_FALSE'){
      if(q.statements?.length===4)return {type:'TRUE_FALSE',selectedAnswers:Object.fromEntries(q.statements.map(st=>[st.id,st.correct]))};
      return {type:'TRUE_FALSE',selectedAnswer:q.correctAnswer};
    }
    return {type:'SHORT_ANSWER',text:q.acceptedAnswers[0]??''};
  };
  return <div className="space-y-4">
    <div className="card result-hero">
      <p className="eyebrow">{tournament?(tournament.status==="won"?"🏆 Hoàn thành lượt thi":tournament.status==="lost"?"❌ Kết thúc lượt thi":"Kết quả"):"Bài đã chấm"}</p>
      <h1>{tournament?"Kết quả thi đấu":"Kết quả luyện tập"}</h1>
      {practice&&<><div className={`result-score ${practice.percentage>=50?"pass":""}`}><span>{practice.score}</span></div><p>điểm · {practice.percentage.toFixed(0)}% đúng</p><p className="result-hero-sub">{practice.correctQuestions} đúng · {practice.wrongQuestions} sai · {practice.unansweredQuestions} bỏ trống</p></>}
      {tournament&&<><div className="text-4xl font-bold mt-3">{tournament.correctCount}/{tournament.totalQuestions}</div><p className="result-hero-sub">{tournament.percentage.toFixed(0)}% đúng · Streak tốt nhất {tournament.bestStreak}</p></>}
      <p className="result-hero-sub">Thời gian {fmt(result.duration)}</p>
      <div className="flex justify-center gap-2 mt-4"><Link className="btn-secondary" to={`/library/${exam.id}`}>Về đề</Link><Link className="btn-primary" to={mode==="practice"?`/practice/${exam.id}`:`/tournament/${exam.id}`}>Làm lại</Link></div>
    </div>
    {tournament?.status==="lost"&&<div className="card"><p className="font-medium">Câu sai</p><p className="result-hero-sub mt-1">Bạn đã trả lời sai nên bài thi kết thúc ngay.</p></div>}
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><h2 className="font-semibold">Xem lại đáp án</h2><div className="flex gap-2"><button className={!wrongOnly?'btn-primary':'btn-secondary'} onClick={()=>setWrongOnly(false)}>Tất cả</button><button className={wrongOnly?'btn-primary':'btn-secondary'} onClick={()=>setWrongOnly(true)}>Chỉ đáp án sai</button></div></div>
      {questions.map((q,i)=>{
        const a=answers[q.id];const correct=!!a&&isAnswerCorrect(q,a);const unanswered=!a;
        if(wrongOnly&&(correct||unanswered))return null;
        return <div className={`card result-review-card ${unanswered?"unanswered":correct?"correct":"wrong"}`} key={q.id}>
          <div className="flex justify-between items-center gap-2"><span className="question-number">{i+1}</span><span className={`result-pill ${unanswered?"":correct?"correct":"wrong"}`}>{unanswered?"— Bỏ trống":correct?"✓ Đúng":"✗ Sai"}</span></div>
          <div className="mt-2 whitespace-pre-wrap rich-question"><RichContent html={q.content} /></div>
          <QuestionImage assetId={q.imageAssetId} remoteUrl={q.imageUrl} />
          {q.type==='TRUE_FALSE'&&q.statements?.length===4&&<div className="mt-3 space-y-2">{q.statements.map((st,index)=>{
            const selected=a?.type==='TRUE_FALSE'?(a.selectedAnswers??{})[st.id]:undefined;
            const ok=typeof selected==='boolean'&&selected===st.correct;
            return <div key={st.id} className={`result-statement ${typeof selected!=='boolean'?"unanswered":ok?"correct":"wrong"}`}>
              <div className="flex gap-2"><b>{index+1}.</b><div className="flex-1"><RichContent html={st.text}/></div><span className="text-xs font-bold whitespace-nowrap">{typeof selected!=='boolean'?'Chưa chọn':selected?'ĐÚNG':'SAI'} · Đáp án: {st.correct?'ĐÚNG':'SAI'}</span></div>
            </div>;
          })}</div>}
          <div className="mt-3 text-sm space-y-2">
            {q.type!=='TRUE_FALSE'&&<><p className={correct?"result-correct":"result-muted"}>Đáp án của bạn: <span className="font-medium"><AnswerView q={q} answer={a}/></span></p><p className="result-muted">Đáp án đúng: <span className="font-medium result-correct"><AnswerView q={q} answer={correctAnswer(q)}/></span></p></>}
            {q.explanation&&<p className="result-explanation">Giải thích: {q.explanation}</p>}
            {!correct&&a&&!q.explanation&&online&&<AiExplainButton q={q} userAnswer={a} correctAnswerText={correctAnswer(q)} />}
          </div>
        </div>;
      })}
      {wrongOnly&&!questions.some(q=>{const a=answers[q.id];return !!a&&!isAnswerCorrect(q,a)})&&<div className="card text-center text-sm result-muted">Không có câu sai.</div>}
    </div>
  </div>;
}
