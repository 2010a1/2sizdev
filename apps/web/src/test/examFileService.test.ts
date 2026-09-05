import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../db/database';
import { examService } from '../domain/exam/exam.service';
import { examFileService } from '../domain/exam/exam.file.service';
import { examRepository } from '../domain/exam/exam.repository';
import { attemptService } from '../domain/exam/attempt.service';
import type { Exam, Question } from '../domain/exam/exam.types';
import type { ExamAssetRecord } from '../db/database';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('ExamFileService', () => {
  it('exports and imports an exam without profile/attempt/history data', async () => {
    const exam = await examService.createExam({ title:'Export me', subject:'Toán', duration:3600 });
    const { blob, filename } = await examFileService.exportExam(exam.id);
    expect(filename).toBe('Export me.exam');
    expect(blob.size).toBeGreaterThan(0);

    const imported = await examFileService.previewImport(new File([await blob.arrayBuffer()], filename));
    expect(imported.imported.content.id).toBe(exam.id);
    expect(imported.imported.content).not.toHaveProperty('profileId');
    expect(imported.imported.content).not.toHaveProperty('attempt');
  });

  it('exports question image references as declared asset paths and remaps them on import', async () => {
    const exam = await examService.createExam({ title:'Image share', subject:'Toán' });
    const question: Question = {
      id: 'image-q1', examId: exam.id, order: 0, type: 'SHORT_ANSWER',
      content: 'Nhìn hình', points: 1, acceptedAnswers: ['A'], imageAssetId: 'local-image-1'
    };
    await examRepository.addQuestion(question);
    await examRepository.putAsset({
      id: 'local-image-1', examId: exam.id, path: 'assets/question-1.webp',
      data: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/webp', hash: 'sha256:' + '1'.repeat(64)
    });

    const { blob, filename } = await examFileService.exportExam(exam.id);
    const preview = await examFileService.previewImport(new File([await blob.arrayBuffer()], filename));
    expect(preview.imported.content.questions[0].imageAssetId).toBe('assets/question-1.webp');
    expect(preview.imported.manifest.assets).toContain('assets/question-1.webp');

    const copy = await examFileService.importConfirmed(preview, true);
    const copiedQuestion = (await examRepository.getQuestionsByExam(copy.id))[0];
    expect(copiedQuestion.imageAssetId).toBe(`${copy.id}:assets/question-1.webp`);
    expect(await examRepository.getAsset(copiedQuestion.imageAssetId!)).toBeTruthy();
  });

  it('does not overwrite duplicate exam IDs and imports as a local copy', async () => {
    const exam = await examService.createExam({ title:'Duplicate', subject:'Anh' });
    const { blob, filename } = await examFileService.exportExam(exam.id);
    const preview = await examFileService.previewImport(new File([await blob.arrayBuffer()], filename));
    expect(preview.duplicate).toBe(true);
    const copy = await examFileService.importConfirmed(preview, true);
    expect(copy.id).not.toBe(exam.id);
    expect(copy.source).toBe('local');
    expect(await examRepository.getExam(exam.id)).toBeTruthy();
    expect(await examRepository.getExam(copy.id)).toBeTruthy();
  });


  it('preserves existing Phase 3 exam, questions, and attempts during Phase 4 import', async () => {
    const exam = await examService.createExam({ title:'Legacy local exam', subject:'Toán', duration:3600 });
    const question: Question = {
      id: 'legacy-q1', examId: exam.id, order: 0, type: 'SHORT_ANSWER',
      content: '2 + 2 = ?', points: 1, acceptedAnswers: ['4']
    };
    await examRepository.addQuestion(question);
    const attempt = await attemptService.createAttempt('profile-legacy', exam.id, 'practice', 1000);

    const { blob, filename } = await examFileService.exportExam(exam.id);
    const preview = await examFileService.previewImport(new File([await blob.arrayBuffer()], filename));
    const copy = await examFileService.importConfirmed(preview, true);

    expect(await examRepository.getExam(exam.id)).toMatchObject({ id: exam.id, title: 'Legacy local exam' });
    expect(await examRepository.getQuestionsByExam(exam.id)).toEqual([question]);
    expect(await examRepository.getAttempt(attempt.id)).toMatchObject({ id: attempt.id, examId: exam.id, status: 'in_progress' });
    expect(await examRepository.getExam(copy.id)).toBeTruthy();
  });


  it('imports a shared package as source=shared without importing attempts', async () => {
    const exam = await examService.createExam({ title:'Shared source', subject:'Anh' });
    const { blob, filename } = await examFileService.exportExam(exam.id);
    const preview = await examFileService.previewImport(new File([await blob.arrayBuffer()], filename));
    const shared = await examFileService.importConfirmed(preview, true, 'shared');
    expect(shared.source).toBe('shared');
    expect(shared.id).not.toBe(exam.id);
  });

  it('duplicating an exam with a question image lets the copy be shared and used (regression for undeclared-asset share failure)', async () => {
    const exam = await examService.createExam({ title:'Has image', subject:'Anh' });
    const question: Question = {
      id: 'q-with-image', examId: exam.id, order: 0, type: 'SHORT_ANSWER',
      content: 'Nhìn hình', points: 1, acceptedAnswers: ['A'], imageAssetId: 'asset_original'
    };
    await examRepository.addQuestion(question);
    await examRepository.putAsset({
      id: 'asset_original', examId: exam.id, path: 'assets/asset_original.png',
      data: new Uint8Array([9, 9, 9]), mimeType: 'image/png', hash: 'sha256:' + '2'.repeat(64)
    });

    const copy = await examService.duplicateExam(exam.id);

    // The copy must own its own asset row (not merely inherit the original's),
    // so that exporting/sharing the copy on its own succeeds without throwing
    // "Question references undeclared asset" / "missing local asset".
    const copiedQuestions = await examRepository.getQuestionsByExam(copy.id);
    expect(copiedQuestions[0].imageAssetId).toBeTruthy();
    expect(copiedQuestions[0].imageAssetId).not.toBe('asset_original');
    const copiedAssets = await examRepository.getAssetsByExam(copy.id);
    expect(copiedAssets).toHaveLength(1);
    expect(copiedAssets[0].id).toBe(copiedQuestions[0].imageAssetId);

    const { blob, filename } = await examFileService.exportExam(copy.id);
    const preview = await examFileService.previewImport(new File([await blob.arrayBuffer()], filename));
    expect(preview.imported.manifest.assets).toContain('assets/asset_original.png');
    expect(preview.imported.content.questions[0].imageAssetId).toBe('assets/asset_original.png');

    // Deleting the original exam must not break the (independently-owned) copy's asset.
    await examService.deleteExam(exam.id);
    expect(await examRepository.getAsset(copiedQuestions[0].imageAssetId!)).toBeTruthy();
  });

  it('rolls back exam, questions, and assets when a write fails inside the atomic transaction', async () => {
    const now = Date.now();
    const importedExam: Exam = {
      id: 'exam_atomic_failure',
      title: 'Atomic failure',
      subject: 'Lý',
      questionCount: 2,
      source: 'local',
      version: 1,
      contentHash: 'sha256:' + 'a'.repeat(64),
      createdAt: now,
      updatedAt: now
    };
    const questions: Question[] = [
      {
        id: 'atomic-q1', examId: importedExam.id, order: 0, type: 'SHORT_ANSWER',
        content: 'Q1', points: 1, acceptedAnswers: ['A']
      },
      {
        id: 'atomic-q2', examId: importedExam.id, order: 1, type: 'SHORT_ANSWER',
        content: 'Q2', points: 1, acceptedAnswers: ['B']
      }
    ];
    const conflictingQuestion: Question = {
      id: 'atomic-q2', examId: 'existing_exam', order: 0, type: 'SHORT_ANSWER',
      content: 'Existing conflicting question', points: 1, acceptedAnswers: ['X']
    };
    const asset: ExamAssetRecord = {
      id: 'atomic-asset', examId: importedExam.id, path: 'q1.webp',
      data: new Uint8Array([1, 2, 3]), hash: 'sha256:' + 'b'.repeat(64)
    };

    // The conflicting question is inserted before the transaction. The second
    // imported question then violates the primary-key constraint after the
    // exam write has already been attempted, forcing Dexie to abort the whole
    // transaction.
    await db.questions.add(conflictingQuestion);

    await expect(
      examRepository.importExamAtomic(importedExam, questions, [asset])
    ).rejects.toBeTruthy();

    expect(await examRepository.getExam(importedExam.id)).toBeUndefined();
    expect(await db.questions.get('atomic-q1')).toBeUndefined();
    expect(await db.questions.get('atomic-q2')).toEqual(conflictingQuestion);
    expect(await db.examAssets.where('examId').equals(importedExam.id).toArray()).toHaveLength(0);
  });
});
