import {
  exportExam,
  importExam,
  sanitizeFilename,
  hashAsset,
  type ImportedExam,
  type ExamAsset
} from '@exam/exam-format';
import { generateId, nowTs } from '@exam/utils';
import { examRepository } from './exam.repository';
import { examService } from './exam.service';
import { mapExamContentToDomain, mapExamToExamContent } from './exam.mapper';
import type { Exam } from './exam.types';
import type { ExamAssetRecord } from '../../db/database';
import { localMutationService } from '../../infrastructure/sync/local-mutation.service';

export interface ExamImportPreview {
  imported: ImportedExam;
  fileName: string;
  fileSize: number;
  duplicate: boolean;
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export const examFileService = {
  async exportExamBytes(examId: string): Promise<{ bytes: Uint8Array; filename: string }> {
    const exam = await examService.getExam(examId);
    const questions = await examRepository.getQuestionsByExam(examId);
    const content = mapExamToExamContent(exam, questions);
    const records = await examRepository.getAssetsByExam(examId);
    const assets: ExamAsset[] = records.map((asset) => ({ path: asset.path, data: asset.data, mimeType: asset.mimeType, hash: asset.hash }));
    return { bytes: await exportExam({ content, assets }), filename: sanitizeFilename(exam.title) };
  },
  async exportExam(examId: string): Promise<{ blob: Blob; filename: string }> {
    const { bytes, filename } = await this.exportExamBytes(examId);
    const copy = bytes.slice();
    return { blob: new Blob([copy], { type: 'application/octet-stream' }), filename };
  },

  async previewImport(file: File): Promise<ExamImportPreview> {
    const bytes = await readFileBytes(file);
    const imported = await importExam(bytes);
    const existing = await examRepository.getExam(imported.content.id);
    return { imported, fileName: file.name, fileSize: file.size, duplicate: !!existing };
  },

  async importConfirmed(preview: ExamImportPreview, asCopy = false, source: Exam['source'] = 'local', sync = true): Promise<Exam> {
    const { imported } = preview;
    const existing = await examRepository.getExam(imported.content.id);
    const newId = asCopy || (existing && !(source === 'official' && existing.source === 'official')) ? generateId('exam') : imported.content.id;
    const { exam, questions } = mapExamContentToDomain(imported.content, newId);
    const now = nowTs();
    const finalExam: Exam = {
      ...exam,
      id: newId,
      source,
      version: imported.content.version,
      contentHash: imported.contentHash,
      createdAt: newId === imported.content.id ? imported.content.createdAt : now,
      updatedAt: now,
      questionCount: questions.length
    };

    const assets: ExamAssetRecord[] = [];
    for (const asset of imported.assets) {
      const path = `assets/${asset.path}`;
      assets.push({
        id: `${newId}:${path}`,
        examId: newId,
        path,
        data: asset.data,
        mimeType: asset.mimeType,
        hash: asset.hash ?? await hashAsset(asset.data)
      });
    }
    if (source === 'official' && existing?.source === 'official' && existing.id === finalExam.id) await examRepository.replaceExamAtomic(finalExam, questions, assets);
    else await examRepository.importExamAtomic(finalExam, questions, assets);
    if (sync) void localMutationService.exam(finalExam.id, existing ? 'UPDATE' : 'CREATE');
    return finalExam;
  }
};
