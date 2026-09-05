import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useProfileStore } from "../../state/profileStore";
import { db } from '../../db/database';
import { AppIcon } from "../components/AppIcon";
import { RichContent } from "../components/exam/RichContent";
import { examService } from '../../domain/exam/exam.service';
import { examRepository } from '../../domain/exam/exam.repository';
import { getShare, importExamShare, listMyShares, updateExamShare, deleteShare, type ShareResponse } from "../../domain/share/exam-share.service";
import { importVocabularyShare, updateVocabularyShare } from "../../domain/share/vocabulary-share.service";
import { vocabularySetController } from "../../domain/vocabulary/vocabulary.set.controller";
import { importExam, type ExamContentInput } from '@exam/exam-format';
import { useOnlineStatus } from "../../hooks/useOnlineStatus";

type ShareKind = "exam" | "vocabularySet";
type Preview = {
  kind: ShareKind;
  code: string;
  title: string;
  description?: string;
  count?: number;
  expiresAt?: number;
  ownerName?: string;
  ownerAvatar?: string;
  subject?: string;
  grade?: string | number;
  duration?: number;
  questions?: Array<{ content: string; imageUrl?: string; imageAssetId?: string }>;
  words?: Array<{ english: string; vietnamese: string }>;
};

type SharedVocabPayload = {
  type: string;
  set: { name: string; description?: string };
  words: Array<{ english?: unknown; vietnamese?: unknown }>;
};

function parseVocabularyPayload(share: ShareResponse) {
  if (!share?.packageBase64) throw new Error("Gói bộ từ không có dữ liệu.");
  const bytes = bytesFromBase64(share.packageBase64);
  let payload: SharedVocabPayload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)) as SharedVocabPayload; } catch { throw new Error("Không thể đọc bộ từ chia sẻ."); }
  if (payload?.type !== "vocabularySet" || !payload?.set?.name || !Array.isArray(payload.words)) {
    throw new Error("Gói chia sẻ không phải bộ từ hợp lệ.");
  }
  return payload;
}

function bytesFromBase64(value:string){ const binary=atob(value); return Uint8Array.from(binary,c=>c.charCodeAt(0)); }

function normalize(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10); }

