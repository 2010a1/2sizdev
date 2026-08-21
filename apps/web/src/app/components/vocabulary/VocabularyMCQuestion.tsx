import type { VocabQuestion } from "@exam/shared-types";
export function VocabularyMCQuestion({question,value,onChange}:{question:VocabQuestion;value?:string;onChange:(v:string)=>void}){
  if(question.availability!=="available") return <div className="card border-amber-200 bg-amber-50 text-amber-800">Chưa đủ dữ liệu để tạo 4 đáp án khác nhau cho câu này. Hãy thêm ít nhất 3 từ khác có nghĩa khác nhau.</div>;
  return <div className="space-y-3"><h2 className="text-xl font-semibold">{question.prompt}</h2><div className="grid gap-2">{question.options?.map((option,i)=><button key={option} className={`card text-left ${value===option?'border-brand-500 bg-brand-50':''}`} onClick={()=>onChange(option)}><b>{String.fromCharCode(65+i)}.</b> {option}</button>)}</div></div>;
}
