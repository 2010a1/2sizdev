import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { examService } from "../../domain/exam/exam.service";
import { examRepository } from "../../domain/exam/exam.repository";
import { examFileService } from "../../domain/exam/exam.file.service";
import type { Exam, Question } from "../../domain/exam/exam.types";
import { RichContent } from "../components/exam/RichContent";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { createExamShare } from "../../domain/share/exam-share.service";
import { AppIcon } from "../components/AppIcon";
import { Skeleton } from "../components/Skeleton";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename.endsWith(".exam") ? filename : `${filename}.exam`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExamDetailPage() {
  const { examId } = useParams(); const nav = useNavigate();
  const [exam, setExam] = useState<Exam>(); const [qs, setQs] = useState<Question[]>([]); const [exporting, setExporting] = useState(false); const [notice, setNotice] = useState(""); const [shareBusy, setShareBusy] = useState(false); const [shareCode, setShareCode] = useState(""); const [deleteOpen, setDeleteOpen] = useState(false); const [deleting, setDeleting] = useState(false); const [loadError, setLoadError] = useState("");
  const load = async () => { if (!examId) return; try { setLoadError(""); setExam(await examService.getExam(examId)); setQs(await examRepository.getQuestionsByExam(examId)); } catch { setLoadError("Không tìm thấy đề thi trên thiết bị này."); } };
  useEffect(() => { void load(); }, [examId]);
  if (loadError) return <div className="empty-state"><div className="empty-icon"><AppIcon name="library" size={28} /></div><h2>{loadError}</h2><p>Đề có thể đã bị xóa hoặc chưa được tải về thiết bị.</p><Link className="btn-primary" to="/library">Về Kho đề</Link></div>;
  if (!exam) return <div className="page-stack max-w-6xl mx-auto">
    <Skeleton className="h-4 w-40" />
    <div className="card space-y-5">
      <Skeleton className="h-6 w-28 rounded-full" />
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-4 w-44" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      <div className="grid grid-cols-2 gap-3">{[0, 1].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
    </div>
  </div>;
  const readOnly = exam.source !== "local";
  async function handleExport() { const currentExam = exam; if (!currentExam) return; setNotice(""); setExporting(true); try { const { blob, filename } = await examFileService.exportExam(currentExam.id); if (!blob.size) throw new Error("File xuất ra đang rỗng"); downloadBlob(blob, filename); setNotice(`Đã xuất ${filename}`); } catch (e) { setNotice(`Không thể xuất file: ${e instanceof Error ? e.message : "Lỗi không xác định"}`); } finally { setExporting(false); } }
  async function share() { const currentExam = exam; if (!currentExam) return; try { setShareBusy(true); setNotice(""); const result = await createExamShare(currentExam.id); setShareCode(result.shareCode); try { await navigator.clipboard.writeText(result.shareCode); setNotice(`Đã tạo mã ${result.shareCode} và sao chép vào clipboard.`); } catch { setNotice(`Đã tạo mã ${result.shareCode}.`); } } catch (e) { setNotice(`Không thể chia sẻ: ${e instanceof Error ? e.message : "Lỗi không xác định"}`); } finally { setShareBusy(false); } }
  async function handleDelete() { if (!exam) return; setDeleting(true); try { await examService.deleteExam(exam.id); nav("/library"); } catch (e) { setNotice(`Không thể xóa đề: ${e instanceof Error ? e.message : "Lỗi không xác định"}`); setDeleteOpen(false); } finally { setDeleting(false); } }
  async function copyShareCode() { try { await navigator.clipboard.writeText(shareCode); setNotice("Đã sao chép mã đề."); } catch { setNotice("Trình duyệt không cho phép sao chép tự động."); } }

  return <div className="page-stack max-w-6xl mx-auto">
    <Breadcrumbs items={[{ label: "Trang chủ", to: "/" }, { label: "Kho đề", to: "/library" }, { label: exam.title }]} />
    <section className="card sm:p-7">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`source-pill ${exam.source}`}>{exam.source === "shared" ? "Đã chia sẻ" : exam.source === "official" ? "Đề gốc" : "Cá nhân"}</span><span className="text-[10px] muted">v{exam.version}</span></div><h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight break-words">{exam.title}</h1><p className="text-sm muted mt-2">{exam.subject}{exam.grade ? ` · Lớp ${exam.grade}` : ""}</p></div><button aria-label="Yêu thích" className="w-11 h-11 grid place-items-center rounded-xl border border-[var(--line)] bg-[var(--surface)] text-warn hover:bg-warn-soft" onClick={async () => { await examService.favoriteExam(exam.id); void load(); }}><AppIcon name="star" size={21} fill={exam.isFavorite ? "currentColor" : "none"} /></button></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-6"><InfoStat label="Câu hỏi" value={`${qs.length} câu`} icon="book" /><InfoStat label="Thời gian" value={exam.duration !== undefined ? `${Math.round(exam.duration / 60)} phút` : "Không giới hạn"} icon="clock" /><InfoStat label="Nguồn" value={exam.source === "local" ? "Cá nhân" : exam.source} icon="library" /><InfoStat label="Trạng thái" value="Offline sẵn sàng" icon="check" /></div>
      {exam.description && <p className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm leading-6 text-[var(--muted)]">{exam.description}</p>}
      <section className="exam-mode-picker mt-6">
        <div><p className="eyebrow">BẮT ĐẦU BÀI THI</p><h2>Chọn chế độ</h2><p>Chọn cách bạn muốn làm đề. Không còn phải đi qua menu Luyện tập hoặc Thi đấu.</p></div>
        <div className="exam-mode-grid">
          <Link className="exam-mode-card exam-mode-card-primary" to={`/practice/${exam.id}`}><span className="exam-mode-icon"><AppIcon name="play" size={20}/></span><span><strong>Luyện tập</strong><small>Làm toàn bộ đề, có thể quay lại và sửa đáp án.</small></span><b>→</b></Link>
          <Link className="exam-mode-card" to={`/tournament/${exam.id}`}><span className="exam-mode-icon"><AppIcon name="trophy" size={20}/></span><span><strong>Thi đấu</strong><small>Chế độ thi nhanh, trả lời sai có thể kết thúc lượt.</small></span><b>→</b></Link>
        </div>
      </section>
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mt-5">{readOnly ? <button className="btn-secondary" onClick={async () => { const copy = await examService.duplicateExam(exam.id); nav(`/library/${copy.id}/edit`); }}><AppIcon name="plus" size={17} />Sao chép</button> : <Link className="btn-secondary" to={`/library/${exam.id}/edit`}><AppIcon name="edit" size={17} />Sửa đề</Link>}<button className="btn-secondary" onClick={handleExport} disabled={exporting}><AppIcon name="download" size={17} />{exporting ? "Đang xuất…" : "Xuất .exam"}</button><button className="btn-secondary" onClick={() => void share()} disabled={shareBusy}><AppIcon name="share" size={17} />{shareBusy ? "Đang tạo…" : "Chia sẻ"}</button>{exam.source === "local" && <button className="btn-secondary danger-soft" onClick={() => setDeleteOpen(true)}><AppIcon name="shield" size={17} />Xóa đề</button>}</div>
      {shareCode && <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-[var(--accent-soft)] bg-[var(--accent-soft)] p-4"><div className="flex-1"><span className="text-[10px] font-extrabold tracking-[.12em] text-[var(--accent)]">MÃ CHIA SẺ</span><div className="mt-1 text-2xl font-black tracking-[.2em] text-[var(--accent-strong)]">{shareCode}</div><p className="mt-1 text-xs text-[var(--muted)]">Người khác có thể nhập mã này trong Kho đề.</p></div><button className="btn-secondary" onClick={() => void copyShareCode()}><AppIcon name="share" size={16} />Sao chép mã</button></div>}
      {deleteOpen && <div className="dialog-overlay" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-2xl bg-[var(--surface)] border border-[var(--line)] p-6 shadow-2xl"><h2 className="text-lg font-bold">Bạn có chắc chắn muốn xóa đề này không?</h2><p className="mt-2 text-sm leading-6 muted">Hành động này sẽ xóa đề vĩnh viễn và không thể hoàn tác.</p><div className="mt-6 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setDeleteOpen(false)} disabled={deleting}>Hủy</button><button className="btn-primary !bg-grade hover:!bg-grade" onClick={() => void handleDelete()} disabled={deleting}>{deleting ? "Đang xóa…" : "Xóa vĩnh viễn"}</button></div></div></div>}{notice && <p role="status" className={`mt-3 text-xs ${notice.startsWith("Không thể") ? "text-[var(--grade)]" : "text-[var(--pass)]"}`}>{notice}</p>}
    </section>
    <section><div className="section-heading mb-3"><div><h2>Danh sách câu hỏi</h2><p>{qs.length} câu trong đề</p></div></div><div className="space-y-2.5">{qs.map((q, i) => <article className="card sm:p-5" key={q.id}><div className="flex items-start gap-3"><span className="question-number">{i + 1}</span><div className="min-w-0 flex-1"><div className="font-semibold leading-6 break-words"><RichContent html={q.content || "(Chưa có nội dung)"} /></div><div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide muted"><span>{q.type}</span><span>·</span><span>{q.points} điểm</span></div></div></div></article>)}</div></section>
  </div>;
}

function InfoStat({ label, value, icon }: { label: string; value: string; icon: "book" | "clock" | "library" | "check" }) { return <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide muted"><AppIcon name={icon} size={14} />{label}</div><strong className="block mt-2 text-sm text-[var(--ink)]">{value}</strong></div>; }
