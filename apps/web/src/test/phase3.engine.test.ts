import { describe, expect, it } from 'vitest';
import { PracticeEngine } from '../domain/practice/practice.engine';
import { TournamentEngine } from '../domain/tournament/tournament.engine';
import type { Question } from '../domain/exam/exam.types';
const questions:Question[]=[
{id:'q1',examId:'e',order:0,type:'ABCD',content:'1+1?',points:2,options:[{id:'a',text:'2'},{id:'b',text:'3'},{id:'c',text:'4'},{id:'d',text:'5'}],correctOptionId:'a'},
{id:'q2',examId:'e',order:1,type:'SHORT_ANSWER',content:'Capital?',points:1,acceptedAnswers:['Hà Nội','Ha Noi'],caseSensitive:false},
{id:'q3',examId:'e',order:2,type:'TRUE_FALSE',content:'A statement',points:1,correctAnswer:true}
];
describe('PracticeEngine',()=>{it('supports navigation and scoring inputs',()=>{const e=new PracticeEngine(questions,{startedAt:0,now:0});e.answerQuestion('q1',{type:'ABCD',selectedOptionId:'a'},100);e.next(200);e.answerQuestion('q2',{type:'SHORT_ANSWER',text:' ha  noi '},300);e.next(400);e.answerQuestion('q3',{type:'TRUE_FALSE',selectedAnswer:true},500);const result=e.submit(1000);expect(result.correctQuestions).toBe(3);expect(result.percentage).toBe(100);});});
describe('TournamentEngine',()=>{it('ends immediately on a wrong answer',()=>{const e=new TournamentEngine(questions,{startedAt:0,now:0});const result=e.answerCurrentQuestion({type:'ABCD',selectedOptionId:'b'},100);expect(result?.status).toBe('lost');expect(()=>e.answerCurrentQuestion({type:'ABCD',selectedOptionId:'a'},200)).toThrow();});it('progresses on correct answers and wins',()=>{const e=new TournamentEngine(questions,{startedAt:0,now:0});expect(e.answerCurrentQuestion({type:'ABCD',selectedOptionId:'a'},100)).toBeNull();expect(e.answerCurrentQuestion({type:'SHORT_ANSWER',text:'ha noi'},200)).toBeNull();const result=e.answerCurrentQuestion({type:'TRUE_FALSE',selectedAnswer:true},300);expect(result?.status).toBe('won');expect(result?.correctCount).toBe(3);});it('times out',()=>{const e=new TournamentEngine([questions[0]],{startedAt:0,now:0},1);expect(e.answerCurrentQuestion({type:'ABCD',selectedOptionId:'a'},1000)?.status).toBe('timeout');});});