export function SharePage() {
  const { code: routeCode } = useParams();
  const profile = useProfileStore(s => s.activeProfile)!;
  const online = useOnlineStatus();
  const nav = useNavigate();
  const [code, setCode] = useState(normalize(routeCode ?? ""));
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(Boolean(routeCode));
  const [myShares, setMyShares] = useState<ShareResponse[]>([]);
  const [managedTitles, setManagedTitles] = useState<Record<string, string>>({});
  const [shareAction, setShareAction] = useState<string>("");
  const [shareManagementError, setShareManagementError] = useState("");

  useEffect(() => { setCode(normalize(routeCode ?? "")); }, [routeCode]);
  useEffect(() => {
    if (online && !routeCode) void loadMyShares();
  }, [online, routeCode]);
  async function loadMyShares(){
    try {
      const r=await listMyShares();
      const shares = r.shares ?? [];
      setMyShares(shares);
      const titleEntries = await Promise.all(shares.map(async (share) => {
        if (!share.sourceEntityId) return null;
        try {
          if (share.packageType === "exam") {
            const exam = await examService.getExam(share.sourceEntityId);
            return exam ? [share.shareId, exam.title] as const : null;
          }
          if (share.packageType === "vocabularySet") {
            const set = await vocabularySetController.get(profile.id, share.sourceEntityId);
            return set ? [share.shareId, set.name] as const : null;
          }
        } catch { return null; }
        return null;
      }));
      setManagedTitles(Object.fromEntries(titleEntries.filter(Boolean) as Array<readonly [string,string]>));
      setShareManagementError("");
    } catch(e){ setShareManagementError(e instanceof Error ? e.message : "Không thể tải mã chia sẻ"); }
  }
  async function updateManagedShare(share: ShareResponse){
    if(!share.sourceEntityId){ setShareManagementError("Mã này chưa liên kết với nội dung gốc nên không thể tự cập nhật."); return; }
    setShareAction(`update:${share.shareCode}`); setShareManagementError("");
    try { if(share.packageType === "exam") await updateExamShare(share.shareCode, share.sourceEntityId); else await updateVocabularyShare(share.shareCode, profile.id, share.sourceEntityId); await loadMyShares(); }
    catch(e){ setShareManagementError(e instanceof Error ? e.message : "Không thể cập nhật mã chia sẻ"); }
    finally { setShareAction(""); }
  }
  async function removeManagedShare(share: ShareResponse){
    if(!window.confirm(`Xóa mã ${share.shareCode}? Mã sẽ không còn nhận được nội dung.`)) return;
    setShareAction(`delete:${share.shareCode}`); setShareManagementError("");
    try { await deleteShare(share.shareCode); await loadMyShares(); } catch(e){ setShareManagementError(e instanceof Error ? e.message : "Không thể xóa mã chia sẻ"); } finally { setShareAction(""); }
  }
  useEffect(() => {
    if (!routeCode) { setPreview(undefined); setError(""); setLoadingPreview(false); return; }
    void resolve(routeCode);
  }, [routeCode]);

  async function resolve(raw: string) {
    const normalized = normalize(raw); setLoadingPreview(true); setError(""); setPreview(undefined);
    try {
      const share = await getShare(normalized);
      if (share.packageType === "exam") {
        let examMeta: Partial<ExamContentInput> = {};
        try { const bytes = bytesFromBase64(share.packageBase64!); const imported = await importExam(bytes); examMeta = imported.content; } catch {}
        setPreview({ kind: "exam", code: share.shareCode, title: examMeta.title ?? "Đề thi được chia sẻ", description: examMeta.description, expiresAt: share.expiresAt, ownerName: share.ownerName, ownerAvatar: share.ownerAvatar, subject: examMeta.subject, grade: examMeta.grade, duration: examMeta.duration, count: examMeta.questions?.length ?? examMeta.questionCount, questions: (examMeta.questions ?? []).map((q)=>({content:q.content,imageUrl:q.imageUrl,imageAssetId:q.imageAssetId})) });
      } else if (share.packageType === "vocabularySet") {
        const payload = parseVocabularyPayload(share);
        const words = payload.words
          .filter((x) => typeof x?.english === "string" && typeof x?.vietnamese === "string")
          .map((x) => ({ english: (x.english as string).trim(), vietnamese: (x.vietnamese as string).trim() }))
          .filter((x) => x.english && x.vietnamese);
        setPreview({
          kind: "vocabularySet",
          code: share.shareCode,
          title: payload.set.name,
          description: payload.set.description,
          count: words.length,
          expiresAt: share.expiresAt,
          ownerName: share.ownerName,
          ownerAvatar: share.ownerAvatar,
          words
        });
      } else {
        throw new Error("Loại nội dung chia sẻ không được hỗ trợ.");
      }
    } catch (e) {
      // Offline fallback: previously received shares remain previewable from IndexedDB.
      try {
        const ref = await db.sharedExams.where('code').equals(normalized).first();
        if (!ref) throw e;
        const exam = await examService.getExam(ref.examId);
        const questions = await examRepository.getQuestionsByExam(ref.examId);
        setPreview({ kind:'exam', code:normalized, title:exam.title, description:exam.description, expiresAt:ref.expiresAt, ownerName:ref.ownerName, ownerAvatar:ref.ownerAvatar, subject:exam.subject, grade:exam.grade, duration:exam.duration, count:questions.length, questions:questions.map(q=>({content:q.content,imageUrl:q.imageUrl,imageAssetId:q.imageAssetId})) });
        setError('Đang xem bản đã lưu offline.');
      } catch { setError(e instanceof Error ? e.message : "Không thể đọc mã chia sẻ"); }
    }
    finally { setLoadingPreview(false); }
  }

  async function receive() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      if (preview.kind === "exam") { if (!navigator.onLine) { const ref = await db.sharedExams.where('code').equals(preview.code).first(); if (ref) { nav(`/library/${ref.examId}`); return; } } const exam = await importExamShare(preview.code); nav(`/library/${exam.id}`); }
      else { const set = await importVocabularyShare(profile.id, preview.code); nav(`/vocabulary/sets/${set.id}`); }
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể nhận nội dung chia sẻ"); }
    finally { setBusy(false); }
  }

  const expiry = useMemo(() => preview?.expiresAt ? `Hết hạn ${new Date(preview.expiresAt).toLocaleString("vi-VN")}` : "Không hết hạn", [preview?.expiresAt]);

  return <div className="page-stack">
    <section className="page-hero">
      <div><span className="eyebrow">TRUNG TÂM CHIA SẺ</span><h1>Chia sẻ & nhận nội dung</h1><p>Một mã duy nhất để nhận đề thi hoặc bộ từ. Sau khi nhận, dữ liệu được lưu vào thiết bị để tiếp tục học offline.</p></div>
      <Link className="btn-secondary" to="/wiki"><AppIcon name="book" size={17}/> Xem hướng dẫn</Link>
    </section>

    {online && <section className="share-hub-grid">
      <div className="share-hub-card"><div className="share-icon"><AppIcon name="download" size={23}/></div><div><span className="eyebrow">NHẬN</span><h2>Nhập mã chia sẻ</h2><p>Dùng mã 6–10 ký tự do người khác gửi cho bạn.</p></div>
        <div className="share-code-form"><input className="input code-input" autoFocus={!routeCode} maxLength={10} placeholder="A7K92X" value={code} onChange={e => { setCode(normalize(e.target.value)); setError(""); }} onKeyDown={e => { if (e.key === "Enter" && code.length >= 6) void resolve(code); }}/><button className="btn-primary" disabled={loadingPreview || code.length < 6} onClick={() => void resolve(code)}>{loadingPreview ? "Đang kiểm tra…" : "Kiểm tra mã"}</button></div>
      </div>
      <div className="share-hub-card soft"><div className="share-icon"><AppIcon name="share" size={23}/></div><div><span className="eyebrow">CÁCH HOẠT ĐỘNG</span><h2>Online để nhận, offline để dùng</h2><p>Máy chủ chỉ làm nhiệm vụ phân phối. Đề và bộ từ sau khi nhập vẫn thuộc workspace local của bạn.</p></div><div className="share-flow"><span>01 · Mã</span><span>→</span><span>02 · Kiểm tra</span><span>→</span><span>03 · Lưu local</span></div></div>
    </section>}

    {!online && !preview && <div className="card border-line-warn bg-warn-soft text-sm text-warn"><strong>Đang offline.</strong> Nhập mã chia sẻ cần kết nối mạng. Các đề đã nhận trước đó vẫn có thể mở và làm offline.</div>}
    {error && <div className="form-error">{error}</div>}
    {preview && <section className={`share-receive-preview share-preview-${preview.kind}`}>
      <div className="share-receive-people">
        <div className="share-person-block">
          <div className="share-avatar">{preview.ownerAvatar ? <img src={preview.ownerAvatar} alt=""/> : <span>🙂</span>}</div>
          <div><span className="eyebrow">NGƯỜI CHIA SẺ</span><strong>{preview.ownerName ?? 'Người chia sẻ'}</strong><small>Đã chia sẻ {preview.kind === 'vocabularySet' ? 'bộ từ này' : 'đề này'}</small></div>
        </div>
        {preview.kind === "exam" ? (
          <div className="share-exam-info"><span className="source-pill shared">ĐỀ THI</span><h2>{preview.title}</h2><div className="share-exam-facts"><span>{preview.subject ?? 'Môn học'}</span>{preview.grade != null && <span>Lớp {preview.grade}</span>}<span>{preview.duration ? `${Math.round(preview.duration/60)} phút` : 'Không giới hạn'}</span><span>{preview.count ?? 0} câu</span></div></div>
        ) : (
          <div className="share-exam-info share-vocab-info"><span className="source-pill shared">BỘ TỪ</span><h2>{preview.title}</h2><p>{preview.description || 'Bộ từ học tập offline.'}</p><div className="share-exam-facts"><span>{preview.count ?? 0} từ</span><span>4 dạng luyện tập</span><span>Dùng offline sau khi nhận</span></div></div>
        )}
      </div>
      {preview.kind === "exam" ? (
        <div className="share-question-preview"><div className="flex items-center justify-between gap-2"><div><span className="eyebrow">XEM TRƯỚC</span><h3>Câu hỏi trong đề</h3></div><button className="btn-primary" disabled={busy} onClick={() => void receive()}>{busy ? 'Đang nhận…' : 'Nhận đề'}</button></div>
          {preview.questions?.slice(0,10).map((q,i)=><article key={i} className="share-question-row"><span>{i+1}</span><div><RichPreview text={q.content}/>{q.imageUrl && <img src={q.imageUrl} alt="Hình câu hỏi"/>}</div></article>)}
          {(preview.questions?.length ?? 0)>10 && <p className="text-xs muted mt-3">+ {(preview.questions?.length ?? 0)-10} câu khác</p>}
          <p className="share-offline-note">Sau khi nhận, đề được lưu vào Kho đề và dùng được offline. Đáp án không hiển thị ở màn hình nhận đề.</p>
        </div>
      ) : (
        <div className="share-question-preview share-vocab-preview"><div className="flex items-center justify-between gap-2"><div><span className="eyebrow">XEM TRƯỚC</span><h3>Từ trong bộ</h3></div><button className="btn-primary" disabled={busy} onClick={() => void receive()}>{busy ? 'Đang nhận…' : 'Nhận bộ từ'}</button></div>
          <div className="share-vocab-word-list">{preview.words?.slice(0,12).map((word,i)=><article key={`${word.english}-${i}`} className="share-vocab-word-row"><span>{i+1}</span><div><strong>{word.english}</strong><small>{word.vietnamese}</small></div></article>)}</div>
          {(preview.words?.length ?? 0)>12 && <p className="text-xs muted mt-3">+ {(preview.words?.length ?? 0)-12} từ khác</p>}
          <p className="share-offline-note">Sau khi nhận, bộ từ được lưu vào thiết bị và có thể luyện tập offline.</p>
        </div>
      )}
    </section>}

    {!routeCode && online && <section className="share-management card">
      <div className="share-management-head"><div><span className="eyebrow">QUẢN LÝ CHIA SẺ</span><h2>Mã chia sẻ của bạn</h2><p>Theo dõi mã đang hoạt động, số lần người khác nhập mã và cập nhật nội dung mà không cần tạo mã mới.</p></div><button className="btn-secondary" onClick={()=>void loadMyShares()}>Làm mới</button></div>
      {shareManagementError && <div className="form-error">{shareManagementError}</div>}
      {myShares.length === 0 ? <div className="share-management-empty">Bạn chưa có mã chia sẻ nào.</div> : <div className="share-management-list">{myShares.map((share)=><article className="share-management-row" key={share.shareId}>
        <div className="share-management-type">
          <span className={`source-pill ${share.packageType === 'vocabularySet' ? 'shared' : 'local'}`}>{share.packageType === 'vocabularySet' ? 'BỘ TỪ' : 'ĐỀ THI'}</span>
          <strong className="share-management-code">{share.shareCode}</strong>
          <span className="share-management-title">{managedTitles[share.shareId] ?? (share.packageType === 'exam' ? 'Đề thi chưa có trong thiết bị này' : 'Bộ từ chưa có trong thiết bị này')}</span>
        </div>
        <div className="share-management-stats"><span><b>{share.accessCount ?? 0}</b> lượt nhập</span><span>cập nhật {new Date(share.updatedAt ?? share.createdAt).toLocaleDateString('vi-VN')}</span><span>{share.expiresAt ? `Hết hạn ${new Date(share.expiresAt).toLocaleDateString('vi-VN')}` : 'Không hết hạn'}</span></div>
        <div className="share-management-actions">
          {share.packageType === 'exam' && share.sourceEntityId && managedTitles[share.shareId] && <Link className="btn-primary" to={`/library/${encodeURIComponent(share.sourceEntityId)}`}>Mở đề thi</Link>}
          {share.packageType === 'vocabularySet' && share.sourceEntityId && managedTitles[share.shareId] && <Link className="btn-primary" to={`/vocabulary/sets/${encodeURIComponent(share.sourceEntityId)}`}>Mở bộ từ</Link>}
          <button className="btn-secondary" disabled={!!shareAction} onClick={()=>void updateManagedShare(share)}>{shareAction===`update:${share.shareCode}`?'Đang cập nhật…':'Cập nhật nội dung'}</button>
          <button className="btn-secondary danger-soft" disabled={!!shareAction} onClick={()=>void removeManagedShare(share)}>{shareAction===`delete:${share.shareCode}`?'Đang xóa…':'Xóa mã'}</button>
        </div>
      </article>)}</div>}
    </section>}

    {!routeCode && <section className="info-grid"><Info icon="library" title="Đề thi" text="Nhập mã để tải .exam, xác thực hash/format và đưa đề vào Kho đề."/><Info icon="brain" title="Bộ từ" text="Nhập mã để tạo bản sao bộ từ trong thư viện. Bộ từ mới dùng được offline ngay sau khi nhận."/><Info icon="shield" title="An toàn" text="Mã được kiểm tra format, package và hash trước khi import; input không được dùng trực tiếp làm đường dẫn file."/></section>}
  </div>;
}

function RichPreview({ text }:{text:string}){ return <RichContent html={text || "(Chưa có nội dung)"}/>; }

function Info({ icon, title, text }: { icon: "library" | "brain" | "shield"; title: string; text: string }) { return <div className="info-card"><div className="info-icon"><AppIcon name={icon} size={20}/></div><div><h3>{title}</h3><p>{text}</p></div></div>; }
