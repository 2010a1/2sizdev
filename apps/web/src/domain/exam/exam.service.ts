import { generateId, nowTs, validateDurationSeconds } from '@exam/utils';
import { ExamFormSchema, ExamDraftSchema, type ExamDraftInput } from '@exam/schemas';
import { hashExam } from '@exam/exam-format';
import type { Exam, Question } from './exam.types';
import { examRepository } from './exam.repository';
import { ExamDomainError, ExamNotFoundError } from './exam.errors';
import { localMutationService } from '../../infrastructure/sync/local-mutation.service';
import { mapExamContentToDomain } from './exam.mapper';

export const examService = {
  async createExamFromJson(input: unknown): Promise<Exam> {
    const parsed = ExamDraftSchema.safeParse(input);
    if (!parsed.success) throw new ExamDomainError(parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('\n'), 'INVALID_EXAM_JSON');
    const ids = new Set<string>();
    for (const q of parsed.data.questions) {
      if (ids.has(q.id)) throw new ExamDomainError(`Trùng question id: ${q.id}`, 'INVALID_EXAM_JSON');
      ids.add(q.id);
      if (q.type === 'SHORT_ANSWER' && (q.correctAnswers.length === 0 || q.needsReview)) throw new ExamDomainError(`Question ${q.id}: cần review đáp án SHORT_ANSWER trước khi lưu`, 'INVALID_EXAM_JSON');
      if (q.type === 'ABCD') {
        const optionIds = q.options.map(o => o.id);
        if (new Set(optionIds).size !== 4) throw new ExamDomainError(`Question ${q.id}: option ID phải duy nhất`, 'INVALID_EXAM_JSON');
        if (!optionIds.includes(q.correctOptionId)) throw new ExamDomainError(`Question ${q.id}: correctOptionId không tồn tại`, 'INVALID_EXAM_JSON');
      }
    }
    const now = nowTs();
    const id = generateId('exam');
    const draft = parsed.data;
    const rawQuestions = draft.questions.map((q, order) => {
      const base:any={id:q.id,examId:id,order,content:q.content,points:q.points??1,explanation:q.explanation};
      if(q.type==='ABCD') return {...base,type:'ABCD',options:q.options,correctOptionId:q.correctOptionId};
      if(q.type==='TRUE_FALSE') return {...base,type:'TRUE_FALSE',correctAnswer:q.correctAnswer};
      return {...base,type:'SHORT_ANSWER',correctAnswers:q.correctAnswers,caseSensitive:q.caseSensitive};
    });
    const unsigned:any={id,title:draft.title,description:draft.description,subject:draft.subject,grade:draft.grade,duration:draft.duration,questionCount:rawQuestions.length,source:'local',version:1,createdAt:now,updatedAt:now,questions:rawQuestions};
    const contentHash=await hashExam(unsigned);
    const {exam,questions}=mapExamContentToDomain({...unsigned,contentHash},id);
    await examRepository.importExamAtomic(exam,questions,[]);
    void localMutationService.exam(exam.id,'CREATE');
    return exam;
  },
  async createExam(input: {title:string; description?:string; subject:string; grade?:number; duration?:number}): Promise<Exam> {
    const parsed = ExamFormSchema.extend({ description: ExamFormSchema.shape.title.optional() }).parse(input);
    const duration = validateDurationSeconds(parsed.duration);
    const now=nowTs(); const exam:Exam={ id:generateId('exam'), title:parsed.title.trim(), description:input.description?.trim(), subject:parsed.subject.trim(), grade:parsed.grade, duration, questionCount:0, source:'local', version:1, contentHash:'local', createdAt:now, updatedAt:now };
    await examRepository.createExam(exam); void localMutationService.exam(exam.id, 'CREATE'); return exam;
  },
  async getExam(id:string) { const exam=await examRepository.getExam(id); if(!exam || exam.deletedAt) throw new ExamNotFoundError(); return exam; },
  async listExams() { return examRepository.listExams(); },
  async updateExam(id:string, patch:Partial<Exam>) { const exam=await this.getExam(id); if(exam.source!=='local') throw new ExamDomainError('Đề này chỉ được xem. Hãy sao chép để chỉnh sửa.','READ_ONLY'); const normalized={...patch, ...(patch.duration !== undefined ? { duration: validateDurationSeconds(patch.duration) } : {}), updatedAt:nowTs()}; await examRepository.updateExam(id,normalized); void localMutationService.exam(id, 'UPDATE'); return this.getExam(id); },
  async deleteExam(id:string) {
    const exam = await this.getExam(id);
    if (exam.source !== 'local') throw new ExamDomainError('Không thể xóa đề chính thức hoặc đề chỉ đọc.', 'READ_ONLY');
    const removed = await examRepository.deleteExam(id);
    void localMutationService.exam(id, 'DELETE');
    for (const q of removed.questions) void localMutationService.question(q.id, 'DELETE', undefined, q);
    for (const asset of removed.assets) void localMutationService.enqueue(undefined, 'examAsset', asset.id, 'DELETE', { id: asset.id, examId: id, path: asset.path, hash: asset.hash }, Date.now(), (asset as any).syncRevision ?? 0);
  },
  async duplicateExam(id:string) { const source=await this.getExam(id); const questions=await examRepository.getQuestionsByExam(id); const now=nowTs(); const newId=generateId('exam'); const exam:Exam={...source,id:newId,title:`${source.title} (Bản sao)`,source:'local',version:1,contentHash:'local',createdAt:now,updatedAt:now,deletedAt:undefined,questionCount:questions.length}; await examRepository.duplicateExam(newId,exam,questions.map(q=>({...q,id:generateId('question'),examId:newId}))); void localMutationService.exam(newId, 'CREATE'); return exam; },
  async favoriteExam(id:string) { const exam=await this.getExam(id); await examRepository.favoriteExam(id,!exam.isFavorite); void localMutationService.exam(id, 'UPDATE'); return !exam.isFavorite; },
  async refreshQuestionCount(id:string) { const questions=await examRepository.getQuestionsByExam(id); await examRepository.updateExam(id,{questionCount:questions.length,updatedAt:nowTs()}); void localMutationService.exam(id, 'UPDATE'); return questions.length; }
};
