import { z } from 'zod';
import { generateId } from '@exam/utils';
import { examRepository } from './exam.repository';
import type { Question, ABCDQuestion, TrueFalseQuestion, ShortAnswerQuestion } from './exam.types';
import { localMutationService } from '../../infrastructure/sync/local-mutation.service';
export type CreateQuestionInput=Omit<ABCDQuestion,'id'|'order'>|Omit<TrueFalseQuestion,'id'|'order'>|Omit<ShortAnswerQuestion,'id'|'order'>;
const base=z.object({id:z.string().min(1),examId:z.string().min(1),order:z.number().int().nonnegative(),content:z.string().trim().min(1),explanation:z.string().optional(),points:z.number().positive(),imageAssetId:z.string().optional(),imageUrl:z.string().url().optional()});
export const QuestionSchema=z.discriminatedUnion('type',[
 base.extend({type:z.literal('ABCD'),options:z.array(z.object({id:z.string().min(1),text:z.string().trim().min(1)})).length(4),correctOptionId:z.string().min(1)}),
 base.extend({type:z.literal('TRUE_FALSE'),correctAnswer:z.boolean().optional(),statements:z.array(z.object({id:z.string().min(1),text:z.string().trim().min(1),correct:z.boolean()})).length(4).optional()}).refine(q=>typeof q.correctAnswer==='boolean'||!!q.statements,{message:'TRUE_FALSE cần đáp án hoặc 4 mệnh đề'}),
 base.extend({type:z.literal('SHORT_ANSWER'),acceptedAnswers:z.array(z.string().trim().min(1)).min(1),caseSensitive:z.boolean().optional()})
]);
export function validateQuestion(question:Question):Question{const parsed=QuestionSchema.parse(question);if(parsed.type==='ABCD'){const ids=parsed.options.map(o=>o.id);if(new Set(ids).size!==4)throw new Error('ABCD phải có 4 option ID duy nhất');if(!ids.includes(parsed.correctOptionId))throw new Error('correctOptionId không tồn tại trong options');}return parsed as Question;}
export const questionService={async addQuestion(input:CreateQuestionInput){const existing=await examRepository.getQuestionsByExam(input.examId);const q=validateQuestion({...input,id:generateId('question'),order:existing.length} as Question);await examRepository.addQuestion(q);void localMutationService.question(q.id,'CREATE');return q;},async updateQuestion(q:Question){const valid=validateQuestion(q);await examRepository.updateQuestion(valid.id,valid);void localMutationService.question(valid.id,'UPDATE');return valid;},async deleteQuestion(id:string){await examRepository.deleteQuestion(id);void localMutationService.question(id,'DELETE');},async reorderQuestions(examId:string,ids:string[]){await examRepository.reorderQuestions(examId,ids);for(const id of ids)void localMutationService.question(id,'UPDATE');}};
export function isTextAnswerCorrect(value:string,acceptedAnswers:string[],caseSensitive=false){const n=normalize(value,caseSensitive);return acceptedAnswers.some(a=>normalize(a,caseSensitive)===n);}function normalize(v:string,cs:boolean){const n=v.normalize('NFC').trim().replace(/\s+/g,' ');return cs?n:n.toLocaleLowerCase('vi-VN');}
