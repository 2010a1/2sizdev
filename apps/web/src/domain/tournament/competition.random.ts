import { shuffleWithSeed } from '@exam/utils';
import type { Question } from '../exam/exam.types';

export const EXAM_SECTION_ORDER = ['ABCD', 'TRUE_FALSE', 'SHORT_ANSWER'] as const;
export type ExamSection = typeof EXAM_SECTION_ORDER[number];

export function sectionForQuestion(question: Question): ExamSection { return question.type; }
export function sectionLabel(section: ExamSection): { title:string; shortTitle:string } {
  if (section === 'ABCD') return { title:'PHẦN I – TRẮC NGHIỆM ABCD', shortTitle:'Trắc nghiệm ABCD' };
  if (section === 'TRUE_FALSE') return { title:'PHẦN II – ĐÚNG / SAI', shortTitle:'Đúng / Sai' };
  return { title:'PHẦN III – TRẢ LỜI NGẮN', shortTitle:'Trả lời ngắn' };
}

export function buildCompetitionOrder(questions:Question[],seed:string){
  const questionOrder = EXAM_SECTION_ORDER.flatMap(section => {
    const ids = questions.filter(q => sectionForQuestion(q) === section).map(q => q.id);
    return shuffleWithSeed(ids, `${seed}:section:${section}`);
  });
  const optionOrderByQuestion:Record<string,string[]>={};
  for(const q of questions) if(q.type==='ABCD') optionOrderByQuestion[q.id]=shuffleWithSeed(q.options.map(o=>o.id),`${seed}:${q.id}`);
  return {questionOrder,optionOrderByQuestion};
}

/** Apply persisted order while enforcing the fixed exam section order. */
export function applyCompetitionOrder(questions:Question[],questionOrder:string[],optionOrderByQuestion:Record<string,string[]>):Question[]{
  const byId=new Map(questions.map(q=>[q.id,q]));
  const seen=new Set<string>();
  const savedIds=questionOrder.filter(id=>byId.has(id)&&!seen.has(id)&&!!seen.add(id));
  const orderedIds: string[] = [];
  for (const section of EXAM_SECTION_ORDER) {
    for (const id of savedIds) { const q=byId.get(id)!; if(sectionForQuestion(q)===section) orderedIds.push(id); }
    for (const q of questions) if(sectionForQuestion(q)===section && !seen.has(q.id)){ orderedIds.push(q.id); seen.add(q.id); }
  }
  return orderedIds.map(id=>byId.get(id)!).map(q=>{
    if(q.type!=='ABCD') return q;
    const saved=optionOrderByQuestion[q.id]??[];
    const used=new Set<number>(); const ordered:number[]=[];
    for(const optionId of saved){
      const index=q.options.findIndex((option,i)=>!used.has(i)&&option.id===optionId);
      if(index>=0){used.add(index);ordered.push(index);}
    }
    for(let i=0;i<q.options.length;i++) if(!used.has(i)) ordered.push(i);
    return {...q,options:ordered.map(i=>q.options[i])};
  });
}
