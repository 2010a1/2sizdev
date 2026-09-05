import type { ExamMetadata, Question as StoredQuestion, Attempt as StoredAttempt, Answer as StoredAnswer } from '@exam/shared-types';
export type Exam = ExamMetadata & { deletedAt?:number };
export interface BaseQuestion { id:string; examId:string; order:number; type:QuestionType; content:string; explanation?:string; points:number; imageAssetId?:string; imageUrl?:string; }
export interface ABCDQuestion extends BaseQuestion { type:'ABCD'; options:{id:string;text:string}[]; correctOptionId:string; }
export interface TrueFalseStatement { id:string; text:string; correct:boolean; }
export interface TrueFalseQuestion extends BaseQuestion { type:'TRUE_FALSE'; correctAnswer:boolean; statements?:TrueFalseStatement[]; }
export interface ShortAnswerQuestion extends BaseQuestion { type:'SHORT_ANSWER'; acceptedAnswers:string[]; caseSensitive?:boolean; }
export type Question = ABCDQuestion | TrueFalseQuestion | ShortAnswerQuestion;
export type QuestionType = Question['type'];
export type AnswerValue = {type:'ABCD';selectedOptionId?:string}|{type:'TRUE_FALSE';selectedAnswer?:boolean;selectedAnswers?:Record<string,boolean>}|{type:'SHORT_ANSWER';text:string};
export type Answer = Omit<StoredAnswer,'answer'> & {answer:AnswerValue};
export type Attempt = StoredAttempt;
export type StoredQuestionRecord = StoredQuestion & { points?:number; imageAssetId?:string; imageUrl?:string; correctOptionId?:string; acceptedAnswers?:string[]; };
