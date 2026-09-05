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
    const records = await examRepository.getAssetsByExam(examId);
    const assetRefById = new Map(records.map((asset) => [asset.id, `assets/${asset.path.replace(/^assets\//, '')}`]));
    const content = mapExamToExamContent(exam, questions);
    const exportContent = {
      ...content,
      questions: content.questions.map((question) => ({
        ...question,
        imageAssetId: question.imageAssetId
          ? assetRefById.get(question.imageAssetId)
          : undefined,
      })),
    };
    for (const question of exportContent.questions) {
      if (question.imageAssetId === undefined && questions.find((q) => q.id === question.id)?.imageAssetId) {
        throw new Error(`Question references missing local asset: ${questions.find((q) => q.id === question.id)?.imageAssetId}`);
      }
    }
    const assets: ExamAsset[] = records.map((asset) => ({ path: asset.path.replace(/^assets\//, ''), data: asset.data, mimeType: asset.mimeType, hash: asset.hash }));
    return { bytes: await exportExam({ content: exportContent, assets }), filename: sanitizeFilename(exam.title) };
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
    const assetIdByPath = new Map(imported.assets.map((asset) => [`assets/${asset.path}`, `${newId}:assets/${asset.path}`]));
    const domainContent = {
      ...imported.content,
      questions: imported.content.questions.map((question) => ({
        ...question,
        imageAssetId: question.imageAssetId
          ? assetIdByPath.get(question.imageAssetId)
          : undefined,
      })),
    };
    for (const question of domainContent.questions) {
      if (question.imageAssetId === undefined && imported.content.questions.find((q) => q.id === question.id)?.imageAssetId) {
        throw new Error(`Question references missing imported asset: ${imported.content.questions.find((q) => q.id === question.id)?.imageAssetId}`);
      }
    }
    const { exam, questions } = mapExamContentToDomain(domainContent, newId);
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
    // A copy or a dedupe-renamed import gets a brand-new id the server has never seen — that is a CREATE. UPDATE is only correct when we overwrite the same id that already synced.
    if (sync) await localMutationService.exam(finalExam.id, existing && newId === imported.content.id ? 'UPDATE' : 'CREATE');
    return finalExam;
  }
};
