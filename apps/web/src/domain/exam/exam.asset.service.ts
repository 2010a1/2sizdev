import { generateId } from "@exam/utils";
import { sha256 } from "@exam/exam-format";
import { examRepository } from "./exam.repository";
import { imageApi } from "../../infrastructure/api/images";
import type { ExamAssetRecord } from "../../db/database";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function extension(mime: string) { return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg"; }

export async function addQuestionImage(examId: string, questionId: string, file: File) {
  if (!ALLOWED.has(file.type)) throw new Error("Chỉ hỗ trợ JPG, PNG, WEBP hoặc GIF.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Ảnh tối đa 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256(bytes);
  const id = generateId("asset");
  const asset: ExamAssetRecord = { id, examId, path: `assets/${id}.${extension(file.type)}`, data: bytes, mimeType: file.type, hash };
  // Local IndexedDB is the source of truth: the question remains usable offline even if ImgBB is unavailable.
  await examRepository.putAsset(asset);
  let remoteUrl: string | undefined;
  if (navigator.onLine) {
    try {
      const base64 = bytesToBase64(bytes);
      const uploaded = await imageApi.uploadToImgBB({ base64, name: file.name || id, mimeType: file.type });
      remoteUrl = uploaded.url || uploaded.displayUrl;
      if (remoteUrl) await examRepository.updateAsset(id, { remoteUrl });
    } catch {
      // Keep the local asset. The UI can report that remote upload failed while offline use remains intact.
    }
  }
  return { ...asset, remoteUrl, questionId };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  return btoa(binary);
}
