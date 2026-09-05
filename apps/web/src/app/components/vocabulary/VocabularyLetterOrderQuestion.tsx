import { useEffect } from "react";
import type { VocabQuestion } from "@exam/shared-types";

export function VocabularyLetterOrderQuestion({question,value,onChange}:{question:VocabQuestion;value:string;onChange:(v:string)=>void}){
  const used=Array.from(value);
  const letters=question.letters??Array.from(question.answer);
  const counts=new Map<string,number>();
  used.forEach(c=>counts.set(c,(counts.get(c)??0)+1));

  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      // Don't steal keystrokes while the user is typing in another control
      // (e.g. the AI chat widget textarea rendered on every page).
      const target=event.target as HTMLElement|null;
      if(target&&(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target.isContentEditable)) return;
      if(event.key==='Backspace'){
        if(value.length) onChange(value.slice(0,-1));
        return;
      }
      if(event.key.length!==1) return;
      const key=event.key.toLocaleLowerCase();
      const match=letters.find(letter=>letter.toLocaleLowerCase()===key && (counts.get(letter)??0)<letters.filter(x=>x===letter).length);
      if(!match) return;
      event.preventDefault();
      onChange(value+match);
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>window.removeEventListener('keydown',onKeyDown);
  },[value,letters,counts,onChange]);

  return <div className="space-y-4 vocab-letter-order">
    <div><h2 className="text-xl font-semibold">{question.prompt}</h2></div>
    <div className="min-h-14 rounded-xl border-2 border-dashed border-[var(--line-strong)] p-2 flex flex-wrap gap-2">{used.length?used.map((c,i)=><button type="button" key={`${c}-${i}`} className="px-3 py-2 rounded-lg bg-accent-soft text-accent-strong font-semibold" onClick={()=>onChange(used.filter((_,j)=>j!==i).join(""))}>{c}</button>):<span className="text-sm muted self-center px-2">Từ bạn đang sắp xếp sẽ hiện ở đây</span>}</div>
    <div className="flex flex-wrap gap-2">{letters.map((c,i)=>{const usedCount=counts.get(c)??0;const total=letters.filter(x=>x===c).length;const disabled=usedCount>=total;return <button type="button" disabled={disabled} key={`${c}-${i}`} className="min-w-11 min-h-11 rounded-lg border bg-[var(--surface)] font-semibold disabled:opacity-30" onClick={()=>onChange(value+c)}>{c}</button>})}</div>
    <button type="button" className="btn-secondary" onClick={()=>onChange("")}>Đặt lại</button>
  </div>;
}
