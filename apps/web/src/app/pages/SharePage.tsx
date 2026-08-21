import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useProfileStore } from "../../state/profileStore";
import { AppIcon } from "../components/AppIcon";
import { getShare, importExamShare } from "../../domain/share/exam-share.service";
import { getVocabularyShare, importVocabularyShare } from "../../domain/share/vocabulary-share.service";

type ShareKind = "exam" | "vocabularySet";
type Preview = { kind: ShareKind; code: string; title: string; description?: string; count?: number; expiresAt?: number };

function normalize(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10); }

export function SharePage() {
  const { code: routeCode } = useParams();
  const profile = useProfileStore(s => s.activeProfile)!;
  const nav = useNavigate();
  const [code, setCode] = useState(normalize(routeCode ?? ""));
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(Boolean(routeCode));

  useEffect(() => { setCode(normalize(routeCode ?? "")); }, [routeCode]);
  useEffect(() => {
    if (!routeCode) { setPreview(undefined); setError(""); setLoadingPreview(false); return; }
    void resolve(routeCode);
  }, [routeCode]);

  async function resolve(raw: string) {
    const normalized = normalize(raw); setLoadingPreview(true); setError(""); setPreview(undefined);
    try {
      const share = await getShare(normalized);
      if (share.packageType === "exam") {
        setPreview({ kind: "exam", code: share.shareCode, title: "Đề thi được chia sẻ", description: "Gói .exam sẽ được kiểm tra và nhập vào thư viện offline.", expiresAt: share.expiresAt });
      } else {
        const vocab = await getVocabularyShare(normalized);
        setPreview({ kind: "vocabularySet", code: share.shareCode, title: vocab.payload.set.name, description: vocab.payload.set.description, count: vocab.wordCount, expiresAt: share.expiresAt });
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể đọc mã chia sẻ"); }
    finally { setLoadingPreview(false); }
  }

  async function receive() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      if (preview.kind === "exam") { const exam = await importExamShare(preview.code); nav(`/library/${exam.id}`); }
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

    <section className="share-hub-grid">
      <div className="share-hub-card"><div className="share-icon"><AppIcon name="download" size={23}/></div><div><span className="eyebrow">NHẬN</span><h2>Nhập mã chia sẻ</h2><p>Dùng mã 6–10 ký tự do người khác gửi cho bạn.</p></div>
        <div className="share-code-form"><input className="input code-input" autoFocus={!routeCode} maxLength={10} placeholder="A7K92X" value={code} onChange={e => { setCode(normalize(e.target.value)); setError(""); }} onKeyDown={e => { if (e.key === "Enter" && code.length >= 6) void resolve(code); }}/><button className="btn-primary" disabled={loadingPreview || code.length < 6} onClick={() => void resolve(code)}>{loadingPreview ? "Đang kiểm tra…" : "Kiểm tra mã"}</button></div>
      </div>
      <div className="share-hub-card soft"><div className="share-icon"><AppIcon name="share" size={23}/></div><div><span className="eyebrow">CÁCH HOẠT ĐỘNG</span><h2>Online để nhận, offline để dùng</h2><p>Máy chủ chỉ làm nhiệm vụ phân phối. Đề và bộ từ sau khi nhập vẫn thuộc workspace local của bạn.</p></div><div className="share-flow"><span>01 · Mã</span><span>→</span><span>02 · Kiểm tra</span><span>→</span><span>03 · Lưu local</span></div></div>
    </section>

    {error && <div className="form-error">{error}</div>}
    {preview && <section className="share-preview">
      <div className="share-preview-icon"><AppIcon name={preview.kind === "exam" ? "library" : "brain"} size={25}/></div>
      <div className="min-w-0 flex-1"><span className="source-pill shared">{preview.kind === "exam" ? "ĐỀ THI" : "BỘ TỪ"}</span><h2>{preview.title}</h2>{preview.description && <p>{preview.description}</p>}<div className="share-preview-meta"><span>Mã <b>{preview.code}</b></span>{preview.count !== undefined && <span>{preview.count} từ</span>}<span>{expiry}</span></div></div>
      <button className="btn-primary" disabled={busy} onClick={() => void receive()}>{busy ? "Đang nhận…" : preview.kind === "exam" ? "Nhận đề" : "Nhận bộ từ"}</button>
    </section>}

    {!routeCode && <section className="info-grid"><Info icon="library" title="Đề thi" text="Nhập mã để tải .exam, xác thực hash/format và đưa đề vào Kho đề."/><Info icon="brain" title="Bộ từ" text="Nhập mã để tạo bản sao bộ từ trong thư viện. Bộ từ mới dùng được offline ngay sau khi nhận."/><Info icon="shield" title="An toàn" text="Mã được kiểm tra format, package và hash trước khi import; input không được dùng trực tiếp làm đường dẫn file."/></section>}
  </div>;
}

function Info({ icon, title, text }: { icon: "library" | "brain" | "shield"; title: string; text: string }) { return <div className="info-card"><div className="info-icon"><AppIcon name={icon as any} size={20}/></div><div><h3>{title}</h3><p>{text}</p></div></div>; }
