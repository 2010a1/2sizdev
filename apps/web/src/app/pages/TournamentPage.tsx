import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppIcon } from "../components/AppIcon";
import { examService } from "../../domain/exam/exam.service";
import type { Exam } from "../../domain/exam/exam.types";

export function TournamentPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  useEffect(() => { void examService.listExams().then(setExams); }, []);
  return <div className="page-stack">
    <section className="mode-hero tournament-hero"><div className="mode-icon"><AppIcon name="trophy" size={28} /></div><div><span className="eyebrow">THI ĐẤU</span><h1>Vào phòng thi</h1><p>Mô phỏng áp lực thi thật: section cố định, câu hỏi xáo trộn ổn định và chấm điểm theo engine hiện tại.</p></div></section>
    <section className="section-heading"><div><h2>Chọn đề thi đấu</h2><p>{exams.length} đề khả dụng trên thiết bị</p></div><Link className="btn-secondary" to="/library"><AppIcon name="library" size={17} />Mở kho đề</Link></section>
    {exams.length === 0 ? <div className="empty-state"><div className="empty-icon"><AppIcon name="trophy" size={30} /></div><h2>Chưa có đề để thi</h2><p>Thêm đề vào thư viện trước khi bắt đầu.</p><Link className="btn-primary" to="/library"><AppIcon name="library" size={18} />Đến Kho đề</Link></div> : <div className="mode-list">{exams.map(e => <div className="mode-card" key={e.id}><div className="mode-card-icon accent"><AppIcon name="trophy" size={20} /></div><div className="mode-card-copy"><strong>{e.title}</strong><span>{e.subject}{e.grade ? ` · Lớp ${e.grade}` : ""}</span><small>{e.questionCount} câu{e.duration !== undefined ? ` · ${Math.round(e.duration / 60)} phút` : ""}</small></div><Link className="btn-primary" to={`/tournament/${e.id}`}><AppIcon name="play" size={17} />Thi đấu</Link></div>)}</div>}
  </div>;
}
