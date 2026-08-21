import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExamFileImportDialog } from "../components/exam/ExamFileImportDialog";
import { AppIcon } from "../components/AppIcon";
import { examService } from "../../domain/exam/exam.service";
import type { Exam } from "../../domain/exam/exam.types";
import { importExamShare } from "../../domain/share/exam-share.service";

export function LibraryPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [shareCode, setShareCode] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");

  const load = () => examService.listExams().then(setExams).catch(() => setExams([]));
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => exams.filter(e => {
    const matchesSearch = `${e.title} ${e.subject}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (filter === "all" || e.source === filter || (filter === "favorite" && e.isFavorite));
  }).sort((a, b) => sort === "name" ? a.title.localeCompare(b.title) : sort === "favorite" ? Number(b.isFavorite) - Number(a.isFavorite) : b.updatedAt - a.updatedAt), [exams, search, filter, sort]);

  const counts = useMemo(() => ({ total: exams.length, favorites: exams.filter(e => e.isFavorite).length, questions: exams.reduce((n, e) => n + e.questionCount, 0) }), [exams]);

  async function fetchByCode() {
    try {
      setShareBusy(true); setShareError("");
      const exam = await importExamShare(shareCode);
      setShareCode(""); await load(); window.location.assign(`/library/${exam.id}`);
    } catch (e) { setShareError(e instanceof Error ? e.message : "Không thể lấy đề bằng mã"); }
    finally { setShareBusy(false); }
  }

  return <div className="page-stack">
    <section className="page-hero">
      <div><span className="eyebrow">THƯ VIỆN OFFLINE-FIRST</span><h1>Kho đề của bạn</h1><p>Tạo, import, chia sẻ và làm bài ngay cả khi không có Internet.</p></div>
      <div className="hero-actions"><button className="btn-secondary" onClick={() => setImportOpen(true)}><AppIcon name="upload" size={18} />Import .exam</button><Link className="btn-primary" to="/library/new"><AppIcon name="plus" size={18} />Tạo đề mới</Link></div>
    </section>

    <section className="stat-grid"><Stat label="Tổng số đề" value={counts.total} icon="library" /><Stat label="Đề yêu thích" value={counts.favorites} icon="star" /><Stat label="Tổng câu hỏi" value={counts.questions} icon="book" /></section>

    <section className="share-panel">
      <div className="share-icon"><AppIcon name="share" size={22} /></div>
      <div className="share-copy"><strong>Nhận đề bằng mã</strong><span>Nhập mã 6–10 ký tự từ bạn bè để thêm đề vào thư viện offline.</span></div>
      <div className="share-form"><input className="input code-input" maxLength={10} placeholder="A7K92X" value={shareCode} onChange={e => { setShareCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "")); setShareError(""); }} onKeyDown={e => { if (e.key === "Enter" && shareCode) void fetchByCode(); }} /><button className="btn-primary" disabled={shareBusy || shareCode.length < 6} onClick={() => void fetchByCode()}>{shareBusy ? "Đang lấy…" : "Lấy đề"}</button></div>
      {shareError && <div className="form-error">{shareError}</div>}
    </section>

    <section className="toolbar"><div className="search-wrap"><AppIcon name="search" size={18} /><input aria-label="Tìm đề" placeholder="Tìm theo tên hoặc môn học…" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="toolbar-selects"><select className="select" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Tất cả</option><option value="local">Đề của tôi</option><option value="official">Đề gốc</option><option value="shared">Đề đã chia sẻ</option><option value="favorite">Yêu thích</option></select><select className="select" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Mới cập nhật</option><option value="name">Tên A–Z</option><option value="favorite">Yêu thích</option></select></div></section>

    {visible.length === 0 ? <EmptyLibrary hasAny={exams.length > 0} /> : <div className="exam-grid">{visible.map(exam => <ExamCard key={exam.id} exam={exam} onDeleted={()=>void load()} />)}</div>}
    {importOpen && <ExamFileImportDialog onClose={() => setImportOpen(false)} onImported={load} />}
  </div>;
}

function Stat({ label, value, icon }: { label: string; value: number; icon: "library" | "star" | "book" }) { return <div className="stat-card"><div className="stat-icon"><AppIcon name={icon} size={20} /></div><div><strong>{value}</strong><span>{label}</span></div></div>; }
function ExamCard({ exam, onDeleted }: { exam: Exam; onDeleted:()=>void }) { const [confirming,setConfirming]=useState(false); const [busy,setBusy]=useState(false); async function remove(){setBusy(true);try{await examService.deleteExam(exam.id);onDeleted();setConfirming(false)}catch(e){alert(e instanceof Error?e.message:'Không thể xóa đề')}finally{setBusy(false)}} return <><Link to={`/library/${exam.id}`} className="exam-card"><div className="exam-card-top"><span className={`source-pill ${exam.source}`}>{exam.source === "shared" ? "Đã chia sẻ" : exam.source === "official" ? "Đề gốc" : "Cá nhân"}</span>{exam.isFavorite && <AppIcon name="star" size={17} className="favorite-icon" fill="currentColor" />}</div><h2>{exam.title}</h2><p className="exam-meta">{exam.subject}{exam.grade ? ` · Lớp ${exam.grade}` : ""}</p><div className="exam-card-footer"><span><AppIcon name="book" size={15} />{exam.questionCount} câu</span><span>{exam.duration !== undefined ? <><AppIcon name="clock" size={15} />{Math.round(exam.duration / 60)} phút</> : "Không giới hạn"}</span><AppIcon name="arrow" size={16} className="card-arrow" /></div></Link>{exam.source==='local'&&<button className="btn-secondary text-red-600 mt-2 w-full" onClick={e=>{e.preventDefault();e.stopPropagation();setConfirming(true)}}>Xóa đề</button>}{confirming&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={()=>!busy&&setConfirming(false)}><div className="card max-w-md w-full p-6" onClick={e=>e.stopPropagation()}><h2 className="text-lg font-bold">Bạn có chắc chắn muốn xóa đề này không?</h2><p className="text-sm text-slate-500 mt-2">Đề sẽ bị xóa vĩnh viễn và không thể hoàn tác.</p><div className="flex justify-end gap-2 mt-5"><button className="btn-secondary" disabled={busy} onClick={()=>setConfirming(false)}>Hủy</button><button className="btn-primary !bg-red-600" disabled={busy} onClick={()=>void remove()}>{busy?'Đang xóa…':'Xóa vĩnh viễn'}</button></div></div></div>}</>; }
function EmptyLibrary({ hasAny }: { hasAny: boolean }) { return <div className="empty-state"><div className="empty-icon"><AppIcon name={hasAny ? "search" : "library"} size={30} /></div><h2>{hasAny ? "Không tìm thấy đề phù hợp" : "Thư viện đang trống"}</h2><p>{hasAny ? "Thử đổi từ khóa hoặc bộ lọc." : "Tạo đề đầu tiên hoặc import một file .exam để bắt đầu."}</p>{!hasAny && <Link className="btn-primary" to="/library/new"><AppIcon name="plus" size={18} />Tạo đề đầu tiên</Link>}</div>; }
