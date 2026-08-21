import { describe, expect, it } from 'vitest';
import type { Question } from '../exam/exam.types';
import { applyCompetitionOrder, buildCompetitionOrder } from './competition.random';
const questions:Question[]=[1,2,3,4,5].map((n)=>({id:`q${n}`,examId:'e',order:n-1,type:'ABCD',content:`Q${n}`,points:1,options:[{id:`${n}a`,text:'A'},{id:`${n}b`,text:'B'},{id:`${n}c`,text:'C'},{id:`${n}d`,text:'D'}],correctOptionId:`${n}a`}));
describe('competition seeded randomization',()=>{it('same seed produces same question and option order',()=>{const a=buildCompetitionOrder(questions,'seed-a');const b=buildCompetitionOrder(questions,'seed-a');expect(a).toEqual(b);});it('different seeds can produce different order',()=>{const a=buildCompetitionOrder(questions,'seed-a');const b=buildCompetitionOrder(questions,'seed-b');expect(a.questionOrder).not.toEqual(b.questionOrder);});it('presentation order does not change correct option identity',()=>{const meta=buildCompetitionOrder(questions,'seed-a');const displayed=applyCompetitionOrder(questions,meta.questionOrder,meta.optionOrderByQuestion);for(const q of displayed)if(q.type==='ABCD')expect(q.options.find(o=>o.id===q.correctOptionId)?.text).toBe('A');});it('re-applying persisted order reproduces reload exactly',()=>{const meta=buildCompetitionOrder(questions,'persisted');const first=applyCompetitionOrder(questions,meta.questionOrder,meta.optionOrderByQuestion);const second=applyCompetitionOrder(questions,meta.questionOrder,meta.optionOrderByQuestion);expect(second).toEqual(first);});});
it('never drops choices when legacy data contains duplicate option ids',()=>{const legacy:Question[]=[{id:'q-dup',examId:'e',order:0,type:'ABCD',content:'x',points:1,options:[{id:'same',text:'A'},{id:'same',text:'B'},{id:'other',text:'C'},{id:'other',text:'D'}],correctOptionId:'same'}];const meta=buildCompetitionOrder(legacy,'seed');const displayed=applyCompetitionOrder(legacy,meta.questionOrder,meta.optionOrderByQuestion);expect(displayed[0]).toMatchObject({type:'ABCD'});if(displayed[0].type==='ABCD')expect(displayed[0].options).toHaveLength(4);});

describe('fixed exam sections',()=>{
  const mixed:Question[]=[
    {id:'sa1',examId:'e',order:0,type:'SHORT_ANSWER',content:'sa1',points:1,acceptedAnswers:['x']},
    {id:'tf1',examId:'e',order:1,type:'TRUE_FALSE',content:'tf1',points:1,correctAnswer:true},
    {id:'mc1',examId:'e',order:2,type:'ABCD',content:'mc1',points:1,options:[{id:'a',text:'A'},{id:'b',text:'B'},{id:'c',text:'C'},{id:'d',text:'D'}],correctOptionId:'a'},
    {id:'sa2',examId:'e',order:3,type:'SHORT_ANSWER',content:'sa2',points:1,acceptedAnswers:['y']},
    {id:'tf2',examId:'e',order:4,type:'TRUE_FALSE',content:'tf2',points:1,correctAnswer:false},
    {id:'mc2',examId:'e',order:5,type:'ABCD',content:'mc2',points:1,options:[{id:'a',text:'A'},{id:'b',text:'B'},{id:'c',text:'C'},{id:'d',text:'D'}],correctOptionId:'a'}
  ];
  it('always keeps ABCD -> true/false -> short answer section order',()=>{
    const order=buildCompetitionOrder(mixed,'section-seed').questionOrder;
    expect(order.map(id=>mixed.find(q=>q.id===id)!.type)).toEqual(['ABCD','ABCD','TRUE_FALSE','TRUE_FALSE','SHORT_ANSWER','SHORT_ANSWER']);
  });
  it('randomizes inside each section without crossing section boundaries',()=>{
    const first=buildCompetitionOrder(mixed,'a').questionOrder;
    const second=buildCompetitionOrder(mixed,'b').questionOrder;
    expect(first.map(id=>mixed.find(q=>q.id===id)!.type)).toEqual(second.map(id=>mixed.find(q=>q.id===id)!.type));
    expect(new Set(first.slice(0,2))).toEqual(new Set(['mc1','mc2']));
  });
});
