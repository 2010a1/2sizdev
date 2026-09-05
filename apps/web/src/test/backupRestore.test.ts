import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../db/database';
import { parseBackup, restoreLocalBackup } from '../infrastructure/backup.service';

const payload = () => ({
  format: 'exam-platform-backup' as const,
  version: 1,
  exportedAt: Date.now(),
  tables: {
    // Rows exactly as the app itself writes them: exams/questions/answers carry no profileId.
    exams: [{ id: 'exam_x', title: 'De thu', subject: 'Toan', source: 'local', version: 1, contentHash: 'x', questionCount: 1, createdAt: 1, updatedAt: 1 }],
    questions: [{ id: 'q_x', examId: 'exam_x', order: 0, type: 'ABCD' }],
    attempts: [{ id: 'att_x', profileId: 'p1', examId: 'exam_x', mode: 'practice', status: 'finished', score: 1, startedAt: 1 }],
    answers: [{ id: 'att_x:q_x', attemptId: 'att_x', questionId: 'q_x', answer: 'a', correct: true, answeredAt: 1, timeSpent: 1 }],
  },
});
const file = () => new File([JSON.stringify(payload())], 'backup.json', { type: 'application/json' });

describe('backup restore accepts the app own exports', () => {
  it('parses rows without profileId (exams/questions/answers)', async () => {
    await db.open();
    const preview = await parseBackup(file());
    expect(preview.totalRows).toBe(4);
    expect(preview.conflicts).toEqual({});
  });

  it('restores merge-mode and round-trips through a second export', async () => {
    await db.open();
    const result = await restoreLocalBackup(file(), 'merge');
    expect(result.totalRows).toBe(4);
    expect((await db.table('exams').get('exam_x'))?.title).toBe('De thu');
    expect((await db.table('answers').get('att_x:q_x'))?.attemptId).toBe('att_x');
    // Re-import over existing rows must not throw either (conflict path).
    const again = await parseBackup(file());
    expect(again.conflicts.exams).toBe(1);
  });
});
