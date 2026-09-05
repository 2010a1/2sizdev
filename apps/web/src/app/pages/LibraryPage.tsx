import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ExamFileImportDialog } from "../components/exam/ExamFileImportDialog";
import { AppIcon } from "../components/AppIcon";
import { Skeleton } from "../components/Skeleton";
import { examService } from "../../domain/exam/exam.service";
import type { Exam } from "../../domain/exam/exam.types";

export function LibraryPage() {
  const [exams, setExams] = useState<Exam[]>();
  const [loaded, setLoaded] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [shareCode, setShareCode] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  const nav = useNavigate();

  const load = () => examService.listExams().then(r => { setExams(r); setLoaded(true); }).catch(() => { setExams([]); setLoaded(true); });
  useEffect(() => { void load(); }, []);

  const list = exams ?? [];
  const visible = useMemo(() => list.filter(e => {
    const matchesSearch = `${e.title} ${e.subject}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (filter === "all" || e.source === filter || (filter === "favorite" && e.isFavorite));
  }).sort((a, b) => sort === "name" ? a.title.localeCompare(b.title) : sort === "favorite" ? Number(b.isFavorite) - Number(a.isFavorite) : b.updatedAt - a.updatedAt), [list, search, filter, sort]);

  const counts = useMemo(() => ({ total: list.length, favorites: list.filter(e => e.isFavorite).length, questions: list.reduce((n, e) => n + e.questionCount, 0) }), [list]);

  function fetchByCode() {
    if (shareCode.length < 6) return;
    nav(`/share/${shareCode}`);
  }

  return <div className="page-stack">
    <section className="page-hero">
      <div><span className="eyebrow">THƯ VIỆN OFFLINE-FIRST</span><h1>Kho đề của bạn</h1><p>Tạo, import, chia sẻ và làm bài ngay cả khi không có Internet.</p></div>
      <div className="hero-actions"><button className="btn-secondary" onClick={() => setImportOpen(true)}><AppIcon name="upload" size={18} />Import .exam</button><Link className="btn-primary" to="/library/new"><AppIcon name="plus" size={18} />Tạo đề mới</Link></div>
    </section>

    <section className="stat-grid"><Stat label="Tổng số đề" value={counts.total} icon="library" /><Stat label="Đề yêu thích" value={counts.favorites} icon="star" /><Stat label="Tổng câu hỏi" value={counts.questions} icon="book" /></section>

    <section className="share-panel">
      <div className="share-icon"><AppIcon name="share" size={22} /></div>
      <div className="share-copy"><strong>Nhận bằng mã chia sẻ</strong><span>Nhập mã 6–10 ký tự để nhận đề thi hoặc bộ từ vào workspace offline.</span></div>
      <div className="share-form"><input className="input code-input" maxLength={10} placeholder="A7K92X" value={shareCode} onChange={e => { setShareCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "")); setShareError(""); }} onKeyDown={e => { if (e.key === "Enter" && shareCode) fetchByCode(); }} /><button className="btn-primary" disabled={shareBusy || shareCode.length < 6} onClick={fetchByCode}>{shareBusy ? "Đang mở…" : "Tiếp tục"}</button></div>
      {shareError && <div className="form-error">{shareError}</div>}
    </section>

    <section className="toolbar"><div className="search-wrap"><AppIcon name="search" size={18} /><input aria-label="Tìm đề" placeholder="Tìm theo tên hoặc môn học…" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="toolbar-selects"><select className="select" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Tất cả</option><option value="local">Đề của tôi</option><option value="official">Đề gốc</option><option value="shared">Đề đã chia sẻ</option><option value="favorite">Yêu thích</option></select><select className="select" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Mới cập nhật</option><option value="name">Tên A–Z</option><option value="favorite">Yêu thích</option></select></div></section>

    {!loaded ? <div className="exam-grid">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="exam-card"><div className="exam-card-top"><Skeleton className="h-6 w-24 rounded-full" /></div><Skeleton className="h-5 w-3/4" /><Skeleton className="h-3.5 w-1/2" /><div className="exam-card-footer mt-auto"><Skeleton className="h-3.5 w-14" /><Skeleton className="h-3.5 w-16" /></div></div>)}</div>
    : visible.length === 0 ? <EmptyLibrary hasAny={list.length > 0} /> : <div className={`exam-grid exam-grid-${localStorage.getItem("thi-thu:library-view") || "block"}`}>{visible.map(exam => <ExamCard key={exam.id} exam={exam} />)}</div>}
    {importOpen && <ExamFileImportDialog onClose={() => setImportOpen(false)} onImported={load} />}
  </div>;
}

function Stat({ label, value, icon }: { label: string; value: number; icon: "library" | "star" | "book" }) { return <div className="stat-card"><div className="stat-icon"><AppIcon name={icon} size={20} /></div><div><strong>{value}</strong><span>{label}</span></div></div>; }
function ExamCard({ exam }: { exam: Exam }) { return <Link to={`/library/${exam.id}`} className="exam-card"><div className="exam-card-top"><span className={`source-pill ${exam.source}`}>{exam.source === "shared" ? "Đã chia sẻ" : exam.source === "official" ? "Đề gốc" : "Cá nhân"}</span>{exam.isFavorite && <AppIcon name="star" size={17} className="favorite-icon" fill="currentColor" />}</div><h2>{exam.title}</h2><p className="exam-meta">{exam.subject}{exam.grade ? ` · Lớp ${exam.grade}` : ""}</p><div className="exam-card-footer"><span><AppIcon name="book" size={15} />{exam.questionCount} câu</span><span>{exam.duration !== undefined ? <><AppIcon name="clock" size={15} />{Math.round(exam.duration / 60)} phút</> : "Không giới hạn"}</span><AppIcon name="arrow" size={16} className="card-arrow" /></div></Link>; }
function EmptyLibrary({ hasAny }: { hasAny: boolean }) { return <div className="empty-state"><div className="empty-icon"><AppIcon name={hasAny ? "search" : "library"} size={30} /></div><h2>{hasAny ? "Không tìm thấy đề phù hợp" : "Thư viện đang trống"}</h2><p>{hasAny ? "Thử đổi từ khóa hoặc bộ lọc." : "Tạo đề đầu tiên hoặc import một file .exam để bắt đầu."}</p>{!hasAny && <Link className="btn-primary" to="/library/new"><AppIcon name="plus" size={18} />Tạo đề đầu tiên</Link>}</div>; }
