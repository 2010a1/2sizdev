import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";
import { Skeleton } from "../components/Skeleton";
import { examService } from "../../domain/exam/exam.service";
import { attemptService } from "../../domain/exam/attempt.service";
import type { Exam } from "../../domain/exam/exam.types";
import { authApi } from "../../infrastructure/api/auth";
import { useAuthStore } from "../../state/authStore";
import { useProfileStore } from "../../state/profileStore";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";

/** One in-progress practice attempt to offer as "continue where you left off". */
type Continuation = { exam: Exam; questionIndex: number };

export function DashboardPage() {
  const user = useAuthStore(s => s.user);
  const online = useOnlineStatus();
  const nav = useNavigate();
  const profile = useProfileStore(s => s.activeProfile);
  const [exams, setExams] = useState<Exam[]>([]);
  const [stats, setStats] = useState({ shares: 0, exams: 0, attempts: 0 });
  const [continueAt, setContinueAt] = useState<Continuation | undefined>();
  const [shareCode, setShareCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const local = await examService.listExams().catch(() => [] as Exam[]);
    setExams(local);
    setLoaded(true);
    // Cheap indexed lookups on the most recent exams; no session rebuild here.
    for (const exam of [...local].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6)) {
      const attempt = profile ? await attemptService.resumeAttempt(profile.id, exam.id, "practice").catch(() => undefined) : undefined;
      if (attempt) { setContinueAt({ exam, questionIndex: attempt.currentQuestionIndex ?? 0 }); break; }
    }
    if (user) {
      try {
        const result = await authApi.account();
        const s = result.stats ?? {};
        setStats({ shares: Number(s.shares ?? 0), exams: Number(s.exams ?? 0), attempts: Number(s.practice ?? 0) + Number(s.tournament ?? 0) });
      } catch {
        // Dashboard remains useful offline; local exam data is still rendered.
      }
    }
  };

  useEffect(() => { void load(); }, [user?.id]);

  const recent = useMemo(() => [...exams].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6), [exams]);

  function receiveSharedContent() {
    if (shareCode.length < 6) return;
    setError("");
    nav(`/share/${shareCode}`);
  }

  return <div className="dashboard-page">
    <section className="dashboard-heading">
      <div>
        <span className="eyebrow">TRANG CHỦ</span>
        <h1>Chào {user?.name || user?.username || "bạn"}, học tiếp nào!</h1>
        <p className="text-sm muted mt-1">Luyện tập, thi đấu và ôn từ vựng — tất cả chạy offline trên thiết bị của bạn.</p>
      </div>
      <Link to="/library" className="dashboard-outline-btn"><AppIcon name="library" size={17} />Kho đề</Link>
    </section>

    {continueAt && (
      <Link to={`/practice/${continueAt.exam.id}`} className="dashboard-continue card">
        <span className="dashboard-icon-box"><AppIcon name="play" size={19} /></span>
        <div>
          <strong>Tiếp tục bài đang làm: {continueAt.exam.title}</strong>
          <small>Đã làm đến câu {Math.min(continueAt.questionIndex + 1, Math.max(1, continueAt.exam.questionCount))} / {continueAt.exam.questionCount || "?"} · nhấn để quay lại</small>
        </div>
        <AppIcon name="arrow" size={18} />
      </Link>
    )}

    <section className="dashboard-actions">
      <Link to="/library/new" className="dashboard-create-card">
        <span className="dashboard-create-icon"><AppIcon name="plus" size={25} /></span>
        <span><strong>Tạo bài thi mới</strong><small>Soạn câu hỏi trực tiếp, AI hoặc JSON</small></span>
        <AppIcon name="arrow" size={20} />
      </Link>
      <Link to="/vocabulary" className="dashboard-create-card">
        <span className="dashboard-create-icon"><AppIcon name="brain" size={25} /></span>
        <span><strong>Ôn từ vựng</strong><small>Luyện bộ từ tiếng Anh đã lưu</small></span>
        <AppIcon name="arrow" size={20} />
      </Link>
    </section>

    <section className="dashboard-stats">
      {loaded ? <>
        <Stat icon="library" value={exams.length} label="Đề lưu trên thiết bị này" />
        <Stat icon="share" value={stats.shares} label="Đề đang chia sẻ trên web" />
        <Stat icon="check" value={stats.attempts} label="Lượt làm bài (server ghi nhận)" />
      </> : <>
        <div className="dashboard-stat-card"><Skeleton className="h-9 w-9 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-16" /><Skeleton className="h-3.5 w-32" /></div></div>
        <div className="dashboard-stat-card"><Skeleton className="h-9 w-9 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-16" /><Skeleton className="h-3.5 w-28" /></div></div>
        <div className="dashboard-stat-card"><Skeleton className="h-9 w-9 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-16" /><Skeleton className="h-3.5 w-24" /></div></div>
      </>}
    </section>

    <section className="dashboard-recent card">
      <div className="dashboard-panel-head"><div><h2>Các bài thi gần đây</h2><p>Những đề bạn vừa mở hoặc cập nhật trong thư viện.</p></div><Link to="/library" className="dashboard-text-link">Xem tất cả <AppIcon name="arrow" size={15} /></Link></div>
      {!loaded ? <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="flex items-center gap-3"><Skeleton className="h-5 flex-1" /><Skeleton className="h-5 w-20" /><Skeleton className="h-5 w-14" /></div>)}</div>
      : recent.length === 0 ? <div className="dashboard-empty"><AppIcon name="library" size={28} /><span>Chưa có bài thi nào.</span><Link to="/library/new" className="btn-primary">Tạo bài thi đầu tiên</Link></div> : <div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>Tên bài thi</th><th>Loại</th><th>Số câu</th><th>Thời gian</th><th>Cập nhật</th><th>Thao tác</th></tr></thead><tbody>{recent.map(exam => <tr key={exam.id}><td><Link to={`/library/${exam.id}`} className="dashboard-exam-name"><span className="dashboard-row-icon"><AppIcon name="book" size={17} /></span>{exam.title}</Link></td><td><span className={`dashboard-pill ${exam.source}`}>{exam.source === "official" ? "Chính thức" : exam.source === "shared" ? "Đã nhận" : "Cá nhân"}</span></td><td>{exam.questionCount}</td><td>{exam.duration ? `${Math.round(exam.duration / 60)} phút` : "—"}</td><td>{new Date(exam.updatedAt).toLocaleDateString("vi-VN")}</td><td><Link to={`/library/${exam.id}`} className="dashboard-row-action"><AppIcon name="play" size={15} /></Link></td></tr>)}</tbody></table></div>}
    </section>

    {online && (
      <section className="dashboard-receive card">
        <div className="dashboard-section-title"><span className="dashboard-icon-box"><AppIcon name="download" size={19} /></span><div><h2>Nhận đề bằng mã chia sẻ</h2><p>Nhập mã 6–10 ký tự để tải đề hoặc bộ từ vào thiết bị.</p></div></div>
        <div className="dashboard-code-form">
          <div className="dashboard-code-input"><AppIcon name="share" size={18} /><input aria-label="Mã nhận đề" maxLength={10} value={shareCode} placeholder="Nhập mã chia sẻ..." onChange={e => { setShareCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "")); setError(""); }} onKeyDown={e => e.key === "Enter" && receiveSharedContent()} /></div>
          <button className="btn-primary" disabled={busy || shareCode.length < 6} onClick={receiveSharedContent}>{busy ? "Đang mở…" : "Tiếp tục"}<AppIcon name="arrow" size={16} /></button>
        </div>
        {error && <p className="dashboard-error">{error}</p>}
      </section>
    )}
  </div>;
}

function Stat({ icon, value, label }: { icon: "share" | "library" | "check"; value: number; label: string }) {
  return <article className="dashboard-stat-card"><span className="dashboard-stat-icon"><AppIcon name={icon} size={22} /></span><div><strong>{value.toLocaleString("vi-VN")}</strong><span>{label}</span></div><span className="dashboard-stat-line" /></article>;
}
