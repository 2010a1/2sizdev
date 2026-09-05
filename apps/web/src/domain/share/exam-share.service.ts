import { importExam } from '@exam/exam-format';
import { db } from '../../db/database';
import { examFileService } from '../exam/exam.file.service';
import { examRepository } from '../exam/exam.repository';

import { apiUrl } from '../../infrastructure/api/base';
import { useProfileStore } from '../../state/profileStore';

function base64(bytes: Uint8Array) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function bytesFromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(apiUrl(path), { ...init, signal: controller.signal, headers: { ...(init?.body != null ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) } });
    let data: any = undefined;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data?.error?.message ?? `HTTP_${response.status}`);
    return data as T;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) throw new Error('Không thể kết nối máy chủ. Bạn vẫn có thể sử dụng các đề đã lưu offline.');
    throw error;
  } finally { window.clearTimeout(timer); }
}

export interface ShareResponse { shareId:string; shareCode:string; packageBase64?:string; packageType:'exam'|'vocabularySet'; contentHash:string; formatVersion:number; storageKey?:string; createdAt:number; expiresAt?:number; shareUrl:string; ownerName?:string; ownerAvatar?:string; sourceEntityId?:string; accessCount?:number; lastAccessAt?:number; updatedAt?:number; }

export async function createExamShare(examId:string, expiresIn:'24h'|'7d'|'never'='7d') {
  const { bytes } = await examFileService.exportExamBytes(examId);
  const imported = await importExam(bytes);
  const profile = useProfileStore.getState().activeProfile;
  return request<ShareResponse>('/api/share', { method:'POST', body:JSON.stringify({ packageType:'exam', packageBase64:base64(bytes), contentHash:imported.contentHash, formatVersion:imported.formatVersion, expiresIn, ownerAvatar: profile?.avatar, sourceEntityId: examId }) });
}

export async function getShare(code:string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,10}$/.test(normalized)) throw new Error('Mã đề không hợp lệ.');
  return request<ShareResponse>(`/api/share/${encodeURIComponent(normalized)}`);
}

export async function importExamShare(code:string) {
  const share = await getShare(code);
  if (share.packageType !== 'exam' || !share.packageBase64) throw new Error('Mã này không phải đề thi.');
  const bytes = bytesFromBase64(share.packageBase64);
  const imported = await importExam(bytes);
  if (imported.contentHash !== share.contentHash || imported.formatVersion !== share.formatVersion) throw new Error('Đề chia sẻ bị lỗi hoặc không thể đọc.');
  const existing = await examRepository.getExam(imported.content.id);
  const exam = await examFileService.importConfirmed({ imported, fileName:`${share.shareCode}.exam`, fileSize:bytes.byteLength, duplicate:!!existing }, true, 'shared');
  await db.sharedExams.put({ id:share.shareId, examId:exam.id, code:share.shareCode, expiresAt:share.expiresAt, importedAt:Date.now(), ownerName:share.ownerName, ownerAvatar:share.ownerAvatar });
  return exam;
}


export async function listMyShares() { return request<{shares: ShareResponse[]}>('/api/share'); }

export async function updateExamShare(code:string, examId:string, expiresIn:'24h'|'7d'|'never'='7d') {
  const { bytes } = await examFileService.exportExamBytes(examId);
  const imported = await importExam(bytes);
  const profile = useProfileStore.getState().activeProfile;
  return request<ShareResponse>(`/api/share/${encodeURIComponent(code)}`, { method:'PUT', body:JSON.stringify({ packageType:'exam', packageBase64:base64(bytes), contentHash:imported.contentHash, formatVersion:imported.formatVersion, expiresIn, ownerAvatar: profile?.avatar, sourceEntityId: examId }) });
}

export async function deleteShare(code:string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,10}$/.test(normalized)) throw new Error('Mã chia sẻ không hợp lệ.');
  return request<{ok:boolean}>(`/api/share/${encodeURIComponent(normalized)}`, { method:'DELETE' });
}
