import { vocabularySetController } from "../vocabulary/vocabulary.set.controller";

import { apiUrl } from "../../infrastructure/api/base";
import { useProfileStore } from '../../state/profileStore';
const encoder = new TextEncoder();

function base64(bytes: Uint8Array) { let binary = ""; for (const b of bytes) binary += String.fromCharCode(b); return btoa(binary); }
function bytesFromBase64(value: string) { const binary = atob(value); return Uint8Array.from(binary, c => c.charCodeAt(0)); }
async function sha256(bytes: Uint8Array) { const hash = await crypto.subtle.digest("SHA-256", bytes.slice().buffer); return `sha256:${Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")}`; }

export interface VocabularySharePayload {
  type: "vocabularySet";
  version: number;
  set: { name: string; description?: string };
  words: Array<{ english: string; vietnamese: string }>;
}

export async function createVocabularyShare(profileId: string, setId: string, expiresIn: "24h" | "7d" | "never" = "7d") {
  const detail = await vocabularySetController.detail(profileId, setId);
  const payload: VocabularySharePayload = { type: "vocabularySet", version: 1, set: { name: detail.set.name, description: detail.set.description }, words: detail.vocabularies.map(v => ({ english: v.english, vietnamese: v.vietnamese })) };
  const bytes = encoder.encode(JSON.stringify(payload));
  const contentHash = await sha256(bytes);
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Bạn đang offline. Hãy kết nối Internet để chia sẻ bộ từ.");
  const profile = useProfileStore.getState().activeProfile;
  const r = await fetch(apiUrl("/api/share"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ packageType: "vocabularySet", packageBase64: base64(bytes), contentHash, formatVersion: 1, expiresIn, ownerAvatar: profile?.avatar, sourceEntityId: setId }) });
  let data: any = {}; try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data?.error?.message ?? "Không thể chia sẻ bộ từ");
  return data;
}

export async function getVocabularyShare(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6,10}$/.test(normalized)) throw new Error("Mã chia sẻ không hợp lệ.");
  const r = await fetch(apiUrl(`/api/share/${encodeURIComponent(normalized)}`));
  let data: any = {}; try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data?.error?.message ?? "Không thể tải nội dung chia sẻ");
  if (data.packageType !== "vocabularySet" || !data.packageBase64) throw new Error("Mã này không phải bộ từ vựng.");
  const bytes = bytesFromBase64(data.packageBase64);
  const actualHash = await sha256(bytes);
  if (actualHash.toLowerCase() !== String(data.contentHash ?? "").toLowerCase()) throw new Error("Bộ từ chia sẻ bị lỗi hoặc đã bị thay đổi.");
  let payload: VocabularySharePayload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("Không thể đọc bộ từ chia sẻ."); }
  if (payload?.type !== "vocabularySet" || !payload?.set?.name || !Array.isArray(payload.words)) throw new Error("Gói chia sẻ không phải bộ từ hợp lệ.");
  const words = payload.words.filter(x => typeof x?.english === "string" && typeof x?.vietnamese === "string").map(x => ({ english: x.english.trim(), vietnamese: x.vietnamese.trim() })).filter(x => x.english && x.vietnamese);
  if (!words.length) throw new Error("Bộ từ chia sẻ không có từ hợp lệ.");
  return { ...data, payload: { ...payload, words }, wordCount: words.length };
}

export async function importVocabularyShare(profileId: string, code: string) {
  const share = await getVocabularyShare(code);
  const payload = share.payload as VocabularySharePayload;
  const existingSets = await vocabularySetController.list(profileId);
  const normalizedName = payload.set.name.trim().toLocaleLowerCase();
  for (const candidate of existingSets) {
    if (candidate.name.trim().toLocaleLowerCase() !== normalizedName || candidate.wordCount !== payload.words.length) continue;
    try {
      const detail = await vocabularySetController.detail(profileId, candidate.id);
      const localWords = detail.vocabularies.map(v => `${v.english.trim().toLocaleLowerCase()}\u0000${v.vietnamese.trim()}`).sort();
      const incomingWords = payload.words.map(v => `${v.english.trim().toLocaleLowerCase()}\u0000${v.vietnamese.trim()}`).sort();
      if (localWords.length === incomingWords.length && localWords.every((word, i) => word === incomingWords[i])) return candidate;
    } catch {}
  }
  const set = await vocabularySetController.create(profileId, { name: payload.set.name, description: payload.set.description ? String(payload.set.description) : undefined });
  try {
    await vocabularySetController.addBulkVocabulary(profileId, set.id, payload.words);
    return set;
  } catch (error) {
    try { await vocabularySetController.delete(profileId, set.id); } catch {}
    throw error;
  }
}


export async function updateVocabularyShare(code:string, profileId:string, setId:string, expiresIn:'24h'|'7d'|'never'='7d') {
  const detail = await vocabularySetController.detail(profileId, setId);
  const payload: VocabularySharePayload = { type: "vocabularySet", version: 1, set: { name: detail.set.name, description: detail.set.description }, words: detail.vocabularies.map(v => ({ english: v.english, vietnamese: v.vietnamese })) };
  const bytes = encoder.encode(JSON.stringify(payload)); const contentHash = await sha256(bytes);
  const profile = useProfileStore.getState().activeProfile;
  const r = await fetch(apiUrl(`/api/share/${encodeURIComponent(code)}`), { method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({ packageType:'vocabularySet',packageBase64:base64(bytes),contentHash,formatVersion:1,expiresIn,ownerAvatar:profile?.avatar,sourceEntityId:setId}) });
  let data:any={}; try{data=await r.json()}catch{} if(!r.ok)throw new Error(data?.error?.message??'Không thể cập nhật bộ từ chia sẻ'); return data;
}
