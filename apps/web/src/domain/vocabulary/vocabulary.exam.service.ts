import { generateId, shuffleWithSeed } from '@exam/utils';
import { vocabularySetService } from './vocabulary.set.service';
import { examService } from '../exam/exam.service';

/** Convert a vocabulary set into a normal exam so it can use the existing exam/share pipeline. */
export const vocabularyExamService={
  async createExam(profileId:string,setId:string){
    const detail=await vocabularySetService.detail(profileId,setId);
    if(detail.vocabularies.length<2) throw new Error('Cần ít nhất 2 từ để tạo đề từ vựng.');
    const words=detail.vocabularies;
    const questions=words.map((word,index)=>{
      const distractors=shuffleWithSeed(words.filter(w=>w.id!==word.id), `${setId}:${word.id}:${index}`).slice(0,3);
      while(distractors.length<3) distractors.push(word);
      const options=[word,...distractors].map((w,i)=>({id:`${word.id}_opt_${i}`,text:w.vietnamese}));
      const correctOptionId=options[0].id;
      // deterministic rotation keeps exactly four choices while avoiding all correct answers in A.
      const shift=index%4; const rotated=[...options.slice(shift),...options.slice(0,shift)];
      return {id:generateId('question'),type:'ABCD' as const,content:word.english,points:1,options:rotated,correctOptionId,explanation:`${word.english} — ${word.vietnamese}`};
    });
    return examService.createExamFromJson({
      title:`Từ vựng: ${detail.set.name}`,
      description:detail.set.description??`Đề được tạo từ bộ từ ${detail.set.name}`,
      subject:'Từ vựng',questions
    });
  }
};
