import type { VocabQuestion } from "@exam/shared-types";
export function VocabularyMCQuestion({question,value,onChange}:{question:VocabQuestion;value?:string;onChange:(v:string)=>void}){
  if(question.availability!=="available") return <div className="card border-line-warn bg-warn-soft text-warn">Chưa đủ dữ liệu để tạo 4 đáp án khác nhau cho câu này. Hãy thêm ít nhất 3 từ khác có nghĩa khác nhau.</div>;
  return <div className="space-y-3"><h2 className="text-xl font-semibold">{question.prompt}</h2><div className="grid gap-2">{question.options?.map((option,i)=>{const letter=String.fromCharCode(65+i);const selected=value===option;return <button type="button" key={option} aria-pressed={selected} className={`card text-left vocab-mc-option ${selected?'vocab-mc-option-selected':''}`} onClick={()=>onChange(option)}><span className="vocab-mc-letter">{letter}</span><span className="vocab-mc-answer">{option}</span></button>})}</div></div>;
}
