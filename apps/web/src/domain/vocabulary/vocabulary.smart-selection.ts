import type { VocabProgress, VocabQuestion, VocabQuestionType } from '@exam/shared-types';
import type { RequestedQuestionCount, SmartSelectionInput, VocabularySetMode } from './vocabulary.set.types';

function hash(input:string){let h=2166136261>>>0;for(const c of input){h^=c.codePointAt(0)!;h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function score(q:VocabQuestion,p:VocabProgress|undefined,mode:VocabularySetMode, recent:Set<string>|undefined){
  const attempts=p?.attemptCount??0, mastery=p?.mastery??0;
  const wrong=p?.lastWrongAt??0;
  const unseen=attempts===0;
  const modeBoost=mode==='WRONG'?(wrong?1000000000000:0):mode==='NEW'?(unseen?1000000000000:0):mode==='WEAK'?(100000000-mastery*100000):0;
  return modeBoost + (wrong ? Math.min(wrong / 1_000_000_000, 1_000_000_000) : 0) + (100-mastery)*1000 + (unseen?500:0) + (recent?.has(q.id)?-250:0) + hash(q.id)%97;
}
function seededOrder<T>(items:T[],seed:string){return [...items].sort((a,b)=>hash(`${seed}|${JSON.stringify(a)}`)-hash(`${seed}|${JSON.stringify(b)}`));}

export function selectSmartQuestions(input:SmartSelectionInput):VocabQuestion[]{
  const allowed=new Set(input.questionTypes);
  let candidates=input.questions.filter(q=>q.availability==='available' && !q.deletedAt && allowed.has(q.type));
  const progressByKey=new Map(input.progress.map(p=>[`${p.vocabularyId}:${p.questionType}`,p]));
  if(input.mode==='WRONG') candidates=candidates.filter(q=>input.wrongQuestionIds ? input.wrongQuestionIds.has(q.id) : (progressByKey.get(`${q.vocabularyId}:${q.type}`)?.wrongCount??0)>0);
  if(input.mode==='NEW') candidates=candidates.filter(q=>input.attemptedQuestionIds ? !input.attemptedQuestionIds.has(q.id) : (progressByKey.get(`${q.vocabularyId}:${q.type}`)?.attemptCount??0)===0);
  const ranked=seededOrder(candidates,input.seed).sort((a,b)=>score(b,progressByKey.get(`${b.vocabularyId}:${b.type}`),input.mode,input.recentQuestionIds)-score(a,progressByKey.get(`${a.vocabularyId}:${a.type}`),input.mode,input.recentQuestionIds));
  const count=input.requestedCount==='all'?ranked.length:Math.max(0,Math.min(input.requestedCount,ranked.length));
  const selected:VocabQuestion[]=[]; const used=new Set<string>(); const perVocabulary=new Map<string,number>();
  while(selected.length<count){
    const last=selected[selected.length-1];
    let q=ranked.find(x=>!used.has(x.id) && x.vocabularyId!==last?.vocabularyId && (perVocabulary.get(x.vocabularyId)??0)<2);
    if(!q) q=ranked.find(x=>!used.has(x.id) && (perVocabulary.get(x.vocabularyId)??0)<2);
    if(!q) q=ranked.find(x=>!used.has(x.id));
    if(!q) break;
    selected.push(q); used.add(q.id); perVocabulary.set(q.vocabularyId,(perVocabulary.get(q.vocabularyId)??0)+1);
  }
  return selected;
}

export function calculateSetStats(progress:VocabProgress[], vocabularyIds:string[]){
  const ids=new Set(vocabularyIds); const rows=progress.filter(p=>ids.has(p.vocabularyId)); const attempts=rows.reduce((n,p)=>n+p.attemptCount,0); const correct=rows.reduce((n,p)=>n+p.correctCount,0); const byVocab=new Map<string,VocabProgress[]>(); rows.forEach(p=>{const a=byVocab.get(p.vocabularyId)??[];a.push(p);byVocab.set(p.vocabularyId,a);});
  const learned=[...byVocab].filter(([,ps])=>ps.some(p=>p.attemptCount>0)).length; const weak=[...byVocab].filter(([,ps])=>ps.some(p=>p.attemptCount>0&&p.mastery<60)).length; const wrong=[...byVocab].filter(([,ps])=>ps.some(p=>p.wrongCount>0)).length; const mastery=attempts?Math.round(correct/attempts*100):0;
  return {mastery,learned,weak,wrong,newCount:Math.max(0,vocabularyIds.length-learned)};
}
